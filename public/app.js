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
  pendingAttachments: [],
  projects: JSON.parse(localStorage.getItem('openrouter_projects') || '[]'),
  currentProjectId: null,
  pendingProjectFiles: [],
  editingProjectId: null,
};

// ===== DOM Elements =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  sidebar: $('#sidebar'),
  sidebarToggle: $('#sidebar-toggle'),
  newChatBtn: $('#new-chat-btn'),
  sidebarContent: $('#sidebar-content'),
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
  attachBtn: $('#attach-btn'),
  fileInput: $('#file-input'),
  attachmentPreviews: $('#attachment-previews'),
  projectSelector: $('#project-selector'),
  newProjectBtn: $('#new-project-btn'),
  projectModal: $('#project-modal'),
  closeProjectModal: $('#close-project-modal'),
  projectModalTitle: $('#project-modal-title'),
  projectNameInput: $('#project-name-input'),
  projectDescInput: $('#project-desc-input'),
  projectInstructionsInput: $('#project-instructions-input'),
  projectFileList: $('#project-file-list'),
  projectFileInput: $('#project-file-input'),
  addProjectFileBtn: $('#add-project-file-btn'),
  saveProjectBtn: $('#save-project-btn'),
  deleteProjectBtn: $('#delete-project-btn'),
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
  renderProjectSelector();
  renderSidebarContent();

  const convs = getActiveConversations();
  if (convs.length > 0) {
    loadConversation(convs[0].id);
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
  els.settingsModal.querySelector('.modal-backdrop').addEventListener('click', closeSettings);
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

  // Escape to close modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!els.projectModal.classList.contains('hidden')) {
        closeProjectModal();
      } else if (!els.settingsModal.classList.contains('hidden')) {
        closeSettings();
      }
    }
  });

  // File attachment button
  els.attachBtn.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      addAttachments([...e.target.files]);
      e.target.value = '';
    }
  });

  // Drag and drop
  const wrapper = $('#input-wrapper');
  wrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    wrapper.classList.add('drag-over');
  });
  wrapper.addEventListener('dragleave', (e) => {
    e.preventDefault();
    wrapper.classList.remove('drag-over');
  });
  wrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    wrapper.classList.remove('drag-over');
    const files = [...e.dataTransfer.files];
    if (files.length > 0) addAttachments(files);
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // Paste images from clipboard
  els.messageInput.addEventListener('paste', (e) => {
    const items = [...(e.clipboardData?.items || [])];
    const fileItems = items.filter((item) => item.kind === 'file');
    if (fileItems.length > 0) {
      e.preventDefault();
      const files = fileItems
        .map((item) => {
          const file = item.getAsFile();
          if (file && file.name === 'image.png') {
            return new File([file], `pasted-image-${Date.now()}.png`, { type: file.type });
          }
          return file;
        })
        .filter(Boolean);
      addAttachments(files);
    }
  });

  // Project selector
  els.projectSelector.addEventListener('change', (e) => {
    state.currentProjectId = e.target.value || null;
    state.currentConvId = null;
    renderSidebarContent();
    const convs = getActiveConversations();
    if (convs.length > 0) {
      loadConversation(convs[0].id);
    } else {
      newChat();
    }
  });

  // Project buttons
  els.newProjectBtn.addEventListener('click', openNewProjectModal);
  els.closeProjectModal.addEventListener('click', closeProjectModal);
  els.projectModal.querySelector('.modal-backdrop').addEventListener('click', closeProjectModal);
  els.saveProjectBtn.addEventListener('click', saveProject);
  els.deleteProjectBtn.addEventListener('click', deleteCurrentProject);
  els.addProjectFileBtn.addEventListener('click', () => els.projectFileInput.click());
  els.projectFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      addProjectFiles([...e.target.files]);
      e.target.value = '';
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

  const groups = {};
  state.models.forEach((m) => {
    const provider = m.id.split('/')[0] || 'other';
    if (!groups[provider]) groups[provider] = [];
    groups[provider].push(m);
  });

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

  Object.keys(groups).sort().forEach((provider) => {
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

  if (state.selectedModel && state.models.find((m) => m.id === state.selectedModel)) {
    selector.value = state.selectedModel;
  } else if (state.models.length > 0) {
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
  els.attachBtn.disabled = false;
  els.messageInput.placeholder = 'Send a message...';
}

function autoResize() {
  const el = els.messageInput;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

// ===== Helpers =====
function generateId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getActiveConversations() {
  if (state.currentProjectId) {
    const project = getCurrentProject();
    return project ? project.conversations : [];
  }
  return state.conversations;
}

function getProject(id) {
  return state.projects.find((p) => p.id === id);
}

function getCurrentProject() {
  return state.currentProjectId ? getProject(state.currentProjectId) : null;
}

function saveCurrentConversations() {
  if (state.currentProjectId) {
    saveProjects();
  } else {
    saveConversations();
  }
}

// ===== File Attachments =====
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'csv', 'json', 'xml', 'html', 'htm', 'css', 'js', 'ts',
  'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'go',
  'rs', 'swift', 'kt', 'php', 'pl', 'r', 'scala', 'lua', 'sh', 'bash',
  'zsh', 'bat', 'ps1', 'sql', 'yaml', 'yml', 'toml', 'ini', 'cfg',
  'conf', 'log', 'env', 'dockerfile', 'makefile', 'gitignore',
  'editorconfig', 'properties', 'vue', 'svelte',
]);

function categorizeFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext) || file.type.startsWith('image/')) return 'image';
  if (ext === 'pdf' || file.type === 'application/pdf') return 'pdf';
  if (TEXT_EXTENSIONS.has(ext) || file.type.startsWith('text/')) return 'text';
  return 'binary';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file, 'UTF-8');
  });
}

async function processFile(file) {
  const category = categorizeFile(file);
  const attachment = {
    id: generateId('f'),
    name: file.name,
    size: file.size,
    type: file.type,
    category,
    dataUrl: null,
    textContent: null,
    preview: null,
  };

  if (category === 'image') {
    attachment.dataUrl = await readFileAsDataUrl(file);
    attachment.preview = URL.createObjectURL(file);
  } else if (category === 'text') {
    attachment.textContent = await readFileAsText(file);
  } else {
    attachment.dataUrl = await readFileAsDataUrl(file);
  }

  return attachment;
}

async function addAttachments(files) {
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) {
      alert(`File "${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 20MB.`);
      continue;
    }
    try {
      const attachment = await processFile(file);
      state.pendingAttachments.push(attachment);
    } catch (err) {
      console.error(`Failed to read file "${file.name}":`, err);
    }
  }
  renderAttachmentPreviews();
}

function removeAttachment(id) {
  const idx = state.pendingAttachments.findIndex((a) => a.id === id);
  if (idx !== -1) {
    const att = state.pendingAttachments[idx];
    if (att.preview) URL.revokeObjectURL(att.preview);
    state.pendingAttachments.splice(idx, 1);
  }
  renderAttachmentPreviews();
}

function clearAttachments() {
  state.pendingAttachments.forEach((a) => {
    if (a.preview) URL.revokeObjectURL(a.preview);
  });
  state.pendingAttachments = [];
  renderAttachmentPreviews();
}

function renderAttachmentPreviews() {
  const container = els.attachmentPreviews;
  container.innerHTML = '';

  if (state.pendingAttachments.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  state.pendingAttachments.forEach((att) => {
    const div = document.createElement('div');
    div.className = `attachment-preview ${att.category === 'image' ? 'image-preview' : 'file-preview'}`;
    if (att.category === 'image') {
      div.innerHTML = `
        <img src="${att.preview || att.dataUrl}" alt="${escapeHtml(att.name)}">
        <button class="remove-attachment" title="Remove">&times;</button>
      `;
    } else {
      const ext = att.name.split('.').pop().toUpperCase().slice(0, 4);
      div.innerHTML = `
        <div class="file-icon">${ext}</div>
        <div class="file-info">
          <div class="file-name" title="${escapeHtml(att.name)}">${escapeHtml(att.name)}</div>
          <div class="file-size">${formatFileSize(att.size)}</div>
        </div>
        <button class="remove-attachment" title="Remove">&times;</button>
      `;
    }
    div.querySelector('.remove-attachment').addEventListener('click', () => removeAttachment(att.id));
    container.appendChild(div);
  });
}

// ===== Projects =====
function renderProjectSelector() {
  const selector = els.projectSelector;
  while (selector.options.length > 1) selector.remove(1);
  state.projects.forEach((project) => {
    const opt = document.createElement('option');
    opt.value = project.id;
    opt.textContent = project.name;
    selector.appendChild(opt);
  });
  if (state.currentProjectId) {
    selector.value = state.currentProjectId;
  }
}

function saveProjects() {
  state.projects.forEach((project) => {
    project.conversations.forEach((conv) => {
      conv.messages.forEach((msg, idx) => {
        if (msg.attachmentMeta && idx < conv.messages.length - 10) {
          msg.attachmentMeta.forEach((att) => { att.dataUrl = null; });
        }
      });
    });
  });
  try {
    localStorage.setItem('openrouter_projects', JSON.stringify(state.projects));
  } catch (e) {
    alert('Storage is full. Try deleting old conversations or project files.');
  }
}

function openNewProjectModal() {
  state.editingProjectId = null;
  state.pendingProjectFiles = [];
  els.projectModalTitle.textContent = 'New Project';
  els.projectNameInput.value = '';
  els.projectDescInput.value = '';
  els.projectInstructionsInput.value = '';
  els.deleteProjectBtn.classList.add('hidden');
  els.saveProjectBtn.textContent = 'Create Project';
  renderProjectFileList();
  els.projectModal.classList.remove('hidden');
  els.projectNameInput.focus();
}

function openEditProjectModal(projectId) {
  const project = getProject(projectId);
  if (!project) return;
  state.editingProjectId = projectId;
  state.pendingProjectFiles = project.files.map((f) => ({ ...f }));
  els.projectModalTitle.textContent = 'Edit Project';
  els.projectNameInput.value = project.name;
  els.projectDescInput.value = project.description || '';
  els.projectInstructionsInput.value = project.instructions || '';
  els.deleteProjectBtn.classList.remove('hidden');
  els.saveProjectBtn.textContent = 'Save Changes';
  renderProjectFileList();
  els.projectModal.classList.remove('hidden');
  els.projectNameInput.focus();
}

function closeProjectModal() {
  els.projectModal.classList.add('hidden');
  state.editingProjectId = null;
  state.pendingProjectFiles = [];
}

async function addProjectFiles(files) {
  for (const file of files) {
    if (state.pendingProjectFiles.length >= 10) {
      alert('Maximum 10 project files allowed.');
      break;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert(`File "${file.name}" is too large. Max 5MB per file.`);
      continue;
    }
    try {
      const processed = await processFile(file);
      state.pendingProjectFiles.push(processed);
    } catch (err) {
      console.error(`Failed to process project file "${file.name}":`, err);
    }
  }
  renderProjectFileList();
}

function renderProjectFileList() {
  const container = els.projectFileList;
  container.innerHTML = '';
  state.pendingProjectFiles.forEach((file, index) => {
    const entry = document.createElement('div');
    entry.className = 'project-file-entry';
    const ext = file.name.split('.').pop().toUpperCase().slice(0, 4);
    entry.innerHTML = `
      <div class="file-info">
        <div class="file-icon">${ext}</div>
        <span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
        <span class="file-size">${formatFileSize(file.size)}</span>
      </div>
      <button class="remove-file-btn" title="Remove">&times;</button>
    `;
    entry.querySelector('.remove-file-btn').addEventListener('click', () => {
      state.pendingProjectFiles.splice(index, 1);
      renderProjectFileList();
    });
    container.appendChild(entry);
  });
}

function saveProject() {
  const name = els.projectNameInput.value.trim();
  if (!name) {
    els.projectNameInput.focus();
    return;
  }

  const description = els.projectDescInput.value.trim();
  const instructions = els.projectInstructionsInput.value.trim();
  const files = state.pendingProjectFiles.map((f) => ({
    id: f.id, name: f.name, size: f.size, type: f.type, category: f.category,
    textContent: f.textContent, dataUrl: f.dataUrl,
  }));

  if (state.editingProjectId) {
    const project = getProject(state.editingProjectId);
    if (project) {
      project.name = name;
      project.description = description;
      project.instructions = instructions;
      project.files = files;
      project.updatedAt = Date.now();
    }
  } else {
    const project = {
      id: generateId('prj'),
      name, description, instructions, files,
      conversations: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    state.projects.unshift(project);
    state.currentProjectId = project.id;
    els.projectSelector.value = project.id;
  }

  saveProjects();
  renderProjectSelector();
  renderSidebarContent();
  closeProjectModal();

  if (!state.editingProjectId) {
    newChat();
  }
}

function deleteCurrentProject() {
  if (!state.editingProjectId) return;
  const project = getProject(state.editingProjectId);
  if (!project) return;

  const convCount = project.conversations.length;
  const msg = convCount > 0
    ? `Delete "${project.name}" and its ${convCount} conversation(s)? This cannot be undone.`
    : `Delete "${project.name}"? This cannot be undone.`;
  if (!confirm(msg)) return;

  state.projects = state.projects.filter((p) => p.id !== state.editingProjectId);
  if (state.currentProjectId === state.editingProjectId) {
    state.currentProjectId = null;
    state.currentConvId = null;
  }

  saveProjects();
  renderProjectSelector();
  closeProjectModal();
  els.projectSelector.value = '';
  renderSidebarContent();
  newChat();
}

// ===== Sidebar Rendering =====
function renderSidebarContent() {
  const container = els.sidebarContent;
  container.innerHTML = '';

  if (!state.currentProjectId) {
    const listDiv = document.createElement('div');
    listDiv.className = 'sidebar-conversations';
    container.appendChild(listDiv);
    renderConversationListInto(listDiv, state.conversations);
    return;
  }

  const project = getCurrentProject();
  if (!project) return;

  // Project header
  const header = document.createElement('div');
  header.className = 'project-header';
  header.innerHTML = `
    <div class="project-header-top">
      <h3 title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</h3>
      <div class="project-header-actions">
        <button class="edit-project-btn" title="Edit project">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>
    </div>
    ${project.description ? `<div class="project-description">${escapeHtml(project.description)}</div>` : ''}
  `;
  header.querySelector('.edit-project-btn').addEventListener('click', () => openEditProjectModal(project.id));
  container.appendChild(header);

  // Project files
  if (project.files.length > 0) {
    const filesSection = document.createElement('div');
    filesSection.className = 'project-files-section';
    filesSection.innerHTML = `<div class="section-label">Files (${project.files.length})</div>`;
    project.files.forEach((file) => {
      const fileItem = document.createElement('div');
      fileItem.className = 'project-file-item';
      const ext = file.name.split('.').pop().toUpperCase().slice(0, 4);
      fileItem.innerHTML = `<div class="file-icon">${ext}</div><span>${escapeHtml(file.name)}</span>`;
      filesSection.appendChild(fileItem);
    });
    container.appendChild(filesSection);
  }

  // Project instructions summary
  if (project.instructions) {
    const instrDiv = document.createElement('div');
    instrDiv.className = 'project-instructions-summary';
    instrDiv.textContent = project.instructions.slice(0, 120) + (project.instructions.length > 120 ? '...' : '');
    instrDiv.title = 'Click to edit instructions';
    instrDiv.addEventListener('click', () => openEditProjectModal(project.id));
    container.appendChild(instrDiv);
  }

  // Conversations list
  const listDiv = document.createElement('div');
  listDiv.className = 'sidebar-conversations';
  container.appendChild(listDiv);
  renderConversationListInto(listDiv, project.conversations);
}

function renderConversationListInto(container, conversations) {
  container.innerHTML = '';
  conversations.forEach((conv) => {
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
    container.appendChild(div);
  });
}

// ===== Conversations =====
function newChat() {
  state.currentConvId = null;
  clearAttachments();
  renderMessages([]);
  els.welcome.classList.remove('hidden');
  renderSidebarContent();
  els.messageInput.focus();
}

function createConversation(firstMessage) {
  const conv = {
    id: generateId('conv'),
    title: firstMessage.slice(0, 80),
    messages: [],
    model: state.selectedModel,
    createdAt: Date.now(),
  };

  if (state.currentProjectId) {
    const project = getCurrentProject();
    if (project) {
      project.conversations.unshift(conv);
      saveProjects();
    }
  } else {
    state.conversations.unshift(conv);
    saveConversations();
  }

  state.currentConvId = conv.id;
  renderSidebarContent();
  return conv;
}

function getCurrentConv() {
  const convs = getActiveConversations();
  return convs.find((c) => c.id === state.currentConvId);
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
  renderSidebarContent();
}

function deleteConversation(id, e) {
  e.stopPropagation();

  if (state.currentProjectId) {
    const project = getCurrentProject();
    if (project) {
      project.conversations = project.conversations.filter((c) => c.id !== id);
      saveProjects();
    }
  } else {
    state.conversations = state.conversations.filter((c) => c.id !== id);
    saveConversations();
  }

  if (state.currentConvId === id) {
    newChat();
  }
  renderSidebarContent();
}

function saveConversations() {
  state.conversations.forEach((conv) => {
    conv.messages.forEach((msg, idx) => {
      if (msg.attachmentMeta && idx < conv.messages.length - 10) {
        msg.attachmentMeta.forEach((att) => { att.dataUrl = null; });
      }
    });
  });
  try {
    localStorage.setItem('openrouter_conversations', JSON.stringify(state.conversations));
  } catch (e) {
    alert('Storage is full. Try deleting old conversations.');
  }
}

// ===== Messages =====
function renderMessages(messages) {
  els.messages.innerHTML = '';
  if (messages.length === 0) {
    els.messages.appendChild(els.welcome || createWelcomeEl());
    els.welcome = $('#welcome');
    els.welcome.classList.remove('hidden');
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
    appendMessageEl(msg.role, msg.content, msg.attachmentMeta, msg.displayText);
  });
  scrollToBottom();
}

function appendMessageEl(role, content, attachmentMeta, displayText) {
  if (els.welcome) els.welcome.classList.add('hidden');

  const div = document.createElement('div');
  div.className = `message ${role}`;
  const avatarLabel = role === 'user' ? 'U' : 'AI';

  div.innerHTML = `
    <div class="message-avatar">${avatarLabel}</div>
    <div class="message-body">
      <div class="message-attachments"></div>
      <div class="message-content"></div>
    </div>
  `;

  const attachmentsEl = div.querySelector('.message-attachments');
  const contentEl = div.querySelector('.message-content');

  if (attachmentMeta && attachmentMeta.length > 0) {
    attachmentMeta.forEach((att) => {
      if (att.category === 'image' && att.dataUrl) {
        const img = document.createElement('img');
        img.src = att.dataUrl;
        img.alt = att.name;
        img.title = att.name;
        img.addEventListener('click', () => window.open(att.dataUrl, '_blank'));
        attachmentsEl.appendChild(img);
      } else {
        const fileEl = document.createElement('div');
        fileEl.className = 'message-attachment-file';
        const ext = att.name.split('.').pop().toUpperCase().slice(0, 4);
        fileEl.innerHTML = `<div class="file-icon">${ext}</div><span>${escapeHtml(att.name)}</span>`;
        attachmentsEl.appendChild(fileEl);
      }
    });
  }

  if (role === 'assistant') {
    const textContent = extractTextFromContent(content);
    contentEl.innerHTML = renderMarkdown(textContent || '');
    addCopyButtons(contentEl);
  } else {
    const userText = displayText !== undefined ? displayText : extractTextFromContent(content);
    if (userText) contentEl.textContent = userText;
  }

  els.messages.appendChild(div);
  scrollToBottom();
  return div;
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  }
  return '';
}

function renderMarkdown(text) {
  if (!text) return '';
  try {
    const html = marked.parse(text, { breaks: true, gfm: true });
    return DOMPurify.sanitize(html);
  } catch {
    return escapeHtml(text);
  }
}

function addCopyButtons(container) {
  container.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code) return;
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

// ===== Build API Messages =====
function buildApiMessages(conv) {
  const messages = [];
  const project = getCurrentProject();

  // 1. System prompt: project instructions + global
  let systemContent = '';
  if (project && project.instructions) {
    systemContent += project.instructions;
  }
  if (state.systemPrompt) {
    if (systemContent) systemContent += '\n\n';
    systemContent += state.systemPrompt;
  }
  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }

  // 2. Inject project files as context
  if (project && project.files.length > 0) {
    const fileParts = [];
    fileParts.push({
      type: 'text',
      text: 'The following files are provided as project context. Use them to inform your responses.',
    });

    project.files.forEach((file) => {
      if (file.category === 'text' && file.textContent) {
        fileParts.push({
          type: 'text',
          text: `[Project File: ${file.name}]\n\`\`\`\n${file.textContent}\n\`\`\``,
        });
      } else if ((file.category === 'image' || file.category === 'pdf') && file.dataUrl) {
        fileParts.push({ type: 'text', text: `[Project File: ${file.name}]` });
        fileParts.push({ type: 'image_url', image_url: { url: file.dataUrl } });
      } else if (file.dataUrl) {
        fileParts.push({ type: 'text', text: `[Project File: ${file.name}]` });
        fileParts.push({ type: 'image_url', image_url: { url: file.dataUrl } });
      }
    });

    messages.push({ role: 'user', content: fileParts });
    messages.push({ role: 'assistant', content: 'I\'ve reviewed the project files and I\'m ready to help. What would you like to discuss?' });
  }

  // 3. Conversation messages
  conv.messages.forEach((m) => {
    messages.push({ role: m.role, content: m.content });
  });

  return messages;
}

// ===== Send Message =====
async function sendMessage() {
  const text = els.messageInput.value.trim();
  const attachments = [...state.pendingAttachments];

  if ((!text && attachments.length === 0) || state.isStreaming) return;

  if (!state.apiKey) {
    openSettings();
    return;
  }

  const displayText = text || '(attached files)';
  if (!state.currentConvId) {
    createConversation(displayText);
  }

  const conv = getCurrentConv();

  // Build content for API
  let apiContent;
  if (attachments.length > 0) {
    apiContent = [];
    attachments.forEach((att) => {
      if (att.category === 'text') {
        apiContent.push({ type: 'text', text: `[File: ${att.name}]\n\`\`\`\n${att.textContent}\n\`\`\`` });
      }
    });
    if (text) {
      apiContent.push({ type: 'text', text });
    }
    attachments.forEach((att) => {
      if (att.category === 'image' || att.category === 'pdf') {
        apiContent.push({ type: 'image_url', image_url: { url: att.dataUrl } });
      } else if (att.category === 'binary') {
        apiContent.push({ type: 'text', text: `[Attached binary file: ${att.name} (${formatFileSize(att.size)})]` });
      }
    });
  } else {
    apiContent = text;
  }

  const storedMessage = {
    role: 'user',
    content: apiContent,
    displayText: text,
    attachmentMeta: attachments.length > 0
      ? attachments.map((a) => ({
          name: a.name, size: a.size, category: a.category,
          dataUrl: a.category === 'image' ? a.dataUrl : null,
        }))
      : undefined,
  };
  conv.messages.push(storedMessage);
  conv.model = state.selectedModel;
  saveCurrentConversations();

  appendMessageEl('user', apiContent, storedMessage.attachmentMeta, text);
  els.messageInput.value = '';
  els.messageInput.style.height = 'auto';
  clearAttachments();

  // Build messages array for API (project-aware)
  const apiMessages = buildApiMessages(conv);

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
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': state.apiKey },
      body: JSON.stringify({ model: state.selectedModel, messages: apiMessages }),
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
        } catch { /* skip malformed chunks */ }
      }
    }

    addCopyButtons(contentEl);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const metaDiv = document.createElement('div');
    metaDiv.className = 'message-meta';
    metaDiv.textContent = `${elapsed}s`;
    assistantDiv.querySelector('.message-body').appendChild(metaDiv);

    conv.messages.push({ role: 'assistant', content: fullResponse });
    saveCurrentConversations();
  } catch (err) {
    if (err.name === 'AbortError') {
      if (fullResponse) {
        conv.messages.push({ role: 'assistant', content: fullResponse });
        saveCurrentConversations();
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
  if (state.abortController) state.abortController.abort();
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
  if (keyChanged && state.apiKey) fetchModels();
  closeSettings();
}

// ===== Start =====
init();
