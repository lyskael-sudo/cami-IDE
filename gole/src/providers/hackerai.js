// src/providers/hackerai.js — HackerAI
//
// TODO: vérifier l'URL exacte et les sélecteurs. Le site « hacker.ai » n'a pas
// d'interface de chat publique stable et documentée au moment du refactor.
// Tant que ce n'est pas validé, le provider est un STUB : il lève une erreur
// explicite plutôt que de faire semblant de fonctionner.
//
// Pour l'activer : fournir les sélecteurs dans ~/.gole/providers/hackerai.json
// (mêmes clés que src/providers/base.js) et remplacer HACKERAI_URL / le corps
// de `ensureImplemented()` si nécessaire.
'use strict';

const AIProviderAdapter = require('./base');

// TODO: vérifier URL et sélecteurs
const HACKERAI_URL = 'https://hacker.ai';

class HackerAIProvider extends AIProviderAdapter {
  constructor() {
    super('hackerai');
    this.selectors = {};
  }

  get url()   { return HACKERAI_URL; }
  get label() { return 'HackerAI'; }

  ensureImplemented() {
    throw new Error(
      'Provider HackerAI non encore implémenté — fournir les sélecteurs dans ' +
      '~/.gole/providers/hackerai.json (et valider HACKERAI_URL dans src/providers/hackerai.js).'
    );
  }
}

module.exports = HackerAIProvider;
module.exports.HACKERAI_URL = HACKERAI_URL;
