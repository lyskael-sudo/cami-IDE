import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow, WebContents } from 'electron'
import type { GoleChatEvent, GolePreferences } from '../preload'

interface PendingPrompt {
  id: string
  text: string
}

interface WorkerMessage {
  type: string
  [key: string]: unknown
}

interface CompanionBounds {
  x: number
  y: number
  width: number
  height: number
}

interface CompanionLayout {
  appBounds: CompanionBounds
  companionBounds: CompanionBounds
  restoreBounds: CompanionBounds
  restoreMaximized: boolean
}

const MAX_PROMPT_LENGTH = 8_000
const MAX_PENDING_PROMPTS = 10

export class GoleChatManager {
  private child: ChildProcess | null = null
  private owner: WebContents | null = null
  private workspacePath: string | null = null
  private bridgePath: string | null = null
  private webkitBinary: string | null = null
  private goleHome: string | null = null
  private browser: GolePreferences['browser'] | null = null
  private ai: GolePreferences['ai'] | null = null
  private ownerWindow: BrowserWindow | null = null
  private restoreBounds: CompanionBounds | null = null
  private restoreMaximized = false
  private ready = false
  private workerReportedError = false
  private pendingPrompts: PendingPrompt[] = []
  private ownerDestroyedListener: (() => void) | null = null

  send(
    window: BrowserWindow,
    workspacePath: string,
    bridgePath: string,
    webkitBinary: string | null,
    goleHome: string,
    preferences: GolePreferences,
    getLayout: () => CompanionLayout | null,
    text: unknown
  ): void {
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > MAX_PROMPT_LENGTH) {
      throw new Error('Le message Gole doit contenir entre 1 et 8 000 caractères.')
    }

    const owner = window.webContents
    if (
      this.child &&
      (this.owner !== owner ||
        this.workspacePath !== workspacePath ||
        this.bridgePath !== bridgePath ||
        this.webkitBinary !== webkitBinary ||
        this.goleHome !== goleHome ||
        this.browser !== preferences.browser ||
        this.ai !== preferences.ai)
    ) {
      this.dispose()
    }

    if (!this.child) {
      this.start(
        window,
        workspacePath,
        bridgePath,
        webkitBinary,
        goleHome,
        preferences,
        getLayout()
      )
    }

    if (this.pendingPrompts.length >= MAX_PENDING_PROMPTS) {
      throw new Error('La file d’attente Gole est pleine.')
    }

    const prompt = { id: randomUUID(), text: text.trim() }
    this.pendingPrompts.push(prompt)
    this.flushPrompts()
  }

  stop(owner: WebContents): void {
    if (this.owner !== owner || !this.child?.connected) {
      return
    }

    this.child.send({ type: 'stop' })
  }

  dispose(): void {
    const child = this.child
    const ownerWindow = this.ownerWindow
    const restoreBounds = this.restoreBounds
    const restoreMaximized = this.restoreMaximized
    this.detachOwnerListener()
    this.child = null
    this.owner = null
    this.ownerWindow = null
    this.restoreBounds = null
    this.restoreMaximized = false
    this.workspacePath = null
    this.bridgePath = null
    this.webkitBinary = null
    this.goleHome = null
    this.browser = null
    this.ai = null
    this.ready = false
    this.workerReportedError = false
    this.pendingPrompts = []

    if (ownerWindow && !ownerWindow.isDestroyed() && restoreBounds) {
      ownerWindow.setBounds(restoreBounds)
      if (restoreMaximized) {
        ownerWindow.maximize()
      }
    }

    if (!child || child.killed || !child.connected) {
      return
    }

    child.send({ type: 'shutdown' }, (error) => {
      if (error) {
        console.warn('[Cami] Arrêt gracieux de Gole impossible :', error)
        child.kill()
      }
    })
    const timeout = setTimeout(() => {
      if (!child.killed) {
        child.kill()
      }
    }, 5_000)
    timeout.unref()
  }

  private start(
    window: BrowserWindow,
    workspacePath: string,
    bridgePath: string,
    webkitBinary: string | null,
    goleHome: string,
    preferences: GolePreferences,
    layout: CompanionLayout | null
  ): void {
    const owner = window.webContents
    if (layout) {
      if (window.isMaximized()) {
        window.unmaximize()
      }
      window.setBounds(layout.appBounds)
    }

    const nodeExecutable = process.env.NODE?.trim()
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CAMI_GOLE_HOME: goleHome,
      CAMI_GOLE_BROWSER: preferences.browser,
      CAMI_GOLE_AI: preferences.ai
    }
    if (layout) {
      childEnv.CAMI_COMPANION_X = String(layout.companionBounds.x)
      childEnv.CAMI_COMPANION_Y = String(layout.companionBounds.y)
      childEnv.CAMI_COMPANION_WIDTH = String(layout.companionBounds.width)
      childEnv.CAMI_COMPANION_HEIGHT = String(layout.companionBounds.height)
    } else {
      delete childEnv.CAMI_COMPANION_X
      delete childEnv.CAMI_COMPANION_Y
      delete childEnv.CAMI_COMPANION_WIDTH
      delete childEnv.CAMI_COMPANION_HEIGHT
    }
    if (webkitBinary) {
      childEnv.GOLE_WEBKIT_BINARY = webkitBinary
    } else {
      delete childEnv.GOLE_WEBKIT_BINARY
    }
    if (!nodeExecutable) {
      childEnv.ELECTRON_RUN_AS_NODE = '1'
    }

    const child = fork(bridgePath, [], {
      cwd: workspacePath,
      execArgv: [],
      execPath: nodeExecutable || process.execPath,
      env: childEnv,
      silent: true
    })

    this.child = child
    this.owner = owner
    this.ownerWindow = layout ? window : null
    this.restoreBounds = layout?.restoreBounds ?? null
    this.restoreMaximized = layout?.restoreMaximized ?? false
    this.workspacePath = workspacePath
    this.bridgePath = bridgePath
    this.webkitBinary = webkitBinary
    this.goleHome = goleHome
    this.browser = preferences.browser
    this.ai = preferences.ai
    this.ready = false
    this.ownerDestroyedListener = () => this.dispose()
    owner.once('destroyed', this.ownerDestroyedListener)
    child.stdout?.resume()
    child.stderr?.resume()

    child.on('message', (message: unknown) => {
      if (this.child !== child || !message || typeof message !== 'object') {
        return
      }

      this.handleMessage(message as WorkerMessage)
    })
    child.on('error', (error) => {
      if (this.child !== child) {
        return
      }
      this.workerReportedError = true
      this.emit({ type: 'error', requestId: null, message: error.message })
      this.dispose()
    })
    child.on('exit', (code, signal) => {
      if (this.child !== child) {
        return
      }
      if (code !== 0 && code !== null && !this.workerReportedError) {
        this.emit({
          type: 'error',
          requestId: null,
          message: `Gole s’est arrêté avec le code ${code}${signal ? ` (${signal})` : ''}.`
        })
      }
      this.dispose()
    })

    child.send({ type: 'start', workspacePath }, (error) => {
      if (error && this.child === child) {
        this.workerReportedError = true
        this.emit({ type: 'error', requestId: null, message: error.message })
        this.dispose()
      }
    })
  }

  private handleMessage(message: WorkerMessage): void {
    if (message.type === 'state' && message.state === 'ready') {
      this.ready = true
    }
    if (message.type === 'error') {
      this.workerReportedError = true
    }
    this.emit(message as GoleChatEvent)
    if (message.type === 'state' && message.state === 'ready') {
      this.flushPrompts()
    }
  }

  private flushPrompts(): void {
    if (!this.ready || !this.child?.connected) {
      return
    }

    while (this.pendingPrompts.length > 0) {
      const prompt = this.pendingPrompts.shift()
      if (prompt) {
        this.child.send({ type: 'prompt', ...prompt })
      }
    }
  }

  private emit(event: GoleChatEvent): void {
    const owner = this.owner
    if (owner && !owner.isDestroyed()) {
      owner.send('gole-chat:event', event)
    }
  }

  private detachOwnerListener(): void {
    if (this.owner && this.ownerDestroyedListener) {
      this.owner.removeListener('destroyed', this.ownerDestroyedListener)
    }
    this.ownerDestroyedListener = null
  }
}
