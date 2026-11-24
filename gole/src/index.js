#!/usr/bin/env node
// src/index.js — CLI entry point for DeepSeek Browser Agent
'use strict';

const path         = require('path');
const fs           = require('fs');
const config       = require('./config');
const logger       = require('./logger');
const DeepSeekAgent = require('./agent');

// ─────────────────────────────────────────────
//  Parse CLI arguments
// ─────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    task        : null,
    interactive : false,
    debug       : false,
    headless    : false,
    saveLog     : false,
    workingDir  : null,
    calibrate   : false,
    subagents   : false,
    browser     : null,
    ai          : null,
    help        : false,
    version     : false,
  };

  let i = 0;
  while (i < args.length) {
    const a = args[i];
    switch (a) {
      case '-i':
      case '--interactive': opts.interactive = true;    break;
      case '--debug':       opts.debug       = true;    break;
      case '--headless':    opts.headless    = true;    break;
      case '--save-log':    opts.saveLog     = true;    break;
      case '--calibrate':   opts.calibrate   = true;    break;
      case '-s':
      case '--subagents':    opts.subagents   = true;    break;
      case '-v':
      case '--version':     opts.version     = true;    break;
      case '-h':
      case '--help':        opts.help        = true;    break;

      case '-d':
      case '--dir':
        opts.workingDir = args[++i];
        break;

      case '-t':
      case '--task':
        opts.task = args[++i];
        break;

      case '--browser':
        opts.browser = args[++i];
        break;

      case '--ai':
        opts.ai = args[++i];
        break;

      default:
        // If it doesn't start with '-', treat it as an inline task
        if (!a.startsWith('-')) {
          opts.task = args.slice(i).join(' ');
          i = args.length; // consume the rest
        }
    }
    i++;
  }

  return opts;
}

// ─────────────────────────────────────────────
//  Help text
// ─────────────────────────────────────────────

function printHelp() {
  console.log(`
\x1b[1mGOLE\x1b[0m — Universal Browser AI Agent

\x1b[33mUSAGE\x1b[0m
  gole [OPTIONS] [TASK]      (aliases: dsa, deepseek-agent)

\x1b[33mOPTIONS\x1b[0m
  -t, --task <task>    Task to run (can also be the last argument without a flag)
  -i, --interactive    Interactive REPL mode — keep browser open, run multiple tasks
  -d, --dir <path>     Set working directory (default: current directory)
  --debug              Verbose debug output
  --headless           Run browser in headless mode (must be logged in already)
  --save-log           Save conversation log to ${config.GOLE_HOME}/logs/
  --calibrate          Open browser and print DOM info + current provider selectors
  --browser <name>     Browser backend: cami-browser|chromium|firefox|brave|librewolf|tor  (default: config)
  --ai <name>          AI provider: deepseek|gemini|hackerai|venice|mistral  (default: config)
  -s, --subagents      Let the AI spawn parallel subagents when it decides it needs to
  -v, --version        Print version
  -h, --help           Show this help

\x1b[33mEXAMPLES\x1b[0m
  # Run a single task
  dsa "Create a REST API in Express with CRUD for users"

  # Interactive mode (recommended)
  dsa --interactive

  # Run on a specific project directory
  dsa --dir ~/projects/myapp "Add TypeScript to this project"

  # Debug mode (shows raw responses)
  dsa --debug "Write a binary search in Python"

  # Headless (faster, requires prior login)
  dsa --headless "Refactor index.js to use async/await"

  # Another browser / AI provider
  gole --browser firefox --ai gemini --interactive
  gole --browser brave   --ai deepseek "build a CLI in Go"
  gole --browser cami-browser --interactive

\x1b[33mFIRST-TIME SETUP\x1b[0m
  1. npm install -g gole   (also downloads Chromium)
  2. gole -i   (opens browser, log in to your AI, then use normally)
     Session is saved per browser+AI — you only log in once per combination.
  External browsers (brave/librewolf/tor) and non-DeepSeek providers need to be
  installed/logged-into separately — see README.

\x1b[33mCONFIG FILE\x1b[0m
  Create \x1b[36mgole.config.json\x1b[0m in your working directory (or ${path.join(config.GOLE_HOME, 'config.json')}) to override settings:
  {
    "HEADLESS": true,
    "MAX_ITERATIONS": 50,
    "STABLE_DELAY": 3000,
    "mcpServers": {
      "adspower-local-api": {
        "command": "npx",
        "args": ["-y", "local-api-mcp-typescript"],
        "env": { "PORT": "50325", "API_KEY": "your_api_key" }
      }
    }
  }
`);
}

// ─────────────────────────────────────────────
//  Calibration helper — show the active provider's selectors and how to override
// ─────────────────────────────────────────────

function printProviderSelectors(provider) {
  const overridePath = path.join(config.GOLE_HOME, 'providers', provider.name + '.json');
  console.log('\n' + '═'.repeat(60));
  console.log('  ' + provider.label + ' — current selectors (override with ' + overridePath + ')');
  console.log('═'.repeat(60));
  for (const [key, val] of Object.entries(provider.resolvedSelectors)) {
    if (Array.isArray(val)) {
      console.log('\n  ' + key + ':');
      val.forEach(s => console.log('    - ' + s));
    }
  }
  console.log('═'.repeat(60));
  console.log('  To override, create ' + overridePath + ' with e.g.');
  console.log('    { "inputBox": ["#my-selector"], "sendButton": ["button.send"] }');
  console.log('  (user selectors are prepended, provider fallbacks stay as backup)\n');
}

// ─────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  // ── Help ───────────────────────────────────────────────────────────────────
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.version) {
    console.log(require('../package.json').version);
    process.exit(0);
  }

  // ── Apply options to config ────────────────────────────────────────────────
  if (opts.debug)      config.DEBUG    = true;
  if (opts.headless)   config.HEADLESS = true;
  if (opts.subagents) config.SUBAGENTS_ENABLED = true;
  if (opts.browser)    config.BROWSER  = opts.browser;
  if (opts.ai)         config.AI       = opts.ai;
  if (opts.workingDir) {
    const resolved = path.resolve(opts.workingDir);
    if (!fs.existsSync(resolved)) {
      logger.error(`Working directory not found: ${resolved}`);
      process.exit(1);
    }
    config.WORKING_DIR = resolved;
  }

  // ── Banner ─────────────────────────────────────────────────────────────────
  logger.banner();
  logger.info(`Working directory : \x1b[36m${config.WORKING_DIR}\x1b[0m`);
  logger.info(`Browser           : \x1b[36m${config.BROWSER}\x1b[0m`);
  logger.info(`AI provider       : \x1b[36m${config.AI}\x1b[0m`);
  logger.info(`Session directory : \x1b[36m${config.SESSION_DIR}\x1b[0m`);
  logger.info(`Headless mode     : \x1b[36m${config.HEADLESS}\x1b[0m`);
  logger.info(`Debug mode        : \x1b[36m${config.DEBUG}\x1b[0m`);
  logger.info(`Subagents mode    : \x1b[36m${config.SUBAGENTS_ENABLED}\x1b[0m`);
  console.log('');

  // ── Create agent ───────────────────────────────────────────────────────────
  const agent = new DeepSeekAgent({ saveLog: opts.saveLog });

  // ── Graceful shutdown handler ──────────────────────────────────────────────
  const shutdown = async (code = 0) => {
    logger.info('\nShutting down...');
    try { await agent.shutdown(); } catch {}
    process.exit(code);
  };

  process.on('SIGINT',  () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', async err => {
    logger.error(`Uncaught error: ${err.message}`);
    if (config.DEBUG) console.error(err.stack);
    await shutdown(1);
  });
  process.on('unhandledRejection', async reason => {
    logger.error(`Unhandled rejection: ${reason}`);
    if (config.DEBUG) console.error(reason);
    await shutdown(1);
  });

  // ── Calibrate mode ─────────────────────────────────────────────────────────
  if (opts.calibrate) {
    logger.header('Calibration Mode — Reading DOM selectors');
    await agent.init({ mcp: false });
    await agent.browser.dumpDebugInfo();
    await agent.browser.screenshot();
    printProviderSelectors(agent.browser.provider);
    await shutdown(0);
  }

  // ── Validate we have a task or interactive mode ────────────────────────────
  if (!opts.interactive && !opts.task) {
    logger.warn('No task provided. Switching to interactive mode...\n');
    opts.interactive = true;
  }

  // ── Launch browser ─────────────────────────────────────────────────────────
  try {
    await agent.init();
  } catch (err) {
    logger.error(`Failed to launch browser: ${err.message}`);
    if (config.DEBUG) console.error(err.stack);
    process.exit(1);
  }

  // ── Run ────────────────────────────────────────────────────────────────────
  try {
    if (opts.interactive) {
      await agent.runInteractive();
    } else {
      await agent.run(opts.task);
    }
  } catch (err) {
    logger.error(`Agent error: ${err.message}`);
    if (config.DEBUG) console.error(err.stack);
    await shutdown(1);
  }

  await shutdown(0);
}

main();
