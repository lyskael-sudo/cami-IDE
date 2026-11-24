// src/browsers/base.js — BrowserAdapter contract
'use strict';

/**
 * BrowserAdapter — interface every browser backend implements.
 */
class BrowserAdapter {
  constructor(name) {
    if (new.target === BrowserAdapter) throw new Error('BrowserAdapter is abstract');
    this.name = name;
  }

  get playwrightType() { throw new Error('playwrightType not implemented'); }

  getExecutablePath() { return null; }

  getLaunchArgs() {
    return this.playwrightType === 'chromium'
      ? ['--disable-blink-features=AutomationControlled', '--no-first-run', '--disable-default-apps']
      : [];
  }

  getProxyConfig() { return null; }

  /**
   * User-Agent override for the launch, or undefined to keep the browser's real one.
   *
   * A hard-coded "Chrome/124" UA used to be forced on every Chromium launch.
   * That desyncs the UA from the Client Hints the real browser sends, and
   * Google rejects the mismatch on OAuth with "This browser or app may not be
   * secure" — which is exactly why Gemini could not be signed into. Keep the
   * genuine UA; only a provider that explicitly asks for a spoof gets one.
   */
  getUserAgent() {
    return undefined;
  }

  ensureAvailable() {}

  async launch(sessionDir, opts = {}) {
    const playwright = require('playwright');
    const engine = playwright[this.playwrightType];
    if (!engine) throw new Error('Playwright has no engine: ' + this.playwrightType);

    const launchOpts = {
      headless : !!opts.headless,
      viewport : opts.viewport || { width: 1280, height: 900 },
      args     : this.getLaunchArgs(),
    };

    const executablePath = this.getExecutablePath();
    if (executablePath) launchOpts.executablePath = executablePath;

    const ua = this.getUserAgent();
    if (ua) launchOpts.userAgent = ua;

    const proxy = this.getProxyConfig();
    if (proxy) launchOpts.proxy = proxy;

    if (this.playwrightType === 'chromium') {
      launchOpts.ignoreDefaultArgs = ['--enable-automation'];
    }

    return engine.launchPersistentContext(sessionDir, launchOpts);
  }
}

module.exports = BrowserAdapter;
