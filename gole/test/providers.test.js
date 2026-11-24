'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getAIProvider, VALID_PROVIDERS } = require('../src/providers');

const SELECTOR_KEYS = [
  'inputBox', 'sendButton', 'stopButton', 'newChat',
  'assistantMessage', 'assistantContent', 'generating',
];

// Stub providers throw from ensureImplemented() and ship no selectors yet.
function isStub(provider) {
  return Object.keys(provider.selectors || {}).length === 0;
}

test('every registered provider exposes a URL and a label', () => {
  for (const name of VALID_PROVIDERS) {
    const provider = getAIProvider(name);
    assert.match(provider.url, /^https:\/\//, name + ' url');
    assert.ok(provider.label, name + ' label');
  }
});

test('implemented providers expose a complete selector bank', () => {
  for (const name of VALID_PROVIDERS) {
    const provider = getAIProvider(name);
    if (isStub(provider)) {
      assert.throws(() => provider.ensureImplemented(), /non encore implémenté/,
        name + ' must reject via ensureImplemented()');
      continue;
    }
    for (const key of SELECTOR_KEYS) {
      assert.ok(
        Array.isArray(provider.resolvedSelectors[key]) && provider.resolvedSelectors[key].length > 0,
        name + '.selectors.' + key + ' must be a non-empty array'
      );
    }
  }
});

test('unknown provider names are rejected with the list of valid ones', () => {
  assert.throws(() => getAIProvider('nope'), /Unknown AI provider/);
});

test('default provider is DeepSeek', () => {
  assert.equal(getAIProvider().name, 'deepseek');
});

test('selector overrides are resolved lazily, after the subclass assigns its own', () => {
  const provider = getAIProvider('deepseek');
  assert.deepEqual(provider.resolvedSelectors.inputBox, provider.selectors.inputBox);
  assert.strictEqual(provider.resolvedSelectors, provider.resolvedSelectors, 'memoised');
});

test('Gemini does not treat its permanent page chrome as "still generating"', () => {
  const gemini = getAIProvider('gemini');
  assert.ok(!gemini.selectors.generating.some(sel => /loading|spinner|generating/.test(sel)));
  assert.ok(gemini.selectors.generating.every(sel => sel.startsWith('button[aria-label')));
});

test('Gemini prefers its stable send-button class', () => {
  const gemini = getAIProvider('gemini');
  assert.equal(gemini.selectors.sendButton[0], 'button.send-button');
});

test('every implemented provider knows how to detect a login wall', () => {
  for (const name of VALID_PROVIDERS) {
    const provider = getAIProvider(name);
    if (isStub(provider)) continue;
    assert.equal(typeof provider.isLoginRequired, 'function', name);
  }
});
