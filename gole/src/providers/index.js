// src/providers/index.js — AI provider adapter factory
'use strict';

const DeepSeekProvider = require('./deepseek');
const GeminiProvider   = require('./gemini');
const HackerAIProvider = require('./hackerai');
const VeniceProvider   = require('./venice');
const MistralProvider  = require('./mistral');

// Aliases (case-insensitive) → provider class
const REGISTRY = {
  deepseek : DeepSeekProvider,
  gemini   : GeminiProvider,
  hackerai : HackerAIProvider,
  venice   : VeniceProvider,
  mistral  : MistralProvider,
};

const VALID = Object.keys(REGISTRY);

/**
 * Resolve an AI provider name to an AIProviderAdapter instance.
 * @param {string} name  case-insensitive, defaults to 'deepseek'
 * @returns {AIProviderAdapter}
 */
function getAIProvider(name) {
  if (!name) name = 'deepseek';
  const key = String(name).toLowerCase().trim();
  const Cls = REGISTRY[key];
  if (!Cls) {
    throw new Error(
      'Unknown AI provider: "' + name + '". Valid values: ' + VALID.join(', ')
    );
  }
  return new Cls();
}

module.exports = { getAIProvider, VALID_PROVIDERS: VALID };
