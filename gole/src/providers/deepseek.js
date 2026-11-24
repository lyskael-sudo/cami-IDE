// src/providers/deepseek.js — chat.deepseek.com (behaviour identical to pre-refactor)
'use strict';

const AIProviderAdapter = require('./base');

// Banner DeepSeek shows when its backend is overloaded
const BUSY_RE = /server is (temporarily )?(busy|unavailable)|temporarily unavailable/i;

/**
 * Selector bank — EXACTLY the selectors gole used before the provider split.
 * Ordered by likelihood, with fallbacks; DeepSeek's UI can change.
 */
const SELECTORS = {
  inputBox: [
    '#chat-input',
    'textarea[placeholder]',
    'textarea',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]',
  ],

  sendButton: [
    'button[aria-label*="Send" i]',
    '[data-testid="send-button"]',
    'button[type="submit"]',
    '[class*="send-btn"]',
    '[class*="sendBtn"]',
    '[class*="send-button"]',
  ],

  stopButton: [
    'button[aria-label*="Stop" i]',
    '[aria-label*="stop generating" i]',
    '[data-testid="stop-button"]',
    '[class*="stop-btn"]',
    '[class*="stopBtn"]',
  ],

  newChat: [
    'button[aria-label*="New chat" i]',
    'button[aria-label*="New conversation" i]',
    'a[href="/"][aria-label]',
    '[data-testid="new-chat"]',
    '[class*="new-chat"]',
    '[class*="newChat"]',
  ],

  assistantMessage: [
    '[class*="assistant"][class*="message"]',
    '[data-role="assistant"]',
    '[class*="markdown-content"]',
    '.ds-markdown',
    '[class*="chat-message"]',
    '[class*="message-bubble"]',
  ],

  assistantContent: [
    '.ds-markdown',
    '[class*="assistant"] [class*="markdown"]',
    '[class*="assistant"] [class*="content"]',
    '[data-role="assistant"] [class*="content"]',
    '[class*="ai-message"] [class*="content"]',
    '[class*="bot-message"] [class*="content"]',
    '[class*="response-content"]',
    '[class*="message-content"]:last-child',
  ],

  // Anything visible from this list means DeepSeek is still generating
  generating: [
    'button[aria-label*="Stop" i]',
    '[class*="stop-gen"]',
    '[class*="stopGen"]',
    '[class*="generating"]',
    '[class*="typing"]',
    '[class*="loading"]',
    '[class*="spinner"]',
    '[class*="blink"]',
    '[class*="cursor"]',
    '[class*="pulsing"]',
  ],
};

class DeepSeekProvider extends AIProviderAdapter {
  constructor() {
    super('deepseek');
    this.selectors = SELECTORS;
  }

  get url()   { return 'https://chat.deepseek.com'; }
  get label() { return 'DeepSeek'; }
  get busyPattern() { return BUSY_RE; }
}

module.exports = DeepSeekProvider;
module.exports.SELECTORS = SELECTORS;
module.exports.BUSY_RE  = BUSY_RE;
