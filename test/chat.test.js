const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const { test } = require('node:test');
const { gzipSync } = require('node:zlib');
const app = require('../server');

test('chat proxy validates effort and streams the upstream response', async (t) => {
  const requests = [];
  const event = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n';
  const done = 'data: [DONE]\n\n';
  const realFetch = global.fetch;
  global.fetch = async (url, options) => {
    requests.push({ url, method: options.method, body: JSON.parse(options.body) });
    return new Response(requests.length === 1 ? event + done : event, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  t.after(() => { global.fetch = realFetch; });

  const server = app.listen(0, '127.0.0.1');
  t.after(() => {
    server.close();
    server.closeAllConnections?.();
  });
  await once(server, 'listening');
  const chat = { model: 'test/model', messages: [{ role: 'user', content: 'Hello' }] };
  const send = (body) => realFetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': 'mock-key' },
    body: JSON.stringify(body),
  });

  const response = await send({ ...chat, reasoning: { effort: 'high', max_tokens: 500 } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(await response.text(), event + done);
  assert.deepEqual(requests[0], {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    method: 'POST',
    body: { ...chat, stream: true, reasoning: { effort: 'high' } },
  });

  const defaultResponse = await send(chat);
  assert.equal(defaultResponse.status, 200);
  assert.equal(await defaultResponse.text(), event);
  assert.deepEqual(requests[1].body, { ...chat, stream: true });

  for (const reasoning of [null, {}, { effort: 'turbo' }, { effort: ['high'] }]) {
    const invalidResponse = await send({ ...chat, reasoning });
    assert.equal(invalidResponse.status, 400);
    assert.deepEqual(await invalidResponse.json(), { error: 'Invalid reasoning effort' });
  }
  assert.equal(requests.length, 2);
});

test('local proxy rejects unexpected hosts and origins and invalid chat bodies before contacting OpenRouter', async (t) => {
  const realFetch = global.fetch;
  let upstreamRequests = 0;
  global.fetch = async () => {
    upstreamRequests++;
    return new Response('');
  };
  t.after(() => { global.fetch = realFetch; });

  const server = app.listen(0, '127.0.0.1');
  t.after(() => {
    server.close();
    server.closeAllConnections?.();
  });
  await once(server, 'listening');
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Api-Key': 'mock-key' };
  const chat = JSON.stringify({ model: 'test/model', messages: [{ role: 'user', content: 'Hello' }] });
  const send = (body, requestHeaders = headers) => realFetch(`${base}/api/chat`, {
    method: 'POST', body, headers: requestHeaders,
  });

  const unexpectedHost = await new Promise((resolve, reject) => {
    const request = http.get(`${base}/`, { headers: { Host: 'other.test' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(unexpectedHost, 403);
  assert.equal((await realFetch(`${base}/api/models`, { headers: { 'X-Api-Key': 'mock-key', Origin: 'https://other.test' } })).status, 403);
  assert.equal((await send(chat, { ...headers, Origin: 'null' })).status, 403);
  const missingKey = await send('{', { 'Content-Type': 'application/json' });
  assert.equal(missingKey.status, 400);
  assert.deepEqual(await missingKey.json(), { error: 'API key required' });
  assert.equal((await send(chat, { ...headers, 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await send(gzipSync(chat), { ...headers, 'Content-Encoding': 'gzip' })).status, 415);
  assert.equal((await send('{')).status, 400);
  assert.equal((await send('{}')).status, 400);

  const oversized = await send(JSON.stringify({ padding: 'a'.repeat(50 * 1024 * 1024) }));
  assert.equal(oversized.status, 413);
  assert.equal(upstreamRequests, 0);

  const home = await realFetch(base);
  assert.equal(home.status, 200);
  const csp = home.headers.get('content-security-policy');
  for (const directive of ["default-src 'none'", "script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'"]) {
    assert.ok(csp.split('; ').includes(directive));
  }
  assert.doesNotMatch(csp, /unsafe-inline|https:/);
  for (const asset of ['/vendor/marked.js', '/vendor/purify.js']) {
    const response = await realFetch(`${base}${asset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    await response.arrayBuffer();
  }
  assert.equal((await realFetch(`${base}/vendor/package.json`)).status, 404);
  assert.equal((await realFetch(`${base}/node_modules/express/package.json`)).status, 404);
});