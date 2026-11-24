// src/browsers/brave.js — Brave Browser (Chromium-based, system install)
'use strict';

const BrowserAdapter = require('./base');
const { detectExecutable } = require('./util');

const CANDIDATES = {
  linux: [
    '/usr/bin/brave-browser',
    '/usr/bin/brave',
    '/opt/brave.com/brave/brave',
  ],
  darwin: [
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  win32: [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ],
};

class BraveAdapter extends BrowserAdapter {
  constructor() {
    super('brave');
    this._path = detectExecutable(CANDIDATES);
  }
  get playwrightType() { return 'chromium'; }
  getExecutablePath() { return this._path; }
  ensureAvailable() {
    if (!this._path) {
      throw new Error(
        'Brave Browser not found.\n' +
        '  Expected one of: ' + [].concat(...Object.values(CANDIDATES)).join(', ') + '\n' +
        '  Install Brave from https://brave.com/download/ and retry.'
      );
    }
  }
}

module.exports = BraveAdapter;
