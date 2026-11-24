import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import type {
  LspCompletionItem,
  LspDiagnostic,
  LspDiagnosticsEvent,
  LspDocumentSymbol,
  LspEnsureResult,
  LspHover,
  LspLocation,
  LspLogEvent,
  LspPosition,
  LspRange,
  LspServerStatus,
  LspSignatureHelp,
  LspStatusEvent,
  LspTextEdit,
  LspWorkspaceEdit,
  LspWorkspaceSymbol
} from '../preload'
import { childEnvironment, findExecutable } from './processUtils'
import { parseJsonc } from './jsonc'

const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
const MAX_INCOMING_MESSAGE_BYTES = 32 * 1024 * 1024
const MAX_STDERR_PREVIEW = 4_096
const MAX_COMPLETION_ITEMS = 500
const MAX_DIAGNOSTICS = 500
const MAX_REFERENCES = 1_000
const MAX_WORKSPACE_SYMBOLS = 500
const REQUEST_TIMEOUT_MS = 20_000
const INITIALIZE_TIMEOUT_MS = 30_000
const FAILURE_COOLDOWN_MS = 5_000
const CONFIG_FILE = '.cami/language-servers.json'

interface Candidate {
  command: string
  args: string[]
}

interface ServerDefinition {
  id: string
  label: string
  languages: string[]
  candidates: Candidate[]
  command: string | null
  args: string[]
  env: Record<string, string>
  initializationOptions: unknown
  custom: boolean
}

interface ServerConfigEntry {
  id?: unknown
  label?: unknown
  languages?: unknown
  command?: unknown
  args?: unknown
  env?: unknown
  initializationOptions?: unknown
}

interface ServerConfigFile {
  servers?: unknown
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

interface OpenDocument {
  languageId: string
  version: number
  textLength: number
}

interface DiagnosticPayload {
  range?: unknown
  severity?: unknown
  message?: unknown
  source?: unknown
  code?: unknown
}

interface CompletionPayload {
  label?: unknown
  kind?: unknown
  detail?: unknown
  documentation?: unknown
  insertText?: unknown
  insertTextFormat?: unknown
  textEdit?: unknown
  additionalTextEdits?: unknown
  sortText?: unknown
  filterText?: unknown
}

interface LocationPayload {
  uri?: unknown
  path?: unknown
  range?: unknown
  targetUri?: unknown
  targetRange?: unknown
  targetSelectionRange?: unknown
}

interface SymbolPayload {
  name?: unknown
  detail?: unknown
  kind?: unknown
  range?: unknown
  selectionRange?: unknown
  location?: LocationPayload
  children?: unknown
  containerName?: unknown
}

interface TextEditPayload {
  range?: unknown
  newText?: unknown
}

interface WorkspaceEditPayload {
  changes?: unknown
  documentChanges?: unknown
}

interface DefaultDefinition {
  id: string
  label: string
  languages: string[]
  candidates: Candidate[]
}

const BUILTIN_DEFINITIONS: DefaultDefinition[] = [
  {
    id: 'python',
    label: 'Python',
    languages: ['python'],
    candidates: [
      { command: 'pyright-langserver', args: ['--stdio'] },
      { command: 'basedpyright-langserver', args: ['--stdio'] },
      { command: 'pylsp', args: [] }
    ]
  },
  {
    id: 'rust',
    label: 'Rust',
    languages: ['rust'],
    candidates: [{ command: 'rust-analyzer', args: [] }]
  },
  {
    id: 'go',
    label: 'Go',
    languages: ['go'],
    candidates: [{ command: 'gopls', args: ['serve'] }]
  },
  {
    id: 'clangd',
    label: 'C / C++',
    languages: ['c', 'cpp', 'objective-c'],
    candidates: [{ command: 'clangd', args: [] }]
  },
  {
    id: 'php',
    label: 'PHP',
    languages: ['php'],
    candidates: [{ command: 'intelephense', args: ['--stdio'] }]
  },
  {
    id: 'ruby',
    label: 'Ruby',
    languages: ['ruby'],
    candidates: [{ command: 'solargraph', args: ['stdio'] }]
  },
  {
    id: 'lua',
    label: 'Lua',
    languages: ['lua'],
    candidates: [{ command: 'lua-language-server', args: [] }]
  },
  {
    id: 'yaml',
    label: 'YAML',
    languages: ['yaml'],
    candidates: [{ command: 'yaml-language-server', args: ['--stdio'] }]
  },
  {
    id: 'shell',
    label: 'Shell',
    languages: ['shell'],
    candidates: [{ command: 'bash-language-server', args: ['start'] }]
  },
  {
    id: 'dockerfile',
    label: 'Dockerfile',
    languages: ['dockerfile'],
    candidates: [{ command: 'docker-langserver', args: ['--stdio'] }]
  }
]

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

function readStringArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter(
      (entry): entry is string =>
        typeof entry === 'string' &&
        entry.length > 0 &&
        entry.length <= 4_096 &&
        !entry.includes('\0')
    )
    .slice(0, maximum)
}

function normalizeLanguageId(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    !value.includes('\0')
    ? value
    : null
}

function normalizeServerId(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[A-Za-z0-9._-]{1,80}$/.test(value)
    ? value
    : null
}

function normalizePosition(value: unknown): LspPosition | null {
  const record = asRecord(value)
  const line = record?.line
  const character = record?.character
  if (
    typeof line !== 'number' ||
    typeof character !== 'number' ||
    !Number.isInteger(line) ||
    !Number.isInteger(character) ||
    line < 0 ||
    character < 0 ||
    line > 10_000_000 ||
    character > 10_000_000
  ) {
    return null
  }
  return { line, character }
}

function normalizeRange(value: unknown): LspRange | null {
  const record = asRecord(value)
  const start = normalizePosition(record?.start)
  const end = normalizePosition(record?.end)
  return start && end ? { start, end } : null
}

function normalizeTextEdits(value: unknown): LspTextEdit[] {
  if (!Array.isArray(value)) {
    return []
  }

  const edits: LspTextEdit[] = []
  for (const entry of value.slice(0, 5_000)) {
    const record = asRecord(entry) as TextEditPayload | null
    const range = normalizeRange(record?.range)
    if (!range || typeof record?.newText !== 'string' || record.newText.length > 4 * 1024 * 1024) {
      continue
    }
    edits.push({ range, newText: record.newText })
  }
  return edits
}

function normalizeCompletionRange(value: unknown): LspRange | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  if ('range' in record) {
    return normalizeRange(record.range)
  }
  if ('replace' in record) {
    return normalizeRange(record.replace)
  }
  return null
}

function documentationText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.slice(0, 16_384)
  }
  const record = asRecord(value)
  if (record && (record.kind === 'markdown' || record.kind === 'plaintext') && typeof record.value === 'string') {
    return record.value.slice(0, 16_384)
  }
  return null
}

function hoverText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry
        }
        const record = asRecord(entry)
        return typeof record?.value === 'string' ? record.value : ''
      })
      .filter(Boolean)
      .join('\n\n')
  }
  const record = asRecord(value)
  return typeof record?.value === 'string' ? record.value : ''
}

function normalizeDiagnostic(value: unknown): LspDiagnostic | null {
  const record = asRecord(value) as DiagnosticPayload | null
  const range = normalizeRange(record?.range)
  const message = typeof record?.message === 'string' ? record.message.slice(0, 8_192) : null
  if (!range || !message) {
    return null
  }

  const severity =
    record?.severity === 1 || record?.severity === 2 || record?.severity === 3
      ? record.severity
      : 4
  const source = typeof record?.source === 'string' ? record.source.slice(0, 200) : null
  const rawCode = record?.code
  const code =
    typeof rawCode === 'string' || typeof rawCode === 'number'
      ? String(rawCode).slice(0, 200)
      : null

  return { range, severity, message, source, code }
}

function normalizeDocumentSymbol(value: unknown): LspDocumentSymbol | null {
  const record = asRecord(value) as SymbolPayload | null
  const name = typeof record?.name === 'string' ? record.name.slice(0, 512) : null
  const range = normalizeRange(record?.range)
  const selectionRange = normalizeRange(record?.selectionRange) ?? range
  if (!name || !range || !selectionRange) {
    return null
  }

  const children = Array.isArray(record?.children)
    ? record.children
        .map(normalizeDocumentSymbol)
        .filter((symbol): symbol is LspDocumentSymbol => symbol !== null)
        .slice(0, 2_000)
    : []

  return {
    name,
    detail: typeof record?.detail === 'string' ? record.detail.slice(0, 512) : null,
    kind: typeof record?.kind === 'number' ? record.kind : 13,
    range,
    selectionRange,
    children
  }
}

export class LanguageServerProcess {
  readonly definition: ServerDefinition
  readonly root: string
  private readonly child: ChildProcessWithoutNullStreams
  private readonly onStatus: (status: LspServerStatus) => void
  private readonly onDiagnostics: (event: LspDiagnosticsEvent) => void
  private readonly onLog: (event: LspLogEvent) => void
  private readonly onExit: (id: string, message: string) => void
  private readonly pending = new Map<number, PendingRequest>()
  private readonly documents = new Map<string, OpenDocument>()
  private readonly status: LspServerStatus
  private nextRequestId = 1
  private receiveBuffer = Buffer.alloc(0)
  private stderrBuffer = ''
  private stopped = false
  private initialized = false

  constructor(
    definition: ServerDefinition,
    root: string,
    callbacks: {
      onStatus: (status: LspServerStatus) => void
      onDiagnostics: (event: LspDiagnosticsEvent) => void
      onLog: (event: LspLogEvent) => void
      onExit: (id: string, message: string) => void
    }
  ) {
    this.definition = definition
    this.root = root
    this.onStatus = callbacks.onStatus
    this.onDiagnostics = callbacks.onDiagnostics
    this.onLog = callbacks.onLog
    this.onExit = callbacks.onExit
    this.status = {
      id: definition.id,
      label: definition.label,
      languages: definition.languages,
      state: 'starting',
      command: [definition.command, ...definition.args].filter(Boolean).join(' ') || null,
      message: 'Démarrage du serveur de langage…'
    }

    this.child = spawn(definition.command ?? '', definition.args, {
      cwd: root,
      env: {
        ...childEnvironment(),
        ...definition.env,
        NO_COLOR: '1'
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.receive(chunk)
    })
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => {
      this.receiveStderr(chunk)
    })
    this.child.on('error', (error) => {
      this.fail(`Impossible de démarrer le serveur : ${error.message}`)
    })
    this.child.on('close', (code, signal) => {
      const message = this.stopped
        ? 'Serveur de langage arrêté.'
        : `Serveur de langage arrêté (${signal ?? code ?? 'inconnu'}).`
      for (const request of this.pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error(message))
      }
      this.pending.clear()
      this.documents.clear()
      if (!this.stopped) {
        this.status.state = 'error'
        this.status.message = message
        this.onStatus({ ...this.status })
      }
      this.onExit(this.definition.id, message)
    })
  }

  get isRunning(): boolean {
    return this.initialized && !this.stopped
  }

  get statusSnapshot(): LspServerStatus {
    return { ...this.status }
  }

  async initialize(): Promise<void> {
    const params = {
      processId: process.pid,
      clientInfo: {
        name: 'Cami',
        version: '0.1.0'
      },
      locale: 'fr',
      rootPath: this.root,
      rootUri: pathToFileURL(this.root).href,
      workspaceFolders: [
        {
          uri: pathToFileURL(this.root).href,
          name: path.basename(this.root)
        }
      ],
      capabilities: {
        workspace: {
          configuration: true,
          workspaceFolders: true
        },
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: true
          },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
              insertReplaceSupport: true,
              resolveSupport: {
                properties: ['documentation', 'detail', 'additionalTextEdits']
              }
            },
            contextSupport: true
          },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: true },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          formatting: {},
          rename: { prepareSupport: false },
          signatureHelp: {
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
              parameterInformation: { labelOffsetSupport: true }
            }
          },
          publishDiagnostics: {
            relatedInformation: false,
            versionSupport: false
          }
        },
        window: {
          workDoneProgress: true,
          showMessage: {}
        }
      },
      initializationOptions: this.definition.initializationOptions ?? null
    }

    this.onStatus({ ...this.status })
    try {
      await this.request('initialize', params, INITIALIZE_TIMEOUT_MS)
      if (this.stopped) {
        return
      }
      this.sendNotification('initialized', {})
      if (this.definition.initializationOptions !== undefined) {
        this.sendNotification('workspace/didChangeConfiguration', {
          settings: this.definition.initializationOptions
        })
      }
      this.initialized = true
      this.status.state = 'running'
      this.status.message = 'Serveur de langage prêt.'
      this.onStatus({ ...this.status })
      this.onLog({
        serverId: this.definition.id,
        level: 'info',
        message: `${this.definition.label} : serveur de langage prêt.`
      })
    } catch (error) {
      this.fail(
        error instanceof Error
          ? error.message
          : 'Le serveur de langage n’a pas pu démarrer.'
      )
      throw error
    }
  }

  stop(): void {
    if (this.stopped) {
      return
    }

    this.stopped = true
    this.initialized = false
    this.documents.clear()
    try {
      this.sendNotification('shutdown', null)
      this.sendNotification('exit', null)
    } catch {
      // The process may already be closing.
    }

    const child = this.child
    const killTimer = setTimeout(() => {
      if (!child.killed) {
        try {
          child.kill('SIGKILL')
        } catch {
          // The process is already gone.
        }
      }
    }, 1_000)
    killTimer.unref()
    try {
      child.kill('SIGTERM')
    } catch {
      // Ignore a process that exited during shutdown.
    }
  }

  openDocument(filePath: string, languageId: string, version: number, text: string): void {
    if (!this.isRunning) {
      return
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES) {
      throw new Error('Le fichier est trop volumineux pour le service de langage.')
    }
    this.documents.set(filePath, {
      languageId,
      version,
      textLength: text.length
    })
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: pathToFileURL(filePath).href,
        languageId,
        version,
        text
      }
    })
  }

  changeDocument(filePath: string, version: number, text: string): void {
    if (!this.isRunning) {
      return
    }
    const doc = this.documents.get(filePath)
    if (!doc || version <= doc.version) {
      return
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES) {
      return
    }
    doc.version = version
    doc.textLength = text.length
    this.sendNotification('textDocument/didChange', {
      textDocument: {
        uri: pathToFileURL(filePath).href,
        version
      },
      contentChanges: [{ text }]
    })
  }

  saveDocument(filePath: string): void {
    if (!this.isRunning) {
      return
    }
    this.sendNotification('textDocument/didSave', {
      textDocument: { uri: pathToFileURL(filePath).href }
    })
  }

  closeDocument(filePath: string): void {
    if (!this.documents.has(filePath)) {
      return
    }
    this.documents.delete(filePath)
    if (this.isRunning) {
      this.sendNotification('textDocument/didClose', {
        textDocument: { uri: pathToFileURL(filePath).href }
      })
    }
  }

  hasDocument(filePath: string): boolean {
    return this.documents.has(filePath)
  }

  request<T = unknown>(
    method: string,
    params: unknown,
    timeout = REQUEST_TIMEOUT_MS
  ): Promise<T> {
    if (this.stopped) {
      return Promise.reject(new Error('Le serveur de langage est arrêté.'))
    }

    const id = this.nextRequestId
    this.nextRequestId += 1
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params
    })

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Le serveur de langage ne répond pas à « ${method} ».`))
      }, timeout)

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })

      try {
        this.writeFrame(payload)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  notify(method: string, params: unknown): void {
    if (!this.stopped) {
      this.sendNotification(method, params)
    }
  }

  private sendNotification(method: string, params: unknown): void {
    try {
      this.writeFrame(
        JSON.stringify({
          jsonrpc: '2.0',
          method,
          params
        })
      )
    } catch {
      // Notifications are best-effort while a server is shutting down.
    }
  }

  private writeFrame(payload: string): void {
    const body = Buffer.from(payload, 'utf8')
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii')
    this.child.stdin.write(Buffer.concat([header, body]))
  }

  private receive(chunk: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk])
    if (this.receiveBuffer.length > MAX_INCOMING_MESSAGE_BYTES) {
      this.fail('Le serveur de langage a envoyé un message trop volumineux.')
      return
    }

    while (true) {
      const headerEnd = this.receiveBuffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        return
      }

      const header = this.receiveBuffer.subarray(0, headerEnd).toString('ascii')
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        this.receiveBuffer = this.receiveBuffer.subarray(headerEnd + 4)
        continue
      }

      const contentLength = Number.parseInt(match[1] ?? '', 10)
      if (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_INCOMING_MESSAGE_BYTES) {
        this.fail('En-tête de message de langage invalide.')
        return
      }

      const messageStart = headerEnd + 4
      const messageEnd = messageStart + contentLength
      if (this.receiveBuffer.length < messageEnd) {
        return
      }

      const body = this.receiveBuffer.subarray(messageStart, messageEnd).toString('utf8')
      this.receiveBuffer = this.receiveBuffer.subarray(messageEnd)
      this.handleMessage(body)
    }
  }

  private handleMessage(raw: string): void {
    let message: unknown
    try {
      message = JSON.parse(raw)
    } catch {
      this.logError('Réponse JSON invalide reçue du serveur de langage.')
      return
    }

    const record = asRecord(message)
    if (!record) {
      return
    }

    if (record.method && record.id !== undefined && record.id !== null) {
      void this.handleServerRequest(record.id, record.method, record.params)
      return
    }

    if (record.method) {
      if (typeof record.method === 'string') {
        this.handleNotification(record.method, record.params)
      }
      return
    }

    const id = typeof record.id === 'number' ? record.id : null
    if (id === null) {
      return
    }
    const pending = this.pending.get(id)
    if (!pending) {
      return
    }
    this.pending.delete(id)
    clearTimeout(pending.timer)

    if (record.error) {
      const errorRecord = asRecord(record.error)
      const messageText = typeof errorRecord?.message === 'string' ? errorRecord.message : 'Erreur de langage.'
      pending.reject(new Error(messageText))
      this.logError(messageText)
      return
    }

    pending.resolve(record.result)
  }

  private async handleServerRequest(
    id: unknown,
    method: unknown,
    params: unknown
  ): Promise<void> {
    if (typeof method !== 'string' || (typeof id !== 'number' && typeof id !== 'string')) {
      return
    }

    let result: unknown = null
    let error: { code: number; message: string } | null = null
    switch (method) {
      case 'workspace/configuration': {
        const record = asRecord(params)
        const items = Array.isArray(record?.items) ? record.items : []
        result = items.map(() => this.definition.initializationOptions ?? null)
        break
      }
      case 'workspace/workspaceFolders':
        result = [
          {
            uri: pathToFileURL(this.root).href,
            name: path.basename(this.root)
          }
        ]
        break
      case 'client/registerCapability':
        result = null
        break
      case 'client/unregisterCapability':
        result = null
        break
      case 'window/workDoneProgress/create':
        result = null
        break
      case 'window/showMessageRequest':
        result = null
        break
      case 'workspace/applyEdit':
        result = { applied: false, failureReason: 'Les modifications sont appliquées par l’éditeur Cami.' }
        break
      case 'workspace/codeLens/refresh':
      case 'workspace/semanticTokens/refresh':
      case 'workspace/inlayHint/refresh':
        result = null
        break
      default:
        error = { code: -32601, message: `Méthode non prise en charge : ${method}` }
        break
    }

    const payload = error
      ? { jsonrpc: '2.0', id, error }
      : { jsonrpc: '2.0', id, result }

    try {
      this.writeFrame(JSON.stringify(payload))
    } catch {
      // The server may be closing.
    }
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === 'textDocument/publishDiagnostics') {
      const record = asRecord(params)
      const uri = typeof record?.uri === 'string' ? record.uri : null
      const rawDiagnostics = Array.isArray(record?.diagnostics) ? record.diagnostics : []
      if (!uri) {
        return
      }

      const filePath = this.uriToPath(uri)
      if (!filePath) {
        return
      }

      const diagnostics = rawDiagnostics
        .slice(0, MAX_DIAGNOSTICS)
        .map(normalizeDiagnostic)
        .filter((diagnostic): diagnostic is LspDiagnostic => diagnostic !== null)

      this.onDiagnostics({
        serverId: this.definition.id,
        path: filePath,
        diagnostics
      })
      return
    }

    if (method === 'window/logMessage') {
      const record = asRecord(params)
      const message = typeof record?.message === 'string' ? record.message.slice(0, 4_096) : ''
      if (message) {
        this.onLog({
          serverId: this.definition.id,
          level: 'info',
          message
        })
      }
      return
    }

    if (method === 'window/showMessage') {
      const record = asRecord(params)
      const message = typeof record?.message === 'string' ? record.message.slice(0, 4_096) : ''
      if (message) {
        this.onLog({
          serverId: this.definition.id,
          level: 'warning',
          message
        })
      }
    }
  }

  private uriToPath(uri: string): string | null {
    if (!uri.startsWith('file:')) {
      return null
    }
    try {
      const filePath = fileURLToPath(uri)
      return pathIsInside(this.root, filePath) ? filePath : null
    } catch {
      return null
    }
  }

  private receiveStderr(chunk: string): void {
    this.stderrBuffer += chunk
    if (this.stderrBuffer.length > MAX_STDERR_PREVIEW) {
      this.stderrBuffer = this.stderrBuffer.slice(-MAX_STDERR_PREVIEW)
    }

    const lines = this.stderrBuffer.split(/\r?\n/)
    this.stderrBuffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        this.onLog({
          serverId: this.definition.id,
          level: 'info',
          message: trimmed.slice(0, 4_096)
        })
      }
    }
  }

  private logError(message: string): void {
    this.onLog({
      serverId: this.definition.id,
      level: 'error',
      message: message.slice(0, 4_096)
    })
  }

  private fail(message: string): void {
    if (this.stopped) {
      return
    }
    this.status.state = 'error'
    this.status.message = message
    this.onStatus({ ...this.status })
    this.logError(message)
    try {
      this.child.kill('SIGTERM')
    } catch {
      // The process may already be gone.
    }
  }
}

export class LspManager {
  private readonly send: (channel: string, payload: unknown) => void
  private readonly servers = new Map<string, LanguageServerProcess>()
  private readonly statuses = new Map<string, LspServerStatus>()
  private readonly startPromises = new Map<string, Promise<LanguageServerProcess | null>>()
  private readonly failureTimes = new Map<string, number>()
  private definitionsCache: { root: string; definitions: ServerDefinition[]; configError: string | null } | null =
    null
  private root: string | null = null

  constructor(send: (channel: string, payload: unknown) => void) {
    this.send = send
  }

  setWorkspace(root: string): void {
    this.stopAll()
    this.root = root
    this.definitionsCache = null
    this.statuses.clear()
    this.failureTimes.clear()
    this.send('lsp:status', { servers: [] } satisfies LspStatusEvent)
  }

  async dispose(): Promise<void> {
    this.stopAll()
    this.root = null
    this.definitionsCache = null
    this.statuses.clear()
    this.failureTimes.clear()
  }

  private stopAll(): void {
    for (const server of this.servers.values()) {
      server.stop()
    }
    this.servers.clear()
    this.startPromises.clear()
  }

  getStatuses(): LspServerStatus[] {
    return [...this.statuses.values()]
      .map((status) => ({ ...status }))
      .sort((left, right) => left.label.localeCompare(right.label, 'fr'))
  }

  private publishStatuses(): void {
    this.send('lsp:status', {
      servers: this.getStatuses()
    } satisfies LspStatusEvent)
  }

  private updateStatus(status: LspServerStatus): void {
    if (!this.root) {
      return
    }
    this.statuses.set(status.id, status)
    if (status.state === 'error') {
      this.failureTimes.set(status.id, Date.now())
    }
    this.publishStatuses()
  }

  private async loadDefinitions(root: string): Promise<{
    definitions: ServerDefinition[]
    configError: string | null
  }> {
    if (this.definitionsCache?.root === root) {
      return {
        definitions: this.definitionsCache.definitions,
        configError: this.definitionsCache.configError
      }
    }

    const definitions: ServerDefinition[] = BUILTIN_DEFINITIONS.map((definition) => ({
      ...definition,
      command: null,
      args: [],
      env: {},
      initializationOptions: undefined,
      custom: false
    }))
    let configError: string | null = null
    const configPath = path.join(root, CONFIG_FILE)

    try {
      const stats = await fs.stat(configPath)
      if (stats.isFile() && stats.size <= 1_048_576) {
        const parsed = parseJsonc<ServerConfigFile>(await fs.readFile(configPath, 'utf8'))
        const servers = parsed.servers
        if (!Array.isArray(servers)) {
          throw new Error('La clé « servers » doit contenir un tableau.')
        }

        for (const rawEntry of servers.slice(0, 100)) {
          const entry = asRecord(rawEntry) as ServerConfigEntry | null
          const id = normalizeServerId(entry?.id)
          const label =
            typeof entry?.label === 'string' && entry.label.length > 0 && entry.label.length <= 120
              ? entry.label
              : id
          const languages = readStringArray(entry?.languages, 30)
            .map(normalizeLanguageId)
            .filter((language): language is string => language !== null)
          const command =
            typeof entry?.command === 'string' &&
            entry.command.length > 0 &&
            entry.command.length <= 4_096 &&
            !entry.command.includes('\0')
              ? entry.command
              : null
          if (!id || !label || languages.length === 0 || !command) {
            continue
          }

          const existingIndex = definitions.findIndex((definition) => definition.id === id)
          const definition: ServerDefinition = {
            id,
            label,
            languages,
            candidates: [{ command, args: readStringArray(entry?.args, 100) }],
            command,
            args: readStringArray(entry?.args, 100),
            env: readStringRecord(entry?.env),
            initializationOptions: entry?.initializationOptions,
            custom: true
          }
          if (existingIndex === -1) {
            definitions.unshift(definition)
          } else {
            definitions[existingIndex] = definition
          }
        }
      }
    } catch (error) {
      configError =
        error instanceof Error
          ? `Configuration des serveurs de langage invalide : ${error.message}`
          : 'Configuration des serveurs de langage invalide.'
    }

    this.definitionsCache = { root, definitions, configError }
    return { definitions, configError }
  }

  private definitionForLanguage(
    definitions: ServerDefinition[],
    languageId: string
  ): ServerDefinition | null {
    const custom = definitions.find(
      (definition) => definition.custom && definition.languages.includes(languageId)
    )
    if (custom) {
      return custom
    }
    return definitions.find((definition) => definition.languages.includes(languageId)) ?? null
  }

  private async resolveCommand(
    definition: ServerDefinition
  ): Promise<{ command: string; args: string[] } | null> {
    const candidates = definition.custom
      ? definition.candidates
      : definition.candidates
    for (const candidate of candidates) {
      const command = await findExecutable(candidate.command)
      if (command) {
        return { command, args: candidate.args }
      }
    }
    return null
  }

  async ensure(languageIdInput: string, filePath: string): Promise<LspEnsureResult> {
    const languageId = normalizeLanguageId(languageIdInput)
    const root = this.root
    if (!languageId || !root || !pathIsInside(root, filePath)) {
      return {
        available: false,
        serverId: null,
        status: null,
        message: 'Service de langage indisponible.'
      }
    }

    const existingServer = [...this.servers.values()].find(
      (server) =>
        server.isRunning &&
        (server.definition.languages.includes(languageId) || server.hasDocument(filePath))
    )
    if (existingServer) {
      return {
        available: true,
        serverId: existingServer.definition.id,
        status: existingServer.statusSnapshot,
        message: existingServer.statusSnapshot.message
      }
    }

    const { definitions, configError } = await this.loadDefinitions(root)
    const definition = this.definitionForLanguage(definitions, languageId)
    if (!definition) {
      return {
        available: false,
        serverId: null,
        status: null,
        message: configError ?? this.validLanguageWithoutServer(languageId)
      }
    }

    const lastFailure = this.failureTimes.get(definition.id) ?? 0
    if (Date.now() - lastFailure < FAILURE_COOLDOWN_MS) {
      return {
        available: false,
        serverId: definition.id,
        status: this.statuses.get(definition.id) ?? null,
        message: this.statuses.get(definition.id)?.message ?? 'Le serveur de langage a échoué récemment.'
      }
    }

    const existingStart = this.startPromises.get(definition.id)
    if (existingStart) {
      const server = await existingStart
      return server
        ? {
            available: true,
            serverId: definition.id,
            status: server.statusSnapshot,
            message: server.statusSnapshot.message
          }
        : {
            available: false,
            serverId: definition.id,
            status: this.statuses.get(definition.id) ?? null,
            message: this.statuses.get(definition.id)?.message ?? 'Serveur de langage indisponible.'
          }
    }

    const startPromise = this.startServer(definition, root, configError)
    this.startPromises.set(definition.id, startPromise)
    try {
      const server = await startPromise
      return server
        ? {
            available: true,
            serverId: definition.id,
            status: server.statusSnapshot,
            message: server.statusSnapshot.message
          }
        : {
            available: false,
            serverId: definition.id,
            status: this.statuses.get(definition.id) ?? null,
            message: this.statuses.get(definition.id)?.message ?? 'Serveur de langage indisponible.'
          }
    } finally {
      this.startPromises.delete(definition.id)
    }
  }

  private validLanguageWithoutServer(languageId: string): string {
    if (['javascript', 'typescript', 'json', 'css', 'scss', 'less', 'html'].includes(languageId)) {
      return 'Ce langage utilise les services intégrés de Monaco.'
    }
    return `Aucun serveur de langage n’est configuré pour « ${languageId} ».`
  }

  private async startServer(
    definition: ServerDefinition,
    root: string,
    configError: string | null
  ): Promise<LanguageServerProcess | null> {
    const existing = this.servers.get(definition.id)
    if (existing?.isRunning) {
      return existing
    }

    const command = await this.resolveCommand(definition)
    if (!command) {
      const message = configError
        ? configError
        : `Serveur ${definition.label} introuvable. Installez « ${
            definition.candidates[0]?.command ?? definition.label
          } » pour activer les fonctions de langage.`
      const status: LspServerStatus = {
        id: definition.id,
        label: definition.label,
        languages: definition.languages,
        state: 'unavailable',
        command: null,
        message
      }
      this.statuses.set(definition.id, status)
      this.failureTimes.set(definition.id, Date.now())
      this.publishStatuses()
      this.send('lsp:log', {
        serverId: definition.id,
        level: 'warning',
        message
      } satisfies LspLogEvent)
      return null
    }

    const resolvedDefinition: ServerDefinition = {
      ...definition,
      command: command.command,
      args: command.args
    }

    const status: LspServerStatus = {
      id: definition.id,
      label: definition.label,
      languages: definition.languages,
      state: 'starting',
      command: [command.command, ...command.args].join(' '),
      message: `Démarrage de ${definition.label}…`
    }
    this.statuses.set(definition.id, status)
    this.publishStatuses()

    let server: LanguageServerProcess
    try {
      server = new LanguageServerProcess(
        resolvedDefinition,
        root,
        {
          onStatus: (nextStatus) => {
            this.updateStatus(nextStatus)
          },
          onDiagnostics: (event) => {
            this.send('lsp:diagnostics', event)
          },
          onLog: (event) => {
            this.send('lsp:log', event)
          },
          onExit: (id) => {
            if (this.servers.get(id) === server) {
              this.servers.delete(id)
            }
            this.publishStatuses()
          }
        }
      )
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Impossible de démarrer le serveur de langage.'
      this.statuses.set(definition.id, {
        ...status,
        state: 'error',
        message
      })
      this.failureTimes.set(definition.id, Date.now())
      this.publishStatuses()
      return null
    }

    this.servers.set(definition.id, server)
    try {
      await server.initialize()
      return server
    } catch (error) {
      this.servers.delete(definition.id)
      this.failureTimes.set(definition.id, Date.now())
      return null
    }
  }

  didOpen(filePath: string, languageId: string, version: number, text: string): void {
    const server = this.serverForDocument(filePath, languageId)
    if (!server) {
      return
    }
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return
    }
    try {
      server.openDocument(filePath, languageId, version, text)
    } catch (error) {
      this.send('lsp:log', {
        serverId: server.definition.id,
        level: 'error',
        message: error instanceof Error ? error.message : String(error)
      } satisfies LspLogEvent)
    }
  }

  didChange(filePath: string, version: number, text: string): void {
    const server = [...this.servers.values()].find((candidate) => candidate.hasDocument(filePath))
    if (!server || typeof version !== 'number' || !Number.isInteger(version)) {
      return
    }
    server.changeDocument(filePath, version, text)
  }

  didSave(filePath: string): void {
    const server = [...this.servers.values()].find((candidate) => candidate.hasDocument(filePath))
    server?.saveDocument(filePath)
  }

  didClose(filePath: string): void {
    const server = [...this.servers.values()].find((candidate) => candidate.hasDocument(filePath))
    server?.closeDocument(filePath)
  }

  private serverForDocument(
    filePath: string,
    languageId?: string
  ): LanguageServerProcess | null {
    const existing = [...this.servers.values()].find((server) => server.hasDocument(filePath))
    if (existing) {
      return existing
    }

    const matching = [...this.servers.values()].filter(
      (server) => server.isRunning && (!languageId || server.definition.languages.includes(languageId))
    )
    return matching[0] ?? null
  }

  private serverForRequest(filePath: string): LanguageServerProcess | null {
    return (
      [...this.servers.values()].find(
        (server) => server.hasDocument(filePath) && server.isRunning
      ) ?? null
    )
  }

  private async requestForFile<T>(
    filePath: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<T | null> {
    const server = this.serverForRequest(filePath)
    if (!server) {
      return null
    }

    try {
      return await server.request<T>(method, params)
    } catch (error) {
      this.send('lsp:log', {
        serverId: server.definition.id,
        level: 'error',
        message: error instanceof Error ? error.message : String(error)
      } satisfies LspLogEvent)
      return null
    }
  }

  private textDocumentPosition(filePath: string, positionInput: unknown): {
    textDocument: { uri: string }
    position: LspPosition
  } | null {
    const position = normalizePosition(positionInput)
    if (!position || !this.root || !pathIsInside(this.root, filePath)) {
      return null
    }
    return {
      textDocument: { uri: pathToFileURL(filePath).href },
      position
    }
  }

  async hover(filePath: string, positionInput: unknown): Promise<LspHover | null> {
    const position = this.textDocumentPosition(filePath, positionInput)
    if (!position) {
      return null
    }

    const result = await this.requestForFile<unknown>(filePath, 'textDocument/hover', position)
    const record = asRecord(result)
    if (!record || record.contents === undefined) {
      return null
    }

    const contents = hoverText(record.contents).trim()
    if (!contents) {
      return null
    }
    return {
      contents,
      range: normalizeRange(record.range)
    }
  }

  async completion(
    filePath: string,
    positionInput: unknown,
    triggerCharacterInput: unknown
  ): Promise<LspCompletionItem[]> {
    const position = this.textDocumentPosition(filePath, positionInput)
    if (!position) {
      return []
    }

    const triggerCharacter =
      typeof triggerCharacterInput === 'string' && triggerCharacterInput.length > 0
        ? triggerCharacterInput.slice(0, 4)
        : null
    const result = await this.requestForFile<unknown>(filePath, 'textDocument/completion', {
      ...position,
      context: triggerCharacter
        ? { triggerKind: 2, triggerCharacter }
        : { triggerKind: 1 }
    })
    const record = asRecord(result)
    const rawItems = Array.isArray(result)
      ? result
      : Array.isArray(record?.items)
        ? record.items
        : []

    const items: LspCompletionItem[] = []
    for (const rawItem of rawItems.slice(0, MAX_COMPLETION_ITEMS)) {
      const item = asRecord(rawItem) as CompletionPayload | null
      if (!item) {
        continue
      }
      const rawLabel = item.label
      const label =
        typeof rawLabel === 'string'
          ? rawLabel
          : typeof asRecord(rawLabel)?.label === 'string'
            ? String(asRecord(rawLabel)?.label)
            : null
      if (!label) {
        continue
      }

      const textEditRecord = asRecord(item.textEdit)
      const textEditRange = normalizeCompletionRange(item.textEdit)
      const newText =
        typeof textEditRecord?.newText === 'string'
          ? textEditRecord.newText
          : typeof item.insertText === 'string'
            ? item.insertText
            : label
      items.push({
        label: label.slice(0, 1_000),
        kind: typeof item.kind === 'number' ? item.kind : 1,
        detail: typeof item.detail === 'string' ? item.detail.slice(0, 4_096) : null,
        documentation: documentationText(item.documentation),
        insertText: newText.slice(0, 64 * 1024),
        insertTextFormat: item.insertTextFormat === 2 ? 2 : 1,
        textEdit: textEditRange ? { range: textEditRange, newText: newText.slice(0, 64 * 1024) } : null,
        additionalTextEdits: normalizeTextEdits(item.additionalTextEdits),
        sortText: typeof item.sortText === 'string' ? item.sortText.slice(0, 256) : null,
        filterText: typeof item.filterText === 'string' ? item.filterText.slice(0, 1_000) : null
      })
    }

    return items
  }

  async definition(filePath: string, positionInput: unknown): Promise<LspLocation[]> {
    const position = this.textDocumentPosition(filePath, positionInput)
    if (!position) {
      return []
    }
    const result = await this.requestForFile<unknown>(filePath, 'textDocument/definition', position)
    return this.normalizeLocations(result, 100)
  }

  async references(filePath: string, positionInput: unknown): Promise<LspLocation[]> {
    const position = this.textDocumentPosition(filePath, positionInput)
    if (!position) {
      return []
    }
    const result = await this.requestForFile<unknown>(filePath, 'textDocument/references', {
      ...position,
      context: { includeDeclaration: true }
    })
    return this.normalizeLocations(result, MAX_REFERENCES)
  }

  private normalizeLocations(value: unknown, limit: number): LspLocation[] {
    if (!Array.isArray(value)) {
      return []
    }

    const locations: LspLocation[] = []
    for (const rawLocation of value.slice(0, limit)) {
      const record = asRecord(rawLocation) as LocationPayload | null
      if (!record) {
        continue
      }
      const uri =
        typeof record.targetUri === 'string'
          ? record.targetUri
          : typeof record.uri === 'string'
            ? record.uri
            : null
      const range = normalizeRange(record.targetSelectionRange ?? record.targetRange ?? record.range)
      if (!uri || !range) {
        continue
      }
      const locationPath = this.uriToRootPath(uri)
      if (!locationPath) {
        continue
      }
      locations.push({ path: locationPath, range })
    }

    return locations
  }

  private uriToRootPath(uri: string): string | null {
    if (!this.root || !uri.startsWith('file:')) {
      return null
    }
    try {
      const filePath = fileURLToPath(uri)
      return pathIsInside(this.root, filePath) ? filePath : null
    } catch {
      return null
    }
  }

  async documentSymbols(filePath: string): Promise<LspDocumentSymbol[]> {
    if (!this.root || !pathIsInside(this.root, filePath)) {
      return []
    }
    const result = await this.requestForFile<unknown>(filePath, 'textDocument/documentSymbol', {
      textDocument: { uri: pathToFileURL(filePath).href }
    })
    if (!Array.isArray(result)) {
      return []
    }

    return result
      .map(normalizeDocumentSymbol)
      .filter((symbol): symbol is LspDocumentSymbol => symbol !== null)
  }

  async workspaceSymbols(queryInput: unknown): Promise<LspWorkspaceSymbol[]> {
    const query = typeof queryInput === 'string' ? queryInput.slice(0, 200) : ''
    if (!this.root) {
      return []
    }

    const results = await Promise.all(
      [...new Set([...this.servers.values()].filter((server) => server.isRunning))].map(
        async (server): Promise<LspWorkspaceSymbol[]> => {
          try {
            const value = await server.request<unknown>('workspace/symbol', { query })
            if (!Array.isArray(value)) {
              return []
            }
            return value
              .slice(0, MAX_WORKSPACE_SYMBOLS)
              .map((rawSymbol): LspWorkspaceSymbol | null => {
                const record = asRecord(rawSymbol) as SymbolPayload | null
                const name = typeof record?.name === 'string' ? record.name.slice(0, 512) : null
                const locationRecord = asRecord(record?.location) as LocationPayload | null
                const uri = typeof locationRecord?.uri === 'string' ? locationRecord.uri : null
                const range = normalizeRange(locationRecord?.range)
                if (!name || !uri || !range) {
                  return null
                }
                const locationPath = this.uriToRootPath(uri)
                if (!locationPath) {
                  return null
                }
                return {
                  name,
                  kind: typeof record?.kind === 'number' ? record.kind : 13,
                  containerName:
                    typeof record?.containerName === 'string'
                      ? record.containerName.slice(0, 512)
                      : null,
                  location: { path: locationPath, range }
                }
              })
              .filter((symbol): symbol is LspWorkspaceSymbol => symbol !== null)
          } catch {
            return []
          }
        }
      )
    )

    return results.flat().slice(0, MAX_WORKSPACE_SYMBOLS)
  }

  async formatting(
    filePath: string,
    tabSize: number,
    insertSpaces: boolean
  ): Promise<LspTextEdit[]> {
    if (!this.root || !pathIsInside(this.root, filePath)) {
      return []
    }
    const result = await this.requestForFile<unknown>(filePath, 'textDocument/formatting', {
      textDocument: { uri: pathToFileURL(filePath).href },
      options: {
        tabSize: Number.isFinite(tabSize) ? Math.min(8, Math.max(1, Math.floor(tabSize))) : 2,
        insertSpaces: insertSpaces === true
      }
    })
    return normalizeTextEdits(result)
  }

  async rename(
    filePath: string,
    positionInput: unknown,
    newNameInput: string
  ): Promise<LspWorkspaceEdit | null> {
    const position = this.textDocumentPosition(filePath, positionInput)
    const newName = typeof newNameInput === 'string' ? newNameInput.trim() : ''
    if (!position || !newName || newName.length > 512) {
      return null
    }

    const result = await this.requestForFile<unknown>(filePath, 'textDocument/rename', {
      ...position,
      newName
    })
    const record = asRecord(result) as WorkspaceEditPayload | null
    if (!record) {
      return null
    }

    const changes: Array<{ path: string; edits: LspTextEdit[] }> = []
    const changesRecord = asRecord(record.changes)
    if (changesRecord) {
      for (const [uri, rawEdits] of Object.entries(changesRecord)) {
        const targetPath = this.uriToRootPath(uri)
        const edits = normalizeTextEdits(rawEdits)
        if (targetPath && edits.length > 0) {
          changes.push({ path: targetPath, edits })
        }
      }
    }

    if (Array.isArray(record.documentChanges)) {
      for (const rawChange of record.documentChanges) {
        const changeRecord = asRecord(rawChange)
        const textDocument = asRecord(changeRecord?.textDocument)
        const uri = typeof textDocument?.uri === 'string' ? textDocument.uri : null
        const targetPath = uri ? this.uriToRootPath(uri) : null
        const edits = normalizeTextEdits(changeRecord?.edits)
        if (targetPath && edits.length > 0) {
          changes.push({ path: targetPath, edits })
        }
      }
    }

    return changes.length > 0 ? { changes } : null
  }

  async signatureHelp(
    filePath: string,
    positionInput: unknown
  ): Promise<LspSignatureHelp | null> {
    const position = this.textDocumentPosition(filePath, positionInput)
    if (!position) {
      return null
    }
    const result = await this.requestForFile<unknown>(filePath, 'textDocument/signatureHelp', position)
    const record = asRecord(result)
    if (!record || !Array.isArray(record.signatures)) {
      return null
    }

    const signatures = record.signatures
      .slice(0, 20)
      .map((rawSignature) => {
        const signature = asRecord(rawSignature)
        if (!signature || typeof signature.label !== 'string') {
          return null
        }
        const parameters = Array.isArray(signature.parameters)
          ? signature.parameters
              .slice(0, 100)
              .map((rawParameter) => {
                const parameter = asRecord(rawParameter)
                const label = parameter?.label
                const parameterLabel =
                  typeof label === 'string'
                    ? label
                    : Array.isArray(label)
                      ? label.map((part) => String(part)).join(', ')
                      : ''
                return {
                  label: parameterLabel.slice(0, 512),
                  documentation: documentationText(parameter?.documentation)
                }
              })
          : []
        return {
          label: signature.label.slice(0, 4_096),
          documentation: documentationText(signature.documentation),
          parameters,
          activeParameter:
            typeof signature.activeParameter === 'number' ? signature.activeParameter : 0
        }
      })
      .filter((signature): signature is NonNullable<typeof signature> => signature !== null)

    return {
      signatures,
      activeSignature:
        typeof record.activeSignature === 'number' ? record.activeSignature : 0
    }
  }
}
