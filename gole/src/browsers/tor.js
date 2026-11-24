// src/browsers/tor.js — Tor Browser (Firefox-based) via SOCKS5 127.0.0.1:9050
'use strict';

const os = require('os');
const path = require('path');
const BrowserAdapter = require('./base');
const { detectExecutable } = require('./util');

const CANDIDATES = {
  linux: [
    path.join(os.homedir(), 'tor-browser', 'Browser', 'firefox'),
    path.join(os.homedir(), 'tor-browser_en-US', 'Browser', 'firefox'),
    '/usr/bin/torbrowser',
  ],
  darwin: [
    '/Applications/Tor Browser.app/Contents/MacOS/firefox',
    path.join(os.homedir(), 'Applications', 'Tor Browser.app', 'Contents', 'MacOS', 'firefox'),
  ],
  win32: [
    'C:\\Program Files\\Tor Browser\\Browser\\firefox.exe',
  ],
};

// Tor is NEVER launched without its SOCKS proxy.
const TOR_PROXY = { server: 'socks5://127.0.0.1:9050' };

class TorAdapter extends BrowserAdapter {
  constructor() {
    super('tor');
    this._path = detectExecutable(CANDIDATES);
  }
  get playwrightType() { return 'firefox'; }
  getExecutablePath() { return this._path; }
  getProxyConfig() { return TOR_PROXY; }
  ensureAvailable() {
    if (!this._path) {
      throw new Error(
        'Tor Browser not found.\n' +
        '  Expected one of: ' + [].concat(...Object.values(CANDIDATES)).join(', ') + '\n' +
        '  Install Tor Browser from https://www.torproject.org/download/ and make sure the\n' +
        '  Tor daemon listens on socks5://127.0.0.1:9050 (torbrowser-launcher does this for you).'
      );
    }
  }
}

module.exports = TorAdapter;
module.exports.TOR_PROXY = TOR_PROXY;
