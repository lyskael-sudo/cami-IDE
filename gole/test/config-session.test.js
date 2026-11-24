'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadSessionDirectory(home, goleHome) {
  const result = spawnSync(
    process.execPath,
    ['-e', "process.stdout.write(require('./src/config').SESSION_DIR)"],
    {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        CAMI_GOLE_HOME: goleHome,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('legacy Gole profiles are moved under the Cami data directory', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cami-gole-profile-'));
  const home = path.join(temporaryDirectory, 'home');
  const goleHome = path.join(temporaryDirectory, 'cami', 'gole');
  const legacySession = path.join(home, '.gole', 'session');
  fs.mkdirSync(goleHome, { recursive: true });
  fs.writeFileSync(
    path.join(goleHome, 'config.json'),
    JSON.stringify({ SESSION_DIR: legacySession }),
  );

  try {
    assert.equal(loadSessionDirectory(home, goleHome), path.join(goleHome, 'session'));
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('custom Gole profile directories are preserved', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cami-gole-profile-'));
  const home = path.join(temporaryDirectory, 'home');
  const goleHome = path.join(temporaryDirectory, 'cami', 'gole');
  const customSession = path.join(temporaryDirectory, 'custom-session');
  fs.mkdirSync(goleHome, { recursive: true });
  fs.writeFileSync(
    path.join(goleHome, 'config.json'),
    JSON.stringify({ SESSION_DIR: customSession }),
  );

  try {
    assert.equal(loadSessionDirectory(home, goleHome), customSession);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
