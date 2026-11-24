// src/providers/venice.js — venice.ai
//
// TODO: vérifier URL et sélecteurs. Venice.ai demande une clé API pour son API
// publique ; son interface web évolue et ses sélecteurs ne sont pas validés ici.
// Provider = STUB explicite tant que les sélecteurs ne sont pas fournis.
//
// Activation : renseigner ~/.gole/providers/venice.json (clés de base.js).
'use strict';

const AIProviderAdapter = require('./base');

// TODO: vérifier URL et sélecteurs
const VENICE_URL = 'https://venice.ai/chat';

class VeniceProvider extends AIProviderAdapter {
  constructor() {
    super('venice');
    this.selectors = {};
  }

  get url()   { return VENICE_URL; }
  get label() { return 'Venice'; }

  ensureImplemented() {
    throw new Error(
      'Provider Venice non encore implémenté — fournir les sélecteurs dans ' +
      '~/.gole/providers/venice.json (et valider VENICE_URL dans src/providers/venice.js).'
    );
  }
}

module.exports = VeniceProvider;
module.exports.VENICE_URL = VENICE_URL;
