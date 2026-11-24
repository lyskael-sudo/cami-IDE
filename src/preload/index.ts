import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export type MenuCommand =
  | 'open-workspace'
  | 'save-active'
  | 'save-all'
  | 'close-active-tab'
  | 'close-all-tabs'
  | 'toggle-terminal'
  | 'toggle-panel'
  | 'toggle-sidebar'
  | 'focus-search'
  | 'quick-open'
  | 'command-palette'
  | 'new-file'
  | 'new-folder'
  | 'split-editor'
  | 'close-split-editor'
  | 'show-problems'
  | 'show-output'
  | 'show-git'
  | 'show-debug'
  | 'show-tasks'
  | 'show-debug-console'
  | 'show-symbols'
  | 'workspace-symbols'
  | 'run-task'
  | 'debug-start-or-continue'
  | 'debug-stop'
  | 'debug-step-over'
  | 'debug-step-into'
  | 'debug-step-out'
  | 'debug-toggle-breakpoint'
  | 'format-document'

export type CloseDialogAction = 'save' | 'discard' | 'cancel'

export type PanelView = 'terminal' | 'problems' | 'output' | 'tasks' | 'debug'

export interface WorkspaceInfo {
  path: string
  name: string
}

export interface QuickOpenFile {
  path: string
  relativePath: string
}

export interface WorkspaceChangeEvent {
  revision: number
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
}

export type FileEncoding = 'UTF-8' | 'UTF-8 with BOM'
export type EndOfLine = 'LF' | 'CRLF'

export interface FileContents {
  path: string
  content: string
  encoding: FileEncoding
  eol: EndOfLine
  size: number
  mtimeMs: number
}

export interface WriteFileResult {
  size: number
  mtimeMs: number
}

export interface SearchOptions {
  caseSensitive?: boolean
}

export interface SearchMatch {
  path: string
  relativePath: string
  line: number
  column: number
  preview: string
}

export interface SearchResponse {
  matches: SearchMatch[]
  truncated: boolean
}

export interface GitStatus {
  isRepository: boolean
  branch: string | null
  ahead: number
  behind: number
  changes: number
}

export type GitFileStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | 'T'

export interface GitChange {
  path: string
  relativePath: string
  originalPath: string | null
  indexStatus: string
  worktreeStatus: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  status: GitFileStatusCode
}

export interface GitRepositoryState {
  isRepository: boolean
  root: string | null
  branch: string | null
  ahead: number
  behind: number
  changes: number
  staged: number
  unstaged: number
  untracked: number
  hasConflicts: boolean
  entries: GitChange[]
}

export interface GitBranches {
  current: string | null
  branches: string[]
}

export interface GitDiffData {
  path: string
  relativePath: string
  staged: boolean
  status: GitFileStatusCode
  original: string
  modified: string
  isBinary: boolean
}

export interface GitCommitResult {
  success: boolean
  message: string
}

export interface LspPosition {
  line: number
  character: number
}

export interface LspRange {
  start: LspPosition
  end: LspPosition
}

export interface LspLocation {
  path: string
  range: LspRange
}

export interface LspTextEdit {
  range: LspRange
  newText: string
}

export interface LspDiagnostic {
  range: LspRange
  severity: 1 | 2 | 3 | 4
  message: string
  source: string | null
  code: string | null
}

export interface LspCompletionItem {
  label: string
  kind: number
  detail: string | null
  documentation: string | null
  insertText: string
  insertTextFormat: 1 | 2
  textEdit: LspTextEdit | null
  additionalTextEdits: LspTextEdit[]
  sortText: string | null
  filterText: string | null
}

export interface LspHover {
  contents: string
  range: LspRange | null
}

export interface LspDocumentSymbol {
  name: string
  detail: string | null
  kind: number
  range: LspRange
  selectionRange: LspRange
  children: LspDocumentSymbol[]
}

export interface LspWorkspaceSymbol {
  name: string
  kind: number
  containerName: string | null
  location: LspLocation
}

export interface LspSignatureParameter {
  label: string
  documentation: string | null
}

export interface LspSignature {
  label: string
  documentation: string | null
  parameters: LspSignatureParameter[]
  activeParameter: number
}

export interface LspSignatureHelp {
  signatures: LspSignature[]
  activeSignature: number
}

export interface LspWorkspaceEdit {
  changes: Array<{
    path: string
    edits: LspTextEdit[]
  }>
}

export interface LspServerStatus {
  id: string
  label: string
  languages: string[]
  state: 'starting' | 'running' | 'error' | 'unavailable'
  command: string | null
  message: string
}

export interface LspEnsureResult {
  available: boolean
  serverId: string | null
  status: LspServerStatus | null
  message: string
}

export interface LspDiagnosticsEvent {
  serverId: string
  path: string
  diagnostics: LspDiagnostic[]
}

export interface LspStatusEvent {
  servers: LspServerStatus[]
}

export interface LspLogEvent {
  serverId: string
  level: 'info' | 'warning' | 'error'
  message: string
}

export interface TerminalCreateOptions {
  id: string
  cols: number
  rows: number
}

export interface TerminalSession {
  id: string
  shell: string
}

export interface TerminalDataEvent {
  id: string
  data: string
}

export interface TerminalExitEvent {
  id: string
  exitCode: number
  signal: number
}

export type GoleChatEvent =
  | { type: 'state'; state: 'starting' | 'running' | 'ready'; requestId?: string | null }
  | { type: 'thought'; text: string; requestId?: string | null }
  | {
      type: 'tool-call'
      name: string
      args: Record<string, unknown>
      requestId?: string | null
    }
  | {
      type: 'tool-result'
      name: string
      result: unknown
      isError: boolean
      requestId?: string | null
    }
  | { type: 'assistant'; text: string; requestId?: string | null }
  | { type: 'login-required'; message: string; requestId?: string | null }
  | { type: 'login-restored'; requestId?: string | null }
  | { type: 'error'; message: string; requestId?: string | null }

export type GoleBrowser = 'cami-browser' | 'chromium' | 'firefox' | 'brave' | 'librewolf' | 'tor'
export type GoleAIProvider = 'deepseek' | 'gemini'

export interface GolePreferences {
  browser: GoleBrowser
  ai: GoleAIProvider
}

export interface TaskDefinition {
  id: string
  label: string
  detail: string
  group: string
  source: 'package' | 'config' | 'auto'
}

export type TaskRunStatus = 'running' | 'success' | 'failed' | 'stopped'

export interface TaskRun {
  id: string
  taskId: string
  label: string
  status: TaskRunStatus
  startedAt: number
  endedAt: number | null
  exitCode: number | null
}

export interface TaskOutputEvent {
  runId: string
  stream: 'stdout' | 'stderr'
  text: string
}

export interface TaskExitEvent {
  runId: string
  status: TaskRunStatus
  exitCode: number | null
  signal: string | null
}

export interface TaskProblem {
  runId: string
  path: string
  relativePath: string
  line: number
  column: number
  severity: 'error' | 'warning' | 'info'
  message: string
  source: string
}

export interface TaskProblemsEvent {
  runId: string
  problems: TaskProblem[]
}

export interface DebugBreakpointInput {
  path: string
  line: number
  column?: number
}

export interface DebugBreakpointFile {
  path: string
  breakpoints: DebugBreakpointInput[]
}

export interface DebugConfiguration {
  id: string
  name: string
  type: 'node' | 'dap'
  request: 'launch' | 'attach'
  program: string | null
  args: string[]
  cwd: string | null
  env: Record<string, string>
  runtime: string | null
  runtimeArgs: string[]
  stopOnEntry: boolean
  pauseOnExceptions: boolean
  adapterCommand: string | null
  adapterArgs: string[]
  adapterEnv: Record<string, string>
  configuration: Record<string, unknown>
  source: 'launch.json' | 'auto'
}

export interface DebugConfigurationList {
  configurations: DebugConfiguration[]
  source: 'launch.json' | 'auto' | 'none'
  error: string | null
}

export interface DebugVerifiedBreakpoint {
  path: string
  line: number
  column: number
  verified: boolean
}

export interface DebugStackFrame {
  id: number
  name: string
  path: string | null
  relativePath: string | null
  line: number
  column: number
}

export interface DebugScope {
  name: string
  variablesReference: number
  expensive: boolean
}

export interface DebugVariable {
  name: string
  value: string
  type: string | null
  variablesReference: number
}

export interface DebugEvaluateResult {
  value: string
  type: string | null
  variablesReference: number
}

export type DebugSessionState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'error'

export type DebugEvent =
  | {
      type: 'state'
      state: DebugSessionState
      sessionName: string | null
      message: string | null
    }
  | {
      type: 'stopped'
      reason: string
      description: string | null
      threadId: number | null
    }
  | {
      type: 'continued'
    }
  | {
      type: 'console'
      category: 'stdout' | 'stderr' | 'console' | 'system'
      text: string
    }
  | {
      type: 'terminated'
      exitCode: number | null
    }
  | {
      type: 'breakpoints'
      breakpoints: DebugVerifiedBreakpoint[]
    }

export interface WindowAPI {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<boolean>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onMaximizedChange: (listener: (isMaximized: boolean) => void) => () => void
}

export interface WorkspaceAPI {
  open: () => Promise<WorkspaceInfo | null>
  current: () => Promise<WorkspaceInfo | null>
  restoreLast: () => Promise<WorkspaceInfo | null>
  readDirectory: (directoryPath?: string) => Promise<FileEntry[]>
  readFile: (filePath: string) => Promise<FileContents>
  writeFile: (filePath: string, content: string) => Promise<WriteFileResult>
  search: (query: string, options?: SearchOptions) => Promise<SearchResponse>
  gitStatus: () => Promise<GitStatus>
  reveal: (targetPath: string) => Promise<void>
  listFiles: () => Promise<QuickOpenFile[]>
  createFile: (parentPath: string, name: string) => Promise<string>
  createDirectory: (parentPath: string, name: string) => Promise<string>
  rename: (targetPath: string, newName: string) => Promise<string>
  deleteEntry: (targetPath: string) => Promise<void>
  onDidChange: (listener: (event: WorkspaceChangeEvent) => void) => () => void
}

export interface GitAPI {
  status: () => Promise<GitRepositoryState>
  diff: (filePath: string, staged: boolean) => Promise<GitDiffData>
  stage: (paths: string[]) => Promise<void>
  unstage: (paths: string[]) => Promise<void>
  stageAll: () => Promise<void>
  unstageAll: () => Promise<void>
  commit: (message: string) => Promise<GitCommitResult>
  branches: () => Promise<GitBranches>
  checkout: (branch: string) => Promise<void>
}

export interface LspAPI {
  statuses: () => Promise<LspServerStatus[]>
  ensure: (languageId: string, filePath: string) => Promise<LspEnsureResult>
  didOpen: (
    filePath: string,
    languageId: string,
    version: number,
    text: string
  ) => Promise<void>
  didChange: (filePath: string, version: number, text: string) => Promise<void>
  didSave: (filePath: string) => Promise<void>
  didClose: (filePath: string) => Promise<void>
  hover: (filePath: string, position: LspPosition) => Promise<LspHover | null>
  completion: (
    filePath: string,
    position: LspPosition,
    triggerCharacter: string | null
  ) => Promise<LspCompletionItem[]>
  definition: (filePath: string, position: LspPosition) => Promise<LspLocation[]>
  references: (filePath: string, position: LspPosition) => Promise<LspLocation[]>
  documentSymbols: (filePath: string) => Promise<LspDocumentSymbol[]>
  workspaceSymbols: (query: string) => Promise<LspWorkspaceSymbol[]>
  formatting: (
    filePath: string,
    tabSize: number,
    insertSpaces: boolean
  ) => Promise<LspTextEdit[]>
  rename: (
    filePath: string,
    position: LspPosition,
    newName: string
  ) => Promise<LspWorkspaceEdit | null>
  signatureHelp: (
    filePath: string,
    position: LspPosition
  ) => Promise<LspSignatureHelp | null>
  onStatus: (listener: (event: LspStatusEvent) => void) => () => void
  onDiagnostics: (listener: (event: LspDiagnosticsEvent) => void) => () => void
  onLog: (listener: (event: LspLogEvent) => void) => () => void
}

export interface TaskAPI {
  list: (activeFilePath?: string | null) => Promise<TaskDefinition[]>
  run: (taskId: string, activeFilePath?: string | null) => Promise<TaskRun>
  runFile: (filePath: string) => Promise<TaskRun>
  stop: (runId: string) => Promise<void>
  onOutput: (listener: (event: TaskOutputEvent) => void) => () => void
  onExit: (listener: (event: TaskExitEvent) => void) => () => void
  onProblems: (listener: (event: TaskProblemsEvent) => void) => () => void
}

export interface DebugAPI {
  configurations: (activeFilePath?: string | null) => Promise<DebugConfigurationList>
  start: (
    configurationId: string,
    breakpoints: DebugBreakpointFile[],
    activeFilePath?: string | null
  ) => Promise<DebugVerifiedBreakpoint[]>
  startFile: (
    filePath: string,
    breakpoints: DebugBreakpointFile[]
  ) => Promise<DebugVerifiedBreakpoint[]>
  stop: () => Promise<void>
  continue: () => Promise<void>
  pause: () => Promise<void>
  next: () => Promise<void>
  stepIn: () => Promise<void>
  stepOut: () => Promise<void>
  setBreakpoints: (
    filePath: string,
    breakpoints: DebugBreakpointInput[]
  ) => Promise<DebugVerifiedBreakpoint[]>
  stackTrace: () => Promise<DebugStackFrame[]>
  scopes: (frameId: number) => Promise<DebugScope[]>
  variables: (variablesReference: number) => Promise<DebugVariable[]>
  evaluate: (expression: string, frameId: number | null) => Promise<DebugEvaluateResult>
  onEvent: (listener: (event: DebugEvent) => void) => () => void
}

export interface DialogAPI {
  confirmFileClose: (fileName: string) => Promise<CloseDialogAction>
  confirmWorkspaceChange: (dirtyCount: number) => Promise<CloseDialogAction>
  confirmDelete: (name: string, hasDirtyFiles: boolean) => Promise<boolean>
}

export interface AppAPI {
  setDirtyCount: (count: number) => Promise<void>
  onSaveAllBeforeClose: (listener: () => void) => () => void
}

export interface TerminalAPI {
  create: (options: TerminalCreateOptions) => Promise<TerminalSession>
  write: (id: string, data: string) => Promise<void>
  resize: (id: string, cols: number, rows: number) => Promise<void>
  dispose: (id: string) => Promise<void>
  onData: (listener: (event: TerminalDataEvent) => void) => () => void
  onExit: (listener: (event: TerminalExitEvent) => void) => () => void
}

export interface GoleAPI {
  command: () => Promise<string>
  getPreferences: () => Promise<GolePreferences>
  setPreferences: (preferences: GolePreferences) => Promise<void>
  send: (text: string, preferences: GolePreferences) => Promise<void>
  stop: () => Promise<void>
  onEvent: (listener: (event: GoleChatEvent) => void) => () => void
}

export interface MenuAPI {
  onCommand: (listener: (command: MenuCommand) => void) => () => void
}

export interface ElectronAPI {
  platform: NodeJS.Platform
  window: WindowAPI
  workspace: WorkspaceAPI
  git: GitAPI
  lsp: LspAPI
  tasks: TaskAPI
  debug: DebugAPI
  dialog: DialogAPI
  app: AppAPI
  terminal: TerminalAPI
  gole: GoleAPI
  menu: MenuAPI
}

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => {
    listener(payload)
  }

  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const electronAPI: ElectronAPI = {
  platform: process.platform,

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (listener) => subscribe<boolean>('window:maximized', listener)
  },

  workspace: {
    open: () => ipcRenderer.invoke('workspace:open'),
    current: () => ipcRenderer.invoke('workspace:current'),
    restoreLast: () => ipcRenderer.invoke('workspace:restore-last'),
    readDirectory: (directoryPath) =>
      ipcRenderer.invoke('workspace:read-directory', directoryPath),
    readFile: (filePath) => ipcRenderer.invoke('workspace:read-file', filePath),
    writeFile: (filePath, content) =>
      ipcRenderer.invoke('workspace:write-file', filePath, content),
    search: (query, options) => ipcRenderer.invoke('workspace:search', query, options),
    gitStatus: () => ipcRenderer.invoke('workspace:git-status'),
    reveal: (targetPath) => ipcRenderer.invoke('workspace:reveal', targetPath),
    listFiles: () => ipcRenderer.invoke('workspace:list-files'),
    createFile: (parentPath, name) =>
      ipcRenderer.invoke('workspace:create-file', parentPath, name),
    createDirectory: (parentPath, name) =>
      ipcRenderer.invoke('workspace:create-directory', parentPath, name),
    rename: (targetPath, newName) =>
      ipcRenderer.invoke('workspace:rename', targetPath, newName),
    deleteEntry: (targetPath) => ipcRenderer.invoke('workspace:delete', targetPath),
    onDidChange: (listener) => subscribe<WorkspaceChangeEvent>('workspace:changed', listener)
  },

  git: {
    status: () => ipcRenderer.invoke('git:status'),
    diff: (filePath, staged) => ipcRenderer.invoke('git:diff', filePath, staged),
    stage: (paths) => ipcRenderer.invoke('git:stage', paths),
    unstage: (paths) => ipcRenderer.invoke('git:unstage', paths),
    stageAll: () => ipcRenderer.invoke('git:stage-all'),
    unstageAll: () => ipcRenderer.invoke('git:unstage-all'),
    commit: (message) => ipcRenderer.invoke('git:commit', message),
    branches: () => ipcRenderer.invoke('git:branches'),
    checkout: (branch) => ipcRenderer.invoke('git:checkout', branch)
  },

  lsp: {
    statuses: () => ipcRenderer.invoke('lsp:statuses'),
    ensure: (languageId, filePath) => ipcRenderer.invoke('lsp:ensure', languageId, filePath),
    didOpen: (filePath, languageId, version, text) =>
      ipcRenderer.invoke('lsp:did-open', filePath, languageId, version, text),
    didChange: (filePath, version, text) =>
      ipcRenderer.invoke('lsp:did-change', filePath, version, text),
    didSave: (filePath) => ipcRenderer.invoke('lsp:did-save', filePath),
    didClose: (filePath) => ipcRenderer.invoke('lsp:did-close', filePath),
    hover: (filePath, position) => ipcRenderer.invoke('lsp:hover', filePath, position),
    completion: (filePath, position, triggerCharacter) =>
      ipcRenderer.invoke('lsp:completion', filePath, position, triggerCharacter),
    definition: (filePath, position) =>
      ipcRenderer.invoke('lsp:definition', filePath, position),
    references: (filePath, position) =>
      ipcRenderer.invoke('lsp:references', filePath, position),
    documentSymbols: (filePath) =>
      ipcRenderer.invoke('lsp:document-symbols', filePath),
    workspaceSymbols: (query) => ipcRenderer.invoke('lsp:workspace-symbols', query),
    formatting: (filePath, tabSize, insertSpaces) =>
      ipcRenderer.invoke('lsp:formatting', filePath, tabSize, insertSpaces),
    rename: (filePath, position, newName) =>
      ipcRenderer.invoke('lsp:rename', filePath, position, newName),
    signatureHelp: (filePath, position) =>
      ipcRenderer.invoke('lsp:signature-help', filePath, position),
    onStatus: (listener) => subscribe<LspStatusEvent>('lsp:status', listener),
    onDiagnostics: (listener) =>
      subscribe<LspDiagnosticsEvent>('lsp:diagnostics', listener),
    onLog: (listener) => subscribe<LspLogEvent>('lsp:log', listener)
  },

  tasks: {
    list: (activeFilePath) =>
      ipcRenderer.invoke('tasks:list', activeFilePath ?? null),
    run: (taskId, activeFilePath) =>
      ipcRenderer.invoke('tasks:run', taskId, activeFilePath ?? null),
    runFile: (filePath) => ipcRenderer.invoke('tasks:run-file', filePath),
    stop: (runId) => ipcRenderer.invoke('tasks:stop', runId),
    onOutput: (listener) => subscribe<TaskOutputEvent>('tasks:output', listener),
    onExit: (listener) => subscribe<TaskExitEvent>('tasks:exit', listener),
    onProblems: (listener) => subscribe<TaskProblemsEvent>('tasks:problems', listener)
  },

  debug: {
    configurations: (activeFilePath) =>
      ipcRenderer.invoke('debug:configurations', activeFilePath ?? null),
    start: (configurationId, breakpoints, activeFilePath) =>
      ipcRenderer.invoke('debug:start', configurationId, breakpoints, activeFilePath ?? null),
    startFile: (filePath, breakpoints) =>
      ipcRenderer.invoke('debug:start-file', filePath, breakpoints),
    stop: () => ipcRenderer.invoke('debug:stop'),
    continue: () => ipcRenderer.invoke('debug:continue'),
    pause: () => ipcRenderer.invoke('debug:pause'),
    next: () => ipcRenderer.invoke('debug:next'),
    stepIn: () => ipcRenderer.invoke('debug:step-in'),
    stepOut: () => ipcRenderer.invoke('debug:step-out'),
    setBreakpoints: (filePath, breakpoints) =>
      ipcRenderer.invoke('debug:set-breakpoints', filePath, breakpoints),
    stackTrace: () => ipcRenderer.invoke('debug:stack-trace'),
    scopes: (frameId) => ipcRenderer.invoke('debug:scopes', frameId),
    variables: (variablesReference) =>
      ipcRenderer.invoke('debug:variables', variablesReference),
    evaluate: (expression, frameId) =>
      ipcRenderer.invoke('debug:evaluate', expression, frameId),
    onEvent: (listener) => subscribe<DebugEvent>('debug:event', listener)
  },

  dialog: {
    confirmFileClose: (fileName) => ipcRenderer.invoke('dialog:confirm-file-close', fileName),
    confirmWorkspaceChange: (dirtyCount) =>
      ipcRenderer.invoke('dialog:confirm-workspace-change', dirtyCount),
    confirmDelete: (name, hasDirtyFiles) =>
      ipcRenderer.invoke('dialog:confirm-delete', name, hasDirtyFiles)
  },

  app: {
    setDirtyCount: (count) => ipcRenderer.invoke('app:set-dirty-count', count),
    onSaveAllBeforeClose: (listener) =>
      subscribe<undefined>('app:save-all-before-close', () => listener())
  },

  terminal: {
    create: (options) => ipcRenderer.invoke('terminal:create', options),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    dispose: (id) => ipcRenderer.invoke('terminal:dispose', id),
    onData: (listener) => subscribe<TerminalDataEvent>('terminal:data', listener),
    onExit: (listener) => subscribe<TerminalExitEvent>('terminal:exit', listener)
  },
  gole: {
    command: () => ipcRenderer.invoke('gole:command'),
    getPreferences: () => ipcRenderer.invoke('gole:preferences:get'),
    setPreferences: (preferences) => ipcRenderer.invoke('gole:preferences:set', preferences),
    send: (text, preferences) => ipcRenderer.invoke('gole-chat:send', text, preferences),
    stop: () => ipcRenderer.invoke('gole-chat:stop'),
    onEvent: (listener) => subscribe<GoleChatEvent>('gole-chat:event', listener)
  },
  menu: {
    onCommand: (listener) => subscribe<MenuCommand>('menu:command', listener)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
