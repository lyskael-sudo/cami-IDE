'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const DeepSeekBrowser = require('../src/browser');

test('login wait clears a stale abort flag instead of failing immediately', async () => {
  const browser = Object.create(DeepSeekBrowser.prototype);
  let loginRequired = true;
  let waits = 0;
  browser.abort = true; // a previous Esc / stop left this set
  browser.onLoginRequired = () => {};
  browser.page = {
    evaluate: async () => loginRequired,
    waitForTimeout: async () => {
      if (++waits > 1) loginRequired = false;
    },
  };
  const previousHeadless = config.HEADLESS;
  config.HEADLESS = false;

  try {
    assert.equal(await browser._ensureLoggedIn(), true);
  } finally {
    config.HEADLESS = previousHeadless;
  }
});

test('login recovery does not resend the prompt when the reply already arrived', async () => {
  const browser = Object.create(DeepSeekBrowser.prototype);
  browser._loginRecoveryCount = 0;
  browser._lastSentMessage = 'Analyse the folder';
  browser._accountSuspensionNotice = async () => null;
  browser._isLoginRequired = async () => true;
  browser._ensureLoggedIn = async () => true;
  browser._extractLastMessage = async () => 'Here is the complete answer, already finished.';
  browser._isGenerating = async () => false;
  const sent = [];
  browser.sendMessage = async (message) => { sent.push(message); };

  assert.equal(await browser._recoverFromLogin(), true);
  assert.deepEqual(sent, []);
});

test('login recovery still resends when the reply never started', async () => {
  const browser = Object.create(DeepSeekBrowser.prototype);
  browser._loginRecoveryCount = 0;
  browser._lastSentMessage = 'Analyse the folder';
  browser._accountSuspensionNotice = async () => null;
  browser._isLoginRequired = async () => true;
  browser._ensureLoggedIn = async () => true;
  browser._extractLastMessage = async () => '';
  browser._isGenerating = async () => false;
  const sent = [];
  browser.sendMessage = async (message) => { sent.push(message); };

  assert.equal(await browser._recoverFromLogin(), true);
  assert.deepEqual(sent, ['Analyse the folder']);
});
