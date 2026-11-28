const express = require('express');
const path = require('path');
const { createCredentialStore, isApiKey } = require('./credential-store');

const app = express();
const HOST = '127.0.0.1';
const PORT = 3000;
const reasoningEfforts = new Set(['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']);
const contentSecurityPolicy = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "font-src 'self'",
  "img-src 'self' data:", "connect-src 'self'", "object-src 'none'", "base-uri 'none'",
  "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

app.disable('trust proxy');
app.disable('query parser');
app.disable('x-powered-by');
app.locals.credentialStore = createCredentialStore();
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': contentSecurityPolicy,
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  const host = req.get('host');
  const port = req.socket.localPort;
  if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) {
    return res.status(403).json({ error: 'Use the local OpenRouter Chat address' });
  }
  next();
});

app.get('/vendor/marked.js', (req, res) => {
  res.sendFile(path.join(path.dirname(require.resolve('marked')), 'marked.umd.js'));
});
app.get('/vendor/purify.js', (req, res) => {
  res.sendFile(require.resolve('dompurify/dist/purify.min.js'));
});
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const origin = req.get('origin');
  if (origin !== undefined && origin !== `http://${req.get('host')}`) {
    return res.status(403).json({ error: 'Cross-origin API requests are not allowed' });
  }
  next();
});

function localOrigin(req) {
  return `http://${req.get('host')}`;
}

const savedKeyError = 'Saved key can’t be used. Re-enter your OpenRouter key or forget it.';

async function requireApiKey(req, res, next) {
  const apiKey = req.get('x-api-key');
  const savedKey = req.get('x-saved-key');
  if (savedKey === undefined) {
    if (!apiKey) return res.status(400).json({ error: 'API key required' });
    if (!isApiKey(apiKey)) return res.status(400).json({ error: 'Invalid API key' });
    res.locals.apiKey = apiKey;
    return next();
  }
  if (apiKey !== undefined) return res.status(400).json({ error: 'Supply only one API credential' });
  try {
    const unsealed = await req.app.locals.credentialStore.unseal(savedKey, localOrigin(req));
    if (!unsealed) return res.status(401).json({ error: savedKeyError, code: 'SAVED_KEY_INVALID' });
    res.locals.apiKey = unsealed;
  } catch {
    return res.status(503).json({ error: 'Could not read private credential storage. Try again or use an API key for this tab.' });
  }
  next();
}

function requireJson(req, res, next) {
  if (req.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  next();
}

// Seal only a caller-supplied key. There is no route that returns the decrypted value.
app.post('/api/credentials', async (req, res) => {
  if (req.get('origin') !== localOrigin(req)) return res.status(403).json({ error: 'Use Settings in the local app to save a key' });
  const apiKey = req.get('x-api-key');
  if (!isApiKey(apiKey) || req.get('x-saved-key') !== undefined) {
    return res.status(400).json({ error: 'Enter a valid API key to save it' });
  }
  try {
    const savedKey = await req.app.locals.credentialStore.seal(apiKey, localOrigin(req));
    res.json({ savedKey });
  } catch {
    res.status(503).json({ error: 'Could not securely save the key on this computer' });
  }
});

// Proxy: fetch available models from OpenRouter
app.get('/api/models', requireApiKey, async (req, res) => {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${res.locals.apiKey}` },
      redirect: 'error',
    });
    if (!response.ok) return res.status(response.status).json({ error: 'OpenRouter could not load models' });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// Proxy: stream chat completions from OpenRouter
app.post('/api/chat', requireApiKey, requireJson, express.json({ limit: '50mb', inflate: false }), async (req, res) => {
  const { model, messages, reasoning } = req.body || {};
  if (typeof model !== 'string' || !model.trim() || !Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'A model and a nonempty messages array are required' });
  }
  const payload = { model, messages, stream: true };
  if (reasoning !== undefined) {
    if (!reasoningEfforts.has(reasoning?.effort)) {
      return res.status(400).json({ error: 'Invalid reasoning effort' });
    }
    payload.reasoning = { effort: reasoning.effort };
  }

  const controller = new AbortController();
  let reader;
  const disconnect = () => {
    controller.abort();
    reader?.cancel().catch(() => {});
  };
  res.once('close', disconnect);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${res.locals.apiKey}`,
        'HTTP-Referer': `http://${HOST}:${PORT}`,
        'X-Title': 'OpenRouter Chat',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text();
      res.status(response.status).json({ error: errBody });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');

    if (controller.signal.aborted) {
      await response.body?.cancel();
      return;
    }
    reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Only OpenRouter can mark a reply complete; an EOF might be a disconnect.
      res.write(Buffer.from(value));
    }

    res.end();
  } catch (err) {
    if (res.destroyed) return;
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to connect to OpenRouter' });
    } else {
      res.end();
    }
  } finally {
    res.removeListener('close', disconnect);
  }
});

app.use('/api/chat', (err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.status === 413) return res.status(413).json({ error: 'Chat request exceeds the 50 MiB limit' });
  if (err.status === 415) return res.status(415).json({ error: 'Unsupported request encoding or charset; send uncompressed UTF-8 JSON' });
  if (err.status === 400) return res.status(400).json({ error: 'Invalid JSON request' });
  res.status(500).json({ error: 'Could not read the chat request' });
});

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`\n  OpenRouter Chat is running at http://${HOST}:${PORT}\n`);
  });
}

module.exports = app;
