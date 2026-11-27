const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const { createCredentialStore } = require('../credential-store');
const app = require('../server');

const browser = process.env.CHROMIUM_BIN;

async function until(check) {
  for (let i = 0; i < 100; i++) {
    const value = await check();
    if (value) return value;
    await delay(50);
  }
  throw new Error(`Browser condition not reached: ${check}`);
}

test('browser renders safely, remembers credentials on opt-in, and restores submitted chat turns', {
  skip: !browser && 'Set CHROMIUM_BIN to a Chromium browser executable',
  timeout: 30000,
}, async (t) => {
  const realFetch = global.fetch;
  const reply = '# Completed reply\n\n| Left | Right |\n| --- | --- |\n| A | B |\n\n' +
    '```demo<&>\nexample()\n```\n\n![remote image](https://example.invalid/remote.png)\n\n' +
    '[docs](https://example.invalid/docs)\n\n<p>raw markup</p>';
  const frame = (content) => new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  let finishReply;
  let modelStatus = 200;
  const modelKeys = [];
  const chatRequests = [];
  let startDisconnect;
  global.fetch = async (url, options) => {
    if (url === 'https://openrouter.ai/api/v1/models') {
      modelKeys.push(options.headers.Authorization);
      if (modelStatus !== 200) return new Response(null, { status: modelStatus });
      return Response.json({ data: [
        { id: 'test/model', name: 'Mock model', reasoning: { supported_efforts: ['high'] } },
        { id: 'test/other', name: 'Other model', reasoning: { supported_efforts: ['low', 'none'] } },
      ] });
    }
    assert.equal(options.headers.Authorization, 'Bearer mock-key');
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const payload = JSON.parse(options.body);
    chatRequests.push(payload);
    const prompt = payload.messages.at(-1).content;
    const done = new TextEncoder().encode('data: [DONE]\n\n');
    if (prompt === 'Failed query') return Response.json({ error: 'Mock upstream failure' }, { status: 503 });
    if (prompt === 'Empty query') return new Response(done);
    if (prompt === 'Next query') return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(frame('A reply'));
      controller.enqueue(done);
      controller.close();
    } }));
    if (['Project partial', 'Before text', 'Reload pending', 'Timeout before text'].includes(prompt)) {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(frame(prompt === 'Project partial' ? 'Partial text' : ''));
          if (prompt === 'Project partial') startDisconnect = () => controller.close();
        },
      }));
    }
    assert.equal(prompt, 'Test prompt');
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(frame('# Completed reply'));
        finishReply = () => {
          controller.enqueue(frame(reply.slice('# Completed reply'.length)));
          controller.enqueue(done);
          controller.close();
        };
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  t.after(() => { global.fetch = realFetch; });

  const keyRoot = await mkdtemp(path.join(tmpdir(), 'openrouter-browser-key-'));
  const keyDirectory = path.join(keyRoot, 'private');
  const originalStore = app.locals.credentialStore;
  const store = createCredentialStore(keyDirectory);
  app.locals.credentialStore = store;
  t.after(async () => {
    app.locals.credentialStore = originalStore;
    await rm(keyRoot, { recursive: true, force: true });
  });

  const server = app.listen(0, '127.0.0.1');
  t.after(() => {
    server.close();
    server.closeAllConnections?.();
  });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const profile = await mkdtemp(path.join(tmpdir(), 'openrouter-browser-test-'));
  const child = spawn(browser, [
    '--headless', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserError;
  let stderr = '';
  child.on('error', (err) => { browserError = err; });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4096); });
  t.after(async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  });
  const debugPort = await until(async () => {
    if (browserError) throw browserError;
    if (child.exitCode !== null) throw new Error(`Browser exited: ${stderr}`);
    try {
      return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  });
  const targets = await (await realFetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  t.after(() => socket.close());
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('Could not connect to the test browser')), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const requests = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    const command = pending.get(message.id);
    if (command) {
      pending.delete(message.id);
      clearTimeout(command.timer);
      if (message.error) command.reject(new Error(message.error.message));
      else command.resolve(message.result);
    }
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Browser command timed out: ${method}`));
    }, 5000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const read = async (expression) => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description);
    return result.result.value;
  };
  const ready = () => until(() => read('document.readyState === "complete" && !!document.querySelector("#settings-btn")'));

  await cdp('Page.enable');
  await cdp('Network.enable');
  await cdp('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp('Network.setBlockedURLs', { urls: ['https://*'] });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.policyViolations = [];
    window.addEventListener('securitypolicyviolation', (event) => window.policyViolations.push(event.violatedDirective));
    if (!sessionStorage.getItem('fixtures-seeded')) {
      sessionStorage.setItem('fixtures-seeded', 'yes');
      localStorage.setItem('openrouter_api_key', 'old-mock-key');
      localStorage.setItem('openrouter_conversations', JSON.stringify([{
        id: 'retained', title: 'Retained <history>', model: 'test/model', messages: [{
          role: 'user', content: 'Earlier chat', attachmentMeta: [{
            category: 'image', name: 'Old "image".png', dataUrl: 'https://example.invalid/old.png',
          }],
        }],
      }]));
    }
  ` });
  await cdp('Page.navigate', { url: base });
  await ready();
  assert.equal(await read('localStorage.getItem("openrouter_api_key")'), null);
  assert.equal(await read('document.querySelector(".conv-title").textContent'), 'Retained <history>');
  assert.equal(await read('document.querySelector(".message-attachment-file span").textContent'), 'Old "image".png');
  assert.equal(await read('!!document.querySelector(".message-attachments img")'), false);
  assert.equal(await read('document.querySelector("#send-btn").disabled'), true);

  await read(`document.querySelector('#settings-btn').click();
    document.querySelector('#api-key-input').value = 'mock-key';
    document.querySelector('#save-settings').click();`);
  await until(() => read('!document.querySelector("#send-btn").disabled'));
  assert.equal(await read('document.querySelector("#api-key-input").value'), '');
  assert.equal(await read('localStorage.getItem("openrouter_api_key")'), null);

  const fileName = 'draft "Q4" & notes.txt';
  const projectName = 'Project <notes> "Q4"';
  await read(`window.addTestFile = (selector, file) => {
    const input = document.querySelector(selector);
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change'));
  };
  window.addTestFile('#file-input', new File(['notes'], ${JSON.stringify(fileName)}, { type: 'text/plain' }));`);
  await until(() => read('!!document.querySelector(".attachment-preview .file-name")'));
  assert.deepEqual(await read(`(() => {
    const el = document.querySelector('.attachment-preview .file-name');
    return [el.title, el.textContent, el.getAttributeNames()];
  })()`), [fileName, fileName, ['class', 'title']]);
  await read(`document.querySelector('.remove-attachment').click();
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
    window.addTestFile('#file-input', new File([png], 'pixel.png', { type: 'image/png' }));`);
  await until(() => read('document.querySelector(".attachment-preview img")?.naturalWidth === 1'));
  await read(`document.querySelector('.remove-attachment').click();
    document.querySelector('#new-project-btn').click();
    document.querySelector('#project-name-input').value = ${JSON.stringify(projectName)};
    window.addTestFile('#project-file-input', new File(['notes'], ${JSON.stringify(fileName)}, { type: 'text/plain' }));`);
  await until(() => read('!!document.querySelector(".project-file-entry")'));
  assert.equal(await read('document.querySelector(".project-file-entry .file-name").title'), fileName);
  await read('document.querySelector("#save-project-btn").click()');
  assert.deepEqual(await read(`(() => {
    const el = document.querySelector('.project-header h3');
    return [el.title, el.textContent, el.getAttributeNames(), document.querySelector('.project-file-item span').textContent];
  })()`), [projectName, projectName, ['title'], fileName]);

  await read(`document.querySelector('#project-selector').value = '';
    document.querySelector('#project-selector').dispatchEvent(new Event('change'));
    document.querySelector('#message-input').value = 'Test prompt';
    document.querySelector('#send-btn').click();`);
  await until(() => read('document.querySelector(".streaming .message-content")?.textContent === "# Completed reply"'));
  assert.equal(await read('!!document.querySelector(".streaming h1")'), false);
  finishReply();
  await until(() => read('!!document.querySelector(".assistant .message-content table")'));

  const inspectReply = `(() => {
    const reply = document.querySelector('.assistant .message-content:not(.missing-reply)');
    const label = reply.querySelector('.code-header > span');
    return {
      heading: reply.querySelector('h1').textContent,
      label: label.textContent,
      labelElements: label.children.length,
      images: reply.querySelectorAll('img').length,
      rawMarkup: reply.textContent.includes('raw markup'),
      link: reply.querySelector('a').getAttribute('href'),
      rel: reply.querySelector('a').rel,
    };
  })()`;
  const expected = { heading: 'Completed reply', label: 'demo<&>', labelElements: 0, images: 0,
    rawMarkup: false, link: 'https://example.invalid/docs', rel: 'noopener noreferrer' };
  assert.deepEqual(await read(inspectReply), expected);
  // Exercise the real button's handler without touching the user's system clipboard.
  await read(`Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: async (text) => { window.copiedText = text; } },
  });
  document.querySelector('.copy-btn').click();`);
  await until(() => read('document.querySelector(".copy-btn").textContent.includes("Copied!")'));
  assert.equal(await read('window.copiedText'), 'example()\n');

  await cdp('Page.reload');
  await until(() => read('document.querySelector("#send-btn")?.disabled && !!document.querySelector(".assistant table")'));
  assert.deepEqual(await read(inspectReply), expected);
  assert.equal(await read('localStorage.getItem("openrouter_api_key")'), null);
  assert.deepEqual(await read('window.policyViolations'), []);
  assert.deepEqual(requests.filter((url) => /^https?:/.test(url) && !url.startsWith(`${base}/`)), []);

  await cdp('Network.setBlockedURLs', { urls: ['https://*', `${base}/vendor/purify.js`] });
  await cdp('Page.reload');
  await until(() => read('typeof DOMPurify === "undefined" && !!document.querySelector(".assistant .plain-text:not(.missing-reply)")'));
  assert.equal(await read('document.querySelector(".assistant .plain-text:not(.missing-reply)").textContent'), reply);

  await cdp('Network.setBlockedURLs', { urls: ['https://*'] });
  const storageKey = 'openrouter_saved_api_key_v1';
  const stored = () => read(`localStorage.getItem(${JSON.stringify(storageKey)})`);
  const settings = () => read('document.querySelector("#settings-btn").click()');
  const save = () => read('document.querySelector("#save-settings").click()');
  const on = (checked) => read(`document.querySelector('#remember-api-key').checked = ${checked};
    document.querySelector('#remember-api-key').dispatchEvent(new Event('change'));`);
  const enter = (value) => read(`document.querySelector('#api-key-input').value = ${JSON.stringify(value)}`);
  const closed = () => until(() => read('document.querySelector("#settings-modal").classList.contains("hidden")'));
  const enabled = () => until(() => read('!document.querySelector("#send-btn").disabled'));
  assert.equal(await stored(), null);
  await settings();
  assert.equal(await read('document.querySelector("#remember-api-key").checked'), false);
  await on(true);
  await read('document.querySelector("#close-settings").click()');
  await settings();
  assert.equal(await read('document.querySelector("#remember-api-key").checked'), false);
  await on(true);
  await save();
  assert.match(await read('document.querySelector("#api-key-status").textContent'), /Enter your OpenRouter API key/);
  await enter('mock-remembered-key');
  await save();
  await closed();
  await enabled();
  const originalRecord = await stored();
  assert.match(originalRecord, /^v1\.[\w-]+$/);
  assert.equal(await read('JSON.stringify(localStorage).includes("mock-remembered-key")'), false);

  app.locals.credentialStore = createCredentialStore(keyDirectory);
  await cdp('Page.reload');
  await enabled();
  assert.equal(modelKeys.at(-1), 'Bearer mock-remembered-key');
  await settings();
  assert.equal(await read('document.querySelector("#remember-api-key").checked'), true);
  assert.equal(await read('document.querySelector("#api-key-input").value'), '');
  await save();
  await closed();
  assert.equal(await stored(), originalRecord);

  app.locals.credentialStore = { ...store, seal: async () => { throw new Error('test storage failure'); } };
  await settings();
  await enter('mock-new-key');
  await save();
  await until(() => read('document.querySelector("#api-key-status").textContent.includes("previous key setting")'));
  assert.equal(await stored(), originalRecord);
  app.locals.credentialStore = store;
  await save();
  await closed();
  await until(() => modelKeys.at(-1) === 'Bearer mock-new-key');
  const replacementRecord = await stored();
  assert.notEqual(replacementRecord, originalRecord);

  modelStatus = 503;
  await cdp('Page.reload');
  await until(() => read('document.querySelector("#model-label")?.textContent.includes("Could not load models")'));
  assert.equal(await stored(), replacementRecord);
  modelStatus = 200;
  await settings();
  await save();
  await closed();
  await enabled();
  assert.equal(modelKeys.at(-1), 'Bearer mock-new-key');

  await settings();
  await on(false);
  await save();
  await closed();
  assert.equal(await stored(), null);
  assert.equal(await read('document.querySelector("#send-btn").disabled'), false);
  const modelCalls = modelKeys.length;
  await cdp('Page.reload');
  await ready();
  assert.equal(await read('document.querySelector("#send-btn").disabled'), true);
  assert.equal(modelKeys.length, modelCalls);
  assert.ok(await read('JSON.parse(localStorage.getItem("openrouter_projects")).length'));

  await read(`localStorage.setItem(${JSON.stringify(storageKey)}, 'v1.damaged')`);
  await cdp('Page.reload');
  await until(() => read('document.querySelector("#model-label")?.textContent.includes("Saved key can’t be used")'));
  assert.equal(modelKeys.length, modelCalls);
  assert.equal(await stored(), 'v1.damaged');
  await settings();
  await on(false);
  await save();
  await closed();
  assert.equal(await stored(), null);

  await settings();
  await enter('mock-key');
  await save();
  await closed();
  await enabled();
  const choose = (selector, value) => read(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.value = ${JSON.stringify(value)};
    el.dispatchEvent(new Event('change'));
  })()`);
  const send = (prompt) => read(`document.querySelector('#message-input').value = ${JSON.stringify(prompt)};
    document.querySelector('#send-btn').click();`);
  const lastTurn = () => read('JSON.parse(localStorage.getItem("openrouter_conversations"))[0].messages.at(-1).turn');
  const lastReply = () => read(`(() => {
    const reply = [...document.querySelectorAll('.message.assistant')].at(-1);
    return [reply.querySelector('.message-content').textContent.trim(), reply.querySelector('.message-meta')?.title || ''];
  })()`);
  const finished = () => until(() => read('!state.activeRequest'));

  const beforeFailure = chatRequests.length;
  await read(`window.alert = (message) => { window.storageWarning = message; };
    window.realStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'openrouter_conversations') throw new DOMException('Mock quota failure', 'QuotaExceededError');
      return window.realStorageWrite.call(this, key, value);
    };`);
  await send('Unsaved draft');
  assert.match(await read('window.storageWarning'), /Could not save/);
  assert.equal(await read('document.querySelector("#message-input").value'), 'Unsaved draft');
  assert.equal(chatRequests.length, beforeFailure);
  await read('Storage.prototype.setItem = window.realStorageWrite');

  await choose('#model-selector', 'test/other');
  await choose('#reasoning-effort', 'none');
  assert.equal((await lastTurn()).preference.model, 'test/model');
  await send('Failed query');
  await finished();
  assert.deepEqual(await lastReply(), ['Response missing or not received.', 'Requested model: test/other']);
  assert.equal((await lastTurn()).status, 'missing');
  assert.deepEqual(chatRequests.at(-1).reasoning, { effort: 'none' });

  await send('Next query');
  await finished();
  assert.deepEqual(await lastReply(), ['A reply', '']);
  assert.ok(chatRequests.at(-1).messages.every((msg) => Object.keys(msg).length === 2));
  assert.ok(!JSON.stringify(chatRequests.at(-1)).includes('Response missing or not received.'));
  await choose('#reasoning-effort', '');
  await send('Empty query');
  await finished();
  assert.deepEqual(await lastReply(), ['Response missing or not received.', 'Requested model: test/other']);
  assert.equal((await lastTurn()).preference.effort, null);
  assert.equal(chatRequests.at(-1).reasoning, undefined);

  await send('Before text');
  await until(() => chatRequests.at(-1).messages.at(-1).content === 'Before text');
  await read('document.querySelector("#stop-btn").click()');
  await finished();
  assert.equal((await lastTurn()).interruption, 'The reply was stopped.');

  await read(`window.realTimeout = window.setTimeout;
    window.setTimeout = (handler, ms, ...args) => window.realTimeout(handler, ms === 120000 ? 100 : ms, ...args);`);
  await send('Timeout before text');
  await finished();
  assert.equal((await lastTurn()).interruption, 'The reply timed out.');
  await read('window.setTimeout = window.realTimeout');

  const project = await read('JSON.parse(localStorage.getItem("openrouter_projects"))[0].id');
  await choose('#project-selector', project);
  await choose('#model-selector', 'test/model');
  await choose('#reasoning-effort', 'high');
  await send('Project partial');
  await until(() => read('document.querySelector(".streaming .message-content")?.textContent === "Partial text"'));
  await choose('#model-selector', 'test/other');
  await choose('#reasoning-effort', 'none');
  assert.deepEqual(await lastReply(), ['Partial text', 'Requested model: test/model']);
  assert.equal(chatRequests.at(-1).model, 'test/model');
  assert.deepEqual(chatRequests.at(-1).reasoning, { effort: 'high' });
  await choose('#project-selector', '');
  startDisconnect();
  await finished();
  await choose('#project-selector', project);
  assert.deepEqual(await lastReply(), ['Partial text', 'Requested model: test/model']);
  const projectTurn = await read('JSON.parse(localStorage.getItem("openrouter_projects"))[0].conversations[0].messages[0].turn');
  assert.equal(projectTurn.status, 'interrupted');
  assert.equal(projectTurn.preference.effort, 'high');
  assert.equal(await read('document.querySelector("#reasoning-effort").value'), 'high');

  await choose('#project-selector', '');
  await choose('#reasoning-effort', 'low');
  await send('Reload pending');
  await until(() => chatRequests.at(-1).messages.at(-1).content === 'Reload pending');
  assert.equal((await lastTurn()).status, 'pending');
  await cdp('Page.reload');
  await ready();
  assert.deepEqual(await lastReply(), ['Response missing or not received.', 'Requested model: test/other']);
  await settings();
  await enter('mock-key');
  await save();
  await closed();
  await enabled();
  assert.equal(await read('document.querySelector("#model-selector").value'), 'test/other');
  assert.equal(await read('document.querySelector("#reasoning-effort").value'), 'low');
  assert.equal((await lastTurn()).status, 'pending');
  const missingCount = await read('document.querySelectorAll(".missing-reply").length');
  const savedTranscript = await read('localStorage.getItem("openrouter_conversations")');
  await read('document.querySelector(".conv-item.active").click()');
  assert.equal(await read('document.querySelectorAll(".missing-reply").length'), missingCount);
  assert.equal(await read('localStorage.getItem("openrouter_conversations")'), savedTranscript);
});