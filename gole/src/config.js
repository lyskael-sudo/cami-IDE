// src/config.js — Central configuration for Gole
'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

// ─────────────────────────────────────────────
//  Base home directory for all Gole data
// ─────────────────────────────────────────────
const GOLE_HOME = process.env.CAMI_GOLE_HOME
  ? path.resolve(process.env.CAMI_GOLE_HOME)
  : path.join(os.homedir(), '.gole');

// ─────────────────────────────────────────────
//  Default configuration
// ─────────────────────────────────────────────
const defaults = {
  // Selection (overridable via CLI --browser / --ai and ~/.gole/config.json)
  BROWSER        : 'chromium',          // chromium | firefox | brave | librewolf | tor | webkit
  AI             : 'deepseek',          // deepseek | gemini | hackerai | venice | mistral

  // Browser
  GOLE_URL       : 'https://chat.deepseek.com', // default URL (provider overrides this)
  SESSION_DIR    : path.join(GOLE_HOME, 'session'), // per-browser/ai subdirs added at runtime
  HEADLESS       : false,

  // Timing
  RESPONSE_TIMEOUT : 180_000,
  STABLE_DELAY     : 2_500,
  SEND_DELAY       : 400,
  BUSY_MAX_RETRIES : 20,
  BUSY_RETRY_DELAY : 3_000,

  // Agent
  MAX_ITERATIONS   : 300,
  CONTEXT_LIMIT    : 128_000, // tokens (estimate)
  CONTEXT_ROLLOVER : 0.9,     // summarize + move to a new chat at this fraction
  WORKING_DIR      : process.cwd(),

  // Agent browser tab (browser_* tools)
  WEB_TIMEOUT      : 30_000,

  // Subagents — parallel tabs under the SAME account (no multi-account pooling)
  SUBAGENTS_ENABLED : false,
  MAX_SUBAGENTS     : 4,
  SUBAGENT_RATE     : { perSec: 2, perMin: 120 },

  // MCP servers — same format as Claude Desktop / Cursor: { "name": { command, args, env, cwd } }
  mcpServers        : {},
  MCP_START_TIMEOUT : 60_000,
  MCP_CALL_TIMEOUT  : 120_000,

  // Output
  MAX_OUTPUT_LENGTH : 8_000,
  DEBUG             : false,
};

// ─────────────────────────────────────────────
//  Config loading priority (highest wins):
//
//  1. ./gole.config.json        — per-project config
//  2. ~/.gole/config.json       — global user config
//  3. built-in defaults
// ─────────────────────────────────────────────

function loadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
    console.warn('[gole] Could not parse config file: ' + filePath);
  }
  return {};
}

const globalConfigPath  = path.join(GOLE_HOME, 'config.json');
const projectConfigPath = path.join(process.cwd(), 'gole.config.json');

// Create the global config with sensible defaults on first run.
if (!fs.existsSync(globalConfigPath)) {
  try {
    fs.mkdirSync(GOLE_HOME, { recursive: true });
    fs.writeFileSync(
      globalConfigPath,
      JSON.stringify({ browser: 'chromium', ai: 'deepseek' }, null, 2) + '\n',
      'utf8'
    );
  } catch (err) {
    console.warn('[gole] Could not create default config: ' + err.message);
  }
}

const globalConfig  = loadJson(globalConfigPath);
const projectConfig = loadJson(projectConfigPath);

// Accept both UPPER_CASE keys (internal) and lower-case keys (user config file).
const normalize = obj => {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (k === 'browser')     { out.BROWSER = v; continue; }
    if (k === 'ai')          { out.AI = v; continue; }
    out[k] = v;
  }
  return out;
};

const g = normalize(globalConfig);
const p = normalize(projectConfig);

const config = {
  ...defaults,
  ...g,   // global overrides defaults
  ...p,   // project overrides global
  // MCP servers merge per server name instead of the project list replacing the global one
  mcpServers: { ...globalConfig.mcpServers, ...projectConfig.mcpServers },
};

// Remove comment keys from JSON files
delete config._comment;

// Resolve session dir to absolute path
if (!path.isAbsolute(config.SESSION_DIR)) {
  config.SESSION_DIR = path.resolve(process.cwd(), config.SESSION_DIR);
}

// Keep profiles from the old ~/.gole installation usable after the Cami migration.
const legacyGoleHome = path.join(os.homedir(), '.gole');
const legacySessionPath = path.resolve(config.SESSION_DIR);
const legacyRelativePath = path.relative(legacyGoleHome, legacySessionPath);
if (
  legacyRelativePath === '' ||
  (!legacyRelativePath.startsWith('..' + path.sep) &&
    legacyRelativePath !== '..' &&
    !path.isAbsolute(legacyRelativePath))
) {
  config.SESSION_DIR = path.join(GOLE_HOME, legacyRelativePath);
}

// Ensure required directories exist
fs.mkdirSync(config.SESSION_DIR, { recursive: true });
fs.mkdirSync(path.join(GOLE_HOME, 'logs'), { recursive: true });

module.exports = config;
module.exports.GOLE_HOME = GOLE_HOME;
