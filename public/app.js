// ===== State =====
// Older builds stored the key on this browser origin. Leave all other storage intact.
localStorage.removeItem('openrouter_api_key');
const state = {
  apiKey: '',
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
  reasoningControl: $('#reasoning-control'),
  reasoningEffort: $('#reasoning-effort'),
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
  els.systemPromptInput.value = state.systemPrompt;

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
    updateModelControls();
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
const tokenPriceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumSignificantDigits: 1,
  maximumSignificantDigits: 6,
});
const reasoningEfforts = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'];
const reasoningEffortLabels = { max: 'Max', xhigh: 'Extra high', high: 'High', medium: 'Medium', low: 'Low', minimal: 'Minimal', none: 'None' };

function parseTokenPrice(value) {
  return typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
}

function modelOptionLabel(model) {
  const name = model.name || model.id;
  const input = parseTokenPrice(model.pricing?.prompt);
  const output = parseTokenPrice(model.pricing?.completion);
  if (input === -1 || output === -1) return `${name} — Variable pricing`;
  if (input === 0 && output === 0) return `${name} — Free text tokens`;

  const format = (price) => {
    const perMillion = price * 1_000_000;
    return Number.isFinite(perMillion) && perMillion >= 0 ? tokenPriceFormatter.format(perMillion) : null;
  };
  const inputLabel = format(input);
  const outputLabel = format(output);
  if (!inputLabel && !outputLabel) return `${name} — Pricing unavailable`;
  return `${name} — ${inputLabel || '?'} in / ${outputLabel || '?'} out per 1M`;
}

function createModelOption(model) {
  const option = document.createElement('option');
  option.value = model.id;
  option.textContent = modelOptionLabel(model);
  return option;
}

async function fetchModels() {
  const apiKey = state.apiKey;
  try {
    const res = await fetch('/api/models', {
      headers: { 'X-Api-Key': apiKey },
    });
    const data = await res.json();
    if (state.apiKey !== apiKey) return;

    if (data.error) {
      console.error('Error fetching models:', data.error);
      return;
    }

    const preferredModel = state.models.length ? state.selectedModel : getCurrentConv()?.model || state.selectedModel;
    state.models = (data.data || [])
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

    populateModelSelector(preferredModel);
    enableInput();
  } catch (err) {
    console.error('Failed to fetch models:', err);
  }
}

function populateModelSelector(preferredModel) {
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
      popularGroup.appendChild(createModelOption(model));
    }
  });
  if (popularGroup.children.length > 0) {
    selector.appendChild(popularGroup);
  }

  Object.keys(groups).sort().forEach((provider) => {
    const optgroup = document.createElement('optgroup');
    optgroup.label = provider;
    groups[provider].forEach((m) => {
      optgroup.appendChild(createModelOption(m));
    });
    selector.appendChild(optgroup);
  });

  if (preferredModel && state.models.some((m) => m.id === preferredModel)) {
    selector.value = preferredModel;
    state.selectedModel = preferredModel;
  } else if (state.models.length > 0) {
    const defaultModel = popular.find((id) => state.models.find((m) => m.id === id));
    selector.value = defaultModel || state.models[0].id;
    state.selectedModel = selector.value;
    localStorage.setItem('openrouter_model', state.selectedModel);
  }

  selector.disabled = false;
  updateModelControls();
}

function updateModelControls() {
  const model = state.models.find((m) => m.id === state.selectedModel);
  els.modelLabel.textContent = model ? (model.name || model.id) : '';

  const capabilities = model?.reasoning;
  const supported = capabilities?.supported_efforts;
  const efforts = (supported === null ? reasoningEfforts : Array.isArray(supported) ? supported : [])
    .filter((effort) => reasoningEfforts.includes(effort) && !(capabilities.mandatory && effort === 'none'));
  const selector = els.reasoningEffort;
  const previous = selector.dataset.model === model?.id ? selector.value : '';
  selector.dataset.model = model?.id || '';
  selector.replaceChildren(new Option('Model default', ''));
  efforts.forEach((effort) => selector.appendChild(new Option(reasoningEffortLabels[effort], effort)));
  selector.value = efforts.includes(previous) ? previous : '';
  selector.disabled = efforts.length === 0;
  els.reasoningControl.classList.toggle('hidden', selector.disabled);
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

function makeElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function fileIcon(name) {
  return makeElement('div', 'file-icon', name.split('.').pop().toUpperCase().slice(0, 4));
}

function fileNameEl(tag, name) {
  const el = makeElement(tag, 'file-name', name);
  el.title = name;
  return el;
}

function attachmentImage(att) {
  if (att.category !== 'image' || typeof att.dataUrl !== 'string' ||
      !/^data:image\/(?:png|jpe?g|gif|webp|bmp|x-icon|vnd\.microsoft\.icon|avif);base64,/i.test(att.dataUrl)) return null;
  const img = document.createElement('img');
  img.alt = att.name;
  img.title = att.name;
  img.src = att.dataUrl;
  return img;
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
  };

  if (category === 'text') {
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
    state.pendingAttachments.splice(idx, 1);
  }
  renderAttachmentPreviews();
}

function clearAttachments() {
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
    const img = attachmentImage(att);
    const div = makeElement('div', img ? 'attachment-preview image-preview' : 'attachment-preview file-preview');
    if (img) {
      div.appendChild(img);
    } else {
      const info = makeElement('div', 'file-info');
      info.append(fileNameEl('div', att.name), makeElement('div', 'file-size', formatFileSize(att.size)));
      div.append(fileIcon(att.name), info);
    }
    const remove = makeElement('button', 'remove-attachment', '×');
    remove.title = 'Remove';
    remove.addEventListener('click', () => removeAttachment(att.id));
    div.appendChild(remove);
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
    const entry = makeElement('div', 'project-file-entry');
    const info = makeElement('div', 'file-info');
    info.append(fileIcon(file.name), fileNameEl('span', file.name), makeElement('span', 'file-size', formatFileSize(file.size)));
    const remove = makeElement('button', 'remove-file-btn', '×');
    remove.title = 'Remove';
    remove.addEventListener('click', () => {
      state.pendingProjectFiles.splice(index, 1);
      renderProjectFileList();
    });
    entry.append(info, remove);
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
      <h3></h3>
      <div class="project-header-actions">
        <button class="edit-project-btn" title="Edit project">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
      </div>
    </div>
  `;
  const name = header.querySelector('h3');
  name.textContent = project.name;
  name.title = project.name;
  if (project.description) header.appendChild(makeElement('div', 'project-description', project.description));
  header.querySelector('.edit-project-btn').addEventListener('click', () => openEditProjectModal(project.id));
  container.appendChild(header);

  // Project files
  if (project.files.length > 0) {
    const filesSection = document.createElement('div');
    filesSection.className = 'project-files-section';
    filesSection.appendChild(makeElement('div', 'section-label', `Files (${project.files.length})`));
    project.files.forEach((file) => {
      const fileItem = document.createElement('div');
      fileItem.className = 'project-file-item';
      fileItem.append(fileIcon(file.name), makeElement('span', '', file.name));
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
      <span class="conv-title"></span>
      <button class="conv-delete" title="Delete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    `;
    div.querySelector('.conv-title').textContent = conv.title;
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
    updateModelControls();
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

  const assistant = role === 'assistant';
  const div = makeElement('div', assistant ? 'message assistant' : 'message user');
  const avatar = makeElement('div', 'message-avatar', assistant ? 'AI' : 'U');
  const body = makeElement('div', 'message-body');
  const attachmentsEl = makeElement('div', 'message-attachments');
  const contentEl = makeElement('div', 'message-content');
  body.append(attachmentsEl, contentEl);
  div.append(avatar, body);

  if (attachmentMeta && attachmentMeta.length > 0) {
    attachmentMeta.forEach((att) => {
      const img = attachmentImage(att);
      if (img) {
        attachmentsEl.appendChild(img);
      } else {
        const fileEl = makeElement('div', 'message-attachment-file');
        fileEl.append(fileIcon(att.name), makeElement('span', '', att.name));
        attachmentsEl.appendChild(fileEl);
      }
    });
  }

  if (assistant) {
    renderAssistantReply(contentEl, extractTextFromContent(content));
  } else {
    const userText = displayText !== undefined ? displayText : extractTextFromContent(content);
    renderPlainText(contentEl, userText);
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

function renderPlainText(container, text) {
  container.classList.add('plain-text');
  container.textContent = text;
}

function renderAssistantReply(container, text) {
  if (!text) return;
  try {
    const markdown = new marked.Marked({
      breaks: true,
      gfm: true,
      renderer: {
        // Drop raw HTML and remote media before DOMPurify builds a fragment.
        html: () => '',
        image: () => '',
      },
    });
    if (!DOMPurify.isSupported) throw new Error('Markdown sanitizer is unavailable');
    const fragment = DOMPurify.sanitize(markdown.parse(text), {
      ALLOWED_TAGS: ['a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'],
      ALLOWED_ATTR: ['align', 'class', 'href', 'start', 'title'],
      ALLOWED_URI_REGEXP: /^https?:\/\//i,
      ALLOW_ARIA_ATTR: false,
      ALLOW_DATA_ATTR: false,
      RETURN_DOM_FRAGMENT: true,
    });
    fragment.querySelectorAll('a[href]').forEach((link) => {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });
    addCopyButtons(fragment);
    container.classList.remove('plain-text');
    container.replaceChildren(fragment);
  } catch {
    renderPlainText(container, text);
  }
}

function addCopyButtons(container) {
  container.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code) return;
    const langClass = [...code.classList].find((c) => c.startsWith('language-'));
    const lang = langClass ? langClass.replace('language-', '') : 'code';
    const header = makeElement('div', 'code-header');
    const btn = makeElement('button', 'copy-btn');
    btn.type = 'button';
    btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
    `;
    const label = makeElement('span', '', 'Copy');
    btn.appendChild(label);
    let resetLabel;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        label.textContent = 'Copied!';
      } catch {
        label.textContent = 'Copy failed';
      }
      clearTimeout(resetLabel);
      resetLabel = setTimeout(() => { label.textContent = 'Copy'; }, 1500);
    });
    header.append(makeElement('span', '', lang), btn);
    pre.insertBefore(header, pre.firstChild);
  });
}

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

    const payload = { model: state.selectedModel, messages: apiMessages };
    const effort = els.reasoningEffort.value;
    if (!els.reasoningEffort.disabled && effort) payload.reasoning = { effort };
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': state.apiKey },
      body: JSON.stringify(payload),
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
          if (typeof delta === 'string' && delta) {
            fullResponse += delta;
            renderPlainText(contentEl, fullResponse);
            scrollToBottom();
          }
        } catch { /* skip malformed chunks */ }
      }
    }

    renderAssistantReply(contentEl, fullResponse);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const metaDiv = document.createElement('div');
    metaDiv.className = 'message-meta';
    metaDiv.textContent = `${elapsed}s`;
    assistantDiv.querySelector('.message-body').appendChild(metaDiv);
    scrollToBottom();

    conv.messages.push({ role: 'assistant', content: fullResponse });
    saveCurrentConversations();
  } catch (err) {
    if (err.name === 'AbortError') {
      if (fullResponse) {
        renderAssistantReply(contentEl, fullResponse);
        conv.messages.push({ role: 'assistant', content: fullResponse });
        saveCurrentConversations();
      }
    } else {
      contentEl.replaceChildren(makeElement('div', 'message-error', `Error: ${err.message}`));
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
  els.apiKeyInput.placeholder = state.apiKey ? 'Key set for this tab; leave blank to keep it' : 'sk-or-v1-...';
  els.systemPromptInput.value = state.systemPrompt;
  els.apiKeyInput.focus();
}

function closeSettings() {
  els.apiKeyInput.value = '';
  els.apiKeyInput.type = 'password';
  els.settingsModal.classList.add('hidden');
}

function saveSettings() {
  const newKey = els.apiKeyInput.value.trim() || state.apiKey;
  const keyChanged = newKey !== state.apiKey;
  state.apiKey = newKey;
  state.systemPrompt = els.systemPromptInput.value.trim();
  localStorage.setItem('openrouter_system_prompt', state.systemPrompt);
  applyTheme(state.theme);
  if (keyChanged && state.apiKey) fetchModels();
  closeSettings();
}

// ===== Start =====
init();
