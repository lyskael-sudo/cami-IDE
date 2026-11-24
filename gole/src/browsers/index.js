// src/browsers/index.js — Browser adapter factory
'use strict';

const ChromiumAdapter  = require('./chromium');
const FirefoxAdapter   = require('./firefox');
const BraveAdapter     = require('./brave');
const LibreWolfAdapter = require('./librewolf');
const TorAdapter       = require('./tor');
const WebKitAdapter    = require('./webkit');

// Aliases (case-insensitive) → adapter class
const REGISTRY = {
  chromium  : ChromiumAdapter,
  chrome    : ChromiumAdapter,
  firefox   : FirefoxAdapter,
  brave     : BraveAdapter,
  librewolf : LibreWolfAdapter,
  tor       : TorAdapter,
  webkit    : WebKitAdapter,
  'cami-browser': WebKitAdapter,
};

const VALID = ['chromium', 'chrome', 'firefox', 'brave', 'librewolf', 'tor', 'webkit', 'cami-browser'];

/**
 * Resolve a browser name to a BrowserAdapter instance.
 * @param {string} name  case-insensitive
 * @returns {BrowserAdapter}
 */
function getBrowserAdapter(name) {
  if (!name) name = 'chromium';
  const key = String(name).toLowerCase().trim();
  const Cls = REGISTRY[key];
  if (!Cls) {
    throw new Error(
      'Unknown browser: "' + name + '". Valid values: ' + VALID.join(', ')
    );
  }
  return new Cls();
}

module.exports = { getBrowserAdapter, VALID_BROWSERS: VALID };
