const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const app = require('../server');

test('chat proxy validates effort and streams the upstream response', async (t) => {
  const requests = [];
  const event = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n';
  const realFetch = global.fetch;
  global.fetch = async (url, options) => {
    requests.push({ url, method: options.method, body: JSON.parse(options.body) });
    return new Response(event, { headers: { 'Content-Type': 'text/event-stream' } });
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
  assert.equal(await response.text(), `${event}data: [DONE]\n\n`);
  assert.deepEqual(requests[0], {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    method: 'POST',
    body: { ...chat, stream: true, reasoning: { effort: 'high' } },
  });

  const defaultResponse = await send(chat);
  assert.equal(defaultResponse.status, 200);
  await defaultResponse.text();
  assert.deepEqual(requests[1].body, { ...chat, stream: true });

  for (const reasoning of [null, {}, { effort: 'turbo' }, { effort: ['high'] }]) {
    const invalidResponse = await send({ ...chat, reasoning });
    assert.equal(invalidResponse.status, 400);
    assert.deepEqual(await invalidResponse.json(), { error: 'Invalid reasoning effort' });
  }
  assert.equal(requests.length, 2);
});