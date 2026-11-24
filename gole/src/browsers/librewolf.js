// src/browsers/librewolf.js — LibreWolf (Firefox fork, system install)
'use strict';

const BrowserAdapter = require('./base');
const { detectExecutable } = require('./util');

const CANDIDATES = {
  linux: [
    '/usr/bin/librewolf',
    '/usr/lib/librewolf/librewolf',
    '/opt/librewolf/librewolf',
  ],
  darwin: [
    '/Applications/LibreWolf.app/Contents/MacOS/librewolf',
  ],
  win32: [
    'C:\\Program Files\\LibreWolf\\librewolf.exe',
    'C:\\Program Files (x86)\\LibreWolf\\librewolf.exe',
  ],
};

class LibreWolfAdapter extends BrowserAdapter {
  constructor() {
    super('librewolf');
    this._path = detectExecutable(CANDIDATES);
  }
  get playwrightType() { return 'firefox'; }
  getExecutablePath() { return this._path; }
  ensureAvailable() {
    if (!this._path) {
      throw new Error(
        'LibreWolf not found.\n' +
        '  Expected one of: ' + [].concat(...Object.values(CANDIDATES)).join(', ') + '\n' +
        '  Install LibreWolf from https://librewolf.net/installation/ and retry.'
      );
    }
  }
}

module.exports = LibreWolfAdapter;
