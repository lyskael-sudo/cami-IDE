// src/browsers/util.js — helpers shared by browser adapters
'use strict';

const fs   = require('fs');
const os   = require('os');

/** True if a path exists and is a file. */
function exists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/**
 * Return the first existing candidate for the current OS, or null.
 * @param {object} map  { linux: [...], darwin: [...], win32: [...] }
 */
function detectExecutable(map) {
  const platform = os.platform();
  const candidates = map[platform] || [];
  for (const p of candidates) {
    if (exists(p)) return p;
  }
  return null;
}

module.exports = { exists, detectExecutable };
