// test/factories.test.js — browser & AI provider factory resolution
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { getBrowserAdapter, VALID_BROWSERS } = require('../src/browsers');
const { getAIProvider, VALID_PROVIDERS }   = require('../src/providers');

// ── Browser factory ──────────────────────────────────────────────────────────

test('browser factory resolves every valid name', () => {
  for (const name of VALID_BROWSERS) {
    const a = getBrowserAdapter(name);
    assert.ok(a, 'adapter for ' + name);
    assert.ok(typeof a.playwrightType === 'string');
    assert.ok(['chromium', 'firefox', 'webkit'].includes(a.playwrightType));
  }
});

test('browser factory is case-insensitive and trims', () => {
  assert.strictEqual(getBrowserAdapter('CHROMIUM').name, 'chromium');
  assert.strictEqual(getBrowserAdapter('  Firefox ').name, 'firefox');
  assert.strictEqual(getBrowserAdapter('Brave').name, 'brave');
});

test('browser factory defaults to chromium', () => {
  assert.strictEqual(getBrowserAdapter().name, 'chromium');
});

test('Cami Browser alias resolves to the native WebKit adapter', () => {
  assert.strictEqual(getBrowserAdapter('cami-browser').name, 'webkit');
});

test('browser factory throws on unknown name listing valid values', () => {
  assert.throws(() => getBrowserAdapter('opera'), err => {
    assert.match(err.message, /Unknown browser/);
    assert.match(err.message, /chromium/);
    return true;
  });
});

test('tor adapter always exposes its SOCKS5 proxy', () => {
  assert.deepStrictEqual(getBrowserAdapter('tor').getProxyConfig(), { server: 'socks5://127.0.0.1:9050' });
});

// ── AI provider factory ──────────────────────────────────────────────────────

test('AI factory resolves every valid name', () => {
  for (const name of VALID_PROVIDERS) {
    const p = getAIProvider(name);
    assert.ok(p, 'provider for ' + name);
    assert.ok(typeof p.url === 'string' && p.url.length > 0);
    assert.ok(typeof p.label === 'string');
  }
});

test('AI factory is case-insensitive and trims', () => {
  assert.strictEqual(getAIProvider('DeepSeek').name, 'deepseek');
  assert.strictEqual(getAIProvider('  GEMINI ').name, 'gemini');
});

test('AI factory defaults to deepseek', () => {
  assert.strictEqual(getAIProvider().name, 'deepseek');
});

test('AI factory throws on unknown name listing valid values', () => {
  assert.throws(() => getAIProvider('chatgpt'), err => {
    assert.match(err.message, /Unknown AI provider/);
    assert.match(err.message, /deepseek/);
    return true;
  });
});

test('deepseek provider keeps the pre-refactor URL and full selector bank', () => {
  const p = getAIProvider('deepseek');
  assert.strictEqual(p.url, 'https://chat.deepseek.com');
  for (const key of ['inputBox', 'sendButton', 'stopButton', 'newChat', 'assistantMessage', 'assistantContent', 'generating']) {
    assert.ok(Array.isArray(p.selectors[key]) && p.selectors[key].length > 0, key);
  }
});

test('unimplemented providers expose ensureImplemented() that throws clearly', () => {
  for (const name of ['hackerai', 'venice', 'mistral']) {
    const p = getAIProvider(name);
    assert.strictEqual(typeof p.ensureImplemented, 'function');
    assert.throws(() => p.ensureImplemented(), err => {
      assert.match(err.message, /non encore implémenté/);
      assert.match(err.message, new RegExp(name + '\\.json'));
      return true;
    });
  }
});
