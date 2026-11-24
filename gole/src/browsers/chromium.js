// src/browsers/chromium.js — Playwright bundled Chromium (default)
'use strict';

const BrowserAdapter = require('./base');

class ChromiumAdapter extends BrowserAdapter {
  constructor() { super('chromium'); }
  get playwrightType() { return 'chromium'; }
}

module.exports = ChromiumAdapter;
