// src/providers/base.js — AIProviderAdapter contract
'use strict';

const fs   = require('fs');
const path = require('path');
const config = require('../config');

/**
 * AIProviderAdapter — interface every web-AI backend implements.
 *
 * A provider is a *site description*: URL, DOM selectors and a handful of
 * site-specific tweaks. The generic Playwright driving lives in DeepSeekBrowser
 * (src/browser.js), which delegates all site knowledge to the active provider.
 *
 * Selector fields (all arrays, ordered by likelihood, with fallbacks):
 *   inputBox, sendButton, stopButton, newChat, assistantMessage,
 *   assistantContent, generating
 *
 * Optional hooks (override only when the site needs it):
 *   isTextareaInput(tag, editable), submitFallback(page), busyPattern,
 *   extractResponse(page, selectors), cleanText(text), loginBannerText
 */
class AIProviderAdapter {
  constructor(name) {
    if (new.target === AIProviderAdapter) throw new Error('AIProviderAdapter is abstract');
    this.name = name;
    // Selectors are assigned by each subclass *after* super(), so overrides
    // cannot be merged here — they would be read from an empty object and the
    // subclass assignment would then discard the result. Resolve lazily.
    this._resolvedSelectors = null;
  }

  /**
   * Provider defaults merged with ~/.gole/providers/<name>.json overrides.
   * Overrides come first in each list, so they take priority over defaults.
   */
  get resolvedSelectors() {
    if (!this._resolvedSelectors) {
      this._resolvedSelectors = this._loadOverrides(this.selectors || {});
    }
    return this._resolvedSelectors;
  }

  get url() { throw new Error('url not implemented'); }

  get label() { return this.name; }

  isTextareaInput(tagName, isContentEditable) {
    return tagName === 'textarea' && !isContentEditable;
  }

  async submitFallback(page) {
    await page.keyboard.press('Enter');
  }

  /**
   * True when the page shows a provider login wall.
   *
   * The generic rule (auth route or visible password field) works for
   * DeepSeek, which embeds its own form. Providers that delegate auth to an
   * OAuth popup (Google/Gemini) never render a password input on the chat
   * page, so they must override this — otherwise the chat is reported as
   * "input box not found" instead of "login required".
   */
  async isLoginRequired(page) {
    return page.evaluate(() => {
      const path = window.location.pathname.toLowerCase();
      const authRoute = /\/(?:auth|login|sign[_-]?in)(?:\/|$)/.test(path);
      const visiblePasswordInput = Array.from(
        document.querySelectorAll('input[type="password"]')
      ).some(element => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden';
      });
      return authRoute || visiblePasswordInput;
    });
  }

  /**
   * User-Agent to force on Chromium launches, or null to keep the real one.
   *
   * Spoofing a fixed Chrome build is counter-productive now: Google compares
   * the UA against the browser's Client Hints and refuses OAuth with
   * "This browser or app may not be secure". Only override when a site really
   * needs it.
   */
  get userAgentOverride() { return null; }

  get busyPattern() { return null; }

  async extractResponse(_page, _selectors) { return null; }

  cleanText(_text) { return null; }

  _overridesPath() {
    return path.join(config.GOLE_HOME, 'providers', this.name + '.json');
  }

  _loadOverrides(base) {
    const merged = { ...base };
    try {
      const file = this._overridesPath();
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const [k, v] of Object.entries(data)) {
          if (v == null) continue;
          merged[k] = Array.isArray(v) ? [...v, ...(base[k] || [])] : [v, ...(base[k] || [])];
        }
      }
    } catch (err) {
      console.warn('[gole] Could not load selectors for ' + this.name + ': ' + err.message);
    }
    return merged;
  }
}

module.exports = AIProviderAdapter;
