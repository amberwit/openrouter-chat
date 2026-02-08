# OpenRouter Chat

A modern, sleek chat interface for communicating with AI models through [OpenRouter](https://openrouter.ai/). Built with Node.js and vanilla JavaScript.

![Dark Theme](https://img.shields.io/badge/theme-dark%20%2F%20light-6366f1)
![Node.js](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Multi-model support** — Access hundreds of AI models (Claude, GPT-4o, Gemini, Llama, DeepSeek, and more) through a single interface
- **Streaming responses** — Real-time token-by-token output with a live cursor
- **Projects** — Create project spaces with shared files and custom instructions (like Claude Projects / Grok Projects / Perplexity Spaces). All project context is automatically available to every chat within the project
- **File attachments** — Attach images, PDFs, text files, and code to any chat via button, drag-and-drop, or clipboard paste
- **Markdown rendering** — Full support for headings, code blocks, tables, lists, and blockquotes
- **Code blocks with copy** — Syntax-highlighted code with language labels and one-click copy
- **Conversation history** — Multiple conversations saved locally with sidebar navigation
- **Dark / Light theme** — Toggle between themes in Settings
- **System prompt** — Configure a custom system prompt for all conversations
- **Stop generation** — Cancel a response mid-stream
- **Responsive design** — Works on desktop and smaller screens

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- An [OpenRouter API key](https://openrouter.ai/keys)

### Installation

```bash
git clone https://github.com/amberwit/openrouter-chat.git
cd openrouter-chat
npm install
```

### Run

```bash
npm start
```

Or run the server directly with Node:

```bash
node server.js
```

Then open **http://localhost:3000** in your browser.

> **PowerShell users:** If you see a "running scripts is disabled on this system" error when using `npm start`, you can either run `node server.js` directly, or fix it for the current user:
>
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```
>
> After that, `npm start` will work going forward.

### Setup

1. Click **Settings** (bottom-left corner)
2. Paste your OpenRouter API key
3. Click **Save Settings**
4. Choose a model from the dropdown at the top
5. Start chatting!

## Project Structure

```
openrouter-chat/
├── server.js          # Express server — proxies requests to OpenRouter
├── package.json
└── public/
    ├── index.html     # Chat UI markup
    ├── styles.css     # Dark/light theme styles
    └── app.js         # Frontend logic (streaming, conversations, markdown)
```

## How It Works

The Express server acts as a lightweight proxy between the browser and the OpenRouter API. This keeps your API key out of browser network logs and handles Server-Sent Events (SSE) streaming. All conversation data is stored in the browser's `localStorage` — nothing is sent to any server other than OpenRouter.

## License

MIT
