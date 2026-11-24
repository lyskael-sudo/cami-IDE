'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const DeepSeekBrowser = require('../src/browser');

test('DeepSeek suspension notice is distinguished from a normal login prompt', () => {
  assert.match(
    DeepSeekBrowser.accountSuspensionNotice(
      'En raison d’infraction aux politiques, votre compte a été suspendu jusqu’au novembre 18, 2026 19:15. Contactez-nous.'
    ),
    /suspendu jusqu’au novembre 18, 2026 19:15/
  );
  assert.equal(DeepSeekBrowser.accountSuspensionNotice('Sign in to continue'), null);
  assert.match(
    DeepSeekBrowser.accountSuspensionNotice('Your account has been suspended.', 'Gemini'),
    /Gemini indique que le compte est suspendu/
  );
});

test('a suspended provider account fails clearly instead of waiting for login', async () => {
  const browser = Object.create(DeepSeekBrowser.prototype);
  browser.page = {
    evaluate: async () => 'Your account has been suspended until November 18, 2026.',
  };

  await assert.rejects(browser._ensureLoggedIn(), /compte est suspendu jusqu’au November 18, 2026/);
});

test('embedded browser waits for login without reading the worker stdin', async () => {
  const browser = Object.create(DeepSeekBrowser.prototype);
  let loginRequired = true;
  let notified = 0;
  let waits = 0;
  browser.abort = false;
  browser.onLoginRequired = () => { notified += 1; };
  browser.page = {
    evaluate: async () => loginRequired,
    waitForTimeout: async () => {
      if (++waits > 1) loginRequired = false;
    },
  };
  const previousHeadless = config.HEADLESS;
  config.HEADLESS = false;

  try {
    await browser._ensureLoggedIn();
  } finally {
    config.HEADLESS = previousHeadless;
  }

  assert.equal(notified, 1);
});

test('embedded browser login wait can be stopped', async () => {
  const browser = Object.create(DeepSeekBrowser.prototype);
  browser.abort = false;
  browser.onLoginRequired = () => {};
  browser.page = {
    evaluate: async () => true,
    waitForTimeout: async () => { browser.abort = true; },
  };
  const previousHeadless = config.HEADLESS;
  config.HEADLESS = false;

  try {
    await assert.rejects(browser._ensureLoggedIn(), /Login cancelled/);
  } finally {
    config.HEADLESS = previousHeadless;
  }
});

test('a session that expires during a task waits for login and resends only the pending message', async () => {
  const browser = Object.create(DeepSeekBrowser.prototype);
  browser._loginRecoveryCount = 0;
  browser._lastSentMessage = 'Continue the folder analysis';
  let loginChecks = 0;
  let restored = false;
  const sent = [];
  browser._accountSuspensionNotice = async () => null;
  browser._isLoginRequired = async () => loginChecks++ === 0;
  browser._ensureLoggedIn = async () => {
    restored = true;
    return true;
  };
  browser.sendMessage = async (message) => {
    assert.equal(restored, true);
    sent.push(message);
  };

  assert.equal(await browser._recoverFromLogin(), true);
  assert.deepEqual(sent, ['Continue the folder analysis']);
  assert.equal(browser._loginRecoveryCount, 1);
});

test('login recovery is bounded when the provider repeatedly invalidates the session', async () => {
  const browser = Object.create(DeepSeekBrowser.prototype);
  browser._loginRecoveryCount = 3;
  browser._accountSuspensionNotice = async () => null;
  browser._isLoginRequired = async () => true;

  await assert.rejects(browser._recoverFromLogin(), /redemandé une connexion plusieurs fois/);
});
