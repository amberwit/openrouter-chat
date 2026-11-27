const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;
const reasoningEfforts = new Set(['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']);

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Proxy: fetch available models from OpenRouter
app.get('/api/models', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ error: 'API key required' });

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

// Proxy: stream chat completions from OpenRouter
app.post('/api/chat', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ error: 'API key required' });

  const { model, messages, reasoning } = req.body;
  const payload = { model, messages, stream: true };
  if (reasoning !== undefined) {
    if (!reasoningEfforts.has(reasoning?.effort)) {
      return res.status(400).json({ error: 'Invalid reasoning effort' });
    }
    payload.reasoning = { effort: reasoning.effort };
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
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
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        res.write('data: [DONE]\n\n');
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      res.write(chunk);
    }

    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to connect to OpenRouter' });
    } else {
      res.end();
    }
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  OpenRouter Chat is running at http://localhost:${PORT}\n`);
  });
}

module.exports = app;
