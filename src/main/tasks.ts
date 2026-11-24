import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { WebContents } from 'electron'
import type {
  TaskDefinition,
  TaskExitEvent,
  TaskOutputEvent,
  TaskProblem,
  TaskProblemsEvent,
  TaskRun,
  TaskRunStatus
} from '../preload'
import { parseJsonc } from './jsonc'
import { childEnvironment, findExecutable, firstExecutable } from './processUtils'

const MAX_TASK_RUNS = 4
const MAX_CONFIG_BYTES = 1024 * 1024
const MAX_PROBLEMS = 1_000
const MAX_LINE_BUFFER = 16 * 1024

interface CompiledProblemPattern {
  regexp: RegExp
  file: number
  line: number
  column: number
  severity: number
  message: number
}

type TaskProblemMatcher =
  | { kind: 'eslint-stylish' }
  | { kind: 'pattern'; pattern: CompiledProblemPattern }

interface InternalTask extends TaskDefinition {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  useNodeRuntime: boolean
  problemMatchers: TaskProblemMatcher[]
}

interface TaskProcess {
  run: TaskRun
  owner: WebContents
  root: string
  child: ChildProcess
  task: InternalTask
  problems: TaskProblem[]
  problemKeys: Set<string>
  pendingProblemFile: string
  problemTimer: NodeJS.Timeout | null
  lineBuffers: Record<'stdout' | 'stderr', string>
  stoppedByUser: boolean
  finished: boolean
}

interface TaskFileEntry {
  label?: unknown
  type?: unknown
  command?: unknown
  args?: unknown
  group?: unknown
  options?: unknown
  env?: unknown
  problemMatcher?: unknown
}

interface TaskFile {
  tasks?: unknown
}

type SendEvent = (owner: WebContents, channel: string, payload: unknown) => void

function pathIsInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

function expandTaskString(
  value: string,
  root: string,
  activeFile: string | null
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

function expandTaskRecord(
  value: Record<string, string>,
  root: string,
  activeFile: string | null
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      expandTaskString(entry, root, activeFile)
    ])
  )
}

function safeString(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    ? value
    : null
}

function readGroup(value: unknown): string {
  if (typeof value === 'string' && value.length <= 80) {
    return value
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const kind = (value as { kind?: unknown }).kind
    if (typeof kind === 'string' && kind.length <= 80) {
      return kind
    }
  }
  return 'tâche'
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (
      typeof entry === 'string' &&
      key.length > 0 &&
      key.length <= 256 &&
      !key.includes('\0') &&
      entry.length <= 16_384 &&
      !entry.includes('\0')
    ) {
      result[key] = entry
    }
  }
  return result
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const stats = await fs.stat(filePath)
  if (!stats.isFile() || stats.size > MAX_CONFIG_BYTES) {
    throw new Error('Fichier de configuration trop volumineux.')
  }
  return parseJsonc<unknown>(await fs.readFile(filePath, 'utf8'))
}

async function exists(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function quoteWindows(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function shellInvocation(command: string, args: string[]): {
  command: string
  args: string[]
} {
  const combined = [command, ...args.map((arg) => (process.platform === 'win32' ? quoteWindows(arg) : quotePosix(arg)))].join(' ')
  if (process.platform === 'win32') {
    return {
      command: process.env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', combined]
    }
  }
  return {
    command: '/bin/sh',
    args: ['-lc', combined]
  }
}

function readPatternIndex(value: unknown, required: boolean): number | null {
  if (value === undefined || value === null) {
    return required ? null : 0
  }
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 100
    ? (value as number)
    : null
}

function readProblemPattern(value: unknown): CompiledProblemPattern | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  const source = safeString(record.regexp, 4_096)
  const file = readPatternIndex(record.file, true)
  const line = readPatternIndex(record.line, true)
  const column = readPatternIndex(record.column, false)
  const severity = readPatternIndex(record.severity, false)
  const message = readPatternIndex(record.message, true)
  if (!source || file === null || line === null || column === null || severity === null || message === null) {
    return null
  }
  try {
    return {
      regexp: new RegExp(source),
      file,
      line,
      column,
      severity,
      message
    }
  } catch {
    return null
  }
}

function readProblemMatcher(value: unknown, depth = 0): TaskProblemMatcher[] {
  if (depth > 2) {
    return []
  }
  if (typeof value === 'string') {
    return value.toLocaleLowerCase() === '$eslint-stylish'
      ? [{ kind: 'eslint-stylish' }]
      : []
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => readProblemMatcher(entry, depth + 1)).slice(0, 8)
  }
  if (!value || typeof value !== 'object') {
    return []
  }
  const record = value as Record<string, unknown>
  const base = typeof record.base === 'string' ? record.base.toLocaleLowerCase() : ''
  if (!record.pattern && base === '$eslint-stylish') {
    return [{ kind: 'eslint-stylish' }]
  }
  const patternValue = Array.isArray(record.pattern) && record.pattern.length === 1
    ? record.pattern[0]
    : record.pattern
  const pattern = readProblemPattern(patternValue)
  return pattern ? [{ kind: 'pattern', pattern }] : []
}

async function readPackageTasks(root: string): Promise<InternalTask[]> {
  const packagePath = path.join(root, 'package.json')
  if (!(await exists(packagePath))) {
    return []
  }

  const parsed = await readJsonFile(packagePath)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return []
  }

  const scripts = (parsed as { scripts?: unknown }).scripts
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    return []
  }

  const npmCommand =
    process.platform === 'win32'
      ? (await findExecutable('npm.cmd')) ?? (await findExecutable('npm')) ?? 'npm.cmd'
      : (await findExecutable('npm')) ?? 'npm'

  return Object.entries(scripts)
    .filter((entry): entry is [string, string] => {
      const [name, command] = entry
      return (
        name.length > 0 &&
        name.length <= 200 &&
        !name.includes('\0') &&
        typeof command === 'string' &&
        command.length <= 4_096 &&
        !command.includes('\0')
      )
    })
    .slice(0, 300)
    .map(([name, command]) => ({
      id: `package:${name}`,
      label: `npm : ${name}`,
      detail: command,
      group: 'npm',
      source: 'package',
      command: npmCommand,
      args: ['run', name],
      cwd: root,
      env: {},
      useNodeRuntime: false,
      problemMatchers: []
    }))
}

async function readConfiguredTasks(
  root: string,
  activeFile: string | null = null
): Promise<InternalTask[]> {
  const candidates = [
    path.join(root, '.cami', 'tasks.json'),
    path.join(root, '.vscode', 'tasks.json')
  ]
  let configPath: string | null = null
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      configPath = candidate
      break
    }
  }

  if (!configPath) {
    return []
  }

  const parsed = await readJsonFile(configPath)
  const tasks = (parsed as TaskFile | null)?.tasks
  if (!Array.isArray(tasks)) {
    throw new Error(`La configuration ${path.relative(root, configPath)} ne contient aucune tâche valide.`)
  }

  const result: InternalTask[] = []
  for (let index = 0; index < tasks.length && index < 300; index += 1) {
    const entry = tasks[index] as TaskFileEntry
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }

    const rawCommand = safeString(entry.command, 4_096)
    if (!rawCommand || rawCommand.includes('\0')) {
      continue
    }
    const command = expandTaskString(rawCommand, root, activeFile)
    if (!command) {
      continue
    }

    const label =
      safeString(entry.label, 200) ?? `Tâche ${index + 1}`
    const rawArgs = Array.isArray(entry.args) ? entry.args : []
    const args = rawArgs
      .filter((arg): arg is string => typeof arg === 'string' && arg.length <= 8_192 && !arg.includes('\0'))
      .slice(0, 256)
      .map((arg) => expandTaskString(arg, root, activeFile))
    const rawOptions =
      entry.options && typeof entry.options === 'object' && !Array.isArray(entry.options)
        ? (entry.options as { cwd?: unknown })
        : null
    const rawCwd = safeString(rawOptions?.cwd, 4_096)
    const expandedCwd = rawCwd ? expandTaskString(rawCwd, root, activeFile) : root
    const cwd = expandedCwd.includes('${') ? root : path.resolve(root, expandedCwd)
    if (!pathIsInside(root, cwd)) {
      throw new Error(`La tâche « ${label} » utilise un dossier de travail hors de l’espace ouvert.`)
    }

    const environment = expandTaskRecord(readStringRecord(entry.env), root, activeFile)
    const type = typeof entry.type === 'string' ? entry.type.toLocaleLowerCase() : 'process'
    const invocation =
      type === 'shell' ? shellInvocation(command, args) : { command, args }

    result.push({
      id: `config:${index}`,
      label,
      detail:
        args.length > 0 ? `${command} ${args.join(' ')}`.slice(0, 400) : command.slice(0, 400),
      group: readGroup(entry.group),
      source: 'config',
      command: invocation.command,
      args: invocation.args,
      cwd,
      env: environment,
      useNodeRuntime: false,
      problemMatchers: readProblemMatcher(entry.problemMatcher)
    })
  }

  return result
}

export async function listTasks(
  root: string,
  activeFile: string | null = null
): Promise<TaskDefinition[]> {
  const [packageTasks, configuredTasks] = await Promise.all([
    readPackageTasks(root),
    readConfiguredTasks(root, activeFile)
  ])

  return [...configuredTasks, ...packageTasks].map((task) => ({
    id: task.id,
    label: task.label,
    detail: task.detail,
    group: task.group,
    source: task.source
  }))
}

async function resolveTask(
  root: string,
  taskId: string,
  activeFile: string | null = null
): Promise<InternalTask> {
  const [packageTasks, configuredTasks] = await Promise.all([
    readPackageTasks(root),
    readConfiguredTasks(root, activeFile)
  ])
  const task = [...configuredTasks, ...packageTasks].find((candidate) => candidate.id === taskId)
  if (!task) {
    throw new Error('Cette tâche n’existe plus dans l’espace de travail.')
  }
  return task
}

async function resolveFileTask(root: string, filePathInput: string): Promise<InternalTask> {
  const filePath = path.resolve(filePathInput)
  if (!pathIsInside(root, filePath) || filePath === root) {
    throw new Error('Le fichier à exécuter se trouve hors du dossier de travail.')
  }

  let stats
  try {
    stats = await fs.stat(filePath)
  } catch {
    throw new Error('Le fichier à exécuter est introuvable.')
  }
  if (!stats.isFile()) {
    throw new Error('Le chemin à exécuter n’est pas un fichier.')
  }

  const name = path.basename(filePath)
  const extension = path.extname(filePath).toLocaleLowerCase()
  const runnable = (command: string, args: string[], useNodeRuntime = false): InternalTask => ({
    id: `file:${filePath}`,
    label: `Exécuter ${name}`,
    detail: `${path.basename(command)} ${args.join(' ')}`.slice(0, 400),
    group: 'exécution',
    source: 'auto',
    command,
    args,
    cwd: root,
    env: {},
    useNodeRuntime,
    problemMatchers: []
  })

  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    const node = await firstExecutable([{ command: 'node' }])
    if (node) {
      return runnable(node.command, [filePath])
    }

    return runnable(process.execPath, [filePath], true)
  }

  if (['.ts', '.mts', '.cts'].includes(extension)) {
    const runner = await firstExecutable([
      { command: 'tsx', args: [filePath] },
      { command: 'ts-node', args: [filePath] }
    ])
    if (!runner) {
      throw new Error(
        'Aucun exécuteur TypeScript n’est installé. Installez « tsx » ou utilisez une tâche configurée.'
      )
    }
    return runnable(runner.command, runner.args)
  }

  if (extension === '.py') {
    const python = await firstExecutable([
      { command: 'python3', args: [filePath] },
      { command: 'python', args: [filePath] }
    ])
    if (!python) {
      throw new Error('Python est introuvable sur cet appareil.')
    }
    return runnable(python.command, python.args)
  }

  if (extension === '.go') {
    const go = await findExecutable('go')
    if (!go) {
      throw new Error('Go est introuvable sur cet appareil.')
    }
    return runnable(go, ['run', filePath])
  }

  if (extension === '.rb') {
    const ruby = await findExecutable('ruby')
    if (!ruby) {
      throw new Error('Ruby est introuvable sur cet appareil.')
    }
    return runnable(ruby, [filePath])
  }

  if (extension === '.php') {
    const php = await findExecutable('php')
    if (!php) {
      throw new Error('PHP est introuvable sur cet appareil.')
    }
    return runnable(php, [filePath])
  }

  if (['.sh', '.bash', '.zsh'].includes(extension)) {
    const shellName = extension === '.zsh' ? 'zsh' : extension === '.bash' ? 'bash' : 'sh'
    const shell = await findExecutable(shellName)
    if (!shell) {
      throw new Error(`Le shell « ${shellName} » est introuvable.`)
    }
    return runnable(shell, [filePath])
  }

  throw new Error(`Aucun exécuteur n’est disponible pour les fichiers ${extension || 'sans extension'}.`)
}

export class TaskManager {
  private readonly runs = new Map<string, TaskProcess>()
  private readonly send: SendEvent

  constructor(send: SendEvent) {
    this.send = send
  }

  list(root: string, activeFile: string | null = null): Promise<TaskDefinition[]> {
    return listTasks(root, activeFile)
  }

  async run(
    root: string,
    taskId: string,
    owner: WebContents,
    activeFile: string | null = null
  ): Promise<TaskRun> {
    const task = await resolveTask(root, taskId, activeFile)
    return this.startTask(root, task, owner)
  }

  async runFile(root: string, filePath: string, owner: WebContents): Promise<TaskRun> {
    const task = await resolveFileTask(root, filePath)
    return this.startTask(root, task, owner)
  }

  private startTask(root: string, task: InternalTask, owner: WebContents): TaskRun {
    if (this.runs.size >= MAX_TASK_RUNS) {
      throw new Error('Trop de tâches sont déjà en cours d’exécution.')
    }

    const run: TaskRun = {
      id: randomUUID(),
      taskId: task.id,
      label: task.label,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null
    }

    const environment: NodeJS.ProcessEnv = {
      ...childEnvironment(),
      ...task.env
    }
    if (task.useNodeRuntime) {
      environment.ELECTRON_RUN_AS_NODE = '1'
    }

    const child = spawn(task.command, task.args, {
      cwd: task.cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32'
    })
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')

    const processEntry: TaskProcess = {
      run,
      owner,
      root,
      child,
      task,
      problems: [],
      problemKeys: new Set(),
      pendingProblemFile: '',
      problemTimer: null,
      lineBuffers: { stdout: '', stderr: '' },
      stoppedByUser: false,
      finished: false
    }
    this.runs.set(run.id, processEntry)

    child.stdout?.on('data', (text: string) => {
      this.publishOutput(processEntry, 'stdout', text)
    })
    child.stderr?.on('data', (text: string) => {
      this.publishOutput(processEntry, 'stderr', text)
    })

    child.on('error', (error) => {
      this.publishOutput(processEntry, 'stderr', `${error.message}\n`)
      this.finish(processEntry, null, error.message)
    })

    child.on('close', (exitCode, signal) => {
      this.flushProblemLine(processEntry, 'stdout')
      this.flushProblemLine(processEntry, 'stderr')
      this.finish(processEntry, exitCode, signal)
    })

    return run
  }

  stop(owner: WebContents, runId: string): void {
    const entry = this.runs.get(runId)
    if (!entry || entry.owner.id !== owner.id) {
      return
    }

    entry.stoppedByUser = true
    this.killProcess(entry)
  }

  stopForOwner(ownerId: number): void {
    for (const entry of [...this.runs.values()]) {
      if (entry.owner.id === ownerId) {
        entry.stoppedByUser = true
        this.killProcess(entry)
      }
    }
  }

  stopAll(): void {
    for (const entry of [...this.runs.values()]) {
      entry.stoppedByUser = true
      this.killProcess(entry)
    }
  }

  private killProcess(entry: TaskProcess): void {
    if (entry.finished) {
      return
    }

    const pid = entry.child.pid
    if (!pid) {
      return
    }

    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true
      }, () => {
        // The close event finalizes the run.
      })
      return
    }

    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try {
        entry.child.kill('SIGTERM')
      } catch {
        // The child may have exited between the two attempts.
      }
    }

    const timer = setTimeout(() => {
      if (!entry.finished && entry.child.pid) {
        try {
          process.kill(-entry.child.pid, 'SIGKILL')
        } catch {
          try {
            entry.child.kill('SIGKILL')
          } catch {
            // The process is already gone.
          }
        }
      }
    }, 2_000)
    timer.unref()
  }

  private publishOutput(
    entry: TaskProcess,
    stream: 'stdout' | 'stderr',
    text: string
  ): void {
    if (!text) {
      return
    }

    const event: TaskOutputEvent = {
      runId: entry.run.id,
      stream,
      text
    }
    this.send(entry.owner, 'tasks:output', event)
    this.parseProblems(entry, stream, text)
  }

  private parseProblems(
    entry: TaskProcess,
    stream: 'stdout' | 'stderr',
    text: string
  ): void {
    const combined = `${entry.lineBuffers[stream]}${text}`
    const lines = combined.split(/\r?\n/)
    entry.lineBuffers[stream] = (lines.pop() ?? '').slice(-MAX_LINE_BUFFER)

    for (const line of lines) {
      this.parseProblemLine(entry, line)
    }
  }

  private flushProblemLine(entry: TaskProcess, stream: 'stdout' | 'stderr'): void {
    const remainder = entry.lineBuffers[stream]
    entry.lineBuffers[stream] = ''
    if (remainder) {
      this.parseProblemLine(entry, remainder)
    }
  }

  private parseProblemLine(entry: TaskProcess, line: string): void {
    if (entry.problems.length >= MAX_PROBLEMS || !line || line.length > 16_384) {
      return
    }

    const trimmed = line.trim()
    for (const matcher of entry.task.problemMatchers) {
      if (matcher.kind === 'eslint-stylish') {
        const stylish = /^\s+(\d+):(\d+)\s+(error|warning|info)\s+(.+?)(?:\s{2,}(\S.*))?$/i.exec(line)
        if (stylish && entry.pendingProblemFile) {
          this.addProblem(
            entry,
            entry.pendingProblemFile,
            Number.parseInt(stylish[1] ?? '', 10),
            Number.parseInt(stylish[2] ?? '', 10),
            stylish[3] ?? '',
            (stylish[4] ?? '').trim()
          )
          return
        }
        if (
          trimmed &&
          !/^\s/.test(line) &&
          /[\\/]/.test(trimmed) &&
          !/^\s*(error|warning|info)\b/i.test(trimmed)
        ) {
          entry.pendingProblemFile = trimmed
        }
        continue
      }

      const match = matcher.pattern.regexp.exec(trimmed)
      if (!match) {
        continue
      }
      this.addProblem(
        entry,
        (match[matcher.pattern.file] ?? '').trim(),
        Number.parseInt(match[matcher.pattern.line] ?? '', 10),
        matcher.pattern.column > 0
          ? Number.parseInt(match[matcher.pattern.column] ?? '', 10)
          : 1,
        matcher.pattern.severity > 0 ? (match[matcher.pattern.severity] ?? '') : 'error',
        (match[matcher.pattern.message] ?? '').trim()
      )
      return
    }

    const patterns: Array<{
      pattern: RegExp
      fileIndex: number
      lineIndex: number
      columnIndex: number
      severityIndex: number
      messageIndex: number
    }> = [
      {
        pattern: /^(.+?):(\d+):(\d+):\s*(error|warning|info|note)\s*:?\s*(.+)$/i,
        fileIndex: 1,
        lineIndex: 2,
        columnIndex: 3,
        severityIndex: 4,
        messageIndex: 5
      },
      {
        pattern: /^(.+?)\((\d+),(\d+)\):\s*(error|warning|info|note)\s+\w+:\s*(.+)$/i,
        fileIndex: 1,
        lineIndex: 2,
        columnIndex: 3,
        severityIndex: 4,
        messageIndex: 5
      },
      {
        pattern: /^(.+?):(\d+):\s*(error|warning|info|note)\s*:?\s*(.+)$/i,
        fileIndex: 1,
        lineIndex: 2,
        columnIndex: -1,
        severityIndex: 3,
        messageIndex: 4
      }
    ]

    for (const descriptor of patterns) {
      const match = descriptor.pattern.exec(trimmed)
      if (!match) {
        continue
      }
      this.addProblem(
        entry,
        (match[descriptor.fileIndex] ?? '').trim(),
        Number.parseInt(match[descriptor.lineIndex] ?? '', 10),
        descriptor.columnIndex === -1
          ? 1
          : Number.parseInt(match[descriptor.columnIndex] ?? '', 10),
        match[descriptor.severityIndex] ?? '',
        (match[descriptor.messageIndex] ?? '').trim()
      )
      return
    }
  }

  private addProblem(
    entry: TaskProcess,
    rawPath: string,
    lineNumber: number,
    columnNumber: number,
    severityTextValue: string,
    messageValue: string
  ): void {
    const severityText = severityTextValue.toLocaleLowerCase()
    const message = messageValue.slice(0, 4_000)
    if (
      !rawPath ||
      rawPath.startsWith('http://') ||
      rawPath.startsWith('https://') ||
      !Number.isFinite(lineNumber) ||
      lineNumber < 1 ||
      !Number.isFinite(columnNumber) ||
      columnNumber < 1 ||
      !message
    ) {
      return
    }

    const absolutePath = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(entry.task.cwd, rawPath)
    if (!pathIsInside(entry.root, absolutePath)) {
      return
    }

    const relativePath = path.relative(entry.root, absolutePath).split(path.sep).join('/')
    if (!relativePath || relativePath.startsWith('../')) {
      return
    }

    const problem: TaskProblem = {
      runId: entry.run.id,
      path: absolutePath,
      relativePath,
      line: lineNumber,
      column: columnNumber,
      severity:
        severityText === 'warning' || severityText === 'warn'
          ? 'warning'
          : severityText === 'note' || severityText === 'info' || severityText === 'information'
            ? 'info'
            : 'error',
      message,
      source: entry.run.label
    }
    const key = `${problem.path}:${problem.line}:${problem.column}:${problem.message}`
    if (!entry.problemKeys.has(key)) {
      entry.problemKeys.add(key)
      entry.problems.push(problem)
      this.scheduleProblems(entry)
    }
  }

  private scheduleProblems(entry: TaskProcess): void {
    if (entry.problemTimer) {
      return
    }

    entry.problemTimer = setTimeout(() => {
      entry.problemTimer = null
      const event: TaskProblemsEvent = {
        runId: entry.run.id,
        problems: entry.problems
      }
      this.send(entry.owner, 'tasks:problems', event)
    }, 180)
  }

  private finish(
    entry: TaskProcess,
    exitCode: number | null,
    signalOrError: NodeJS.Signals | string | null
  ): void {
    if (entry.finished) {
      return
    }

    entry.finished = true
    if (entry.problemTimer) {
      clearTimeout(entry.problemTimer)
      entry.problemTimer = null
    }

    const status: TaskRunStatus = entry.stoppedByUser
      ? 'stopped'
      : exitCode === 0
        ? 'success'
        : 'failed'
    const finishedRun: TaskRun = {
      ...entry.run,
      status,
      endedAt: Date.now(),
      exitCode
    }
    entry.run = finishedRun
    this.runs.delete(entry.run.id)

    const event: TaskExitEvent = {
      runId: entry.run.id,
      status,
      exitCode,
      signal: typeof signalOrError === 'string' ? signalOrError : null
    }
    this.send(entry.owner, 'tasks:exit', event)
    this.send(entry.owner, 'tasks:problems', {
      runId: entry.run.id,
      problems: entry.problems
    } satisfies TaskProblemsEvent)
  }
}
