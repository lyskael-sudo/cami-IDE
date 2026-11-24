'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const DeepSeekAgent = require('./agent');

let agent = null;
let initializing = false;
let running = false;
let activeRequestId = null;
const pendingPrompts = [];

function send(event, callback) {
  if (process.connected) process.send(event, callback);
}

function fail(error, requestId = null, callback) {
  send({
    type: 'error',
    requestId,
    message: error instanceof Error ? error.message : String(error)
  }, callback);
}

async function runPrompt(request) {
  if (!agent || running) return;
  running = true;
  activeRequestId = request.id;
  try {
    await agent.run(request.text);
  } catch (error) {
    fail(error, request.id);
  } finally {
    activeRequestId = null;
    running = false;
    send({ type: 'state', state: 'ready' });
    const next = pendingPrompts.shift();
    if (next) void runPrompt(next);
  }
}

async function start(workspacePath) {
  if (initializing || agent) return;
  initializing = true;
  try {
    const root = fs.realpathSync(workspacePath);
    if (!fs.statSync(root).isDirectory()) {
      throw new Error('Le dossier de travail de Gole est invalide.');
    }

    process.chdir(root);
    config.WORKING_DIR = root;
    config.BROWSER = process.env.CAMI_GOLE_BROWSER || 'cami-browser';
    config.AI = process.env.CAMI_GOLE_AI || 'deepseek';
    agent = new DeepSeekAgent({
      onEvent: (event) => send({ ...event, requestId: activeRequestId }),
      onLoginRequired: () => send({
        type: 'login-required',
        message: `La session ${agent?.browser?.provider?.label || config.AI} a expiré. Reconnectez-vous dans la fenêtre du navigateur ; Gole reprendra ensuite sa tâche.`
      }),
      onLoginRestored: () => send({
        type: 'login-restored'
      })
    });
    send({ type: 'state', state: 'starting' });
    await agent.init();
    send({ type: 'state', state: 'ready' });

    const next = pendingPrompts.shift();
    if (next) void runPrompt(next);
  } catch (error) {
    await shutdown();
    fail(error, null, () => process.exit(1));
  } finally {
    initializing = false;
  }
}

async function shutdown() {
  const current = agent;
  agent = null;
  if (!current) return;
  current.stop();
  try {
    await current.shutdown();
  } catch (error) {
    fail(error, activeRequestId);
  }
}

process.on('message', (message) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'start' && typeof message.workspacePath === 'string') {
    void start(message.workspacePath);
    return;
  }

  if (message.type === 'prompt' && typeof message.text === 'string') {
    if (!agent) {
      pendingPrompts.push(message);
      return;
    }
    if (running) {
      pendingPrompts.push(message);
      return;
    }
    void runPrompt(message);
    return;
  }

  if (message.type === 'stop') {
    agent?.stop();
    if (initializing && agent?.browser) agent.browser.abort = true;
    return;
  }

  if (message.type === 'shutdown') {
    void shutdown().finally(() => process.exit(0));
  }
});

process.on('disconnect', () => {
  void shutdown().finally(() => process.exit(0));
});
