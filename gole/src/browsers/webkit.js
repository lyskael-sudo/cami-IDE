// src/browsers/webkit.js — Native Cami WebKitGTK browser adapter.
'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const BrowserAdapter = require('./base');

function findBinary() {
  const configured = process.env.GOLE_WEBKIT_BINARY;
  const candidates = [
    configured,
    path.resolve(__dirname, '../../../cami/native/webkit-browser/build/cami-webkit-browser'),
    path.resolve(__dirname, '../../../cami/native/webkit-browser/out/cami-webkit-browser'),
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

class WebKitAdapter extends BrowserAdapter {
  constructor() {
    super('webkit');
    this.binary = findBinary();
  }

  get playwrightType() {
    return 'webkit';
  }

  ensureAvailable() {
    if (process.platform !== 'linux') {
      throw new Error('The native Cami WebKitGTK browser is currently supported on Linux only.');
    }
    if (!this.binary || !fs.existsSync(this.binary)) {
      throw new Error(
        'Cami WebKit browser was not found. Build cami/native/webkit-browser or set GOLE_WEBKIT_BINARY.'
      );
    }
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      throw new Error('The native WebKit browser needs an active graphical session (DISPLAY or WAYLAND_DISPLAY).');
    }
  }

  async launch(sessionDir, opts = {}) {
    this.ensureAvailable();
    if (opts.headless) {
      throw new Error('The native WebKitGTK browser requires a visible desktop session.');
    }
    const child = spawn(this.binary, [sessionDir], { stdio: ['pipe', 'pipe', 'pipe'] });
    const context = new WebKitContext(child);
    const timer = setTimeout(() => {
      context._fail(new Error('Timed out waiting for the Cami WebKit browser to start.'));
      child.kill();
    }, 15_000);
    timer.unref();
    try {
      await context.ready;
    } finally {
      clearTimeout(timer);
    }
    return context;
  }
}

class WebKitContext {
  constructor(child) {
    this.child = child;
    this.pagesList = [];
    this.pending = new Map();
    this.nextRequestId = 1;
    this.closed = false;
    this.events = new EventEmitter();
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.stdout = readline.createInterface({ input: child.stdout });
    this.stdout.on('line', line => this._onLine(line));
    child.stderr.on('data', data => process.stderr.write(`[cami-webkit] ${data}`));
    child.once('error', error => this._fail(error));
    child.once('exit', (code, signal) => {
      this.closed = true;
      if (this.pagesList.length === 0 || this.pending.size > 0) {
        this._fail(new Error(`Cami WebKit browser exited before replying (${signal || code}).`));
      }
      for (const page of this.pagesList) page._markClosed();
    });
  }

  _onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this._fail(new Error(`Invalid message from Cami WebKit browser: ${error.message}`));
      return;
    }

    if (message.event === 'ready') {
      const page = new WebKitPage(this, 0);
      page._setUrl(message.url || 'about:blank');
      this.pagesList.push(page);
      this.resolveReady();
      this.resolveReady = null;
      this.rejectReady = null;
      return;
    }
    if (message.event === 'navigation') {
      const page = this.pagesList.find(item => item.id === message.pageId);
      if (page) page._onNavigation(message.url);
      return;
    }
    if (message.event === 'navigationError') {
      const page = this.pagesList.find(item => item.id === message.pageId);
      if (page) page._onNavigationError(new Error(message.error || 'Navigation failed.'));
      return;
    }
    if (message.event === 'pageClosed') {
      const page = this.pagesList.find(item => item.id === message.pageId);
      if (page) page._markClosed();
      return;
    }
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    this.pending.delete(String(message.id));
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result);
  }

  _fail(error) {
    this.rejectReady?.(error);
    this.rejectReady = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(method, params = {}) {
    if (this.closed || this.child.exitCode !== null) {
      return Promise.reject(new Error('Cami WebKit browser is not running.'));
    }
    const id = String(this.nextRequestId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for WebKit command "${method}".`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (!error) return;
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  pages() {
    return this.pagesList.filter(page => !page.isClosed());
  }

  async newPage() {
    const id = await this.request('newPage');
    const page = new WebKitPage(this, id);
    this.pagesList.push(page);
    return page;
  }

  async close() {
    if (this.closed || this.child.exitCode !== null) return;
    try {
      await this.request('closeAll');
    } finally {
      this.closed = true;
      this.child.stdin.end();
    }
  }
}

class WebKitPage {
  constructor(context, id) {
    this.context = context;
    this.id = id;
    this._url = 'about:blank';
    this._closed = false;
    this._events = new EventEmitter();
    this._timeout = 30_000;
    this.keyboard = new WebKitKeyboard(this);
  }

  _setUrl(url) { this._url = url; }

  _onNavigation(url) { this._setUrl(url); }
  _onNavigationError(error) { this._events.emit('navigationError', error); }

  _markClosed() {
    if (this._closed) return;
    this._closed = true;
    this._events.emit('close');
  }

  async _evaluate(script) {
    const wrapped = `(() => {
      const findElements = (${findElements.toString()});
      return ${script};
    })()`;
    return this.context.request('evaluate', { pageId: this.id, script: wrapped });
  }

  async goto(url) {
    await this.context.request('navigate', { pageId: this.id, url: String(url) });
    this._setUrl(String(url));
    return null;
  }

  url() { return this._url; }
  isClosed() { return this._closed || this.context.closed; }
  setDefaultTimeout(timeout) { this._timeout = timeout; }
  addInitScript() { return Promise.resolve(); }
  bringToFront() { return this.context.request('focus', { pageId: this.id }); }

  async evaluate(fn, arg) {
    if (typeof fn === 'string') return this._evaluate(fn);
    const firstArg = arg === undefined ? 'undefined' : JSON.stringify(arg);
    return this._evaluate(buildInvocation(fn, firstArg));
  }

  locator(selector) { return new WebKitLocator(this, { selector: String(selector) }); }

  getByText(text) {
    return new WebKitLocator(this, { text: String(text) });
  }

  getByRole(role, options = {}) {
    return new WebKitLocator(this, {
      role: String(role),
      name: options.name instanceof RegExp
        ? { source: options.name.source, flags: options.name.flags }
        : options.name == null ? null : { source: String(options.name), flags: 'i' },
    });
  }

  async $(selector) {
    const locator = this.locator(selector).first();
    return await locator.count() ? new WebKitElement(this, locator.query, 0) : null;
  }

  async waitForSelector(selector, options = {}) {
    const locator = this.locator(selector).first();
    await locator.waitFor(options);
    return new WebKitElement(this, locator.query, 0);
  }

  async waitForTimeout(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async waitForLoadState(state = 'load', options = {}) {
    const deadline = Date.now() + (options.timeout || this._timeout);
    do {
      const readyState = await this.evaluate(() => document.readyState);
      if ((state === 'domcontentloaded' && readyState !== 'loading') ||
          (state === 'load' && readyState === 'complete')) return;
      if (state === 'networkidle') {
        await this.waitForTimeout(300);
        return;
      }
      await this.waitForTimeout(100);
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for page load state "${state}".`);
  }

  async goBack() { return this.context.request('back', { pageId: this.id }); }
  async goForward() { return this.context.request('forward', { pageId: this.id }); }

  async screenshot({ path: filePath }) {
    return this.context.request('screenshot', { pageId: this.id, path: filePath });
  }

  once(event, callback) { this._events.once(event, callback); }

  async close() {
    if (this.isClosed()) return;
    await this.context.request('close', { pageId: this.id });
    this._markClosed();
    if (this.context.pages().length === 0) {
      this.context.closed = true;
      this.context.child.stdin.end();
    }
  }
}

class WebKitKeyboard {
  constructor(page) { this.page = page; }

  async press(key) {
    await this.page.evaluate(keyName => {
      const target = document.activeElement || document.body;
      const parts = keyName.split('+');
      const key = parts.pop();
      const modifiers = {
        ctrlKey: parts.includes('Control') || parts.includes('ControlOrMeta'),
        metaKey: parts.includes('Meta'),
        altKey: parts.includes('Alt'),
        shiftKey: parts.includes('Shift'),
      };
      if (key.toLowerCase() === 'a' && (modifiers.ctrlKey || modifiers.metaKey) &&
          target && typeof target.select === 'function') target.select();
      const event = type => new KeyboardEvent(type, {
        key, bubbles: true, cancelable: true, ...modifiers,
      });
      const allowed = target.dispatchEvent(event('keydown'));
      target.dispatchEvent(event('keypress'));
      target.dispatchEvent(event('keyup'));
      if (key === 'Enter' && allowed && target.form) target.form.requestSubmit();
    }, key);
  }
}

class WebKitLocator {
  constructor(page, query, index = null) {
    this.page = page;
    this.query = query;
    this.index = index;
  }

  first() { return new WebKitLocator(this.page, this.query, 0); }
  last() { return new WebKitLocator(this.page, this.query, -1); }
  nth(index) { return new WebKitLocator(this.page, this.query, index); }

  async count() {
    return this.page.evaluate(query => findElements(query).length, this.query);
  }

  async _withElement(operation, arg) {
    const index = this.index === null ? 0 : this.index;
    const argSource = arg === undefined ? 'undefined' : JSON.stringify(arg);
    return this.page._evaluate(`(() => {
      const items = findElements(${JSON.stringify(this.query)});
      const at = ${index} === -1 ? items.length - 1 : ${index};
      const element = items[at];
      if (!element) throw new Error('No element matched the locator.');
      return (${operation.toString()})(element, ${argSource});
    })()`);
  }

  async isVisible() {
    return this._withElement(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && style.opacity !== '0';
    }).catch(() => false);
  }

  async isEnabled() {
    return this._withElement(element => !element.disabled && element.getAttribute('aria-disabled') !== 'true')
      .catch(() => false);
  }

  async click() {
    return this._withElement(element => {
      element.scrollIntoView({ block: 'center', inline: 'center' });
      element.focus();
      element.click();
      return true;
    });
  }

  async fill(value) {
    return this._withElement((element, text) => {
      element.focus();
      if (element.isContentEditable) {
        element.textContent = text;
      } else {
        const prototype = element.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (setter) setter.call(element, text);
        else element.value = text;
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, String(value));
  }

  async press(key) {
    await this.click();
    return this.page.keyboard.press(key);
  }

  async pressSequentially(value) {
    await this.fill(value);
  }

  async innerText() {
    return this._withElement(element => element.innerText || element.textContent || '');
  }

  async evaluate(fn, arg) {
    const invocation = buildInvocation(fn, 'element', arg);
    const query = JSON.stringify(this.query);
    const index = this.index === null ? 0 : this.index;
    return this.page._evaluate(`(() => {
      const items = findElements(${query});
      const at = ${index} === -1 ? items.length - 1 : ${index};
      const element = items[at];
      if (!element) throw new Error('No element matched the locator.');
      return ${invocation};
    })()`);
  }

  async waitFor({ timeout = this.page._timeout, state = 'visible' } = {}) {
    const deadline = Date.now() + timeout;
    do {
      const count = await this.count();
      if (state === 'hidden' ? !count : count && (state !== 'visible' || await this.isVisible())) return;
      await this.page.waitForTimeout(100);
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for locator state "${state}".`);
  }
}

class WebKitElement extends WebKitLocator {
  async isVisible() { return super.isVisible(); }
}

function findElements(query) {
  if (query.selector != null) return [...document.querySelectorAll(query.selector)];
  if (query.text != null) {
    const text = query.text.toLocaleLowerCase();
    return [...document.querySelectorAll('body *')].filter(el =>
      (el.innerText || el.textContent || '').trim().toLocaleLowerCase().includes(text)
    );
  }
  const candidates = [...document.querySelectorAll(`[role="${CSS.escape(query.role)}"], ${query.role}`)];
  if (!query.name) return candidates;
  const matcher = new RegExp(query.name.source, query.name.flags);
  return candidates.filter(el => matcher.test(
    el.getAttribute('aria-label') || el.innerText || el.textContent || ''
  ));
}

function buildInvocation(fn, firstArg, arg) {
  if (typeof fn !== 'function') throw new TypeError('evaluate expects a function or JavaScript string.');
  return `((${fn.toString()})(${firstArg}${arg === undefined ? '' : `, ${JSON.stringify(arg)}`}))`;
}

module.exports = WebKitAdapter;
module.exports.WebKitPage = WebKitPage;
