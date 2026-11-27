# OpenRouter Chat

A modern, sleek chat interface for communicating with AI models through [OpenRouter](https://openrouter.ai/). Built with Node.js and vanilla JavaScript.

![Dark Theme](https://img.shields.io/badge/theme-dark%20%2F%20light-6366f1)
![Node.js](https://img.shields.io/badge/node-%3E%3D24-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Multi-model support** — Access hundreds of AI models (Claude, GPT-4o, Gemini, Llama, DeepSeek, and more) through a single interface
- **Model pricing** — Compare OpenRouter's catalog rates for input and output text, in USD per million tokens. These are not per-request estimates and don't include separately priced features.
- **Reasoning effort** — Set effort for models that expose it, or leave it on **Model default**. Reasoning can add to output cost even though the chat only displays the answer.
- **Streaming responses** — Live plain text, with Markdown formatting when the reply finishes
- **Projects** — Create project spaces with shared files and custom instructions (like Claude Projects / Grok Projects / Perplexity Spaces). All project context is automatically available to every chat within the project
- **File attachments** — Attach images, PDFs, text files, and code to any chat via button, drag-and-drop, or clipboard paste
- **Markdown rendering** — Full support for headings, code blocks, tables, lists, and blockquotes
- **Code blocks with copy** — Formatted code with language labels and one-click copy
- **Conversation history** — Multiple conversations saved locally with sidebar navigation
- **Dark / Light theme** — Toggle between themes in Settings
- **System prompt** — Configure a custom system prompt for all conversations
- **Stop generation** — Cancel a response mid-stream
- **Responsive design** — Works on desktop and smaller screens

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v24 LTS (or a newer supported release)
- An [OpenRouter API key](https://openrouter.ai/keys)

### Installation

```bash
git clone https://github.com/amberwit/openrouter-chat.git
cd openrouter-chat
npm ci
```

### Run

```bash
npm start
```

Or run the server directly with Node:

```bash
node server.js
```

Then open **http://127.0.0.1:3000** in your browser. The server listens on IPv4 loopback only; it is not intended for LAN access, port forwarding, or use behind a reverse proxy.

**Upgrading from an older build?** Stop the old server first. After starting the fixed build, open **http://localhost:3000** in the same browser profile if that is where your existing chats are stored. The fixed app still accepts this address when it resolves to IPv4. It removes only the previously saved API key on startup; chats, projects, and preferences remain on their original browser origin. `localhost` and `127.0.0.1` do not share browser storage. If you switch addresses, an empty history at the new address does not mean that the old history was deleted. Do not clear all site data to remove a key. If `localhost` is unavailable, use the browser's developer tools on the original origin to remove just `openrouter_api_key` from Local Storage, without loading the old build.

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
5. Start chatting! Re-enter your key after reloading or closing the tab.

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

The browser keeps your API key in the current tab's memory and sends it to the local proxy in an `X-Api-Key` request header. It is visible in browser developer tools while the app is in use. The proxy uses it to call OpenRouter over HTTPS and streams the response back. Consider a spending-limited OpenRouter key. If you suspect an old key was exposed, revoke it in OpenRouter and review your usage.

Chats, project files, and preferences are stored in the browser's `localStorage`, not in a server-side database. On each chat request, the conversation, system instructions, and attached context (including eligible project files) are sent through OpenRouter to the model provider. Do not include files or secrets you are unwilling to share with those services. Markdown libraries are served locally and model replies do not load remote images or other embedded media. HTTP(S) links still open their destinations when clicked. Only supported raster attachments are previewed; other types appear as file names.

Chat requests are limited to 50 MiB of uncompressed JSON, including the conversation, attachments, and project context. If a request is too large, reduce the attachments or project files, or start a shorter chat.

## Tests

Run `npm test` to check model labels, reasoning controls, local request restrictions, and streaming with a mocked OpenRouter response. No API key is required. To include the browser checks for formatting, attachments, CSP, and credential cleanup, set `CHROMIUM_BIN` to an installed Chromium-based browser executable. The suite launches its own headless browser with a disposable profile and mocks OpenRouter. For example, on macOS with Microsoft Edge installed:

```bash
CHROMIUM_BIN='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' npm test
```

## License

MIT
