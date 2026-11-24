// src/providers/mistral.js — chat.mistral.ai (Le Chat)
//
// TODO: vérifier les sélecteurs. L'URL est stable (chat.mistral.ai/chat) mais
// les classes DOM de Le Chat ne sont pas validées ici : provider = STUB
// explicite jusqu'à calibration. Pour activer, fournir les sélecteurs dans
// ~/.gole/providers/mistral.json (clés de base.js).
'use strict';

const AIProviderAdapter = require('./base');

const MISTRAL_URL = 'https://chat.mistral.ai/chat';

class MistralProvider extends AIProviderAdapter {
  constructor() {
    super('mistral');
    this.selectors = {};
  }

  get url()   { return MISTRAL_URL; }
  get label() { return 'Mistral'; }

  ensureImplemented() {
    throw new Error(
      'Provider Mistral non encore implémenté — fournir les sélecteurs dans ' +
      '~/.gole/providers/mistral.json (mêmes clés que src/providers/base.js).'
    );
  }
}

module.exports = MistralProvider;
module.exports.MISTRAL_URL = MISTRAL_URL;
