<div align="center">

<a href="https://www.npmjs.com/package/gole"><img src="https://img.shields.io/npm/v/gole?style=for-the-badge&color=blue" alt="npm version"/></a>
<img src="https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=for-the-badge" alt="Node.js"/>
<img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="License"/>
<img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge" alt="PRs Welcome"/>

# 🤖 GOLE — Universal Browser AI Agent

**An autonomous AI coding agent that runs entirely for free — no API key required.**

It drives a real browser to talk to [DeepSeek](https://chat.deepseek.com), giving you a Claude Code / Cursor-style coding agent at zero cost. Pick the **browser** (`chromium`, `firefox`, `brave`, `librewolf`, `tor`, or Linux WebKitGTK) and the **AI provider** (`deepseek`, `gemini`, …) independently. The agent edits files, runs commands, browses the web in its own browser tab and can use any [MCP](https://modelcontextprotocol.io) server.

[Installation](#-installation) · [Quick Start](#-quick-start) · [Usage](#-usage) · [Interactive commands](#-interactive-commands) · [Configuration](#-configuration) · [Tools](#-available-tools) · [Subagents](#-subagents) · [MCP servers](#-mcp-servers) · [Contributing](#-contributing)

---

> ⚠️ **Early release.** The agent drives the DeepSeek web UI, which can change without notice. If it breaks, run `gole --calibrate` and open an issue.
>
> Based on [Omar-Azam/deepseek-browser-agent](https://github.com/Omar-Azam/deepseek-browser-agent) (MIT) — adds an interactive input box, chat history/resume, automatic context rollover, auto-retry on "server busy", browser tools, MCP servers and more. See the [changelog](./CHANGELOG.md).

</div>

---

## 🧠 How It Works

Most AI coding agents talk to a paid API. This one doesn't.

Instead, it uses **Playwright** to control a real Chromium browser, navigates to `chat.deepseek.com`, sends your task, waits for the response, and parses it to extract tool calls — all automatically. Your local files, terminal, a browser tab and any MCP servers you configure are wired up as tools the AI can use, so it can read code, write files, run commands, browse JS-heavy sites and build complete projects step by step.

On Linux, `--browser webkit` selects Cami's native WebKitGTK companion. It runs JavaScript in WebKit, shares a persistent profile between tabs, and is controlled over local standard input/output (not a network port). Build it from the Plinth workspace with `./install-cami-gole-deps.sh --npm-only`, or set `GOLE_WEBKIT_BINARY` to its executable. WebKitGTK requires a graphical desktop and does not support `--headless`.

```
Your Terminal
     │
     ▼
 Agent Core          ← orchestrates the loop
     │
     ├──► Browser (Playwright)  ← talks to chat.deepseek.com
     │         │
     │    DeepSeek AI  ← thinks, decides what tool to use
     │         │
     └──► Tool Executor  ← files, shell, browser tab, subagents, MCP servers
              │
         Your Project / the web
```

---

## 📦 Installation

```bash
npm install -g gole
```

> Chromium downloads automatically after install (~150 MB, one time only).
> If it was skipped (CI, offline): `npx playwright install chromium`.

**Requirements:** Node.js ≥ 18, a free [DeepSeek](https://chat.deepseek.com) account (or any other supported provider — see below).

### 🌐 Supported browsers

| `--browser` | Engine | Notes |
|---|---|---|
| `chromium` (default) / `chrome` | Playwright bundled | Auto-downloaded, nothing to install |
| `firefox` | Playwright bundled | `npx playwright install firefox` |
| `brave` | Chromium | Must be installed by you (auto-detected) |
| `librewolf` | Firefox fork | Must be installed by you (auto-detected) |
| `tor` | Tor Browser | Tor Browser **and** the Tor daemon on `socks5://127.0.0.1:9050` (never bypassed) |
| `webkit` | Native WebKitGTK | Linux only; build `cami/native/webkit-browser` and use a graphical session |

Each browser gets its own session folder, so you can be logged in to several at once: `~/.gole/session/<browser>/<ai>/`.

### 🧠 Supported AI providers

| `--ai` | Site | Status |
|---|---|---|
| `deepseek` (default) | chat.deepseek.com | ✅ Fully supported (pre-refactor behaviour) |
| `gemini` | gemini.google.com | ✅ Best-effort selectors — run `--calibrate` if they drift |
| `hackerai` | hacker.ai | ⚠️ Stub — provide selectors in `~/.gole/providers/hackerai.json` |
| `venice` | venice.ai | ⚠️ Stub — provide selectors in `~/.gole/providers/venice.json` |
| `mistral` | chat.mistral.ai | ⚠️ Stub — provide selectors in `~/.gole/providers/mistral.json` |

Every provider needs a free account on its website, logged in once per browser+provider session. Selector overrides go in `~/.gole/providers/<name>.json` (same keys as `src/providers/base.js`).

---

## 🚀 Quick Start

**1. First run — log in to DeepSeek:**
```bash
gole --interactive
```
A browser window opens. Log in to your DeepSeek account, then come back to the terminal and press **Enter**. Your session is saved — you only do this once.

**2. Give it a task:**
```bash
gole "build a REST API in Express with user authentication"
```

**3. Use the short alias `dsa` from any project folder:**
```bash
cd ~/my-project
dsa "add input validation to all my API routes"
```

---

## 💻 Usage

```
gole [OPTIONS] [TASK]

  -t, --task <task>    Task to run (or just type it as the last argument)
  -i, --interactive    Keep browser open, run multiple tasks in a session
  -d, --dir <path>     Set working directory (default: current directory)
  --debug              Print raw AI responses to the terminal
  --headless           Run browser invisibly (requires prior login)
  --browser <name>     chromium|chrome|firefox|brave|librewolf|tor|webkit (default: config)
  --ai <name>          deepseek|gemini|hackerai|venice|mistral       (default: config)
  -s, --subagents      Let the AI spawn parallel subagents when it decides it needs to
  --save-log           Save full session log to ~/.gole/logs/
  --calibrate          Print DOM info + current provider selectors (run if the agent breaks)
  -v, --version        Print version
  -h, --help           Show help

Aliases:
  dsa, deepseek-agent  Backwards-compatible aliases (deprecated — prefer gole)
```

### Examples

```bash
# Single task — runs and exits
gole "create a Python script that scrapes Hacker News"

# Interactive mode — keeps browser open between tasks
gole --interactive

# Run on a specific project
dsa --dir ~/projects/my-app "refactor all callbacks to async/await"

# Debug mode (shows what DeepSeek is actually outputting)
dsa --debug "build a calculator"

# Headless mode (faster — browser runs in background)
dsa --headless "write unit tests for utils.js"

# Browse a JS-heavy docs site in the agent's own tab
dsa "open https://localapi-doc-en.adspower.com/ and list the parameters of Open Browser V2"

```

---

## ⌨️ Interactive commands

In `--interactive` mode the input box stays at the bottom of the terminal. Type `/` to open the command menu (↑↓ select, Tab fills, Enter runs). **Alt+Enter** or a trailing `\` adds a new line. While the agent works, **Esc** stops it, and anything you type is delivered with the next step.

| Command | What it does |
|---|---|
| `/new_chat` | Start a fresh DeepSeek chat |
| `/stop` | Stop the running task (or press Esc) |
| `/continue` | Keep going after the step limit |
| `/history` | List saved chats |
| `/resume <n>` | Reopen chat number *n* from `/history` |
| `/context` | Show estimated context usage |
| `/headless on` / `/headless off` | Restart the browser invisibly / with a window |
| `/subagents on` / `/subagents off` | Let DeepSeek spawn parallel subagents on its own, or not (off by default) |
| `/subagents-max <n>` | Cap how many subagents can run at once (`MAX_SUBAGENTS`) |
| `/help` | Show the list |
| `/exit` | Quit |

When the chat reaches 90% of the context limit, the agent asks DeepSeek for a summary and continues in a new chat automatically.

---

## ⚙️ Configuration

### Global config — applies everywhere

Create `~/.gole/config.json`:

```json
{
  "HEADLESS": true,
  "MAX_ITERATIONS": 50,
  "STABLE_DELAY": 3000,
  "DEBUG": false
}
```

### Per-project config — overrides global

Drop `gole.config.json` in your project root:

```json
{
  "MAX_ITERATIONS": 60,
  "MAX_OUTPUT_LENGTH": 12000
}
```

### All settings

| Setting | Default | Description |
|---|---|---|
| `DEEPSEEK_URL` | `https://chat.deepseek.com` | Chat page to automate |
| `HEADLESS` | `false` | Hide the browser window |
| `MAX_ITERATIONS` | `300` | Max agent steps per task before stopping |
| `RESPONSE_TIMEOUT` | `180000` | Max ms to wait for a response (3 min) |
| `STABLE_DELAY` | `2500` | Ms of silence that means DeepSeek is done |
| `SEND_DELAY` | `400` | Ms between typing and pressing Enter |
| `BUSY_MAX_RETRIES` | `20` | Auto-clicks of Continue on "server unavailable" before failing |
| `BUSY_RETRY_DELAY` | `3000` | Ms to wait after each Continue click |
| `CONTEXT_LIMIT` | `128000` | Model context size (tokens, estimated) |
| `CONTEXT_ROLLOVER` | `0.9` | Fraction of the limit at which the chat is summarized and restarted |
| `WORKING_DIR` | current dir | Project the tools operate on (same as `--dir`) |
| `MAX_OUTPUT_LENGTH` | `8000` | Truncate long command outputs sent to AI |
| `DEBUG` | `false` | Print raw AI responses to terminal |
| `SESSION_DIR` | `~/.gole/session` | Where browser cookies are saved |
| `WEB_TIMEOUT` | `30000` | Default timeout (ms) for `browser_*` actions |
| `mcpServers` | `{}` | MCP servers to start, see [MCP servers](#-mcp-servers) |
| `MCP_START_TIMEOUT` | `60000` | Max ms for an MCP server to start and list its tools |
| `MCP_CALL_TIMEOUT` | `120000` | Max ms for one MCP tool call |
| `SUBAGENTS_ENABLED` | `false` | Whether DeepSeek may call `spawn_subagents` (same as `/subagents on\|off`) |
| `MAX_SUBAGENTS` | `4` | Max subagents at once (same as `/subagents-max`) |
| `SUBAGENT_RATE` | `{ perSec: 2, perMin: 120 }` | Shared send-rate budget across every tab of the one account |

---

## 🛠️ Available Tools

The agent can use these tools autonomously to complete your task:

| Tool | Description |
|---|---|
| `read_file` | Read a file with line numbers; long files come in whole-line chunks (`start_line`) |
| `write_file` | Create, overwrite or `append` to a file (auto-creates directories) |
| `write_files` | Write multiple files at once (batch scaffold) |
| `replace_in_file` | Edit a file: `find` must match exactly once (or `all_occurrences`), regex optional |
| `delete_file` | Permanently delete a file |
| `list_directory` | List directory contents, optionally recursive |
| `run_command` | Run a shell command (stdout+stderr); `background: true` for servers / watchers; Esc kills it |
| `find_files` | Find files by name glob (e.g. `*.ts`, `src/*.js`) |
| `search_in_files` | Search text inside files (like `grep -rn`, regex or plain text) |
| `read_url` | Fast plain-HTTP fetch of a URL (no JavaScript) |
| `spawn_subagents` | Run 2+ independent subtasks in parallel, each in its own tab under this same account (off by default — see [Subagents](#-subagents)) |

Moving, copying, `mkdir` and `stat` go through `run_command`. File search is pure Node — no `find` / `grep` needed.

### 🌐 Browser tools

The agent gets its own tab in the same Chromium that talks to DeepSeek (cookies and logins persist). Every action returns a **snapshot**: page text plus numbered interactive elements, so the model clicks and types by `ref` number instead of guessing CSS selectors. The DeepSeek tab is brought back to the front after each action.

| Tool | Description |
|---|---|
| `browser_open` | Open a URL (or `back` / `forward`) and return the snapshot |
| `browser_snapshot` | Snapshot of the current page |
| `browser_read` | Full page / element text in chunks (`offset`) — for long docs |
| `browser_click` | Click by `ref`, CSS `selector` or visible `text` |
| `browser_type` | Type into an input (`submit` presses Enter, `clear: false` appends) |
| `browser_press` | Press a key (Enter, Escape, Tab, PageDown…) |
| `browser_wait` | Wait for a selector / text, or pause |
| `browser_eval` | Run JavaScript in the page, return JSON |
| `browser_tab` | `list` / `switch` / `new` / `close` agent tabs |
| `browser_connect` | Attach to an external Chromium over CDP (`ws://…` or `http://host:port`), e.g. an AdsPower profile |
| `browser_close` | Close the agent tab; detach from the external browser (it keeps running) |

---

## 🧩 Subagents

DeepSeek can decide, on its own, to split a task into independent pieces and run them in parallel — each subagent gets its own browser tab, its own chat and its own full tool-calling system prompt, under the **same logged-in DeepSeek account** as the main chat. There's no human-driven "run these tasks" command: the main agent studies what you asked, and reaches for `spawn_subagents` only when it finds genuinely independent work (e.g. "check the exports of three unrelated files") — never for a single task or steps that depend on each other.

Off by default. Turn it on with `/subagents on` (or start with `-s` / `--subagents`); current state shows in the status footer and the startup banner. `/subagents-max <n>` caps how many run at once.

**One account, not several.** Every tab — the main chat and every subagent — shares a single send-rate budget (`SUBAGENT_RATE`, default 2 req/sec · 120 req/min); they queue for it, never exceed it. This is a deliberate design decision: spreading requests across *multiple* DeepSeek accounts to multiply that limit would be rate-limit evasion, not a feature, so it isn't supported and won't be added.

Because subagents run concurrently, their terminal output is tagged `[sub i/n]` so you can tell which tab is doing what while they interleave.

---

## 🔌 MCP servers

Any stdio [MCP](https://modelcontextprotocol.io) server can be plugged in. Its tools show up for DeepSeek as `mcp__<server>__<tool>` (non-alphanumerics become `_`). Use the same `mcpServers` block as Claude Desktop / Cursor — in `gole.config.json` or `~/.gole/config.json` (both are merged per server):

```json
{
  "mcpServers": {
    "adspower-local-api": {
      "command": "npx",
      "args": ["-y", "local-api-mcp-typescript"],
      "env": { "PORT": "50325", "API_KEY": "your_api_key" }
    }
  }
}
```

Servers start in parallel before the first message, so their tools are listed in the system prompt. A server that fails to start only prints a warning. Only stdio servers (`command`) are supported. Add `"tools": ["name", …]` to a server entry to expose only those tools (keeps the prompt short).

Typical combo: start an AdsPower profile through its MCP tool, then `browser_connect` to the returned ws endpoint and drive that profile with the `browser_*` tools.

---

## 📂 Where Data is Stored

Everything lives in `~/.gole/` in your home directory:

```
~/.gole/
├── session/<browser>/<ai>/   ← Per-browser, per-provider cookies (one login each)
├── providers/<ai>.json       ← Selector overrides for a provider (optional)
├── logs/                     ← Session logs (--save-log) and bg-*.log
├── history.json              ← Chats for /history and /resume
└── config.json               ← Your global settings (optional)
```

> Sessions are isolated per browser and per AI, so `gole --browser brave --ai deepseek`
> and `gole --browser tor --ai gemini` keep separate logins and can run in parallel.

---

## 🔧 Troubleshooting

### Agent responds but creates no files
The browser DOM rendered the AI's response in a way the parser didn't catch. Run with `--debug` to see exactly what's being received:
```bash
gole --debug "build a calculator"
```

### Agent stops responding / loops
DeepSeek's UI may have changed. Run the calibration tool — it inspects the live DOM and prints updated selectors:
```bash
gole --calibrate
```

### Login session expired
Just run without `--headless` — the browser opens and you log in again:
```bash
gole --interactive
```

### `--headless` says login is required
Headless needs a saved login. Run `gole --interactive` (without `--headless`) once first.

### `--browser brave` / `librewolf` / `tor` fails to launch
Those browsers are **not bundled** — install them yourself. The error lists the exact paths gole looks for:
- **Brave:** <https://brave.com/download/>
- **LibreWolf:** <https://librewolf.net/installation/>
- **Tor Browser:** <https://www.torproject.org/download/> (and the Tor daemon must listen on `socks5://127.0.0.1:9050`; `torbrowser-launcher` does this for you). Tor is **never** launched without its SOCKS proxy.

### `--ai gemini` (or a stub provider) does nothing useful
Non-DeepSeek providers need their selectors validated against the live site. Run `gole --ai <name> --calibrate` to dump the DOM and current selectors, then drop overrides into `~/.gole/providers/<name>.json`. `hackerai`, `venice` and `mistral` ship as explicit stubs — they raise a clear error until you supply selectors.

### Chromium didn't download automatically
```bash
npx playwright install chromium
```

### Response times out on long tasks
Increase the timeout in your config:
```json
{ "RESPONSE_TIMEOUT": 300000, "STABLE_DELAY": 4000 }
```

### `read_url` returns an almost empty page
The site renders with JavaScript. The agent is told to switch to `browser_open`; you can also ask it to use the browser directly.

### An MCP server does not start
The warning at start-up shows the server's last stderr lines. Check that the `command` runs in your terminal (e.g. `npx -y local-api-mcp-typescript`) and that the app it talks to (e.g. AdsPower) is running. The first `npx -y` run downloads the package — raise `MCP_START_TIMEOUT` on a slow connection.

---

## 🗂️ Project Structure

```
gole/
├── src/
│   ├── index.js          ← CLI entry point and argument parsing
│   ├── agent.js          ← Core agent loop (send → wait → parse → execute)
│   ├── browser.js        ← Generic Playwright controller (site logic lives in providers/)
│   ├── browsers/         ← Browser adapters: base, chromium, firefox, brave, librewolf, tor, index (factory)
│   ├── providers/        ← AI provider adapters: base, deepseek, gemini, hackerai, venice, mistral, index
│   ├── tools/            ← Tool registry (index.js) + fs, shell, net, browser, subagents tools, util
│   ├── subagents.js      ← SubagentPool: runs a task to completion in its own tab
│   ├── rateLimiter.js    ← Shared send-rate throttle across the main tab + subagent tabs
│   ├── mcp.js            ← MCP client: starts servers, registers their tools
│   ├── parser.js         ← Extracts tool calls from AI responses (several fallback formats)
│   ├── prompt.js         ← System prompt and conversation history manager
│   ├── config.js         ← Configuration loader (global + per-project)
│   ├── logger.js         ← ANSI-colored terminal output + markdown rendering
│   ├── ui.js             ← Persistent bottom input box and command menu
│   ├── calibrate.js      ← DOM selector inspector
│   └── postinstall.js    ← Auto-downloads Chromium after npm install
├── test/                 ← node:test unit tests (npm test)
├── CHANGELOG.md
├── LICENSE
├── README.md
└── package.json
```

---

## 🤝 Contributing

Contributions are very welcome — there's plenty of room to grow.

### Setting up locally

```bash
git clone https://github.com/JustGimli/gole
cd gole
npm install          # also downloads Chromium
npm test
node src/index.js --interactive
```

### Areas that need work

- 🧪 **Tests** — parser, file/shell tools, `read_url` and the MCP client are covered; browser tools, the agent loop and subagents need tests
- 🎨 **UI selector resilience** — DeepSeek updates their UI occasionally; better selector strategies are welcome
- 🔌 **More tools** — image generation, database tools, MCP over HTTP, etc.
- 🌐 **Other AI frontends** — adapting the browser layer to work with other free AI chats
- 📦 **Windows support** — file search no longer needs `find` / `grep`, but it is still only tested on Linux
- 📝 **Better error messages** — making failures easier to diagnose

### How to contribute

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-improvement`
3. Make your changes
4. Open a Pull Request with a clear description

Please keep PRs focused — one feature or fix per PR makes review much faster.

### Reporting bugs

Open an issue on GitHub with:
- What you ran
- What you expected
- What actually happened
- Output of `gole --debug "your task"` if relevant

---

## ⚠️ Disclaimer

This project automates a web browser to interact with chat.deepseek.com. Automating web UIs may violate the terms of service of the website being automated. Use this tool for **personal and development purposes only**. The agent can run arbitrary shell commands and modify files in your working directory — run it in projects you can restore (e.g. under git). The authors take no responsibility for account suspensions, data loss or other consequences of use. Not affiliated with DeepSeek.

---

## 📄 License

MIT — see [LICENSE](./LICENSE). Original work © Omar Azam; modifications © JustGimli.

---

<div align="center">

**Built with Playwright · Powered by DeepSeek**

If this project helped you, consider giving it a ⭐ on GitHub!

</div>
