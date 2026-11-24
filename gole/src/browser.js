// src/browser.js — generic Playwright controller for any web-AI provider.
// Site specifics (URL + selectors + submit gesture) come from src/providers/.
'use strict';

const path         = require('path');
const os           = require('os');
const config       = require('./config');
const logger       = require('./logger');
const { stripThinkingBlocks, looksIncompleteToolCall } = require('./parser');
const { getBrowserAdapter } = require('./browsers');
const { getAIProvider }     = require('./providers');

// The default DeepSeek URL — used to detect whether the user explicitly
// overrode GOLE_URL in config (which then wins over the provider's URL).
const DEFAULT_DEEPSEEK_URL = 'https://chat.deepseek.com';

function accountSuspensionNotice(bodyText, providerName = 'DeepSeek') {
  const text = String(bodyText || '').replace(/\s+/g, ' ').trim();
  if (!/(?:account.{0,100}suspended|suspended.{0,100}account|compte.{0,100}suspendu[e]?|suspendu[e]?.{0,100}compte)/i.test(text)) {
    return null;
  }

  const until = text.match(/(?:until|jusqu['’]?(?:à|au|aux)?)\s+([^.!?]+)/i)?.[1]?.trim();
  return until
    ? `${providerName} indique que le compte est suspendu jusqu’au ${until}. Cami ne peut pas réactiver le compte ; contactez ${providerName} ou attendez la fin de la suspension.`
    : `${providerName} indique que le compte est suspendu. Cami ne peut pas réactiver le compte ; contactez ${providerName}.`;
}

/**
 * Chromium keeps SESSION_DIR/SingletonLock → "host-PID" while a browser uses the profile.
 * A second launch on it is handed to that browser (extra window there, cryptic
 * "context closed" here), so refuse early. Stale lock (dead PID) → let Chromium handle it.
 */
function assertProfileFree(sessionDir) {
  let pid;
  try { pid = Number(require('fs').readlinkSync(path.join(sessionDir, 'SingletonLock')).split('-').pop()); }
  catch { return; }
  if (!Number.isInteger(pid) || pid <= 0) return;
  try { process.kill(pid, 0); }
  catch (err) { if (err.code !== 'EPERM') return; }
  throw new Error(
    `Another gole / Chromium is already using ${sessionDir} (pid ${pid}).\n` +
    '  → Close it first, or set SESSION_DIR in gole.config.json to run a second one.'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  ChatBrowser class — generic Playwright driver for any web-AI provider.
//  (Historic name kept for API stability; the class name is no longer
//   DeepSeek-specific now that AIProviderAdapter carries the site details.)
// ─────────────────────────────────────────────────────────────────────────────

class DeepSeekBrowser {
  constructor(browserName, providerName) {
    this.browserName = browserName || config.BROWSER || 'chromium';
    this.adapter     = getBrowserAdapter(this.browserName);
    this.provider    = getAIProvider(providerName || config.AI || 'deepseek');
    this.context     = null;
    this.page        = null;
    this._closed     = false;
    this.onLoginRequired = null;
    this.onLoginRestored = null;
    this._lastSentMessage = null;
    this._loginRecoveryCount = 0;
    this.abort       = false; // set by the agent to cut waitForResponse short
    this.rateLimiter = null;  // shared RateLimiter; set when subagent tabs are in play
    this.chatPages   = new Set(); // subagent chat tabs — hidden from the browser_* tools
  }

  /** Current selector bank (provider defaults + user overrides). */
  get SEL() { return this.provider.resolvedSelectors; }

  /** URL to open: explicit GOLE_URL override wins, else the provider's own URL. */
  get _url() {
    if (config.GOLE_URL && config.GOLE_URL !== DEFAULT_DEEPSEEK_URL) return config.GOLE_URL;
    return this.provider.url;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Session directory isolated per browser and per AI provider. */
  _sessionDir() {
    const base  = path.resolve(config.SESSION_DIR);
    return path.join(base, this.browserName, this.provider.name);
  }

  async launch() {
    logger.info('Launching browser with persistent session...');
    this.adapter.ensureAvailable();
    if (typeof this.provider.ensureImplemented === 'function') this.provider.ensureImplemented();

    const sessionDir = this._sessionDir();
    require('fs').mkdirSync(sessionDir, { recursive: true });
    assertProfileFree(sessionDir);

    this.context = await this.adapter.launch(sessionDir, { headless: config.HEADLESS });

    // Grab existing page or open a new one
    const pages   = this.context.pages();
    this.page     = pages.length > 0 ? pages[0] : await this.context.newPage();

    // Mask automation signals
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await this._navigate(this._url);
    await this._ensureLoggedIn();

    logger.success('Browser ready!');
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    try { await this.context?.close(); } catch {}
  }

  /** Restart the browser in headless / headed mode (session dir is kept) */
  async relaunch(headless) {
    config.HEADLESS = headless;
    await this.close();
    this._closed = false;
    await this.launch();
  }

  /**
   * Open an extra tab in this SAME browser context — same cookies, same logged-in
   * account, just another chat. Returns a DeepSeekBrowser-shaped handle sharing
   * this.context (and this.rateLimiter, if set) so callers can drive it with the
   * usual sendMessage/waitForResponse/newChat methods. Close it with
   * `tab.page.close()`, not `tab.close()` — that would close the whole context.
   */
  async openTab() {
    const page = await this.context.newPage();
    const tab  = Object.create(DeepSeekBrowser.prototype);
    tab.context     = this.context;
    tab.page        = page;
    tab.provider    = this.provider;
    tab.browserName = this.browserName;
    tab._closed     = false;
    tab.abort       = false;
    tab.rateLimiter = this.rateLimiter;
    tab.chatPages   = this.chatPages;
    // Subagent tabs share this context: they must reuse the parent's login
    // callback (opening a companion window) instead of falling back to
    // _waitForEnter(), which would read the embedded worker's stdin. They also
    // need their own recovery counter — an undefined one makes
    // `count >= 3` permanently false and the re-login loop unbounded.
    tab.onLoginRequired = this.onLoginRequired;
    tab.onLoginRestored = this.onLoginRestored;
    tab._lastSentMessage = null;
    tab._loginRecoveryCount = 0;
    this.chatPages.add(page);
    page.once('close', () => this.chatPages.delete(page));

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await tab._navigate(this._url);
    return tab;
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  async _navigate(url) {
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await this.page.waitForTimeout(1_500);
    } catch (err) {
      logger.warn(`Navigation warning: ${err.message}`);
    }
  }

  async newChat() {
    // Try clicking the "New Chat" button in the sidebar
    for (const sel of this.SEL.newChat) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible()) {
          await el.click();
          await this.page.waitForTimeout(1_000);
          logger.dim('Started new chat session');
          return;
        }
      } catch {}
    }

    // Fallback: navigate to home which usually opens a fresh chat
    await this._navigate(this._url);
    logger.dim(`Navigated to ${this.provider.label} home (new chat)`);
  }

  // ── Login handling ─────────────────────────────────────────────────────────

  async _ensureLoggedIn() {
    const suspension = await this._accountSuspensionNotice();
    if (suspension) throw new Error(suspension);

    const needsLogin = await this._isLoginRequired();
    if (!needsLogin) return false;

    if (config.HEADLESS) {
      throw new Error('Login required — run without --headless once to log in (session is saved).');
    }

    // A previous stop (Esc) leaves abort=true; clear it so the login window is
    // actually usable instead of failing on the first poll.
    this.abort = false;

    if (typeof this.onLoginRequired === 'function') {
      // The embedded host may resolve asynchronously (it shows a companion
      // window): await it so a rejected promise is not swallowed.
      await this.onLoginRequired();
    } else {
      this._printLoginBanner();
      await this._waitForEnter();
    }

    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      if (this.abort) throw new Error('Login cancelled.');
      await this.page.waitForTimeout(1_000);
      const currentSuspension = await this._accountSuspensionNotice();
      if (currentSuspension) throw new Error(currentSuspension);
      if (!await this._isLoginRequired()) {
        await this.page.waitForTimeout(1_000);
        if (!await this._isLoginRequired()) {
          this.onLoginRestored?.();
          return true;
        }
      }
    }
    throw new Error('Login timed out after five minutes. Please try again.');
  }

  async _isLoginRequired() {
    return this.page.evaluate(() => {
      const path = window.location.pathname.toLowerCase();
      const authRoute = /\/(?:auth|login|sign[_-]?in)(?:\/|$)/.test(path);
      const visiblePasswordInput = Array.from(
        document.querySelectorAll('input[type="password"]')
      ).some(element => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== 'none' && style.visibility !== 'hidden';
      });
      return authRoute || visiblePasswordInput;
    });
  }

  async _accountSuspensionNotice() {
    const bodyText = await this.page.evaluate(() => document.body?.innerText || '');
    return accountSuspensionNotice(bodyText, this.provider?.label || 'DeepSeek');
  }

  async _recoverFromLogin() {
    const suspension = await this._accountSuspensionNotice();
    if (suspension) throw new Error(suspension);
    if (!await this._isLoginRequired()) return false;
    if (this._loginRecoveryCount >= 3) {
      const providerName = this.provider?.label || 'DeepSeek';
      throw new Error(`${providerName} a redemandé une connexion plusieurs fois. Vérifiez la session du compte.`);
    }

    const pendingMessage = this._lastSentMessage;
    this._loginRecoveryCount += 1;
    logger.warn(`Connexion ${this.provider?.label || 'DeepSeek'} interrompue ; en attente de votre reconnexion...`);
    await this._ensureLoggedIn();
    // Re-send only when the message never produced an answer. A login page can
    // appear after the reply started: resending then would duplicate the
    // request (and could replay tool side effects).
    if (pendingMessage && !await this._replyAlreadyArrived()) {
      await this.sendMessage(pendingMessage);
    }
    return true;
  }

  /** True when the last assistant message exists and is already finished. */
  async _replyAlreadyArrived() {
    try {
      const text = await this._extractLastMessage();
      if (!text || text.length < 10) return false;
      return !await this._isGenerating() && !looksIncompleteToolCall(text);
    } catch {
      return false;
    }
  }

  _printLoginBanner() {
    console.log('');
    logger.warn('╔══════════════════════════════════════════════╗');
    logger.warn('║  🔐  LOGIN REQUIRED                          ║');
    logger.warn('║                                              ║');
    logger.warn(`║  1. Log in to ${this.provider.label.padEnd(29).slice(0, 29)}║`);
    logger.warn('║  2. Return here and press  ENTER  to continue║');
    logger.warn('╚══════════════════════════════════════════════╝');
    console.log('');
  }

  async _waitForEnter() {
    return new Promise(resolve => {
      const stdin   = process.stdin;
      const wasRaw  = stdin.isRaw;
      const wasPaused = stdin.readableFlowing !== true;

      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.resume();

      const handler = chunk => {
        const s = chunk.toString();
        if (s.includes('\n') || s.includes('\r')) {
          stdin.removeListener('data', handler);
          if (stdin.isTTY && wasRaw) stdin.setRawMode(true);
          if (wasPaused)            stdin.pause();
          resolve();
        }
      };

      stdin.on('data', handler);
    });
  }

  // ── Sending Messages ───────────────────────────────────────────────────────

  async sendMessage(text) {
    await this._ensureLoggedIn();
    if (this.rateLimiter) await this.rateLimiter.take();

    // Find input element
    const { el, isTextarea } = await this._findInput();

    // Click to focus
    await el.click({ force: true });
    await this.page.waitForTimeout(200);

    // Clear existing content
    await this.page.keyboard.press('Control+a');
    await this.page.waitForTimeout(100);

    if (isTextarea) {
      // Standard textarea — use fill() which is reliable
      await el.fill(text);
    } else {
      // contenteditable div (DeepSeek, Gemini's Quill editor, …) — needs execCommand.
      // el.evaluate(fn, arg) passes the element handle as the first parameter and
      // `arg` as the second — page.evaluate() would only accept ONE extra argument.
      await el.evaluate((element, content) => {
        element.focus();
        // Select all and delete
        document.execCommand('selectAll', false, null);
        document.execCommand('delete',    false, null);
        // Insert text (fires proper input events)
        document.execCommand('insertText', false, content);
        // Belt-and-suspenders: fire input event manually
        element.dispatchEvent(new InputEvent('input', { bubbles: true, data: content }));
      }, text);
    }

    await this.page.waitForTimeout(config.SEND_DELAY);

    // Try send button, fall back to the provider's submit gesture (Enter)
    const clicked = await this._clickSendButton();
    if (!clicked) {
      await this.provider.submitFallback(this.page);
    }
    this._lastSentMessage = text;

    await this.page.waitForTimeout(500);
  }

  async _findInput() {
    for (const sel of this.SEL.inputBox) {
      try {
        const el = await this.page.waitForSelector(sel, { timeout: 4_000, state: 'visible' });
        if (!el) continue;
        const tagName          = await el.evaluate(e => e.tagName.toLowerCase());
        const isContentEditable = await el.evaluate(e => e.isContentEditable);
        return { el, isTextarea: this.provider.isTextareaInput(tagName, isContentEditable) };
      } catch {}
    }
    let where = '';
    try {
      const shot = path.join(config.GOLE_HOME, 'logs', `input-missing-${Date.now()}.png`);
      where = `\n  Page URL: ${this.page.url()}`;
      await this.screenshot(shot);
      where += `\n  Screenshot: ${shot}`;
    } catch {}
    throw new Error(
      `Cannot find the ${this.provider.label} chat input box.` + where + '\n' +
      '  → Make sure the page is fully loaded and you are logged in.\n' +
      '  → Run with --debug to inspect DOM selectors.\n' +
      '  → Run: gole --calibrate to inspect the page.'
    );
  }

  async _clickSendButton() {
    for (const sel of this.SEL.sendButton) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible() && await el.isEnabled()) {
          await el.click();
          return true;
        }
      } catch {}
    }
    return false;
  }

  // ── Waiting for Response ───────────────────────────────────────────────────

  /**
   * Wait until DeepSeek finishes generating and return the response text.
   *
   * Algorithm:
   *  1. Record how many assistant messages are on the page right now.
   *  2. Wait until a new message appears (count goes up).
   *  3. Poll the last message text every 500 ms.
   *  4. When the text has not changed for STABLE_DELAY ms AND
   *     no stop/loading indicator is visible → done.
   */
  async waitForResponse(expectNew = true) {
    if (await this._recoverFromLogin()) {
      // The message was re-sent after the re-login: skip the "wait for a new
      // message" phase (the counter may already be higher) and re-stabilise.
      return this._awaitStableReply(false);
    }
    return this._awaitStableReply(expectNew);
  }

  /**
   * Core polling loop. Split out so a mid-flight login recovery can restart it
   * without losing the abort flag or re-running the 12 s "new message" phase.
   */
  async _awaitStableReply(expectNew) {
    const timeout     = config.RESPONSE_TIMEOUT;
    const stableDelay = config.STABLE_DELAY;
    const start       = Date.now();

    // ── Phase 1: wait for a new message to appear ──────────────────────────
    //  Skipped on a re-read (expectNew=false): the message already exists, so
    //  waiting for the count to rise would just burn the 12 s timeout.
    if (expectNew) {
      const initialCount = await this._getMessageCount();
      let   appeared     = false;

      while (Date.now() - start < 12_000 && !this.abort) {
        if (await this._recoverFromLogin()) {
          return this._awaitStableReply(false);
        }
        const count = await this._getMessageCount();
        if (count > initialCount) { appeared = true; break; }
        await this.page.waitForTimeout(400);
      }

      if (!appeared) logger.warn('Response may have been delayed — continuing to wait...');
    }

    // ── Phase 2: wait for text to stabilise ───────────────────────────────
    let lastText    = '';
    let stableStart = null;
    let dotCount    = 0;
    let busyRetries = 0;
    let deadline    = start + timeout;

    while (Date.now() < deadline) {
      if (this.abort) { await this._clickStop(); break; }
      if (await this._recoverFromLogin()) {
        return this._awaitStableReply(false);
      }
      // Server busy banner → click Continue and keep waiting (never "done")
      if (await this._handleServerBusy()) {
        if (++busyRetries > config.BUSY_MAX_RETRIES) {
          throw new Error(`${this.provider.label} server still unavailable after ${config.BUSY_MAX_RETRIES} retries.`);
        }
        lastText    = '';
        stableStart = null;
        deadline    = Math.max(deadline, Date.now() + timeout / 2);
        await this.page.waitForTimeout(config.BUSY_RETRY_DELAY);
        continue;
      }

      const text = await this._extractLastMessage();

      if (text !== lastText) {
        lastText    = text;
        stableStart = null;
      } else if (text.length > 0) {
        if (!stableStart) stableStart = Date.now();
        else if (Date.now() - stableStart >= stableDelay) {
          // Confirmed done only if DeepSeek stopped AND the text isn't a tool
          // call still mid-stream (a server-lag pause can look "stable").
          // ponytail: on a false positive we just wait to RESPONSE_TIMEOUT and
          // return anyway — correct, only slower in that rare case.
          if (!await this._isGenerating() && !looksIncompleteToolCall(text)) break;
          stableStart = null;                       // still generating, reset
        }
      }

      // Progress indicator
      dotCount = (dotCount + 1) % 4;
      logger.thinking(`Receiving response${'.'.repeat(dotCount)}  (${text.length} chars)`);

      await this.page.waitForTimeout(500);
    }

    logger.clearLine();

    if (await this._recoverFromLogin()) {
      return this._awaitStableReply(false);
    }
    const final = await this._extractLastMessage();
    this._lastSentMessage = null;
    this._loginRecoveryCount = 0;
    return this._cleanText(final);
  }

  // ── DOM Extraction ─────────────────────────────────────────────────────────

  /** Count how many "response" blocks are visible */
  async _getMessageCount() {
    return await this.page.evaluate(candidates => {
      for (const sel of candidates) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) return els.length;
      }
      // Broad fallback
      return document.querySelectorAll('[class*="message"]').length;
    }, this.SEL.assistantMessage);
  }

  /** Extract the text of the last assistant message — including code blocks */
  async _extractLastMessage() {
    return await this.page.evaluate(directSelectors => {

      // ── Helper: get all text including code blocks ────────────────────────
      // Walks the DOM and reconstructs text, re-adding fence markers for code
      // blocks so the parser can recognise tool_call fences even after the
      // browser markdown renderer has converted them to <pre><code> elements.
      function getFullText(el) {
        if (!el) return '';
        let result = '';

        function walk(node) {
          if (node.nodeType === Node.TEXT_NODE) {
            result += node.textContent;
            return;
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const tag = node.tagName.toLowerCase();

          // Buttons (Copy / Download / Run…) are UI chrome, not content
          if (tag === 'button') return;

          // Tables → markdown pipe rows so the terminal can render them
          if (tag === 'table') {
            const cell = c => (c.innerText || '').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
            const rows = Array.from(node.querySelectorAll('tr')).map(tr =>
              '| ' + Array.from(tr.children).map(cell).join(' | ') + ' |');
            if (rows.length) {
              const cols = (rows[0].match(/ \| /g) || []).length + 1;
              rows.splice(1, 0, '|' + ' --- |'.repeat(cols));
              result += '\n' + rows.join('\n') + '\n';
            }
            return;
          }

          // Headings / bold / list items keep their markdown markers
          if (/^h[1-6]$/.test(tag)) result += '\n' + '#'.repeat(Number(tag[1])) + ' ';
          if (tag === 'strong' || tag === 'b') result += '**';
          if (tag === 'li') {
            const p = node.parentElement;
            result += p && p.tagName.toLowerCase() === 'ol'
              ? (Array.prototype.indexOf.call(p.children, node) + 1) + '. ' : '- ';
          }

          // <pre> wraps a fenced code block — reconstruct the backtick fence
          // so the parser can match the ```tool_call regex.
          if (tag === 'pre') {
            const codeEl = node.querySelector('code');
            if (codeEl) {
              const cls  = codeEl.className || '';
              const lang = (cls.match(/language-(\S+)/) || [])[1] || '';
              const body = codeEl.textContent || '';
              result += '\n```' + lang + '\n' + body + '\n```\n';
            } else {
              result += '\n```\n' + node.textContent + '\n```\n';
            }
            return;
          }

          // Inline <code> — skip if inside a <pre> (already handled)
          if (tag === 'code') {
            const parentTag = node.parentElement && node.parentElement.tagName
              ? node.parentElement.tagName.toLowerCase() : '';
            if (parentTag !== 'pre') {
              result += '`' + node.textContent + '`';
            }
            return;
          }

          for (const child of node.childNodes) walk(child);

          if (tag === 'strong' || tag === 'b') result += '**';

          if (['p','div','li','br','h1','h2','h3','h4','h5','h6'].includes(tag)) {
            result += '\n';
          }
        }

        walk(el);
        return result.trim();
      }

      // ── Attempt 1: Specific assistant-message selectors ──────────────────
      for (const sel of directSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          const t = getFullText(els[els.length - 1]);
          if (t.length > 10) return t;
        }
      }

      // ── Attempt 2: Any markdown/prose container ───────────────────────────
      const markdownEls = document.querySelectorAll(
        '[class*="markdown"], [class*="prose"], [class*="rendered"]'
      );
      if (markdownEls.length > 0) {
        const t = getFullText(markdownEls[markdownEls.length - 1]);
        if (t.length > 10) return t;
      }

      // ── Attempt 3: Heuristic — large non-user text blocks ────────────────
      const allBlocks = Array.from(
        document.querySelectorAll('[class*="message"], [class*="chat-item"], [class*="turn"]')
      );
      const candidates = allBlocks.filter(el => {
        const cls = el.className || '';
        return (
          !cls.toLowerCase().includes('input') &&
          !cls.toLowerCase().includes('user') &&
          !el.querySelector('textarea, input[type="text"]') &&
          (el.innerText || '').length > 20
        );
      });

      if (candidates.length > 0) {
        return getFullText(candidates[candidates.length - 1]);
      }

      return '';
    }, this.SEL.assistantContent);
  }

  /** Click DeepSeek's "stop generating" button if it is showing */
  async _clickStop() {
    for (const sel of this.SEL.stopButton) {
      try {
        const el = await this.page.$(sel);
        if (el && await el.isVisible()) { await el.click(); return; }
      } catch {}
    }
  }

  /** If the "server unavailable" banner is up, click Continue/Retry. Returns true if banner seen. */
  async _handleServerBusy() {
    // Only sites that declare a busy banner have one (DeepSeek); others skip.
    if (!this.provider.busyPattern) return false;
    // Only short, visible elements outside chat markdown/code count — the model's own
    // reply (or files it read) can contain the phrase and must not trigger this.
    const busy = await this.page.evaluate(re => {
      const rx = new RegExp(re, 'i');
      return Array.from(document.querySelectorAll('div, span, p')).some(el => {
        if (el.children.length > 3 || el.offsetParent === null) return false;
        if (el.closest('[class*="markdown"], pre, code, textarea, nav, [class*="sidebar"]')) return false;
        const t = (el.innerText || '').trim();
        return t.length > 0 && t.length < 150 && rx.test(t);
      });
    }, this.provider.busyPattern.source);
    if (!busy) return false;

    // The banner stays in the chat after Continue is clicked, so the real signal is the
    // "Continue" button itself: it exists only while the stream is actually stopped.
    const btn = this.page.getByRole('button', { name: /^continue$/i }).last();
    if (!await btn.isVisible().catch(() => false)) return false;

    logger.warn(`${this.provider.label}: server unavailable — clicking Continue...`);
    try { await btn.click({ timeout: 3_000 }); } catch {}
    return true;
  }

  /** True if the AI is still streaming / generating */
  async _isGenerating() {
    return await this.page.evaluate(selectors => selectors.some(sel => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    }), this.SEL.generating);
  }

  // ── Text Cleanup ───────────────────────────────────────────────────────────

  _cleanText(text) {
    if (!text) return '';

    // Chain-of-thought blocks / "Thinking..." headers first (same rules as the parser)
    return stripThinkingBlocks(text)
      // Strip "label / Copy / Download" code-block chrome, keep the label as the fence language
      .replace(/(?:^|\n)(?:([\w+#.-]{1,20})\s*\n+)?(?:(?:Copy|Download)\s*\n+)+```(\w*)\n/g,
        (_, label, lang) => '\n```' + (lang || label || '') + '\n')
      // Strip copy-code button artifacts like "1CopyRunInsert"
      .replace(/^\d+(?:Copy|Run|Insert|Edit)\b.*$/gm, '')
      // Collapse 3+ blank lines into 2
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ── Debug / Calibration Utilities ─────────────────────────────────────────

  /**
   * Dump useful DOM information to stdout.
   * Called by `gole --calibrate`.
   */
  async dumpDebugInfo() {
    const info = await this.page.evaluate(() => {
      const classFreq = {};
      document.querySelectorAll('*').forEach(el => {
        el.classList.forEach(c => {
          if (c.match(/message|chat|input|send|stop|markdown|content|assistant|user|bot/i)) {
            classFreq[c] = (classFreq[c] || 0) + 1;
          }
        });
      });

      const inputs = Array.from(document.querySelectorAll('textarea, [contenteditable]')).map(e => ({
        tag         : e.tagName,
        id          : e.id || null,
        class       : e.className?.slice(0, 80) || null,
        placeholder : e.placeholder || null,
        editable    : e.isContentEditable,
        visible     : e.offsetParent !== null,
      }));

      return {
        url    : window.location.href,
        title  : document.title,
        classes: Object.entries(classFreq).sort((a, b) => b[1] - a[1]).slice(0, 40),
        inputs,
      };
    });

    console.log('\n' + '═'.repeat(60));
    console.log('  DOM DEBUG INFO');
    console.log('═'.repeat(60));
    console.log('URL   :', info.url);
    console.log('Title :', info.title);
    console.log('\nInput elements:');
    info.inputs.forEach(i => console.log(' ', JSON.stringify(i)));
    console.log('\nMatching CSS classes (by frequency):');
    info.classes.forEach(([cls, count]) => console.log(`  ${String(count).padStart(3)}x  .${cls}`));
    console.log('═'.repeat(60) + '\n');
  }

  /** Take a screenshot (for debugging) */
  async screenshot(filePath = path.join(os.tmpdir(), 'gole-debug.png')) {
    await this.page.screenshot({ path: filePath, fullPage: false });
    logger.info(`Screenshot saved: ${filePath}`);
  }
}

module.exports = DeepSeekBrowser;
module.exports.accountSuspensionNotice = accountSuspensionNotice;
module.exports.assertProfileFree = assertProfileFree;
