// src/providers/gemini.js — gemini.google.com
//
// Gemini's UI is a Quill-style rich text editor (contenteditable) and model
// replies live in <model-response>. Google changes class names often, so the
// selector bank leans on stable structural attributes; run `gole --calibrate`
// (or drop overrides into ~/.gole/providers/gemini.json) if it stops matching.
'use strict';

const AIProviderAdapter = require('./base');

const SELECTORS = {
  inputBox: [
    'rich-textarea [contenteditable="true"]',
    'div.ql-editor[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    'textarea[aria-label]',
    '[contenteditable="true"]',
  ],

  sendButton: [
    'button.send-button',
    'button[aria-label="Send message"]',
    'button[aria-label*="Send" i]',
    'button[aria-label*="Envoyer" i]',
    '[data-test-id="send-button"]',
    'button[type="submit"]',
  ],

  stopButton: [
    'button[aria-label*="Stop" i]',
    'button[aria-label*="stop response" i]',
    'button[aria-label*="Arrêter" i]',
  ],

  newChat: [
    'a[href="/app"]',
    'button[aria-label*="New chat" i]',
    'side-navigation-button[aria-label*="New chat" i]',
    '[data-test-id="new-chat-button"]',
  ],

  assistantMessage: [
    'model-response',
    'message-content.model-response-text',
    '[class*="model-response"]',
    '[class*="response-container"]',
  ],

  assistantContent: [
    '.message-text',
    'model-response .message-text',
    'model-response message-content',
    'model-response .markdown',
    'message-content.model-response-text',
    '[class*="model-response"] [class*="markdown"]',
    '[class*="response-content"]',
  ],

  // Only the stop button is a reliable "still streaming" signal on Gemini:
  // the generic [class*="loading"] / [class*="spinner"] selectors match the
  // permanent page chrome and made every reply look unfinished.
  generating: [
    'button[aria-label*="Stop response" i]',
    'button[aria-label*="Stop" i]',
    'button[aria-label*="Arrêter" i]',
  ],
};

class GeminiProvider extends AIProviderAdapter {
  constructor() {
    super('gemini');
    this.selectors = SELECTORS;
  }

  get url()   { return 'https://gemini.google.com/app'; }
  get label() { return 'Gemini'; }

  /**
   * Gemini is signed out without ever showing a password field: the chat page
   * renders normally with a "Sign in" link that opens a Google OAuth popup.
   * The generic (auth route | password input) rule therefore missed it and the
   * failure surfaced as "cannot find the chat input box" instead of a login
   * prompt. Detect the actual sign-in affordance instead.
   */
  async isLoginRequired(page) {
    return page.evaluate(() => {
      const path = window.location.pathname.toLowerCase();
      if (/\/(?:auth|login|sign[_-]?in)(?:\/|$)/.test(path)) return true;
      if (location.hostname === 'accounts.google.com') return true;

      const visible = el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden';
      };

      const signInLink = Array.from(
        document.querySelectorAll('a[href*="accounts.google.com"], a[href*="ServiceLogin"]')
      ).some(visible);
      if (signInLink) return true;

      const signInButton = Array.from(document.querySelectorAll('a, button'))
        .some(el => visible(el) && /^(?:sign\s*in|se\s*connecter)$/i.test((el.innerText || '').trim()));
      if (signInButton) return true;

      // Signed out, the composer is present but explicitly disabled/read-only.
      const composer = document.querySelector('rich-textarea [contenteditable="true"]');
      if (composer && composer.getAttribute('contenteditable') === 'false') return true;

      return false;
    });
  }
}

module.exports = GeminiProvider;
module.exports.SELECTORS = SELECTORS;
