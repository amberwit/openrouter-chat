const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const appSource = readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function createElement() {
  const classes = new Set();
  return {
    children: [],
    dataset: {},
    value: '',
    set innerHTML(value) { this.children = []; },
    appendChild(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    classList: {
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
  };
}

function loadApp() {
  const elements = new Map();
  const context = vm.createContext({
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, createElement());
        return elements.get(selector);
      },
      createElement,
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    window: {},
    Option: function (textContent, value) { Object.assign(this, { textContent, value }); },
  });
  const run = (code) => vm.runInContext(code, context);
  // Load the real browser functions without running startup against the test DOM.
  run(appSource.replace(/\binit\(\);\s*$/, ''));
  return { context, elements, run };
}

test('model labels distinguish paid, zero, missing and dynamic token rates', () => {
  const { context, run } = loadApp();
  for (const [pricing, suffix] of [
    [{ prompt: '0.00000006', completion: '0.00000018' }, '$0.06 in / $0.18 out per 1M'],
    [{ prompt: '0', completion: '0' }, 'Free text tokens'],
    [{ prompt: '-1', completion: '-1' }, 'Variable pricing'],
    [undefined, 'Pricing unavailable'],
    [{ prompt: '', completion: '0' }, '? in / $0 out per 1M'],
    [{ prompt: '0.0000000001', completion: '0.0000015' }, '$0.0001 in / $1.5 out per 1M'],
  ]) {
    context.model = { id: 'test/model', pricing };
    assert.equal(run('modelOptionLabel(model)'), `test/model — ${suffix}`);
  }
});

test('Popular and provider options use the same label and keep the model ID', () => {
  const { context, elements, run } = loadApp();
  context.model = { id: 'openai/gpt-4o', name: 'GPT-4o', pricing: { prompt: '0.000002', completion: '0.000008' } };
  run('state.models = [model]; populateModelSelector(model.id)');
  const select = elements.get('#model-selector');
  assert.deepEqual(select.children.map((group) => group.label), ['Popular', 'openai']);
  for (const group of select.children) {
    assert.equal(group.children[0].value, context.model.id);
    assert.equal(group.children[0].textContent, 'GPT-4o — $2 in / $8 out per 1M');
  }
  assert.equal(select.value, context.model.id);
});

test('effort options follow the selected model, including when restoring a conversation', () => {
  const { elements, run } = loadApp();
  run(`
    state.models = [
      { id: 'a', reasoning: { supported_efforts: ['high', 'none'], mandatory: true } },
      { id: 'b', reasoning: { supported_efforts: null } },
      { id: 'c', reasoning: { default_enabled: true }, supported_parameters: ['reasoning'] },
    ];
    populateModelSelector('a');
  `);
  const effort = elements.get('#reasoning-effort');
  const control = elements.get('#reasoning-control');
  const values = () => effort.children.map((option) => option.value);
  assert.deepEqual(values(), ['', 'high']);
  assert.equal(control.classList.contains('hidden'), false);
  assert.equal(effort.value, '');

  effort.value = 'high';
  run('updateModelControls()');
  assert.equal(effort.value, 'high');

  run(`
    renderMessages = () => {};
    renderSidebarContent = () => {};
    state.conversations = [{ id: 'conv-b', model: 'b' }, { id: 'conv-c', model: 'c' }];
    loadConversation('conv-b');
  `);
  assert.equal(effort.value, '');
  assert.deepEqual(values(), ['', 'max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none']);

  run("loadConversation('conv-c')");
  assert.deepEqual(values(), ['']);
  assert.equal(effort.disabled, true);
  assert.equal(control.classList.contains('hidden'), true);
});