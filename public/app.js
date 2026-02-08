// ===== State =====
const state = {
  apiKey: localStorage.getItem('openrouter_api_key') || '',
  systemPrompt: localStorage.getItem('openrouter_system_prompt') || '',
  theme: localStorage.getItem('openrouter_theme') || 'dark',
  selectedModel: localStorage.getItem('openrouter_model') || '',
  conversations: JSON.parse(localStorage.getItem('openrouter_conversations') || '[]'),
  currentConvId: null,
  models: [],
  isStreaming: false,
  abortController: null,
};

// ===== DOM Elements =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  sidebar: $('#sidebar'),
  sidebarToggle: $('#sidebar-toggle'),
  newChatBtn: $('#new-chat-btn'),
  convList: $('#conversation-list'),
  modelSelector: $('#model-selector'),
  messagesContainer: $('#messages-container'),
  messages: $('#messages'),
  welcome: $('#welcome'),
  messageInput: $('#message-input'),
  sendBtn: $('#send-btn'),
  stopBtn: $('#stop-btn'),
  charCount: $('#char-count'),
  modelLabel: $('#model-label'),
  settingsBtn: $('#settings-btn'),
  settingsModal: $('#settings-modal'),
  closeSettings: $('#close-settings'),
  apiKeyInput: $('#api-key-input'),
  toggleKeyVis: $('#toggle-key-visibility'),
  systemPromptInput: $('#system-prompt-input'),
  saveSettings: $('#save-settings'),
};

// ===== Initialization =====
function init() {
  applyTheme(state.theme);
  els.apiKeyInput.value = state.apiKey;
  els.systemPromptInput.value = state.systemPrompt;

  if (state.apiKey) {
    fetchModels();
  }

  bindEvents();
  renderConversationList();

  // Auto-open last conversation or start fresh
  if (state.conversations.length > 0) {
    loadConversation(state.conversations[0].id);
  }
}

// ===== Event Bindings =====
function bindEvents() {
  // Sidebar
  els.sidebarToggle.addEventListener('click', () => {
    els.sidebar.classList.toggle('collapsed');
  });
  els.newChatBtn.addEventListener('click', newChat);

  // Input
  els.messageInput.addEventListener('input', autoResize);
  els.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  els.sendBtn.addEventListener('click', sendMessage);
  els.stopBtn.addEventListener('click', stopStreaming);

  // Model selector
  els.modelSelector.addEventListener('change', (e) => {
    state.selectedModel = e.target.value;
    localStorage.setItem('openrouter_model', state.selectedModel);
    updateModelLabel();
  });

  // Settings
  els.settingsBtn.addEventListener('click', openSettings);
  els.closeSettings.addEventListener('click', closeSettings);
  $('.modal-backdrop').addEventListener('click', closeSettings);
  els.saveSettings.addEventListener('click', saveSettings);

  // API key visibility toggle
  els.toggleKeyVis.addEventListener('click', () => {
    const input = els.apiKeyInput;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Theme buttons
  $$('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.theme-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.theme = btn.dataset.theme;
    });
  });

  // Hint cards
  $$('.hint-card').forEach((card) => {
    card.addEventListener('click', () => {
      els.messageInput.value = card.dataset.prompt;
      autoResize();
      els.messageInput.focus();
    });
  });

  // Escape to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.settingsModal.classList.contains('hidden')) {
      closeSettings();
    }
  });
}

// ===== Theme =====
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('openrouter_theme', theme);
  $$('.theme-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

// ===== Models =====
async function fetchModels() {
  try {
    const res = await fetch('/api/models', {
      headers: { 'X-Api-Key': state.apiKey },
    });
    const data = await res.json();

    if (data.error) {
      console.error('Error fetching models:', data.error);
      return;
    }

    state.models = (data.data || [])
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

    populateModelSelector();
    enableInput();
  } catch (err) {
    console.error('Failed to fetch models:', err);
  }
}

function populateModelSelector() {
  const selector = els.modelSelector;
  selector.innerHTML = '';

  // Group models by provider
  const groups = {};
  state.models.forEach((m) => {
    const provider = m.id.split('/')[0] || 'other';
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push(m);
  });

  // Popular models first
  const popular = [
    'anthropic/claude-sonnet-4',
    'anthropic/claude-3.5-sonnet',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'google/gemini-2.0-flash-001',
    'google/gemini-2.5-pro-preview',
    'meta-llama/llama-3.3-70b-instruct',
    'deepseek/deepseek-chat',
    'deepseek/deepseek-r1',
  ];

  const popularGroup = document.createElement('optgroup');
  popularGroup.label = 'Popular';

  popular.forEach((id) => {
    const model = state.models.find((m) => m.id === id);
    if (model) {
      const opt = document.createElement('option');
      opt.value = model.id;
      opt.textContent = model.name || model.id;
      popularGroup.appendChild(opt);
    }
  });

  if (popularGroup.children.length > 0) {
    selector.appendChild(popularGroup);
  }

  // All models grouped by provider
  Object.keys(groups)
    .sort()
    .forEach((provider) => {
      const optgroup = document.createElement('optgroup');
      optgroup.label = provider;
      groups[provider].forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        optgroup.appendChild(opt);
      });
      selector.appendChild(optgroup);
    });

  // Restore selected model
  if (state.selectedModel && state.models.find((m) => m.id === state.selectedModel)) {
    selector.value = state.selectedModel;
  } else if (state.models.length > 0) {
    // Default to first popular or first model
    const defaultModel = popular.find((id) => state.models.find((m) => m.id === id));
    selector.value = defaultModel || state.models[0].id;
    state.selectedModel = selector.value;
    localStorage.setItem('openrouter_model', state.selectedModel);
  }

  selector.disabled = false;
  updateModelLabel();
}

function updateModelLabel() {
  const model = state.models.find((m) => m.id === state.selectedModel);
  els.modelLabel.textContent = model ? (model.name || model.id) : '';
}

// ===== Input =====
function enableInput() {
  els.messageInput.disabled = false;
  els.sendBtn.disabled = false;
  els.messageInput.placeholder = 'Send a message...';
}

function autoResize() {
  const el = els.messageInput;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

// ===== Conversations =====
function newChat() {
  state.currentConvId = null;
  renderMessages([]);
  els.welcome.classList.remove('hidden');
  renderConversationList();
  els.messageInput.focus();
}

function createConversation(firstMessage) {
  const conv = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title: firstMessage.slice(0, 80),
    messages: [],
    model: state.selectedModel,
    createdAt: Date.now(),
  };
  state.conversations.unshift(conv);
  state.currentConvId = conv.id;
  saveConversations();
  renderConversationList();
  return conv;
}

function getCurrentConv() {
  return state.conversations.find((c) => c.id === state.currentConvId);
}

function loadConversation(id) {
  state.currentConvId = id;
  const conv = getCurrentConv();
  if (!conv) return;

  if (conv.model && state.models.find((m) => m.id === conv.model)) {
    els.modelSelector.value = conv.model;
    state.selectedModel = conv.model;
    updateModelLabel();
  }

  renderMessages(conv.messages);
  renderConversationList();
}

function deleteConversation(id, e) {
  e.stopPropagation();
  state.conversations = state.conversations.filter((c) => c.id !== id);
  saveConversations();
  if (state.currentConvId === id) {
    newChat();
  }
  renderConversationList();
}

function saveConversations() {
  localStorage.setItem('openrouter_conversations', JSON.stringify(state.conversations));
}

function renderConversationList() {
  els.convList.innerHTML = '';
  state.conversations.forEach((conv) => {
    const div = document.createElement('div');
    div.className = `conv-item${conv.id === state.currentConvId ? ' active' : ''}`;
    div.innerHTML = `
      <span class="conv-title">${escapeHtml(conv.title)}</span>
      <button class="conv-delete" title="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    `;
    div.addEventListener('click', () => loadConversation(conv.id));
    div.querySelector('.conv-delete').addEventListener('click', (e) => deleteConversation(conv.id, e));
    els.convList.appendChild(div);
  });
}

// ===== Messages =====
function renderMessages(messages) {
  els.messages.innerHTML = '';
  if (messages.length === 0) {
    els.messages.appendChild(els.welcome || createWelcomeEl());
    els.welcome = $('#welcome');
    els.welcome.classList.remove('hidden');
    // Re-bind hint cards
    $$('.hint-card').forEach((card) => {
      card.addEventListener('click', () => {
        els.messageInput.value = card.dataset.prompt;
        autoResize();
        els.messageInput.focus();
      });
    });
    return;
  }

  els.welcome && els.welcome.classList.add('hidden');

  messages.forEach((msg) => {
    appendMessageEl(msg.role, msg.content);
  });

  scrollToBottom();
}

function appendMessageEl(role, content) {
  // Hide welcome
  if (els.welcome) els.welcome.classList.add('hidden');

  const div = document.createElement('div');
  div.className = `message ${role}`;

  const avatarLabel = role === 'user' ? 'U' : 'AI';

  div.innerHTML = `
    <div class="message-avatar">${avatarLabel}</div>
    <div class="message-body">
      <div class="message-content"></div>
    </div>
  `;

  const contentEl = div.querySelector('.message-content');
  if (role === 'assistant') {
    contentEl.innerHTML = renderMarkdown(content || '');
    addCopyButtons(contentEl);
  } else {
    contentEl.textContent = content;
  }

  els.messages.appendChild(div);
  scrollToBottom();
  return div;
}

function renderMarkdown(text) {
  if (!text) return '';
  try {
    const html = marked.parse(text, {
      breaks: true,
      gfm: true,
    });
    return DOMPurify.sanitize(html);
  } catch {
    return escapeHtml(text);
  }
}

function addCopyButtons(container) {
  container.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code) return;

    // Detect language from class
    const langClass = [...code.classList].find((c) => c.startsWith('language-'));
    const lang = langClass ? langClass.replace('language-', '') : 'code';

    const header = document.createElement('div');
    header.className = 'code-header';
    header.innerHTML = `
      <span>${lang}</span>
      <button class="copy-btn" onclick="copyCode(this)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy
      </button>
    `;
    pre.insertBefore(header, pre.firstChild);
  });
}

window.copyCode = function (btn) {
  const pre = btn.closest('pre');
  const code = pre.querySelector('code');
  navigator.clipboard.writeText(code.textContent).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy
      `;
    }, 1500);
  });
};

function scrollToBottom() {
  els.messagesContainer.scrollTop = els.messagesContainer.scrollHeight;
}

// ===== Send Message =====
async function sendMessage() {
  const text = els.messageInput.value.trim();
  if (!text || state.isStreaming) return;

  if (!state.apiKey) {
    openSettings();
    return;
  }

  // Create conversation if needed
  if (!state.currentConvId) {
    createConversation(text);
  }

  const conv = getCurrentConv();
  conv.messages.push({ role: 'user', content: text });
  conv.model = state.selectedModel;
  saveConversations();

  // Render user message
  appendMessageEl('user', text);
  els.messageInput.value = '';
  els.messageInput.style.height = 'auto';

  // Build messages array for API
  const apiMessages = [];
  if (state.systemPrompt) {
    apiMessages.push({ role: 'system', content: state.systemPrompt });
  }
  conv.messages.forEach((m) => apiMessages.push({ role: m.role, content: m.content }));

  // Start streaming
  state.isStreaming = true;
  els.sendBtn.classList.add('hidden');
  els.stopBtn.classList.remove('hidden');
  els.messageInput.disabled = true;

  const assistantDiv = appendMessageEl('assistant', '');
  assistantDiv.classList.add('streaming');
  const contentEl = assistantDiv.querySelector('.message-content');

  let fullResponse = '';
  const startTime = Date.now();

  try {
    state.abortController = new AbortController();

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': state.apiKey,
      },
      body: JSON.stringify({
        model: state.selectedModel,
        messages: apiMessages,
      }),
      signal: state.abortController.signal,
    });

    if (!res.ok) {
      const errData = await res.text();
      throw new Error(errData || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullResponse += delta;
            contentEl.innerHTML = renderMarkdown(fullResponse);
            scrollToBottom();
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    // Finalize
    addCopyButtons(contentEl);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const metaDiv = document.createElement('div');
    metaDiv.className = 'message-meta';
    metaDiv.textContent = `${elapsed}s`;
    assistantDiv.querySelector('.message-body').appendChild(metaDiv);

    conv.messages.push({ role: 'assistant', content: fullResponse });
    saveConversations();
  } catch (err) {
    if (err.name === 'AbortError') {
      // User stopped
      if (fullResponse) {
        conv.messages.push({ role: 'assistant', content: fullResponse });
        saveConversations();
      }
    } else {
      contentEl.innerHTML = `<div class="message-error">Error: ${escapeHtml(err.message)}</div>`;
    }
  } finally {
    assistantDiv.classList.remove('streaming');
    state.isStreaming = false;
    state.abortController = null;
    els.sendBtn.classList.remove('hidden');
    els.stopBtn.classList.add('hidden');
    els.messageInput.disabled = false;
    els.messageInput.focus();
  }
}

function stopStreaming() {
  if (state.abortController) {
    state.abortController.abort();
  }
}

// ===== Settings =====
function openSettings() {
  els.settingsModal.classList.remove('hidden');
  els.apiKeyInput.value = state.apiKey;
  els.systemPromptInput.value = state.systemPrompt;
  els.apiKeyInput.focus();
}

function closeSettings() {
  els.settingsModal.classList.add('hidden');
}

function saveSettings() {
  const newKey = els.apiKeyInput.value.trim();
  const keyChanged = newKey !== state.apiKey;

  state.apiKey = newKey;
  state.systemPrompt = els.systemPromptInput.value.trim();

  localStorage.setItem('openrouter_api_key', state.apiKey);
  localStorage.setItem('openrouter_system_prompt', state.systemPrompt);

  applyTheme(state.theme);

  if (keyChanged && state.apiKey) {
    fetchModels();
  }

  closeSettings();
}

// ===== Helpers =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== Start =====
init();
