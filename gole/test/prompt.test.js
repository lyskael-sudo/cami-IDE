'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ConversationManager } = require('../src/prompt');

test('system prompt requires concise French and English code comments', () => {
  const prompt = new ConversationManager().buildFirstMessage('Inspect this project', '', '');

  assert.match(prompt, /adding or changing code comments or docstrings, write each in both French/);
  assert.match(prompt, /and English, together as concise paired lines/);
  assert.match(prompt, /do not add comments where none are needed/);
  assert.match(prompt, /Do not translate or rewrite unrelated existing comments/);
});
