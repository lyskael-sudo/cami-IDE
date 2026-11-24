import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type {
  DebugBreakpointFile,
  DebugBreakpointInput,
  DebugConfiguration,
  DebugConfigurationList,
  DebugEvaluateResult,
  DebugEvent,
  DebugScope,
  DebugSessionState,
  DebugStackFrame,
  DebugVariable,
  DebugVerifiedBreakpoint
} from '../preload'
import { parseJsonc } from './jsonc'
import { childEnvironment, findExecutable } from './processUtils'

const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_BREAKPOINTS_PER_FILE = 500
const MAX_STACK_FRAMES = 200
const MAX_VARIABLES = 500
const MAX_CONSOLE_TEXT = 32_000
const REQUEST_TIMEOUT_MS = 20_000
const START_TIMEOUT_MS = 60_000

interface NormalizedBreakpoint {
  line: number
  column: number
}

interface NormalizedBreakpointFile {
  path: string
  breakpoints: NormalizedBreakpoint[]
}

interface DebugSessionCallbacks {
  onStopped: (reason: string, description: string | null, threadId: number | null) => void
  onContinued: () => void
  onConsole: (category: 'stdout' | 'stderr' | 'console' | 'system', text: string) => void
  onTerminated: (exitCode: number | null) => void
  onBreakpoints: (breakpoints: DebugVerifiedBreakpoint[]) => void
}

interface DebugSession {
  readonly name: string
  start(breakpoints: NormalizedBreakpointFile[]): Promise<DebugVerifiedBreakpoint[]>
  stop(): Promise<void>
  continue(): Promise<void>
  pause(): Promise<void>
  next(): Promise<void>
  stepIn(): Promise<void>
  stepOut(): Promise<void>
  setBreakpoints(
    filePath: string,
    breakpoints: NormalizedBreakpoint[]
  ): Promise<DebugVerifiedBreakpoint[]>
  stackTrace(): Promise<DebugStackFrame[]>
  scopes(frameId: number): Promise<DebugScope[]>
  variables(reference: number): Promise<DebugVariable[]>
  evaluate(expression: string, frameId: number | null): Promise<DebugEvaluateResult>
}

interface RawLaunchConfiguration {
  name?: unknown
  type?: unknown
  request?: unknown
  program?: unknown
  args?: unknown
  cwd?: unknown
  env?: unknown
  runtime?: unknown
  runtimeExecutable?: unknown
  runtimeArgs?: unknown
  stopOnEntry?: unknown
  pauseOnExceptions?: unknown
  adapterCommand?: unknown
  adapterArgs?: unknown
  adapterEnv?: unknown
}

interface LaunchFile {
  configurations?: unknown
}

interface CdpRemoteObject {
  type?: string
  subtype?: string
  value?: unknown
  unserializableValue?: string
  description?: string
  objectId?: string
  preview?: {
    description?: string
    overflow?: boolean
    properties?: Array<{
      name?: string
      type?: string
      value?: string
      subtype?: string
    }>
  }
}

interface CdpPropertyDescriptor {
  name?: string
  value?: CdpRemoteObject
  get?: CdpRemoteObject
  set?: CdpRemoteObject
  symbol?: unknown
}

interface CdpCallFrame {
  callFrameId: string
  functionName: string
  url: string
  location: {
    scriptId: string
    lineNumber: number
    columnNumber: number
  }
  scopeChain: Array<{
    type: string
    name?: string
    object: CdpRemoteObject
  }>
}

interface CdpPausedPayload {
  callFrames?: CdpCallFrame[]
  reason?: string
  data?: {
    description?: string
    value?: unknown
    type?: string
  }
  hitBreakpoints?: string[]
}

interface DapStackFrame {
  id?: number
  name?: string
  source?: {
    path?: string
    name?: string
  }
  line?: number
  column?: number
}

interface DapBreakpoint {
  verified?: boolean
  line?: number
  column?: number
  message?: string
  source?: {
    path?: string
  }
}

interface DapMessage {
  seq?: number
  type?: string
  request_seq?: number
  success?: boolean
  command?: string
  message?: string
  body?: unknown
  event?: string
}

type SendDebugEvent = (event: DebugEvent) => void

function pathIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readStringArray(value: unknown, maximum = 256): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter(
      (entry): entry is string =>
        typeof entry === 'string' && entry.length <= 8_192 && !entry.includes('\0')
    )
    .slice(0, maximum)
}

function readStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) {
    return {}
  }
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (
      key.length > 0 &&
      key.length <= 256 &&
      typeof entry === 'string' &&
      entry.length <= 16_384 &&
      !key.includes('\0') &&
      !entry.includes('\0')
    ) {
      result[key] = entry
    }
  }
  return result
}

function truncate(value: string, maximum = MAX_CONSOLE_TEXT): string {
  return value.length > maximum ? `${value.slice(0, maximum)}…` : value
}

function expandLaunchString(
  value: string,
  root: string,
  activeFile: string | null = null
): string {
  return value.replace(/\$\{([^{}]+)\}/g, (match, expression: string) => {
    switch (expression) {
      case 'workspaceFolder':
      case 'workspaceRoot':
      case 'cwd':
        return root
      case 'workspaceFolderBasename':
        return path.basename(root)
      case 'file':
        return activeFile ?? match
      case 'relativeFile':
        return activeFile
          ? path.relative(root, activeFile).split(path.sep).join('/')
          : match
      case 'relativeFileDirname':
        return activeFile
          ? path.relative(root, path.dirname(activeFile)).split(path.sep).join('/')
          : match
      case 'fileBasename':
        return activeFile ? path.basename(activeFile) : match
      case 'fileDirname':
        return activeFile ? path.dirname(activeFile) : match
      case 'fileExtname':
        return activeFile ? path.extname(activeFile) : match
      case 'fileBasenameNoExtension':
        return activeFile ? path.basename(activeFile, path.extname(activeFile)) : match
      default:
        if (expression.startsWith('env:')) {
          return process.env[expression.slice(4)] ?? ''
        }
        return match
    }
  })
}

function expandLaunchValue(
  value: unknown,
  root: string,
  activeFile: string | null = null,
  depth = 0
): unknown {
  if (depth > 20) {
    return value
  }
  if (typeof value === 'string') {
    return expandLaunchString(value, root, activeFile)
  }
  if (Array.isArray(value)) {
    return value.map((entry) => expandLaunchValue(entry, root, activeFile, depth + 1))
  }
  const record = asRecord(value)
  if (record) {
    const expanded: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(record)) {
      expanded[key] = expandLaunchValue(entry, root, activeFile, depth + 1)
    }
    return expanded
  }
  return value
}

function normalizeBreakpoints(
  root: string,
  files: DebugBreakpointFile[]
): NormalizedBreakpointFile[] {
  const seenPaths = new Set<string>()
  const normalized: NormalizedBreakpointFile[] = []

  for (const file of files.slice(0, 2_000)) {
    if (!file || typeof file.path !== 'string' || !Array.isArray(file.breakpoints)) {
      continue
    }

    const filePath = path.resolve(file.path)
    if (!pathIsInside(root, filePath) || seenPaths.has(filePath)) {
      continue
    }
    seenPaths.add(filePath)

    const seenLocations = new Set<string>()
    const breakpoints: NormalizedBreakpoint[] = []
    for (const input of file.breakpoints.slice(0, MAX_BREAKPOINTS_PER_FILE)) {
      if (!input || typeof input !== 'object') {
        continue
      }
      const line = input.line
      const column = input.column
      if (
        !Number.isInteger(line) ||
        (line as number) < 1 ||
        (line as number) > 10_000_000 ||
        (column !== undefined &&
          (!Number.isInteger(column) || column < 1 || column > 10_000_000))
      ) {
        continue
      }
      const normalizedColumn = typeof column === 'number' ? column : 1
      const key = `${line}:${normalizedColumn}`
      if (seenLocations.has(key)) {
        continue
      }
      seenLocations.add(key)
      breakpoints.push({ line: line as number, column: normalizedColumn })
    }

    normalized.push({ path: filePath, breakpoints })
  }

  return normalized
}

function resolveSourcePath(root: string, url: string | undefined): string | null {
  if (!url) {
    return null
  }
  try {
    const filePath = url.startsWith('file:')
      ? fileURLToPath(url)
      : path.isAbsolute(url)
        ? url
        : null
    if (!filePath) {
      return null
    }
    const resolved = path.resolve(filePath)
    return pathIsInside(root, resolved) ? resolved : null
  } catch {
    return null
  }
}

function relativePathOf(root: string, filePath: string | null): string | null {
  if (!filePath) {
    return null
  }
  return path.relative(root, filePath).split(path.sep).join('/')
}

function frameLocation(
  frame: CdpCallFrame,
  root: string,
  scriptUrl?: string
): {
  path: string | null
  relativePath: string | null
  line: number
  column: number
} {
  const sourcePath = resolveSourcePath(root, frame.url || scriptUrl)
  return {
    path: sourcePath,
    relativePath: relativePathOf(root, sourcePath),
    line: frame.location.lineNumber + 1,
    column: frame.location.columnNumber + 1
  }
}

function formatRemoteObject(value: CdpRemoteObject | undefined): string {
  if (!value) {
    return 'undefined'
  }
  if (value.type === 'undefined') {
    return 'undefined'
  }
  if (value.type === 'string') {
    return truncate(String(value.value ?? ''), 8_000)
  }
  if (value.type === 'number' || value.type === 'boolean' || value.type === 'bigint') {
    return truncate(
      String(value.value ?? value.unserializableValue ?? value.description ?? value.type),
      8_000
    )
  }
  if (value.type === 'symbol') {
    return truncate(value.description ?? 'Symbol()', 8_000)
  }
  if (value.type === 'function') {
    return truncate(value.description ?? 'function', 8_000)
  }
  if (value.subtype === 'null') {
    return 'null'
  }
  if (value.subtype === 'error') {
    return truncate(value.description ?? 'Error', 8_000)
  }

  const preview = value.preview
  if (preview?.properties && preview.properties.length > 0) {
    const entries = preview.properties.slice(0, 12).map((property) => {
      const name = property.name ?? '?'
      const propertyValue = property.value ?? property.type ?? ''
      return `${name}: ${propertyValue}`
    })
    const suffix = preview.overflow || preview.properties.length > 12 ? ', …' : ''
    if (preview.description) {
      const bracket = preview.description.match(/^([A-Za-z0-9_$.[\]]+)/)?.[1] ?? preview.description
      return truncate(`${bracket} { ${entries.join(', ')}${suffix} }`, 8_000)
    }
    return truncate(`{ ${entries.join(', ')}${suffix} }`, 8_000)
  }

  return truncate(value.description ?? 'objet', 8_000)
}

class CdpClient {
  private readonly socket: WebSocket
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (reason: Error) => void
      timer: NodeJS.Timeout
    }
  >()
  private nextId = 1
  private closed = false
  onEvent: ((method: string, params: unknown) => void) | null = null
  onClose: (() => void) | null = null

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.addEventListener('message', (event) => {
      this.handleMessage(event.data)
    })
    socket.addEventListener('error', () => {
      this.rejectAll(new Error('La connexion au débogueur Node a échoué.'))
    })
    socket.addEventListener('close', () => {
      this.closed = true
      this.rejectAll(new Error('La session de débogage Node est terminée.'))
      this.onClose?.()
    })
  }

  static connect(url: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      let socket: WebSocket
      try {
        socket = new WebSocket(url)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }

      const timer = setTimeout(() => {
        try {
          socket.close()
        } catch {
          // Ignore a socket that is already closing.
        }
        reject(new Error('La connexion au débogueur Node a expiré.'))
      }, 15_000)
      timer.unref()

      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolve(new CdpClient(socket))
      })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('La connexion au débogueur Node a échoué.'))
      })
    })
  }

  request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeout = REQUEST_TIMEOUT_MS
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('La session de débogage est terminée.'))
    }
    const id = this.nextId
    this.nextId += 1

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Le débogueur Node ne répond pas à « ${method} ».`))
      }, timeout)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    try {
      this.socket.close()
    } catch {
      // Ignore a socket that is already closed.
    }
    this.rejectAll(new Error('La session de débogage est terminée.'))
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
  }

  private handleMessage(data: unknown): void {
    const text =
      typeof data === 'string'
        ? data
        : data instanceof ArrayBuffer
          ? Buffer.from(data).toString('utf8')
          : null
    if (!text) {
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    const message = asRecord(parsed)
    if (!message) {
      return
    }

    if (typeof message.method === 'string') {
      this.onEvent?.(message.method, message.params)
      return
    }

    const id = typeof message.id === 'number' ? message.id : null
    if (id === null) {
      return
    }
    const request = this.pending.get(id)
    if (!request) {
      return
    }
    this.pending.delete(id)
    clearTimeout(request.timer)
    if (message.error) {
      const errorRecord = asRecord(message.error)
      request.reject(
        new Error(
          typeof errorRecord?.message === 'string'
            ? errorRecord.message
            : 'Erreur du débogueur Node.'
        )
      )
      return
    }
    request.resolve(message.result)
  }
}

class NodeInspectorSession implements DebugSession {
  readonly name: string
  private readonly root: string
  private readonly config: DebugConfiguration
  private readonly callbacks: DebugSessionCallbacks
  private readonly child: ChildProcess
  private readonly breakpointIds = new Map<string, string[]>()
  private readonly scriptUrls = new Map<string, string>()
  private cdp: CdpClient | null = null
  private callFrames: CdpCallFrame[] = []
  private variablesHandles = new Map<number, string>()
  private nextVariablesHandle = 1
  private stopped = false
  private ended = false
  private initialPauseHandled = false
  private stderrBuffer = ''
  private stdoutTail = ''
  private disconnectRequested = false
  private debuggerUrlPromise: Promise<string>
  private resolveDebuggerUrl: ((url: string) => void) | null = null
  private rejectDebuggerUrl: ((error: Error) => void) | null = null

  private constructor(
    root: string,
    config: DebugConfiguration,
    callbacks: DebugSessionCallbacks
  ) {
    this.root = root
    this.config = config
    this.callbacks = callbacks
    this.name = config.name

    const program = config.program
    if (!program) {
      throw new Error('Aucun programme n’est défini pour cette configuration Node.js.')
    }

    const cwd = config.cwd ?? root
    const runtime = config.runtime ?? process.execPath
    const runtimeArgs = config.runtimeArgs.filter((arg) => !arg.startsWith('--inspect'))
    const useElectronRuntime = runtime === process.execPath
    const environment: NodeJS.ProcessEnv = {
      ...childEnvironment(),
      ...config.env
    }
    if (useElectronRuntime) {
      environment.ELECTRON_RUN_AS_NODE = '1'
    }

    this.debuggerUrlPromise = new Promise<string>((resolve, reject) => {
      this.resolveDebuggerUrl = resolve
      this.rejectDebuggerUrl = reject
    })

    this.child = spawn(
      runtime,
      [
        ...runtimeArgs,
        '--inspect-brk=127.0.0.1:0',
        '--enable-source-maps',
        program,
        ...config.args
      ],
      {
        cwd,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32'
      }
    )
    this.child.stdout?.setEncoding('utf8')
    this.child.stderr?.setEncoding('utf8')
    this.child.stdout?.on('data', (text: string) => {
      const combined = this.stdoutTail + text
      this.stdoutTail = combined.slice(-160)
      if (
        combined.includes('Waiting for the debugger to disconnect') &&
        !this.disconnectRequested
      ) {
        this.disconnectRequested = true
        this.detachAfterCompletion()
      }
      callbacks.onConsole('stdout', text)
    })
    this.child.stderr?.on('data', (text: string) => {
      this.handleStderr(text)
    })
    this.child.on('error', (error) => {
      this.rejectDebuggerUrl?.(
        new Error(`Impossible de lancer le programme Node.js : ${error.message}`)
      )
      callbacks.onConsole('stderr', `${error.message}\n`)
      this.emitTerminated(null)
    })
    this.child.on('close', (exitCode) => {
      if (!this.ended) {
        this.ended = true
        this.rejectDebuggerUrl?.(new Error('Le programme Node.js s’est arrêté avant le débogage.'))
        if (!this.stopped) {
          this.callbacks.onConsole(
            'system',
            exitCode === 0
              ? '\nLe programme est terminé.\n'
              : `\nLe programme s’est arrêté avec le code ${exitCode ?? 'inconnu'}.\n`
          )
          this.callbacks.onTerminated(exitCode)
        }
      }
      this.cdp?.close()
    })
  }

  static async create(
    root: string,
    config: DebugConfiguration,
    callbacks: DebugSessionCallbacks
  ): Promise<NodeInspectorSession> {
    const session = new NodeInspectorSession(root, config, callbacks)
    await session.connectToDebugger()
    return session
  }

  private handleStderr(text: string): void {
    this.stderrBuffer += text
    const lines = this.stderrBuffer.split(/\r?\n/)
    this.stderrBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const match = /(ws:\/\/[^\s]+)/.exec(line)
      if (match?.[1] && !this.cdp) {
        this.resolveDebuggerUrl?.(match[1])
        this.resolveDebuggerUrl = null
        this.rejectDebuggerUrl = null
        continue
      }
      if (
        line.includes('Waiting for the debugger to disconnect') &&
        !this.disconnectRequested
      ) {
        this.disconnectRequested = true
        this.detachAfterCompletion()
      }
      if (line.trim()) {
        this.callbacks.onConsole('stderr', `${line}\n`)
      }
    }
  }

  private detachAfterCompletion(): void {
    if (this.stopped || this.ended) {
      return
    }
    const cdp = this.cdp
    this.cdp = null
    cdp?.close()
  }

  private async connectToDebugger(): Promise<void> {
    let debuggerUrl: string
    try {
      debuggerUrl = await Promise.race([
        this.debuggerUrlPromise,
        new Promise<string>((_resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Le port du débogueur Node.js n’a pas été détecté.')),
            15_000
          )
          timer.unref()
        })
      ])
    } catch (error) {
      this.forceStop()
      throw error
    }

    const cdp = await CdpClient.connect(debuggerUrl)
    this.cdp = cdp
    cdp.onEvent = (method, params) => {
      this.handleEvent(method, params)
    }
    cdp.onClose = () => {
      if (!this.stopped && !this.ended) {
        this.ended = true
        this.callbacks.onTerminated(null)
      }
    }
  }

  async start(breakpoints: NormalizedBreakpointFile[]): Promise<DebugVerifiedBreakpoint[]> {
    const cdp = this.cdp
    if (!cdp) {
      throw new Error('La connexion au débogueur Node.js a échoué.')
    }

    try {
      await Promise.all([
        cdp.request('Runtime.enable'),
        cdp.request('Debugger.enable')
      ])
      await cdp.request('Debugger.setPauseOnExceptions', {
        state: this.config.pauseOnExceptions ? 'uncaught' : 'none'
      })
      const verified = await this.applyAllBreakpoints(breakpoints)
      await cdp.request('Runtime.runIfWaitingForDebugger')
      return verified
    } catch (error) {
      this.forceStop()
      throw error
    }
  }

  private async applyAllBreakpoints(
    files: NormalizedBreakpointFile[]
  ): Promise<DebugVerifiedBreakpoint[]> {
    const results: DebugVerifiedBreakpoint[] = []
    for (const file of files) {
      results.push(...(await this.applyBreakpointsForFile(file.path, file.breakpoints)))
    }
    return results
  }

  private async applyBreakpointsForFile(
    filePath: string,
    breakpoints: NormalizedBreakpoint[]
  ): Promise<DebugVerifiedBreakpoint[]> {
    const cdp = this.cdp
    if (!cdp) {
      return breakpoints.map((breakpoint) => ({
        path: filePath,
        line: breakpoint.line,
        column: breakpoint.column,
        verified: false
      }))
    }

    const previousIds = this.breakpointIds.get(filePath) ?? []
    for (const id of previousIds) {
      try {
        await cdp.request('Debugger.removeBreakpoint', { breakpointId: id })
      } catch {
        // A stale breakpoint can be ignored.
      }
    }

    const ids: string[] = []
    const results: DebugVerifiedBreakpoint[] = []
    for (const breakpoint of breakpoints.slice(0, MAX_BREAKPOINTS_PER_FILE)) {
      try {
        const response = await cdp.request<{ breakpointId?: string }>(
          'Debugger.setBreakpointByUrl',
          {
            lineNumber: breakpoint.line - 1,
            columnNumber: Math.max(0, breakpoint.column - 1),
            url: pathToFileURL(filePath).href
          }
        )
        if (response.breakpointId) {
          ids.push(response.breakpointId)
        }
        results.push({
          path: filePath,
          line: breakpoint.line,
          column: breakpoint.column,
          verified: true
        })
      } catch {
        results.push({
          path: filePath,
          line: breakpoint.line,
          column: breakpoint.column,
          verified: false
        })
      }
    }

    if (ids.length > 0) {
      this.breakpointIds.set(filePath, ids)
    } else {
      this.breakpointIds.delete(filePath)
    }
    return results
  }

  async setBreakpoints(
    filePath: string,
    breakpoints: NormalizedBreakpoint[]
  ): Promise<DebugVerifiedBreakpoint[]> {
    const results = await this.applyBreakpointsForFile(filePath, breakpoints)
    this.callbacks.onBreakpoints(results)
    return results
  }

  async continue(): Promise<void> {
    await this.cdp?.request('Debugger.resume')
  }

  async pause(): Promise<void> {
    await this.cdp?.request('Debugger.pause')
  }

  async next(): Promise<void> {
    await this.cdp?.request('Debugger.stepOver')
  }

  async stepIn(): Promise<void> {
    await this.cdp?.request('Debugger.stepInto')
  }

  async stepOut(): Promise<void> {
    await this.cdp?.request('Debugger.stepOut')
  }

  async stackTrace(): Promise<DebugStackFrame[]> {
    return this.callFrames.slice(0, MAX_STACK_FRAMES).map((frame, index) => {
      const location = frameLocation(
        frame,
        this.root,
        this.scriptUrls.get(frame.location.scriptId)
      )
      return {
        id: index,
        name: frame.functionName || '(fonction anonyme)',
        path: location.path,
        relativePath: location.relativePath,
        line: location.line,
        column: location.column
      }
    })
  }

  async scopes(frameId: number): Promise<DebugScope[]> {
    const frame = this.callFrames[frameId]
    if (!frame) {
      return []
    }

    const names: Record<string, string> = {
      local: 'Variables locales',
      closure: 'Closure',
      global: 'Global',
      block: 'Bloc',
      script: 'Script',
      eval: 'Évaluation',
      catch: 'Catch',
      with: 'Avec',
      module: 'Module'
    }

    const scopes: DebugScope[] = []
    for (const scope of frame.scopeChain) {
      if (!scope.object?.objectId) {
        continue
      }
      scopes.push({
        name: names[scope.type] ?? scope.type,
        variablesReference: this.allocateHandle(scope.object.objectId),
        expensive: scope.type === 'global'
      })
    }
    return scopes
  }

  async variables(reference: number): Promise<DebugVariable[]> {
    const cdp = this.cdp
    const objectId = this.variablesHandles.get(reference)
    if (!cdp || !objectId) {
      return []
    }

    try {
      const result = await cdp.request<{ result?: CdpPropertyDescriptor[] }>(
        'Runtime.getProperties',
        {
          objectId,
          ownProperties: true,
          accessorPropertiesOnly: false,
          generatePreview: true,
          nonIndexedPropertiesOnly: false
        }
      )
      const properties = Array.isArray(result.result) ? result.result : []
      const variables: DebugVariable[] = []
      for (const property of properties.slice(0, MAX_VARIABLES)) {
        if (!property.name || property.symbol) {
          continue
        }
        const value = property.value ?? property.get
        if (!value) {
          continue
        }
        variables.push({
          name: truncate(property.name, 1_000),
          value: formatRemoteObject(value),
          type: value.subtype ? `${value.type ?? 'object'} (${value.subtype})` : (value.type ?? null),
          variablesReference: value.objectId ? this.allocateHandle(value.objectId) : 0
        })
      }
      if (properties.length > MAX_VARIABLES) {
        variables.push({
          name: '…',
          value: `${properties.length - MAX_VARIABLES} propriétés supplémentaires`,
          type: null,
          variablesReference: 0
        })
      }
      return variables
    } catch {
      return []
    }
  }

  async evaluate(expression: string, frameId: number | null): Promise<DebugEvaluateResult> {
    const cdp = this.cdp
    if (!cdp) {
      throw new Error('Aucune session de débogage active.')
    }
    const trimmed = expression.trim()
    if (!trimmed) {
      return { value: '', type: null, variablesReference: 0 }
    }
    if (trimmed.length > 32_000) {
      throw new Error('Expression trop longue.')
    }

    const frame = frameId === null ? null : this.callFrames[frameId]
    const result = frame
      ? await cdp.request<{ result?: CdpRemoteObject; exceptionDetails?: unknown }>(
          'Debugger.evaluateOnCallFrame',
          {
            callFrameId: frame.callFrameId,
            expression: trimmed,
            returnByValue: false,
            generatePreview: true,
            silent: false
          }
        )
      : await cdp.request<{ result?: CdpRemoteObject; exceptionDetails?: unknown }>(
          'Runtime.evaluate',
          {
            expression: trimmed,
            returnByValue: false,
            generatePreview: true,
            awaitPromise: true,
            silent: false
          }
        )

    const remote = result.result
    if (result.exceptionDetails && remote?.description) {
      throw new Error(remote.description.slice(0, 8_000))
    }
    return {
      value: formatRemoteObject(remote),
      type: remote?.subtype ? `${remote.type ?? 'object'} (${remote.subtype})` : (remote?.type ?? null),
      variablesReference: remote?.objectId ? this.allocateHandle(remote.objectId) : 0
    }
  }

  private allocateHandle(objectId: string): number {
    const reference = this.nextVariablesHandle
    this.nextVariablesHandle += 1
    this.variablesHandles.set(reference, objectId)
    return reference
  }

  private handleEvent(method: string, params: unknown): void {
    if (method === 'Debugger.scriptParsed') {
      const payload = asRecord(params)
      if (
        typeof payload?.scriptId === 'string' &&
        typeof payload.url === 'string' &&
        payload.url.length > 0 &&
        this.scriptUrls.size < 20_000
      ) {
        this.scriptUrls.set(payload.scriptId, payload.url)
      }
      return
    }

    if (method === 'Debugger.paused') {
      const payload = asRecord(params) as CdpPausedPayload | null
      this.callFrames = Array.isArray(payload?.callFrames) ? payload.callFrames : []
      this.variablesHandles.clear()
      const hitBreakpoints = Array.isArray(payload?.hitBreakpoints)
        ? payload.hitBreakpoints
        : []
      const reason = typeof payload?.reason === 'string' ? payload.reason : 'pause'

      if (
        !this.initialPauseHandled &&
        !this.config.stopOnEntry &&
        hitBreakpoints.length === 0 &&
        reason !== 'exception' &&
        reason !== 'promiseRejection'
      ) {
        this.initialPauseHandled = true
        void this.cdp?.request('Debugger.resume').catch(() => {
          // The program may have exited during the automatic resume.
        })
        return
      }

      this.initialPauseHandled = true
      const rawDescription = payload?.data?.description
      const rawValue = payload?.data?.value
      const description =
        typeof rawDescription === 'string'
          ? rawDescription.slice(0, 4_000)
          : typeof rawValue === 'string'
            ? rawValue.slice(0, 4_000)
            : null
      this.callbacks.onStopped(reason, description, 1)
      return
    }

    if (method === 'Debugger.resumed') {
      this.callbacks.onContinued()
      return
    }

    if (method === 'Runtime.exceptionThrown') {
      const payload = asRecord(params)
      const details = asRecord(payload?.exceptionDetails)
      const exception = asRecord(details?.exception)
      const text =
        typeof exception?.description === 'string'
          ? exception.description
          : typeof details?.text === 'string'
            ? details.text
            : 'Exception JavaScript.'
      this.callbacks.onConsole('stderr', `${text.slice(0, 8_000)}\n`)
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.ended = true
    this.cdp?.close()
    this.cdp = null
    this.callFrames = []
    this.variablesHandles.clear()
    this.scriptUrls.clear()
    this.killChild()
  }

  private forceStop(): void {
    this.stopped = true
    this.ended = true
    this.cdp?.close()
    this.cdp = null
    this.scriptUrls.clear()
    this.killChild()
  }

  private killChild(): void {
    const pid = this.child.pid
    if (!pid) {
      return
    }
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
      } catch {
        // The process may already be gone.
      }
      return
    }

    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try {
        this.child.kill('SIGTERM')
      } catch {
        // The process may already be gone.
      }
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try {
          this.child.kill('SIGKILL')
        } catch {
          // The process may already be gone.
        }
      }
    }, 2_000)
    timer.unref()
  }

  private emitTerminated(exitCode: number | null): void {
    if (this.ended && this.stopped) {
      return
    }
    if (this.ended) {
      return
    }
    this.ended = true
    this.callbacks.onTerminated(exitCode)
  }
}

class DapClient {
  private readonly child: ChildProcess
  private readonly pending = new Map<
    number,
    {
      resolve: (body: unknown) => void
      reject: (error: Error) => void
      timer: NodeJS.Timeout
    }
  >()
  private readonly bufferState = { buffer: Buffer.alloc(0) }
  private nextSequence = 1
  private closed = false
  onEvent: ((event: string, body: unknown) => void) | null = null
  onExit: ((exitCode: number | null) => void) | null = null
  onConsole: ((category: 'stderr' | 'system', text: string) => void) | null = null
  private stderrBuffer = ''

  constructor(command: string, args: string[], cwd: string, env: Record<string, string>) {
    this.child = spawn(command, args, {
      cwd,
      env: {
        ...childEnvironment(),
        ...env
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32'
    })
    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.receive(chunk)
    })
    this.child.stderr?.setEncoding('utf8')
    this.child.stderr?.on('data', (chunk: string) => {
      this.stderrBuffer += chunk
      const lines = this.stderrBuffer.split(/\r?\n/)
      this.stderrBuffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim()) {
          this.onConsole?.('stderr', `${line}\n`)
        }
      }
    })
    this.child.on('error', (error) => {
      this.rejectAll(new Error(`Impossible de démarrer l’adaptateur DAP : ${error.message}`))
      this.onExit?.(null)
    })
    this.child.on('close', (exitCode) => {
      this.closed = true
      this.rejectAll(new Error('L’adaptateur DAP est terminé.'))
      this.onExit?.(exitCode)
    })
  }

  request<T = unknown>(
    command: string,
    args: Record<string, unknown> = {},
    timeout = REQUEST_TIMEOUT_MS
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('L’adaptateur DAP est terminé.'))
    }
    const seq = this.nextSequence
    this.nextSequence += 1

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq)
        reject(new Error(`L’adaptateur DAP ne répond pas à « ${command} ».`))
      }, timeout)
      this.pending.set(seq, {
        resolve: (body) => resolve(body as T),
        reject,
        timer
      })
      try {
        this.write({
          seq,
          type: 'request',
          command,
          arguments: args
        })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(seq)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  stop(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.rejectAll(new Error('La session DAP est terminée.'))
    const pid = this.child.pid
    if (pid && process.platform !== 'win32') {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        try {
          this.child.kill('SIGTERM')
        } catch {
          // Ignore.
        }
      }
    } else if (pid) {
      try {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore'
        })
      } catch {
        // Ignore.
      }
    }
    const timer = setTimeout(() => {
      if (!pid) {
        return
      }
      if (process.platform !== 'win32') {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          try {
            this.child.kill('SIGKILL')
          } catch {
            // Ignore.
          }
        }
      }
    }, 2_000)
    timer.unref()
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    this.pending.clear()
  }

  private write(message: Record<string, unknown>): void {
    const body = Buffer.from(JSON.stringify(message), 'utf8')
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii')
    this.child.stdin?.write(Buffer.concat([header, body]))
  }

  private respond(request: DapMessage, body: Record<string, unknown>): void {
    this.write({
      seq: this.nextSequence++,
      type: 'response',
      request_seq: request.seq,
      success: true,
      command: request.command,
      body
    })
  }

  private respondError(request: DapMessage, message: string): void {
    this.write({
      seq: this.nextSequence++,
      type: 'response',
      request_seq: request.seq,
      success: false,
      command: request.command,
      message
    })
  }

  private receive(chunk: Buffer): void {
    this.bufferState.buffer = Buffer.concat([this.bufferState.buffer, chunk])
    if (this.bufferState.buffer.length > 32 * 1024 * 1024) {
      this.rejectAll(new Error('L’adaptateur DAP a envoyé un message trop volumineux.'))
      this.stop()
      return
    }

    while (true) {
      const headerEnd = this.bufferState.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        return
      }
      const header = this.bufferState.buffer.subarray(0, headerEnd).toString('ascii')
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        this.bufferState.buffer = this.bufferState.buffer.subarray(headerEnd + 4)
        continue
      }
      const contentLength = Number.parseInt(match[1] ?? '', 10)
      if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > 32 * 1024 * 1024) {
        this.rejectAll(new Error('Trame DAP invalide.'))
        this.stop()
        return
      }
      const messageStart = headerEnd + 4
      const messageEnd = messageStart + contentLength
      if (this.bufferState.buffer.length < messageEnd) {
        return
      }
      const payload = this.bufferState.buffer.subarray(messageStart, messageEnd).toString('utf8')
      this.bufferState.buffer = this.bufferState.buffer.subarray(messageEnd)
      this.handlePayload(payload)
    }
  }

  private handlePayload(payload: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    const message = asRecord(parsed) as DapMessage | null
    if (!message) {
      return
    }

    if (message.type === 'response') {
      const requestSeq = message.request_seq
      if (typeof requestSeq !== 'number') {
        return
      }
      const pending = this.pending.get(requestSeq)
      if (!pending) {
        return
      }
      this.pending.delete(requestSeq)
      clearTimeout(pending.timer)
      if (message.success === false) {
        pending.reject(new Error(message.message ?? `Requête DAP « ${message.command ?? ''} » refusée.`))
      } else {
        pending.resolve(message.body)
      }
      return
    }

    if (message.type === 'event' && typeof message.event === 'string') {
      this.onEvent?.(message.event, message.body)
      return
    }

    if (message.type === 'request' && typeof message.command === 'string') {
      this.handleReverseRequest(message)
    }
  }

  private handleReverseRequest(request: DapMessage): void {
    if (request.command === 'runInTerminal') {
      this.respondError(request, 'Le terminal intégré DAP n’est pas pris en charge par cette configuration.')
      return
    }
    if (request.command === 'startDebugging') {
      this.respondError(request, 'Le lancement d’une session enfant n’est pas pris en charge.')
      return
    }
    if (request.command === 'handshake') {
      this.respond(request, {})
      return
    }
    this.respondError(request, `Requête inverse DAP non prise en charge : ${request.command}`)
  }
}

class DapSession implements DebugSession {
  readonly name: string
  private readonly root: string
  private readonly config: DebugConfiguration
  private readonly callbacks: DebugSessionCallbacks
  private readonly adapterCommand: string
  private client: DapClient | null = null
  private initializedResolve: (() => void) | null = null
  private initializedPromise: Promise<void>
  private launchPromise: Promise<unknown> | null = null
  private breakpointState = new Map<string, DebugVerifiedBreakpoint[]>()
  private currentThreadId: number | null = null
  private lastExitCode: number | null = null
  private stopped = false

  private constructor(
    root: string,
    config: DebugConfiguration,
    adapterCommand: string,
    callbacks: DebugSessionCallbacks
  ) {
    this.root = root
    this.config = config
    this.adapterCommand = adapterCommand
    this.callbacks = callbacks
    this.name = config.name
    this.initializedPromise = new Promise<void>((resolve) => {
      this.initializedResolve = resolve
    })
  }

  static async create(
    root: string,
    config: DebugConfiguration,
    callbacks: DebugSessionCallbacks
  ): Promise<DapSession> {
    if (!config.adapterCommand) {
      throw new Error('Aucune commande d’adaptateur DAP n’est configurée.')
    }

    const rawCommand = config.adapterCommand
    const cwd = config.cwd ?? root
    const adapterCommand =
      path.isAbsolute(rawCommand) || rawCommand.includes('/') || rawCommand.includes('\\')
        ? path.resolve(cwd, rawCommand)
        : await findExecutable(rawCommand)
    if (!adapterCommand) {
      throw new Error(`Adaptateur DAP introuvable : ${rawCommand}`)
    }

    const session = new DapSession(root, config, adapterCommand, callbacks)
    await session.initialize()
    return session
  }

  private async initialize(): Promise<void> {
    const client = new DapClient(
      this.adapterCommand,
      this.config.adapterArgs,
      this.config.cwd ?? this.root,
      this.config.adapterEnv
    )
    this.client = client

    client.onConsole = (category, text) => {
      this.callbacks.onConsole(category, text)
    }
    client.onExit = (exitCode) => {
      if (!this.stopped) {
        this.stopped = true
        this.callbacks.onTerminated(exitCode ?? this.lastExitCode)
      }
    }
    client.onEvent = (event, body) => {
      this.handleEvent(event, body)
    }

    try {
      await client.request(
        'initialize',
        {
          clientID: 'cami',
          clientName: 'Cami',
          adapterID: this.config.type,
          locale: 'fr',
          linesStartAt1: true,
          columnsStartAt1: true,
          pathFormat: 'path',
          supportsVariableType: true,
          supportsVariablePaging: false,
          supportsRunInTerminalRequest: false,
          supportsStartDebuggingRequest: false
        },
        START_TIMEOUT_MS
      )

      const requestType = this.config.request
      const launchArguments: Record<string, unknown> = {
        ...this.config.configuration,
        name: this.config.name,
        type: this.config.type,
        request: requestType,
        cwd: this.config.cwd ?? this.root,
        args: this.config.args,
        env: this.config.env,
        stopOnEntry: this.config.stopOnEntry
      }
      if (this.config.program) {
        launchArguments.program = this.config.program
      }

      const launchPromise = client.request(
        requestType,
        launchArguments,
        START_TIMEOUT_MS
      )
      launchPromise.catch(() => undefined)
      this.launchPromise = launchPromise

      await Promise.race([
        this.initializedPromise,
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 15_000)
          timer.unref()
        })
      ])
    } catch (error) {
      client.stop()
      throw error
    }
  }

  async start(breakpoints: NormalizedBreakpointFile[]): Promise<DebugVerifiedBreakpoint[]> {
    const all: DebugVerifiedBreakpoint[] = []
    for (const file of breakpoints) {
      all.push(...(await this.setBreakpoints(file.path, file.breakpoints)))
    }

    const client = this.client
    if (!client) {
      throw new Error('L’adaptateur DAP n’est pas disponible.')
    }
    await client.request('configurationDone', {}, 15_000).catch(() => undefined)
    if (this.launchPromise) {
      await this.launchPromise
      this.launchPromise = null
    }
    return all
  }

  async setBreakpoints(
    filePath: string,
    breakpoints: NormalizedBreakpoint[]
  ): Promise<DebugVerifiedBreakpoint[]> {
    const client = this.client
    if (!client) {
      return []
    }

    const response = await client.request<{ breakpoints?: DapBreakpoint[] }>('setBreakpoints', {
      source: {
        name: path.basename(filePath),
        path: filePath
      },
      breakpoints: breakpoints.map((breakpoint) => ({
        line: breakpoint.line,
        column: breakpoint.column
      })),
      sourceModified: false
    })

    const adapterBreakpoints = Array.isArray(response.breakpoints) ? response.breakpoints : []
    const results = breakpoints.map((breakpoint, index) => {
      const adapterBreakpoint = adapterBreakpoints[index]
      return {
        path: filePath,
        line: breakpoint.line,
        column: breakpoint.column,
        verified: adapterBreakpoint?.verified !== false
      }
    })
    this.breakpointState.set(filePath, results)
    this.callbacks.onBreakpoints(results)
    return results
  }

  async continue(): Promise<void> {
    const client = this.client
    if (!client) {
      return
    }
    await client.request('continue', {
      threadId: this.currentThreadId ?? 1,
      singleThread: false
    })
  }

  async pause(): Promise<void> {
    const client = this.client
    if (!client) {
      return
    }
    await client.request('pause', { threadId: this.currentThreadId ?? 1 })
  }

  async next(): Promise<void> {
    const client = this.client
    if (!client) {
      return
    }
    await client.request('next', {
      threadId: this.currentThreadId ?? 1,
      singleThread: false
    })
  }

  async stepIn(): Promise<void> {
    const client = this.client
    if (!client) {
      return
    }
    await client.request('stepIn', {
      threadId: this.currentThreadId ?? 1,
      singleThread: false
    })
  }

  async stepOut(): Promise<void> {
    const client = this.client
    if (!client) {
      return
    }
    await client.request('stepOut', {
      threadId: this.currentThreadId ?? 1,
      singleThread: false
    })
  }

  async stackTrace(): Promise<DebugStackFrame[]> {
    const client = this.client
    if (!client) {
      return []
    }
    const response = await client.request<{ stackFrames?: DapStackFrame[] }>('stackTrace', {
      threadId: this.currentThreadId ?? 1,
      startFrame: 0,
      levels: MAX_STACK_FRAMES
    })
    const frames = Array.isArray(response.stackFrames) ? response.stackFrames : []
    return frames.slice(0, MAX_STACK_FRAMES).map((frame, index) => {
      const sourcePath = frame.source?.path
        ? path.resolve(frame.source.path)
        : null
      const safePath =
        sourcePath && pathIsInside(this.root, sourcePath) ? sourcePath : null
      return {
        id: typeof frame.id === 'number' ? frame.id : index,
        name: frame.name?.slice(0, 512) || `Frame ${index + 1}`,
        path: safePath,
        relativePath: relativePathOf(this.root, safePath),
        line: typeof frame.line === 'number' && frame.line > 0 ? frame.line : 1,
        column: typeof frame.column === 'number' && frame.column > 0 ? frame.column : 1
      }
    })
  }

  async scopes(frameId: number): Promise<DebugScope[]> {
    const client = this.client
    if (!client) {
      return []
    }
    const response = await client.request<{
      scopes?: Array<{ name?: string; variablesReference?: number; expensive?: boolean }>
    }>('scopes', { frameId })
    const scopes = Array.isArray(response.scopes) ? response.scopes : []
    return scopes
      .filter(
        (scope): scope is { name: string; variablesReference: number; expensive?: boolean } =>
          typeof scope.name === 'string' &&
          typeof scope.variablesReference === 'number' &&
          scope.variablesReference > 0
      )
      .slice(0, 100)
      .map((scope) => ({
        name: scope.name.slice(0, 512),
        variablesReference: scope.variablesReference,
        expensive: scope.expensive === true
      }))
  }

  async variables(reference: number): Promise<DebugVariable[]> {
    const client = this.client
    if (!client) {
      return []
    }
    const response = await client.request<{
      variables?: Array<{
        name?: string
        value?: string
        type?: string
        variablesReference?: number
      }>
    }>('variables', {
      variablesReference: reference,
      start: 0,
      count: MAX_VARIABLES
    })
    const variables = Array.isArray(response.variables) ? response.variables : []
    return variables.slice(0, MAX_VARIABLES).map((variable) => ({
      name: variable.name?.slice(0, 1_000) ?? '?',
      value: variable.value?.slice(0, 8_000) ?? '',
      type: typeof variable.type === 'string' ? variable.type.slice(0, 512) : null,
      variablesReference:
        typeof variable.variablesReference === 'number' ? variable.variablesReference : 0
    }))
  }

  async evaluate(expression: string, frameId: number | null): Promise<DebugEvaluateResult> {
    const client = this.client
    if (!client) {
      throw new Error('Aucune session DAP active.')
    }
    const trimmed = expression.trim()
    if (!trimmed) {
      return { value: '', type: null, variablesReference: 0 }
    }
    const args: Record<string, unknown> = {
      expression: trimmed,
      context: frameId === null ? 'repl' : 'watch'
    }
    if (frameId !== null) {
      args.frameId = frameId
    }
    const response = await client.request<{
      result?: string
      type?: string
      variablesReference?: number
    }>('evaluate', args)
    return {
      value: response.result?.slice(0, 8_000) ?? '',
      type: typeof response.type === 'string' ? response.type.slice(0, 512) : null,
      variablesReference:
        typeof response.variablesReference === 'number' ? response.variablesReference : 0
    }
  }

  private handleEvent(event: string, body: unknown): void {
    if (event === 'initialized') {
      this.initializedResolve?.()
      this.initializedResolve = null
      return
    }

    if (event === 'stopped') {
      const record = asRecord(body)
      const threadId = typeof record?.threadId === 'number' ? record.threadId : null
      this.currentThreadId = threadId
      this.callbacks.onStopped(
        typeof record?.reason === 'string' ? record.reason : 'pause',
        typeof record?.description === 'string'
          ? record.description
          : typeof record?.text === 'string'
            ? record.text
            : null,
        threadId
      )
      return
    }

    if (event === 'continued') {
      this.callbacks.onContinued()
      return
    }

    if (event === 'output') {
      const record = asRecord(body)
      const category =
        record?.category === 'stderr'
          ? 'stderr'
          : record?.category === 'console'
            ? 'console'
            : 'stdout'
      if (typeof record?.output === 'string' && record.output.length > 0) {
        this.callbacks.onConsole(category, record.output.slice(0, MAX_CONSOLE_TEXT))
      }
      return
    }

    if (event === 'exited') {
      const record = asRecord(body)
      this.lastExitCode = typeof record?.exitCode === 'number' ? record.exitCode : null
      return
    }

    if (event === 'terminated') {
      if (!this.stopped) {
        this.stopped = true
        this.callbacks.onTerminated(this.lastExitCode)
      }
      this.client?.stop()
      return
    }

    if (event === 'breakpoint') {
      const record = asRecord(body)
      const breakpoint = asRecord(record?.breakpoint)
      const sourcePath =
        typeof breakpoint?.source === 'object'
          ? asRecord(breakpoint.source)?.path
          : typeof record?.source === 'object'
            ? asRecord(record.source)?.path
            : null
      if (typeof sourcePath === 'string') {
        const note: DebugVerifiedBreakpoint = {
          path: path.resolve(sourcePath),
          line: typeof breakpoint?.line === 'number' ? breakpoint.line : 1,
          column: typeof breakpoint?.column === 'number' ? breakpoint.column : 1,
          verified: breakpoint?.verified !== false
        }
        if (pathIsInside(this.root, note.path)) {
          this.callbacks.onBreakpoints([note])
        }
      }
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    const client = this.client
    if (client) {
      await client.request('disconnect', { terminateDebuggee: true }, 3_000).catch(() => undefined)
      client.stop()
    }
    this.client = null
  }
}

export class DebugManager {
  private readonly send: SendDebugEvent
  private root: string | null = null
  private session: DebugSession | null = null
  private sessionName: string | null = null
  private state: DebugSessionState = 'idle'

  constructor(send: SendDebugEvent) {
    this.send = send
  }

  async setWorkspace(root: string): Promise<void> {
    await this.stop()
    this.root = root
    this.state = 'idle'
  }

  async dispose(): Promise<void> {
    await this.stop()
    this.root = null
  }

  async getConfigurations(
    activeFilePath: string | null = null
  ): Promise<DebugConfigurationList> {
    const root = this.requireRoot()
    return readLaunchConfigurations(root, activeFilePath)
  }

  async start(
    configurationId: string,
    breakpointsInput: DebugBreakpointFile[],
    activeFilePath: string | null = null
  ): Promise<DebugVerifiedBreakpoint[]> {
    const root = this.requireRoot()
    const configurations = await readLaunchConfigurations(root, activeFilePath)
    const configuration = configurations.configurations.find(
      (candidate) => candidate.id === configurationId
    )
    if (!configuration) {
      throw new Error('Cette configuration de débogage n’existe plus.')
    }

    return this.startWithConfiguration(root, configuration, breakpointsInput)
  }

  async startFile(
    filePathInput: string,
    breakpointsInput: DebugBreakpointFile[]
  ): Promise<DebugVerifiedBreakpoint[]> {
    const root = this.requireRoot()
    const filePath = path.resolve(filePathInput)
    if (!pathIsInside(root, filePath)) {
      throw new Error('Le fichier à déboguer se trouve hors du dossier de travail.')
    }

    const extension = path.extname(filePath).toLocaleLowerCase()
    if (!['.js', '.mjs', '.cjs'].includes(extension)) {
      throw new Error(
        'Le débogage direct est disponible pour les fichiers JavaScript (.js, .mjs, .cjs).'
      )
    }

    let stats
    try {
      stats = await fs.stat(filePath)
    } catch {
      throw new Error('Le fichier à déboguer est introuvable.')
    }
    if (!stats.isFile()) {
      throw new Error('Le chemin à déboguer n’est pas un fichier.')
    }

    const configuration: DebugConfiguration = {
      id: 'active-file',
      name: `Fichier actif — ${path.basename(filePath)}`,
      type: 'node',
      request: 'launch',
      program: filePath,
      args: [],
      cwd: root,
      env: {},
      runtime: null,
      runtimeArgs: [],
      stopOnEntry: false,
      pauseOnExceptions: false,
      adapterCommand: null,
      adapterArgs: [],
      adapterEnv: {},
      configuration: {},
      source: 'auto'
    }

    return this.startWithConfiguration(root, configuration, breakpointsInput)
  }

  private async startWithConfiguration(
    root: string,
    configuration: DebugConfiguration,
    breakpointsInput: DebugBreakpointFile[]
  ): Promise<DebugVerifiedBreakpoint[]> {
    if (this.session) {
      await this.stop()
    }

    const validatedConfiguration = await validateConfiguration(root, configuration)
    const breakpoints = normalizeBreakpoints(root, breakpointsInput)
    this.sessionName = configuration.name
    this.emitState('starting', null, `Préparation de « ${configuration.name} »…`)

    const callbacks: DebugSessionCallbacks = {
      onStopped: (reason, description, threadId) => {
        this.emitState('paused', description, null)
        this.send({
          type: 'stopped',
          reason,
          description,
          threadId
        })
      },
      onContinued: () => {
        if (this.state !== 'running') {
          this.emitState('running', null, null)
        }
        this.send({ type: 'continued' })
      },
      onConsole: (category, text) => {
        this.send({ type: 'console', category, text })
      },
      onTerminated: (exitCode) => {
        this.session = null
        this.emitState(
          'stopped',
          null,
          exitCode === null
            ? 'La session de débogage est terminée.'
            : `Le programme s’est arrêté avec le code ${exitCode}.`
        )
        this.send({ type: 'terminated', exitCode })
      },
      onBreakpoints: (verified) => {
        this.send({ type: 'breakpoints', breakpoints: verified })
      }
    }

    let session: DebugSession
    try {
      session =
        validatedConfiguration.type === 'node'
          ? await NodeInspectorSession.create(root, validatedConfiguration, callbacks)
          : await DapSession.create(root, validatedConfiguration, callbacks)
    } catch (error) {
      this.session = null
      const message =
        error instanceof Error ? error.message : 'Impossible de démarrer le débogage.'
      this.emitState('error', null, message)
      this.send({ type: 'console', category: 'system', text: `${message}\n` })
      throw error
    }

    this.session = session
    try {
      const verified = await session.start(breakpoints)
      if (this.state === 'starting') {
        this.emitState('running', null, null)
      }
      return verified
    } catch (error) {
      await session.stop()
      this.session = null
      const message =
        error instanceof Error ? error.message : 'Impossible de démarrer la session de débogage.'
      this.emitState('error', null, message)
      this.send({ type: 'console', category: 'system', text: `${message}\n` })
      throw error
    }
  }

  async stop(): Promise<void> {
    const session = this.session
    this.session = null
    if (session) {
      await session.stop()
    }
    if (this.state !== 'idle' && this.state !== 'stopped' && this.state !== 'error') {
      this.emitState('stopped', null, 'Session de débogage arrêtée.')
    } else {
      this.state = this.state === 'error' ? 'error' : 'stopped'
    }
  }

  async continue(): Promise<void> {
    await this.requireSession().continue()
  }

  async pause(): Promise<void> {
    await this.requireSession().pause()
  }

  async next(): Promise<void> {
    await this.requireSession().next()
  }

  async stepIn(): Promise<void> {
    await this.requireSession().stepIn()
  }

  async stepOut(): Promise<void> {
    await this.requireSession().stepOut()
  }

  async setBreakpoints(
    filePathInput: string,
    breakpointsInput: DebugBreakpointInput[]
  ): Promise<DebugVerifiedBreakpoint[]> {
    const root = this.requireRoot()
    const filePath = path.resolve(filePathInput)
    if (!pathIsInside(root, filePath)) {
      throw new Error('Le fichier de point d’arrêt se trouve hors du dossier de travail.')
    }
    const normalized = normalizeBreakpoints(root, [
      {
        path: filePath,
        breakpoints: breakpointsInput
      }
    ])[0]
    if (!normalized) {
      return []
    }
    if (!this.session) {
      return []
    }
    return this.session.setBreakpoints(filePath, normalized.breakpoints)
  }

  async stackTrace(): Promise<DebugStackFrame[]> {
    return this.session ? this.session.stackTrace() : []
  }

  async scopes(frameId: number): Promise<DebugScope[]> {
    if (!Number.isInteger(frameId) || frameId < 0) {
      return []
    }
    return this.session ? this.session.scopes(frameId) : []
  }

  async variables(reference: number): Promise<DebugVariable[]> {
    if (!Number.isInteger(reference) || reference <= 0) {
      return []
    }
    return this.session ? this.session.variables(reference) : []
  }

  async evaluate(expression: string, frameId: number | null): Promise<DebugEvaluateResult> {
    return this.requireSession().evaluate(expression, frameId)
  }

  private requireRoot(): string {
    if (!this.root) {
      throw new Error('Aucun dossier de travail n’est ouvert.')
    }
    return this.root
  }

  private requireSession(): DebugSession {
    if (!this.session) {
      throw new Error('Aucune session de débogage active.')
    }
    return this.session
  }

  private emitState(
    state: DebugSessionState,
    _description: string | null,
    message: string | null
  ): void {
    this.state = state
    this.send({
      type: 'state',
      state,
      sessionName: this.sessionName,
      message
    })
  }
}

async function readLaunchConfigurations(
  root: string,
  activeFilePath: string | null = null
): Promise<DebugConfigurationList> {
  const activeFile =
    activeFilePath && pathIsInside(root, activeFilePath) ? activeFilePath : null
  const candidates = [
    path.join(root, '.cami', 'launch.json'),
    path.join(root, '.vscode', 'launch.json')
  ]

  let configPath: string | null = null
  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate)
      if (stats.isFile()) {
        configPath = candidate
        break
      }
    } catch {
      // Try the next candidate.
    }
  }

  let error: string | null = null
  const configurations: DebugConfiguration[] = []
  let launchFilePresent = false
  let ignored = 0

  if (configPath) {
    launchFilePresent = true
    try {
      const stats = await fs.stat(configPath)
      if (stats.size > MAX_CONFIG_BYTES) {
        throw new Error('Le fichier launch.json est trop volumineux.')
      }
      const parsed = parseJsonc<LaunchFile>(await fs.readFile(configPath, 'utf8'))
      const rawConfigurations = parsed.configurations
      if (!Array.isArray(rawConfigurations)) {
        throw new Error('Le fichier launch.json ne contient aucune configuration.')
      }

      for (let index = 0; index < rawConfigurations.length && index < 200; index += 1) {
        const raw = asRecord(rawConfigurations[index]) as RawLaunchConfiguration | null
        if (!raw) {
          continue
        }
        const type = typeof raw.type === 'string' ? raw.type.toLocaleLowerCase() : ''
        const request = raw.request === 'attach' ? 'attach' : 'launch'
        if (type === 'node' || type === 'pwa-node') {
          if (request === 'attach') {
            ignored += 1
            continue
          }
          if (typeof raw.program !== 'string' || raw.program.length === 0) {
            ignored += 1
            continue
          }
          const expandedProgram = expandLaunchString(raw.program, root, activeFile)
          const program = expandedProgram.includes('${')
            ? null
            : path.resolve(root, expandedProgram)
          const expandedCwd =
            typeof raw.cwd === 'string' && raw.cwd.length > 0
              ? expandLaunchString(raw.cwd, root, activeFile)
              : root
          const runtimeValue =
            typeof raw.runtimeExecutable === 'string'
              ? raw.runtimeExecutable
              : typeof raw.runtime === 'string'
                ? raw.runtime
                : null
          configurations.push({
            id: `launch:${index}`,
            name:
              typeof raw.name === 'string' && raw.name.length > 0
                ? raw.name.slice(0, 200)
                : `Configuration Node ${index + 1}`,
            type: 'node',
            request: 'launch',
            program,
            args: readStringArray(raw.args).map((argument) =>
              expandLaunchString(argument, root, activeFile)
            ),
            cwd: path.resolve(root, expandedCwd),
            env: Object.fromEntries(
              Object.entries(readStringRecord(raw.env)).map(([key, entry]) => [
                key,
                expandLaunchString(entry, root, activeFile)
              ])
            ),
            runtime: runtimeValue ? expandLaunchString(runtimeValue, root, activeFile) : null,
            runtimeArgs: readStringArray(raw.runtimeArgs).map((argument) =>
              expandLaunchString(argument, root, activeFile)
            ),
            stopOnEntry: raw.stopOnEntry === true,
            pauseOnExceptions: raw.pauseOnExceptions === true,
            adapterCommand: null,
            adapterArgs: [],
            adapterEnv: {},
            configuration: {},
            source: 'launch.json'
          })
          continue
        }

        if (typeof raw.adapterCommand === 'string' && raw.adapterCommand.length > 0) {
          const expandedDapProgram =
            typeof raw.program === 'string' && raw.program.length > 0
              ? expandLaunchString(raw.program, root, activeFile)
              : null
          const dapProgram =
            expandedDapProgram && !expandedDapProgram.includes('${')
              ? path.resolve(root, expandedDapProgram)
              : null
          const dapCwd =
            typeof raw.cwd === 'string' && raw.cwd.length > 0
              ? path.resolve(root, expandLaunchString(raw.cwd, root, activeFile))
              : root
          configurations.push({
            id: `launch:${index}`,
            name:
              typeof raw.name === 'string' && raw.name.length > 0
                ? raw.name.slice(0, 200)
                : `Configuration DAP ${index + 1}`,
            type: 'dap',
            request,
            program: dapProgram,
            args: readStringArray(raw.args).map((argument) =>
              expandLaunchString(argument, root, activeFile)
            ),
            cwd: dapCwd,
            env: Object.fromEntries(
              Object.entries(readStringRecord(raw.env)).map(([key, entry]) => [
                key,
                expandLaunchString(entry, root, activeFile)
              ])
            ),
            runtime: null,
            runtimeArgs: [],
            stopOnEntry: raw.stopOnEntry === true,
            pauseOnExceptions: raw.pauseOnExceptions === true,
            adapterCommand: expandLaunchString(raw.adapterCommand, root, activeFile),
            adapterArgs: readStringArray(raw.adapterArgs).map((argument) =>
              expandLaunchString(argument, root, activeFile)
            ),
            adapterEnv: Object.fromEntries(
              Object.entries(readStringRecord(raw.adapterEnv)).map(([key, entry]) => [
                key,
                expandLaunchString(entry, root, activeFile)
              ])
            ),
            configuration: (expandLaunchValue(asRecord(raw) ?? {}, root, activeFile) as Record<
              string,
              unknown
            >),
            source: 'launch.json'
          })
          continue
        }

        ignored += 1
      }
      if (ignored > 0) {
        error = `${ignored} configuration(s) ignorée(s) car leur adaptateur ou leur programme n’est pas pris en charge.`
      }
    } catch (caught) {
      error =
        caught instanceof Error
          ? `Configuration de débogage invalide : ${caught.message}`
          : 'Configuration de débogage invalide.'
    }
  }

  if (configurations.length === 0) {
    const auto = await detectMainProgramConfiguration(root)
    if (auto) {
      configurations.push(auto)
    }
  }

  return {
    configurations,
    source: configurations.some((configuration) => configuration.source === 'launch.json')
      ? 'launch.json'
      : configurations.length > 0
        ? 'auto'
        : launchFilePresent
          ? 'launch.json'
          : 'none',
    error
  }
}

async function detectMainProgramConfiguration(
  root: string
): Promise<DebugConfiguration | null> {
  const packagePath = path.join(root, 'package.json')
  try {
    const stats = await fs.stat(packagePath)
    if (!stats.isFile() || stats.size > MAX_CONFIG_BYTES) {
      return null
    }
    const parsed = asRecord(parseJsonc<unknown>(await fs.readFile(packagePath, 'utf8')))
    const mainPath = typeof parsed?.main === 'string' ? parsed.main : null
    if (!mainPath) {
      return null
    }
    const program = path.resolve(root, expandLaunchString(mainPath, root))
    if (!pathIsInside(root, program)) {
      return null
    }
    const programStats = await fs.stat(program)
    if (!programStats.isFile()) {
      return null
    }
    return {
      id: 'auto:main',
      name: `Programme principal — ${path.basename(program)}`,
      type: 'node',
      request: 'launch',
      program,
      args: [],
      cwd: root,
      env: {},
      runtime: null,
      runtimeArgs: [],
      stopOnEntry: false,
      pauseOnExceptions: false,
      adapterCommand: null,
      adapterArgs: [],
      adapterEnv: {},
      configuration: {},
      source: 'auto'
    }
  } catch {
    return null
  }
}

async function validateConfiguration(
  root: string,
  configuration: DebugConfiguration
): Promise<DebugConfiguration> {
  const cwd = configuration.cwd ? path.resolve(configuration.cwd) : root
  if (!pathIsInside(root, cwd)) {
    throw new Error('Le dossier de travail du débogueur est hors de l’espace ouvert.')
  }
  try {
    if (!(await fs.stat(cwd)).isDirectory()) {
      throw new Error('Le dossier de travail du débogueur est introuvable.')
    }
  } catch {
    throw new Error('Le dossier de travail du débogueur est introuvable.')
  }

  let runtime: string | null = null
  if (configuration.runtime) {
    const rawRuntime = configuration.runtime
    if (
      path.isAbsolute(rawRuntime) ||
      rawRuntime.includes('/') ||
      rawRuntime.includes('\\')
    ) {
      runtime = path.resolve(cwd, rawRuntime)
      const executable = await findExecutable(runtime)
      if (!executable) {
        throw new Error(`L’exécutable Node.js est introuvable : ${rawRuntime}`)
      }
      runtime = executable
    } else {
      runtime = await findExecutable(rawRuntime)
      if (!runtime) {
        throw new Error(`L’exécutable Node.js est introuvable : ${rawRuntime}`)
      }
    }
  } else {
    runtime = await findExecutable('node')
  }

  let program: string | null = null
  if (configuration.program) {
    program = path.resolve(configuration.program)
    if (!pathIsInside(root, program)) {
      throw new Error('Le programme à déboguer est hors de l’espace ouvert.')
    }
    const stats = await fs.stat(program)
    if (!stats.isFile()) {
      throw new Error('Le programme à déboguer est introuvable.')
    }
  } else if (configuration.type === 'node') {
    throw new Error('Aucun programme n’est défini pour cette configuration Node.js.')
  }

  if (configuration.type === 'dap' && !configuration.adapterCommand) {
    throw new Error('Aucune commande d’adaptateur DAP n’est configurée.')
  }

  return {
    ...configuration,
    cwd,
    runtime,
    program
  }
}
