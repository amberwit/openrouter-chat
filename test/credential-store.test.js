const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chmod, mkdtemp, readFile, readdir, rm, stat } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createCredentialStore } = require('../credential-store');
const app = require('../server');

async function tempDirectory(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'openrouter-credentials-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('saved credentials are authenticated, origin-bound, and survive reloading the private key', async (t) => {
  const root = await tempDirectory(t);
  const directory = path.join(root, 'private');
  const keyFile = path.join(directory, 'credential-key-v1');
  const origin = 'http://127.0.0.1:3000';
  const apiKey = 'mock-openrouter-key';
  const store = createCredentialStore(directory);
  const [record, another] = await Promise.all([store.seal(apiKey, origin), createCredentialStore(directory).seal(apiKey, origin)]);
  assert.notEqual(record, another);
  assert.ok(!record.includes(apiKey));
  assert.deepEqual(await readdir(directory), ['credential-key-v1']);
  const file = await readFile(keyFile);
  assert.equal(file.length, 32);
  assert.equal(file.includes(apiKey), false);
  if (process.platform !== 'win32') {
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
  }

  const restarted = createCredentialStore(directory);
  assert.equal(await restarted.unseal(record, origin), apiKey);
  assert.equal(await restarted.unseal(another, origin), apiKey);
  assert.equal(await restarted.unseal(record, 'http://localhost:3000'), null);
  const bytes = Buffer.from(record.slice(3), 'base64url');
  bytes[bytes.length - 1] ^= 1;
  assert.equal(await restarted.unseal(`v1.${bytes.toString('base64url')}`, origin), null);
  const otherDirectory = path.join(root, 'other');
  const other = createCredentialStore(otherDirectory);
  assert.equal(await other.unseal(record, origin), null);
  assert.deepEqual((await readdir(root)).sort(), ['private']);
  await other.seal(apiKey, origin);
  assert.equal(await other.unseal(record, origin), null);

  if (process.platform !== 'win32') {
    await chmod(keyFile, 0o644);
    await assert.rejects(restarted.unseal(record, origin), /private/);
    await assert.rejects(restarted.seal(apiKey, origin), /private/);
  }
  await rm(keyFile);
  assert.equal(await restarted.unseal(record, origin), null);
  const replacement = await restarted.seal('mock-replacement', origin);
  assert.equal(await restarted.unseal(replacement, origin), 'mock-replacement');
});

test('proxy seals locally and only forwards authorized decrypted credentials to OpenRouter', async (t) => {
  const directory = path.join(await tempDirectory(t), 'private');
  const originalStore = app.locals.credentialStore;
  app.locals.credentialStore = createCredentialStore(directory);
  t.after(() => { app.locals.credentialStore = originalStore; });
  const realFetch = global.fetch;
  const upstream = [];
  global.fetch = async (url, options) => {
    upstream.push([url, options.headers.Authorization, options.redirect]);
    if (url.endsWith('/models')) return Response.json({ data: [] });
    return new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n');
  };
  t.after(() => { global.fetch = realFetch; });
  const server = app.listen(0, '127.0.0.1');
  t.after(() => { server.close(); server.closeAllConnections(); });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const seal = (headers) => realFetch(`${base}/api/credentials`, { method: 'POST', headers });
  const models = (headers) => realFetch(`${base}/api/models`, { headers });
  const apiKey = 'mock-saved-openrouter-key';

  assert.equal((await seal({ 'X-Api-Key': apiKey })).status, 403);
  assert.equal((await seal({ Origin: 'https://elsewhere.test', 'X-Api-Key': apiKey })).status, 403);
  assert.equal((await seal({ Origin: base })).status, 400);
  const sealed = await seal({ Origin: base, 'X-Api-Key': apiKey });
  assert.equal(sealed.status, 200);
  assert.equal(sealed.headers.get('cache-control'), 'no-store');
  const { savedKey } = await sealed.json();
  assert.match(savedKey, /^v1\.[\w-]+$/);
  assert.ok(!savedKey.includes(apiKey));
  const header = { 'X-Saved-Key': savedKey };
  assert.equal((await models({ ...header, Origin: 'https://elsewhere.test' })).status, 403);
  assert.equal((await models({ ...header, 'X-Api-Key': apiKey })).status, 400);
  const tampered = `v1.${savedKey[3] === 'A' ? 'B' : 'A'}${savedKey.slice(4)}`;
  const invalid = await models({ 'X-Saved-Key': tampered });
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).code, 'SAVED_KEY_INVALID');
  assert.equal((await realFetch(`${base}/api/credentials`)).status, 404);
  assert.equal(upstream.length, 0);

  app.locals.credentialStore = createCredentialStore(directory);
  assert.equal((await models(header)).status, 200);
  const chat = await realFetch(`${base}/api/chat`, { method: 'POST', headers: { ...header, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test/model', messages: [{ role: 'user', content: 'Hello' }] }),
  });
  assert.equal(chat.status, 200);
  assert.match(await chat.text(), /\[DONE\]/);
  assert.deepEqual(upstream, [
    ['https://openrouter.ai/api/v1/models', `Bearer ${apiKey}`, 'error'],
    ['https://openrouter.ai/api/v1/chat/completions', `Bearer ${apiKey}`, 'error'],
  ]);
});