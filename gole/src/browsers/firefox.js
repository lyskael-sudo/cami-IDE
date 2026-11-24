// src/browsers/firefox.js — Playwright bundled Firefox
'use strict';

const BrowserAdapter = require('./base');

class FirefoxAdapter extends BrowserAdapter {
  constructor() { super('firefox'); }
  get playwrightType() { return 'firefox'; }
}

module.exports = FirefoxAdapter;
