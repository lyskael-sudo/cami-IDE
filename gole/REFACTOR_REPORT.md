# Gole — Refactor Report

Refactor of `deepseek-browser-agent-pro` into **gole**, a *universal browser AI agent*
with independent **multi-browser** and **multi-AI-provider** support.

Reference commit history:

1. `snapshot before gole refactor` — untouched upstream copy
2. `refactor: rename to gole` — package/bin/banner/`~/.gole`
3. `feat(browsers): multi-browser adapter`
4. `feat(providers): multi-AI adapter`
5. `feat(cli): config + docs + tests for multi-browser/multi-ai`
6. `docs: refactor report` (this file)

---

## What was done

### Rename to gole
- `package.json` name → `gole`; bin keeps `gole` plus deprecated aliases `dsa` and `deepseek-agent` (all → `src/index.js`).
- All user data moved to `~/.gole/` (`session/`, `logs/`, `providers/`, `history.json`, `config.json`).
- Banner and `--help` rebranded to *GOLE — Universal Browser AI Agent*.
- On first run, `~/.gole/config.json` is created with `{ "browser": "chromium", "ai": "deepseek" }` if absent (already in `src/config.js`).

### Multi-browser (`src/browsers/`)
- `base.js` — `BrowserAdapter` contract (`playwrightType`, `getExecutablePath`, `getLaunchArgs`, `getProxyConfig`, `ensureAvailable`, `launch`).
- `chromium.js`, `firefox.js` — Playwright bundled engines.
- `brave.js`, `librewolf.js`, `tor.js` — external executables auto-detected per OS.
  - Tor always configures `socks5://127.0.0.1:9050`; **never bypassed**.
- `util.js` — `detectExecutable()` helper.
- `index.js` — `getBrowserAdapter(name)` factory, case-insensitive, aliases `chrome`→chromium, clear error listing valid values.
- Missing executables raise an error naming the expected path(s) and an install hint.
- Sessions isolated per browser: `~/.gole/session/<browser>/<ai>/`.

### Multi-AI (`src/providers/`)
- `base.js` — `AIProviderAdapter` contract exposing a documented `selectors`
  object (`inputBox`, `sendButton`, `stopButton`, `newChat`, `assistantMessage`,
  `assistantContent`, `generating`) plus optional hooks and per-user overrides
  loaded from `~/.gole/providers/<name>.json` (user selectors prepended).
- `deepseek.js` — **exact** pre-refactor selectors and busy-banner regex.
- `gemini.js` — best-effort selectors for gemini.google.com.
- `hackerai.js`, `venice.js`, `mistral.js` — explicit **stubs** that throw a clear
  "non encore implémenté" error with the override path until selectors are supplied.
- `index.js` — `getAIProvider(name)` factory, case-insensitive, defaults to deepseek.
- `src/browser.js` is now provider-agnostic: every `SEL.*` / `GOLE_URL` / `BUSY_RE`
  reference goes through `this.provider`. The agent loop is untouched — it still talks
  to `browser.sendMessage` / `waitForResponse` / `newChat`.
- `gole --calibrate` now prints the active provider's selectors and the exact
  override-file path.

### CLI / config / docs / tests
- New flags: `--browser <name>` and `--ai <name>` (defaults from `~/.gole/config.json`).
- `--help` lists all valid browsers and providers and shows combination examples.
- `gole.config.example.json` added; `.gitignore` still ignores the real `gole.config.json`.
- README updated: supported browsers/providers tables, prerequisites, per-browser
  prerequisites, session layout, troubleshooting for external browsers and stubs.
- `test/factories.test.js` — 11 unit tests for both factories (resolution,
  case-insensitivity, defaults, unknown-name errors, Tor proxy, DeepSeek selector
  completeness, stub errors). Total suite: **41 tests, all passing**.
- `postinstall.js` now installs both bundled engines (Chromium + Firefox).

---

## What remains to do

- **hacker.ai** — URL and selectors unverified. Confirm `HACKERAI_URL` in
  `src/providers/hackerai.js` and provide `~/.gole/providers/hackerai.json`.
- **venice.ai** — same; the public site needs a logged-in session.
- **chat.mistral.ai** — URL stable, selectors unverified; add overrides.
- **Gemini** — selectors are best-effort; validate against the live DOM with
  `gole --ai gemini --calibrate` and adjust `gemini.js` or overrides.
- **Tor** — end-to-end launch not tested here (Tor Browser / daemon absent on this
  machine). Test on a host with Tor Browser + `socks5://127.0.0.1:9050`.
- **Brave / LibreWolf** — external installs not present here; test on a host where
  they are installed.

## Known limitations

- Providers other than DeepSeek need their selectors validated manually; they ship
  as best-effort or stubs — no false claims of working.
- One persistent profile per `<browser>/<ai>` pair; two gole instances cannot share
  the same profile concurrently (`SingletonLock` guard, unchanged from upstream).
- Tor requires the user's Tor Browser **and** daemon; gole never routes around it.
- `--calibrate` with a stub provider throws before opening the browser (by design).

---

## Test commands

```bash
# Unit tests
npm test

# Factory sanity (no browser launch)
node -e "const {getBrowserAdapter,VALID_BROWSERS}=require('./src/browsers');
         const {getAIProvider,VALID_PROVIDERS}=require('./src/providers');
         console.log(VALID_BROWSERS, VALID_PROVIDERS);"

# Retrocompat: no flags → chromium + deepseek + ~/.gole/session/chromium/deepseek
node -e "const B=require('./src/browser'); const b=new B();
         console.log(b.provider.name, b._sessionDir(), b._url);"

# SAFE end-to-end (already run in this environment)
gole --browser chromium --ai deepseek --headless "dis bonjour"
gole --browser firefox  --ai deepseek --headless "dis bonjour"

# Print selectors for a provider
gole --ai deepseek --calibrate

# MANUAL — run where the browser/provider is installed and logged in
gole --browser brave     --ai deepseek --interactive
gole --browser librewolf --ai deepseek --interactive
gole --browser tor       --ai deepseek --interactive   # needs Tor daemon on 9050
gole --browser chromium  --ai gemini   --interactive
```

### Tested automatically in this environment
- Chromium and Firefox persistent contexts launch, load a page and close ✔
- Brave / LibreWolf / Tor correctly report "not installed" without crashing ✔
- DeepSeek selector bank preserved verbatim (regression test) ✔
- 41 unit tests pass ✔

### To test manually elsewhere
- brave, librewolf, tor browser launches
- gemini / hackerai / venice / mistral end-to-end (after calibration)
