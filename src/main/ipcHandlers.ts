import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  shell,
  type IpcMainInvokeEvent,
  type WebContents
} from 'electron'
import { promises as fs, watch, type Dirent, type FSWatcher } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import type { IPty } from 'node-pty'
import { GoleChatManager } from './goleChat'
import type {
  CloseDialogAction,
  DebugBreakpointFile,
  DebugBreakpointInput,
  FileContents,
  FileEntry,
  GoleAIProvider,
  GoleBrowser,
  GolePreferences,
  GitStatus,
  QuickOpenFile,
  SearchMatch,
  SearchOptions,
  SearchResponse,
  TerminalCreateOptions,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalSession,
  WorkspaceChangeEvent,
  WorkspaceInfo,
  WriteFileResult
} from '../preload'
import { DebugManager } from './debug'
import {
  checkoutGitBranch,
  commitGitChanges,
  getGitErrorMessage,
  readGitBranches,
  readGitDiff,
  readGitRepositoryState,
  stageAllGitPaths,
  stageGitPaths,
  unstageAllGitPaths,
  unstageGitPaths
} from './git'
import { LspManager } from './lsp'
import { TaskManager } from './tasks'

const MAX_TEXT_FILE_BYTES = 16 * 1024 * 1024
const MAX_SEARCH_FILE_BYTES = 1_500_000
const MAX_SEARCH_RESULTS = 200
const MAX_SEARCH_FILES = 8_000
const MAX_QUICK_OPEN_FILES = 20_000
const MAX_TERMINAL_SESSIONS = 4
const MAX_TERMINAL_DATA_LENGTH = 1_048_576
const WORKSPACE_WATCH_DEBOUNCE_MS = 180
const TERMINAL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const IGNORED_SEARCH_DIRECTORIES = new Set([
  '.git',
  '.cache',
  '.next',
  '.nuxt',
  '.turbo',
  'coverage',
  'dist',
  'dist-electron',
  'node_modules',
  'out',
  'release'
])

type WindowGetter = () => BrowserWindow | null

interface TerminalProcess {
  id: string
  owner: WebContents
  pty: IPty
}

let getMainWindow: WindowGetter = () => null
let workspaceRoot: string | null = null
const dirtyCounts = new WeakMap<BrowserWindow, number>()
const terminals = new Map<string, TerminalProcess>()
const goleChatManager = new GoleChatManager()
const watchedOwners = new Set<number>()
const registeredChannels = new Set<string>()
let nodePtyModule: Promise<typeof import('node-pty')> | null = null
let workspaceWatcher: FSWatcher | null = null
let workspaceWatchTimer: NodeJS.Timeout | null = null
let workspaceWatchRetryTimer: NodeJS.Timeout | null = null
let workspaceRevision = 0
let quickOpenCache: { root: string; files: QuickOpenFile[] } | null = null

function sendMainWindowEvent(channel: string, payload: unknown): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    sendToOwner(window.webContents, channel, payload)
  }
}

const taskManager = new TaskManager(sendToOwner)
const lspManager = new LspManager(sendMainWindowEvent)
const debugManager = new DebugManager((event) => {
  sendMainWindowEvent('debug:event', event)
})

function registerHandler(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
): void {
  ipcMain.handle(channel, listener)
  registeredChannels.add(channel)
}

function assertTrustedSender(event: IpcMainInvokeEvent): BrowserWindow {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || event.sender !== window.webContents) {
    throw new Error('IPC refusé : émetteur non autorisé.')
  }

  if (event.senderFrame !== event.sender.mainFrame) {
    throw new Error('IPC refusé : seuls les cadres principaux sont autorisés.')
  }

  const senderUrl = event.senderFrame?.url ?? ''
  const developmentUrl = process.env.VITE_DEV_SERVER_URL

  if (developmentUrl) {
    let expectedOrigin = ''

    try {
      expectedOrigin = new URL(developmentUrl).origin
    } catch {
      throw new Error('Configuration du serveur de développement invalide.')
    }

    let senderOrigin = ''

    try {
      senderOrigin = new URL(senderUrl).origin
    } catch {
      throw new Error('IPC refusé : origine invalide.')
    }

    if (senderOrigin !== expectedOrigin) {
      throw new Error('IPC refusé : origine non autorisée.')
    }
  } else if (!senderUrl.startsWith('file://')) {
    throw new Error('IPC refusé : origine non autorisée.')
  }

  return window
}

function requireWorkspace(): string {
  if (!workspaceRoot) {
    throw new Error('Aucun dossier de travail n’est ouvert.')
  }

  return workspaceRoot
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

function parseAbsolutePath(input: unknown, label: string): string {
  if (
    typeof input !== 'string' ||
    input.length === 0 ||
    input.length > 4_096 ||
    input.includes('\0')
  ) {
    throw new Error(`${label} invalide.`)
  }

  if (!path.isAbsolute(input)) {
    throw new Error(`${label} doit être un chemin absolu.`)
  }

  return path.resolve(input)
}

function parseOptionalWorkspaceFilePath(input: unknown, label: string): string | null {
  if (input === null || input === undefined) {
    return null
  }
  return parseWorkspaceFilePath(input, label)
}

function parseWorkspaceFilePath(input: unknown, label: string): string {
  const root = requireWorkspace()
  const resolved = parseAbsolutePath(input, label)
  if (!isPathInside(root, resolved) || resolved === root) {
    throw new Error('Accès refusé : le chemin se trouve hors du dossier de travail.')
  }
  return resolved
}

function parseStringArray(input: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(input) || input.length > maximum) {
    throw new Error(`${label} invalide.`)
  }

  return input.map((entry) => {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 4_096 || entry.includes('\0')) {
      throw new Error(`${label} invalide.`)
    }
    return entry
  })
}

function parseBreakpointFiles(input: unknown): DebugBreakpointFile[] {
  if (!Array.isArray(input) || input.length > 2_000) {
    throw new Error('Points d’arrêt invalides.')
  }
  return input as DebugBreakpointFile[]
}

function parseBreakpointInputs(input: unknown): DebugBreakpointInput[] {
  if (!Array.isArray(input) || input.length > 2_000) {
    throw new Error('Points d’arrêt invalides.')
  }
  return input as DebugBreakpointInput[]
}

function parseInteger(input: unknown, label: string, minimum = 0): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < minimum) {
    throw new Error(`${label} invalide.`)
  }
  return input
}

async function resolveExistingTarget(input: unknown, label: string): Promise<string> {
  const root = requireWorkspace()
  const lexicalPath = parseAbsolutePath(input, label)

  if (!isPathInside(root, lexicalPath)) {
    throw new Error('Accès refusé : le chemin se trouve hors du dossier de travail.')
  }

  const realPath = await fs.realpath(lexicalPath)
  if (!isPathInside(root, realPath)) {
    throw new Error('Accès refusé : le chemin résolu sort du dossier de travail.')
  }

  return realPath
}

async function workspaceInfo(): Promise<WorkspaceInfo | null> {
  if (!workspaceRoot) {
    return null
  }

  return {
    path: workspaceRoot,
    name: path.basename(workspaceRoot)
  }
}

function lastWorkspaceStatePath(): string {
  return path.join(app.getPath('userData'), 'last-workspace.json')
}

function invalidateQuickOpenCache(): void {
  quickOpenCache = null
}

async function persistWorkspacePath(root: string): Promise<void> {
  const statePath = lastWorkspaceStatePath()

  try {
    await fs.mkdir(path.dirname(statePath), { recursive: true })
    const temporaryPath = `${statePath}.${process.pid}.tmp`
    await fs.writeFile(temporaryPath, JSON.stringify({ path: root }), {
      encoding: 'utf8',
      mode: 0o600
    })
    await fs.rename(temporaryPath, statePath)
  } catch {
    // Session persistence is a convenience and must never block workspace access.
  }
}

async function readPersistedWorkspacePath(): Promise<string | null> {
  try {
    const rawState = await fs.readFile(lastWorkspaceStatePath(), 'utf8')
    const state = JSON.parse(rawState) as { path?: unknown }

    if (typeof state.path !== 'string' || !path.isAbsolute(state.path)) {
      return null
    }

    const realPath = await fs.realpath(state.path)
    const stats = await fs.stat(realPath)
    return stats.isDirectory() ? realPath : null
  } catch {
    return null
  }
}

function stopWorkspaceWatcher(): void {
  if (workspaceWatchRetryTimer) {
    clearTimeout(workspaceWatchRetryTimer)
    workspaceWatchRetryTimer = null
  }

  if (workspaceWatchTimer) {
    clearTimeout(workspaceWatchTimer)
    workspaceWatchTimer = null
  }

  if (workspaceWatcher) {
    try {
      workspaceWatcher.close()
    } catch {
      // The watcher may already have been closed by the operating system.
    }
    workspaceWatcher = null
  }
}

function retryWorkspaceWatcher(root: string): void {
  if (workspaceWatchRetryTimer || workspaceRoot !== root) {
    return
  }

  workspaceWatchRetryTimer = setTimeout(() => {
    workspaceWatchRetryTimer = null
    if (workspaceRoot === root) {
      startWorkspaceWatcher()
    }
  }, 2_000)
}

function startWorkspaceWatcher(): void {
  stopWorkspaceWatcher()

  const root = workspaceRoot
  if (!root) {
    return
  }

  try {
    const watcher = watch(root, { recursive: true, persistent: false }, (_event, fileName) => {
      if (workspaceRoot !== root) {
        return
      }

      const relativeName = fileName ? fileName.toString() : ''
      if (relativeName) {
        const segments = relativeName.split(/[\\/]/)
        if (segments.some((segment) => IGNORED_SEARCH_DIRECTORIES.has(segment))) {
          return
        }
      }

      if (workspaceWatchTimer) {
        clearTimeout(workspaceWatchTimer)
      }

      workspaceWatchTimer = setTimeout(() => {
        workspaceWatchTimer = null
        if (workspaceRoot !== root) {
          return
        }

        invalidateQuickOpenCache()
        workspaceRevision += 1

        const window = getMainWindow()
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
          return
        }

        const payload: WorkspaceChangeEvent = { revision: workspaceRevision }
        window.webContents.send('workspace:changed', payload)
      }, WORKSPACE_WATCH_DEBOUNCE_MS)
    })

    watcher.on('error', (error) => {
      if (workspaceWatcher === watcher) {
        console.warn('[Cami] La surveillance du dossier a échoué ; nouvelle tentative :', error)
        watcher.close()
        workspaceWatcher = null
        retryWorkspaceWatcher(root)
      }
    })

    workspaceWatcher = watcher
  } catch (error) {
    workspaceWatcher = null
    console.warn('[Cami] Impossible de surveiller le dossier ; nouvelle tentative :', error)
    retryWorkspaceWatcher(root)
  }
}

async function activateWorkspace(root: string): Promise<void> {
  if (workspaceRoot !== root) {
    goleChatManager.dispose()
  }
  stopWorkspaceWatcher()
  disposeAllTerminals()
  invalidateQuickOpenCache()
  taskManager.stopAll()
  await debugManager.setWorkspace(root)
  lspManager.setWorkspace(root)
  workspaceRoot = root
  startWorkspaceWatcher()
  await persistWorkspacePath(root)
}

async function deactivateWorkspaceServices(): Promise<void> {
  goleChatManager.dispose()
  taskManager.stopAll()
  await debugManager.dispose()
  await lspManager.dispose()
}

async function chooseWorkspace(window: BrowserWindow): Promise<WorkspaceInfo | null> {
  const result = await dialog.showOpenDialog(window, {
    title: 'Ouvrir un dossier de travail',
    buttonLabel: 'Ouvrir le dossier',
    properties: ['openDirectory']
  })

  const selectedPath = result.filePaths[0]
  if (result.canceled || !selectedPath) {
    return null
  }

  const realPath = await fs.realpath(selectedPath)
  const stats = await fs.stat(realPath)
  if (!stats.isDirectory()) {
    throw new Error('Le chemin sélectionné n’est pas un dossier.')
  }

  await activateWorkspace(realPath)

  return {
    path: realPath,
    name: path.basename(realPath)
  }
}

async function restoreLastWorkspace(): Promise<WorkspaceInfo | null> {
  if (workspaceRoot) {
    return workspaceInfo()
  }

  const persistedPath = await readPersistedWorkspacePath()
  if (!persistedPath) {
    return null
  }

  try {
    await activateWorkspace(persistedPath)
    return workspaceInfo()
  } catch {
    return null
  }
}

async function currentWorkspace(): Promise<WorkspaceInfo | null> {
  if (!workspaceRoot) {
    return null
  }

  try {
    const stats = await fs.stat(workspaceRoot)
    if (!stats.isDirectory()) {
      workspaceRoot = null
      stopWorkspaceWatcher()
      await deactivateWorkspaceServices()
      return null
    }

    return workspaceInfo()
  } catch {
    workspaceRoot = null
    stopWorkspaceWatcher()
    await deactivateWorkspaceServices()
    return null
  }
}

async function readWorkspaceDirectory(input: unknown): Promise<FileEntry[]> {
  const root = requireWorkspace()
  let directory = root

  if (input !== undefined && input !== null) {
    directory = await resolveExistingTarget(input, 'Chemin du dossier')
    const stats = await fs.stat(directory)
    if (!stats.isDirectory()) {
      throw new Error('Le chemin demandé n’est pas un dossier.')
    }
  }

  const directoryEntries = await fs.readdir(directory, { withFileTypes: true })
  const resolvedEntries = await Promise.all(
    directoryEntries.map(async (entry: Dirent): Promise<FileEntry | null> => {
      const entryPath = path.join(directory, entry.name)

      if (entry.isSymbolicLink()) {
        try {
          const realPath = await fs.realpath(entryPath)
          if (!isPathInside(root, realPath)) {
            return null
          }

          const stats = await fs.stat(realPath)
          if (!stats.isDirectory() && !stats.isFile()) {
            return null
          }

          return {
            name: entry.name,
            path: entryPath,
            isDirectory: stats.isDirectory()
          }
        } catch {
          return null
        }
      }

      if (!entry.isDirectory() && !entry.isFile()) {
        return null
      }

      return {
        name: entry.name,
        path: entryPath,
        isDirectory: entry.isDirectory()
      }
    })
  )

  const entries = resolvedEntries.filter((entry): entry is FileEntry => entry !== null)
  entries.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1
    }

    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: 'base'
    })
  })

  return entries
}

function parseEntryName(input: unknown): string {
  if (typeof input !== 'string') {
    throw new Error('Nom invalide.')
  }

  if (input.length === 0 || input.length > 255 || input.trim().length === 0) {
    throw new Error('Le nom doit contenir entre 1 et 255 caractères.')
  }

  if (input === '.' || input === '..' || /[\\/\0]/.test(input) || /[\u0000-\u001f\u007f]/.test(input)) {
    throw new Error('Le nom contient des caractères interdits.')
  }

  if (Buffer.byteLength(input, 'utf8') > 255) {
    throw new Error('Le nom est trop long.')
  }

  return input
}

async function createWorkspaceEntry(
  parentInput: unknown,
  nameInput: unknown,
  isDirectory: boolean
): Promise<string> {
  const root = requireWorkspace()
  const parentPath = await resolveExistingTarget(parentInput, 'Dossier parent')
  const parentStats = await fs.stat(parentPath)

  if (!parentStats.isDirectory()) {
    throw new Error('Le dossier parent est invalide.')
  }

  const name = parseEntryName(nameInput)
  const targetPath = path.join(parentPath, name)
  if (!isPathInside(root, targetPath) || targetPath === root) {
    throw new Error('Accès refusé : le chemin se trouve hors du dossier de travail.')
  }

  try {
    await fs.lstat(targetPath)
    throw new Error('Un élément porte déjà ce nom.')
  } catch (error) {
    if (error instanceof Error && error.message === 'Un élément porte déjà ce nom.') {
      throw error
    }
  }

  if (isDirectory) {
    await fs.mkdir(targetPath)
  } else {
    await fs.writeFile(targetPath, '', { encoding: 'utf8', flag: 'wx' })
  }

  invalidateQuickOpenCache()
  return targetPath
}

async function renameWorkspaceEntry(input: unknown, newNameInput: unknown): Promise<string> {
  const root = requireWorkspace()
  const lexicalPath = parseAbsolutePath(input, 'Chemin de l’élément')

  if (!isPathInside(root, lexicalPath) || lexicalPath === root) {
    throw new Error('Accès refusé : le chemin se trouve hors du dossier de travail.')
  }

  const linkStats = await fs.lstat(lexicalPath)
  if (linkStats.isSymbolicLink()) {
    throw new Error('Les liens symboliques ne peuvent pas être renommés.')
  }

  const realPath = await resolveExistingTarget(lexicalPath, 'Chemin de l’élément')
  if (realPath === root) {
    throw new Error('Le dossier de travail ne peut pas être renommé.')
  }

  const name = parseEntryName(newNameInput)
  const targetPath = path.join(path.dirname(realPath), name)

  if (!isPathInside(root, targetPath)) {
    throw new Error('Accès refusé : le chemin se trouve hors du dossier de travail.')
  }

  if (targetPath === realPath) {
    return realPath
  }

  try {
    await fs.lstat(targetPath)
    throw new Error('Un élément porte déjà ce nom.')
  } catch (error) {
    if (error instanceof Error && error.message === 'Un élément porte déjà ce nom.') {
      throw error
    }
  }

  await fs.rename(realPath, targetPath)
  invalidateQuickOpenCache()
  return targetPath
}

async function deleteWorkspaceEntry(input: unknown): Promise<void> {
  const root = requireWorkspace()
  const lexicalPath = parseAbsolutePath(input, 'Chemin de l’élément')

  if (!isPathInside(root, lexicalPath) || lexicalPath === root) {
    throw new Error('Le dossier de travail ne peut pas être supprimé.')
  }

  const realPath = await resolveExistingTarget(lexicalPath, 'Chemin de l’élément')
  if (realPath === root) {
    throw new Error('Le dossier de travail ne peut pas être supprimé.')
  }

  await shell.trashItem(lexicalPath)
  invalidateQuickOpenCache()
}

async function listWorkspaceFiles(): Promise<QuickOpenFile[]> {
  const root = requireWorkspace()
  if (quickOpenCache?.root === root) {
    return quickOpenCache.files
  }

  const files: QuickOpenFile[] = []
  const directories: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]

  while (directories.length > 0 && files.length < MAX_QUICK_OPEN_FILES) {
    const current = directories.pop()
    if (!current || current.depth > 32) {
      continue
    }

    let entries: Dirent[]
    try {
      entries = await fs.readdir(current.path, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (files.length >= MAX_QUICK_OPEN_FILES) {
        break
      }

      if (entry.isSymbolicLink() || !entry.isFile()) {
        continue
      }

      const entryPath = path.join(current.path, entry.name)
      files.push({
        path: entryPath,
        relativePath: path.relative(root, entryPath).split(path.sep).join('/')
      })
    }

    const childDirectories: Array<{ path: string; depth: number }> = []
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !IGNORED_SEARCH_DIRECTORIES.has(entry.name) &&
        current.depth < 32
      ) {
        childDirectories.push({
          path: path.join(current.path, entry.name),
          depth: current.depth + 1
        })
      }
    }

    for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
      const directory = childDirectories[index]
      if (directory) {
        directories.push(directory)
      }
    }
  }

  files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath, undefined, {
      numeric: true,
      sensitivity: 'base'
    })
  )
  quickOpenCache = { root, files }
  return files
}

async function readWorkspaceFile(input: unknown): Promise<FileContents> {
  const realPath = await resolveExistingTarget(input, 'Chemin du fichier')
  const stats = await fs.stat(realPath)

  if (!stats.isFile()) {
    throw new Error('Le chemin demandé n’est pas un fichier.')
  }

  if (stats.size > MAX_TEXT_FILE_BYTES) {
    throw new Error('Ce fichier dépasse la taille maximale supportée (16 Mo).')
  }

  const buffer = await fs.readFile(realPath)
  if (buffer.length > MAX_TEXT_FILE_BYTES) {
    throw new Error('Ce fichier dépasse la taille maximale supportée (16 Mo).')
  }

  if (buffer.subarray(0, 8_192).includes(0)) {
    throw new Error('Les fichiers binaires ne peuvent pas être ouverts dans l’éditeur.')
  }

  const content = buffer.toString('utf8')
  const hasBom =
    buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf

  return {
    path: realPath,
    content,
    encoding: hasBom ? 'UTF-8 with BOM' : 'UTF-8',
    eol: content.includes('\r\n') ? 'CRLF' : 'LF',
    size: buffer.length,
    mtimeMs: stats.mtimeMs
  }
}

async function writeWorkspaceFile(input: unknown, content: unknown): Promise<WriteFileResult> {
  if (typeof content !== 'string') {
    throw new Error('Le contenu du fichier est invalide.')
  }

  const contentSize = Buffer.byteLength(content, 'utf8')
  if (contentSize > MAX_TEXT_FILE_BYTES) {
    throw new Error('Le contenu dépasse la taille maximale supportée (16 Mo).')
  }

  const realPath = await resolveExistingTarget(input, 'Chemin du fichier')
  const stats = await fs.stat(realPath)

  if (!stats.isFile()) {
    throw new Error('Impossible d’écrire dans un dossier.')
  }

  await fs.writeFile(realPath, content, { encoding: 'utf8' })
  const updatedStats = await fs.stat(realPath)

  return {
    size: contentSize,
    mtimeMs: updatedStats.mtimeMs
  }
}

function normalizeSearchOptions(input: unknown): Required<SearchOptions> {
  if (input === undefined || input === null) {
    return { caseSensitive: false }
  }

  if (typeof input !== 'object') {
    throw new Error('Options de recherche invalides.')
  }

  const caseSensitive = (input as SearchOptions).caseSensitive
  if (caseSensitive !== undefined && typeof caseSensitive !== 'boolean') {
    throw new Error('L’option de sensibilité à la casse est invalide.')
  }

  return {
    caseSensitive: caseSensitive ?? false
  }
}

async function searchWorkspace(
  queryInput: unknown,
  optionsInput: unknown
): Promise<SearchResponse> {
  const root = requireWorkspace()

  if (typeof queryInput !== 'string') {
    throw new Error('La requête de recherche est invalide.')
  }

  if (queryInput.length === 0) {
    return { matches: [], truncated: false }
  }

  if (queryInput.length > 200) {
    throw new Error('La requête de recherche est trop longue (200 caractères maximum).')
  }

  const options = normalizeSearchOptions(optionsInput)
  const needle = options.caseSensitive ? queryInput : queryInput.toLocaleLowerCase()
  const matches: SearchMatch[] = []
  const directories: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
  let scannedFiles = 0
  let truncated = false

  while (directories.length > 0) {
    const current = directories.pop()
    if (!current) {
      break
    }

    if (current.depth > 32) {
      truncated = true
      continue
    }

    let entries: Dirent[]
    try {
      entries = await fs.readdir(current.path, { withFileTypes: true })
    } catch {
      continue
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
    const childDirectories: Array<{ path: string; depth: number }> = []

    for (const entry of entries) {
      if (matches.length >= MAX_SEARCH_RESULTS || scannedFiles >= MAX_SEARCH_FILES) {
        truncated = true
        break
      }

      if (entry.isSymbolicLink()) {
        continue
      }

      const entryPath = path.join(current.path, entry.name)

      if (entry.isDirectory()) {
        if (!IGNORED_SEARCH_DIRECTORIES.has(entry.name)) {
          childDirectories.push({
            path: entryPath,
            depth: current.depth + 1
          })
        }
        continue
      }

      if (!entry.isFile()) {
        continue
      }

      scannedFiles += 1

      try {
        const stats = await fs.stat(entryPath)
        if (stats.size > MAX_SEARCH_FILE_BYTES) {
          continue
        }

        const buffer = await fs.readFile(entryPath)
        if (buffer.subarray(0, 8_192).includes(0)) {
          continue
        }

        const lines = buffer.toString('utf8').split(/\r?\n/)
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex] ?? ''
          const haystack = options.caseSensitive ? line : line.toLocaleLowerCase()
          const matchIndex = haystack.indexOf(needle)

          if (matchIndex === -1) {
            continue
          }

          const snippetStart = Math.max(0, matchIndex - 60)
          const snippetEnd = Math.min(line.length, matchIndex + queryInput.length + 120)
          let preview = line.slice(snippetStart, snippetEnd).trim()
          if (snippetStart > 0) {
            preview = `…${preview}`
          }
          if (snippetEnd < line.length) {
            preview = `${preview}…`
          }

          matches.push({
            path: entryPath,
            relativePath: path.relative(root, entryPath).split(path.sep).join('/'),
            line: lineIndex + 1,
            column: matchIndex + 1,
            preview
          })

          if (matches.length >= MAX_SEARCH_RESULTS) {
            truncated = true
            break
          }
        }
      } catch {
        // An unreadable file must not interrupt a workspace-wide search.
      }
    }

    if (truncated) {
      break
    }

    for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
      const directory = childDirectories[index]
      if (directory) {
        directories.push(directory)
      }
    }
  }

  return { matches, truncated }
}

async function readGitStatus(): Promise<GitStatus> {
  const root = requireWorkspace()
  const repository = await readGitRepositoryState(root)
  return {
    isRepository: repository.isRepository,
    branch: repository.branch,
    ahead: repository.ahead,
    behind: repository.behind,
    changes: repository.changes
  }
}

async function revealPath(input: unknown): Promise<void> {
  const realPath = await resolveExistingTarget(input, 'Chemin à révéler')
  const stats = await fs.stat(realPath)

  if (stats.isDirectory()) {
    const errorMessage = await shell.openPath(realPath)
    if (errorMessage) {
      throw new Error(errorMessage)
    }
    return
  }

  shell.showItemInFolder(realPath)
}

function sendToOwner(owner: WebContents, channel: string, payload: unknown): void {
  if (owner.isDestroyed()) {
    return
  }

  try {
    owner.send(channel, payload)
  } catch {
    // The renderer may be tearing down its window while a PTY is exiting.
  }
}

function loadNodePty(): Promise<typeof import('node-pty')> {
  nodePtyModule ??= import('node-pty')
  return nodePtyModule
}

function getShellPath(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }

  if (process.env.SHELL && path.isAbsolute(process.env.SHELL)) {
    return process.env.SHELL
  }

  return process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
}

function createTerminalEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      environment[key] = value
    }
  }

  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.ELECTRON_ENABLE_LOGGING
  delete environment.ELECTRON_NO_ATTACH_CONSOLE
  environment.TERM = 'xterm-256color'
  environment.COLORTERM = 'truecolor'
  environment.TERM_PROGRAM = 'Cami'

  return environment
}

function quotePosixArgument(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

interface GoleSetup {
  workspace: string
  entry: string
  binary: string | null
  goleHome: string
}

const GOLE_BROWSERS: readonly GoleBrowser[] = [
  'cami-browser',
  'chromium',
  'firefox',
  'brave',
  'librewolf',
  'tor'
]
const GOLE_AI_PROVIDERS: readonly GoleAIProvider[] = ['deepseek', 'gemini']

function isGolePreferences(value: unknown): value is GolePreferences {
  if (!value || typeof value !== 'object') {
    return false
  }
  const preferences = value as Record<string, unknown>
  return (
    GOLE_BROWSERS.includes(preferences.browser as GoleBrowser) &&
    GOLE_AI_PROVIDERS.includes(preferences.ai as GoleAIProvider)
  )
}

function golePreferencesPath(): string {
  return path.join(app.getPath('userData'), 'gole', 'preferences.json')
}

async function getGolePreferences(): Promise<GolePreferences> {
  let contents: string
  try {
    contents = await fs.readFile(golePreferencesPath(), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { browser: 'cami-browser', ai: 'deepseek' }
    }
    throw error
  }

  let preferences: unknown
  try {
    preferences = JSON.parse(contents)
  } catch (error) {
    throw new Error(`Le fichier des préférences Gole est invalide : ${String(error)}`)
  }
  if (!isGolePreferences(preferences)) {
    throw new Error('Les préférences Gole contiennent un navigateur ou un fournisseur IA non pris en charge.')
  }
  return preferences
}

async function saveGolePreferences(value: unknown): Promise<GolePreferences> {
  if (!isGolePreferences(value)) {
    throw new Error('Sélection de navigateur ou de fournisseur IA Gole invalide.')
  }
  const preferences = value
  const file = golePreferencesPath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporaryFile = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporaryFile, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryFile, file)
  } catch (error) {
    await fs.rm(temporaryFile, { force: true })
    throw error
  }
  return preferences
}

async function getGoleSetup(browser: GoleBrowser): Promise<GoleSetup> {
  if (browser === 'cami-browser' && process.platform !== 'linux') {
    throw new Error('L’intégration WebKit de Gole est actuellement disponible sous Linux.')
  }

  const workspace = requireWorkspace()
  const goleHome = path.join(app.getPath('userData'), 'gole')
  await fs.mkdir(goleHome, { recursive: true })
  const legacyGoleHome = path.join(os.homedir(), '.gole')
  if (legacyGoleHome !== goleHome) {
    try {
      await fs.cp(legacyGoleHome, goleHome, {
        recursive: true,
        force: false,
        errorOnExist: false
      })
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
        throw error
      }
    }
  }

  const entryCandidates = [
    process.env.CAMI_GOLE_ENTRY,
    app.isPackaged
      ? path.join(process.resourcesPath, 'gole/src/index.js')
      : path.resolve(app.getAppPath(), 'gole/src/index.js')
  ].filter((candidate): candidate is string => Boolean(candidate))
  let entry: string | null = null

  for (const candidate of entryCandidates) {
    if (!path.isAbsolute(candidate)) {
      throw new Error('CAMI_GOLE_ENTRY doit être un chemin absolu.')
    }

    try {
      const realPath = await fs.realpath(candidate)
      const stats = await fs.stat(realPath)
      if (stats.isFile()) {
        entry = realPath
        break
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        (error.code !== 'ENOENT' && error.code !== 'ENOTDIR')
      ) {
        throw error
      }
    }
  }

  if (!entry) {
    throw new Error(
      'Gole est introuvable. Vérifiez le dossier cami/gole ou définissez CAMI_GOLE_ENTRY.'
    )
  }

  let binary: string | null = null
  if (browser === 'cami-browser') {
    binary = process.env.GOLE_WEBKIT_BINARY
      ? path.resolve(process.env.GOLE_WEBKIT_BINARY)
      : app.isPackaged
        ? path.join(process.resourcesPath, 'native/cami-webkit-browser')
        : path.resolve(app.getAppPath(), 'native/webkit-browser/build/cami-webkit-browser')
    try {
      await fs.access(binary)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error('Le navigateur Cami/WebKit natif est absent. Lancez install-cami-gole-deps.sh --npm-only.')
      }
      throw error
    }
  }

  return { workspace, entry, binary, goleHome }
}

async function getGoleCommand(): Promise<string> {
  const preferences = await getGolePreferences()
  const { workspace, entry, binary, goleHome } = await getGoleSetup(preferences.browser)
  const nodeExecutable = process.env.NODE?.trim() || process.execPath
  const useElectronNode = !process.env.NODE?.trim()
  return [
    ...(useElectronNode ? ['ELECTRON_RUN_AS_NODE=1'] : []),
    'CAMI_GOLE_HOME=' + quotePosixArgument(goleHome),
    ...(binary ? ['GOLE_WEBKIT_BINARY=' + quotePosixArgument(binary)] : []),
    quotePosixArgument(nodeExecutable),
    quotePosixArgument(entry),
    '--browser',
    quotePosixArgument(preferences.browser),
    '--ai',
    quotePosixArgument(preferences.ai),
    '--dir',
    quotePosixArgument(workspace),
    '--interactive'
  ].join(' ')
}

function getCompanionLayout(window: BrowserWindow): {
  appBounds: { x: number; y: number; width: number; height: number }
  companionBounds: { x: number; y: number; width: number; height: number }
  restoreBounds: { x: number; y: number; width: number; height: number }
  restoreMaximized: boolean
} {
  const restoreMaximized = window.isMaximized()
  const parent = restoreMaximized ? window.getNormalBounds() : window.getBounds()
  const workArea = screen.getDisplayMatching(window.getBounds()).workArea
  let companionWidth = Math.min(
    workArea.width,
    720,
    Math.max(Math.min(420, workArea.width), Math.round(workArea.width * 0.38))
  )
  const minimumAppWidth = 900
  if (workArea.width - companionWidth < minimumAppWidth && workArea.width >= minimumAppWidth + 320) {
    companionWidth = workArea.width - minimumAppWidth
  }
  const height = Math.min(800, workArea.height)
  const rightSpace = workArea.x + workArea.width - (parent.x + parent.width)
  const leftSpace = parent.x - workArea.x
  const placeRight = rightSpace >= leftSpace
  const canFitSideBySide = workArea.width - companionWidth >= minimumAppWidth
  const appHeight = Math.min(parent.height, workArea.height)
  const appY = Math.min(Math.max(parent.y, workArea.y), workArea.y + workArea.height - appHeight)
  let appBounds = {
    x: parent.x,
    y: appY,
    width: parent.width,
    height: appHeight
  }
  let x: number

  if (canFitSideBySide) {
    appBounds = {
      ...appBounds,
      x: placeRight ? workArea.x : workArea.x + companionWidth,
      y: appY,
      width: workArea.width - companionWidth
    }
    x = placeRight ? appBounds.x + appBounds.width : workArea.x
  } else if (placeRight) {
    x = workArea.x + workArea.width - companionWidth
  } else {
    x = workArea.x
  }

  return {
    appBounds,
    companionBounds: {
      x,
      y: Math.min(Math.max(parent.y, workArea.y), workArea.y + workArea.height - height),
      width: companionWidth,
      height
    },
    restoreBounds: parent,
    restoreMaximized
  }
}

function validateDimension(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

function validateTerminalOptions(input: unknown): TerminalCreateOptions {
  if (!input || typeof input !== 'object') {
    throw new Error('Paramètres du terminal invalides.')
  }

  const options = input as Partial<TerminalCreateOptions>
  if (typeof options.id !== 'string' || !TERMINAL_ID_PATTERN.test(options.id)) {
    throw new Error('Identifiant du terminal invalide.')
  }

  return {
    id: options.id,
    cols: validateDimension(options.cols, 2, 500, 80),
    rows: validateDimension(options.rows, 1, 200, 24)
  }
}

function watchTerminalOwner(owner: WebContents): void {
  if (watchedOwners.has(owner.id)) {
    return
  }

  watchedOwners.add(owner.id)
  owner.once('destroyed', () => {
    watchedOwners.delete(owner.id)
    disposeTerminalsForOwner(owner.id)
  })
}

function disposeTerminalsForOwner(ownerId: number): void {
  for (const [id, session] of terminals) {
    if (session.owner.id === ownerId) {
      terminals.delete(id)
      try {
        session.pty.kill()
      } catch {
        // The process may have exited between the iteration and the kill.
      }
    }
  }
}

function disposeAllTerminals(): void {
  for (const [id, session] of terminals) {
    terminals.delete(id)
    try {
      session.pty.kill()
    } catch {
      // The process may have exited between the iteration and the kill.
    }
  }
}

async function createTerminal(
  event: IpcMainInvokeEvent,
  input: unknown
): Promise<TerminalSession> {
  const options = validateTerminalOptions(input)
  const owner = event.sender
  const ownerSessionCount = [...terminals.values()].filter(
    (session) => session.owner.id === owner.id
  ).length

  if (ownerSessionCount >= MAX_TERMINAL_SESSIONS) {
    throw new Error('Trop de sessions de terminal sont actives.')
  }

  if (terminals.has(options.id)) {
    throw new Error('Cette session de terminal existe déjà.')
  }

  const ptyModule = await loadNodePty()

  // Re-check after the asynchronous native module load. Concurrent create calls
  // would otherwise both pass the checks above and leak an untracked PTY.
  if (terminals.has(options.id)) {
    throw new Error('Cette session de terminal existe déjà.')
  }

  const currentOwnerSessionCount = [...terminals.values()].filter(
    (session) => session.owner.id === owner.id
  ).length
  if (currentOwnerSessionCount >= MAX_TERMINAL_SESSIONS) {
    throw new Error('Trop de sessions de terminal sont actives.')
  }

  const shellPath = getShellPath()
  const shellArgs =
    process.platform === 'win32' && /powershell(?:\.exe)?$/i.test(shellPath) ? ['-NoLogo'] : []
  const cwd = workspaceRoot ?? os.homedir()

  if (!cwd) {
    throw new Error('Impossible de déterminer le dossier de travail du terminal.')
  }

  const terminalProcess = ptyModule.spawn(shellPath, shellArgs, {
    name: 'xterm-256color',
    cols: options.cols,
    rows: options.rows,
    cwd,
    env: createTerminalEnvironment()
  })

  const session: TerminalProcess = {
    id: options.id,
    owner,
    pty: terminalProcess
  }
  terminals.set(options.id, session)
  watchTerminalOwner(owner)

  terminalProcess.onData((data) => {
    const payload: TerminalDataEvent = { id: options.id, data }
    sendToOwner(owner, 'terminal:data', payload)
  })

  terminalProcess.onExit(({ exitCode, signal }) => {
    terminals.delete(options.id)
    const payload: TerminalExitEvent = {
      id: options.id,
      exitCode,
      signal: signal ?? 0
    }
    sendToOwner(owner, 'terminal:exit', payload)
  })

  return {
    id: options.id,
    shell: path.basename(shellPath)
  }
}

function findOwnedTerminal(event: IpcMainInvokeEvent, input: unknown): TerminalProcess | null {
  if (typeof input !== 'string' || !TERMINAL_ID_PATTERN.test(input)) {
    throw new Error('Identifiant du terminal invalide.')
  }

  const session = terminals.get(input)
  if (!session || session.owner.id !== event.sender.id) {
    return null
  }

  return session
}

function closeDialogAction(response: number): CloseDialogAction {
  if (response === 1) {
    return 'save'
  }

  if (response === 2) {
    return 'discard'
  }

  return 'cancel'
}

async function confirmFileClose(
  window: BrowserWindow,
  fileName: unknown
): Promise<CloseDialogAction> {
  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 255) {
    throw new Error('Nom de fichier invalide.')
  }

  const result = await dialog.showMessageBox(window, {
    type: 'warning',
    buttons: ['Annuler', 'Enregistrer', 'Ne pas enregistrer'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    title: 'Modifications non enregistrées',
    message: `Enregistrer les modifications de « ${fileName} » ?`,
    detail: 'Choisissez si les modifications doivent être enregistrées avant la fermeture.'
  })

  return closeDialogAction(result.response)
}

async function confirmWorkspaceChange(
  window: BrowserWindow,
  dirtyCountInput: unknown
): Promise<CloseDialogAction> {
  const dirtyCount =
    typeof dirtyCountInput === 'number' &&
    Number.isInteger(dirtyCountInput) &&
    dirtyCountInput >= 0 &&
    dirtyCountInput <= 10_000
      ? dirtyCountInput
      : 0

  const result = await dialog.showMessageBox(window, {
    type: 'warning',
    buttons: ['Annuler', 'Enregistrer et changer', 'Ne pas enregistrer'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
    title: 'Modifications non enregistrées',
    message: 'Enregistrer les modifications avant d’ouvrir un autre dossier ?',
    detail:
      dirtyCount > 0
        ? `${dirtyCount} fichier${dirtyCount > 1 ? 's sont modifiés' : ' est modifié'}.`
        : 'Le dossier actuel sera fermé.'
  })

  return closeDialogAction(result.response)
}

async function confirmDelete(
  window: BrowserWindow,
  nameInput: unknown,
  hasDirtyFilesInput: unknown
): Promise<boolean> {
  if (typeof nameInput !== 'string' || nameInput.length === 0 || nameInput.length > 255) {
    throw new Error('Nom d’élément invalide.')
  }

  const hasDirtyFiles = hasDirtyFilesInput === true
  const result = await dialog.showMessageBox(window, {
    type: 'warning',
    buttons: ['Annuler', 'Déplacer dans la corbeille'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Supprimer un élément',
    message: `Déplacer « ${nameInput} » dans la corbeille ?`,
    detail: hasDirtyFiles
      ? 'Cet élément contient des fichiers modifiés non enregistrés. Leurs modifications seront perdues.'
      : 'L’élément pourra être restauré depuis la corbeille du système.'
  })

  return result.response === 1
}

/**
 * Intercepts window closure while the renderer reports dirty files. The renderer
 * remains the source of truth for editor state, while the confirmation dialog is
 * intentionally native and cannot be overridden by page JavaScript.
 */
export function guardWindowClose(window: BrowserWindow): void {
  const ownerId = window.webContents.id
  let closeConfirmed = false
  let promptOpen = false

  window.webContents.on('did-start-loading', () => {
    dirtyCounts.set(window, 0)
  })

  window.on('close', (event) => {
    const dirtyCount = dirtyCounts.get(window) ?? 0
    if (closeConfirmed || dirtyCount === 0) {
      return
    }

    event.preventDefault()
    if (promptOpen) {
      return
    }

    promptOpen = true
    void dialog
      .showMessageBox(window, {
        type: 'warning',
        buttons: ['Annuler', 'Enregistrer', 'Ne pas enregistrer'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
        title: 'Modifications non enregistrées',
        message: 'Enregistrer les modifications avant de fermer Cami ?',
        detail:
          dirtyCount > 1
            ? `${dirtyCount} fichiers modifiés sont en attente.`
            : 'Un fichier modifié est en attente.'
      })
      .then((result) => {
        promptOpen = false

        if (result.response === 1) {
          if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
            window.webContents.send('app:save-all-before-close')
          }
          return
        }

        if (result.response === 2) {
          closeConfirmed = true
          window.close()
        }
      })
      .catch(() => {
        promptOpen = false
      })
  })

  window.on('closed', () => {
    dirtyCounts.delete(window)
    disposeTerminalsForOwner(ownerId)
    taskManager.stopForOwner(ownerId)
    void debugManager.dispose()
    void lspManager.dispose()
  })
}

export function registerIpcHandlers(windowGetter: WindowGetter): () => void {
  getMainWindow = windowGetter

  registerHandler('window:minimize', (event) => {
    const window = assertTrustedSender(event)
    window.minimize()
  })

  registerHandler('window:toggle-maximize', (event) => {
    const window = assertTrustedSender(event)
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
    return window.isMaximized()
  })

  registerHandler('window:close', (event) => {
    const window = assertTrustedSender(event)
    window.close()
  })

  registerHandler('window:is-maximized', (event) => {
    const window = assertTrustedSender(event)
    return window.isMaximized()
  })

  registerHandler('workspace:open', async (event) => {
    const window = assertTrustedSender(event)
    return chooseWorkspace(window)
  })

  registerHandler('workspace:current', (event) => {
    assertTrustedSender(event)
    return currentWorkspace()
  })

  registerHandler('workspace:restore-last', async (event) => {
    assertTrustedSender(event)
    return restoreLastWorkspace()
  })

  registerHandler('workspace:read-directory', async (event, input) => {
    assertTrustedSender(event)
    return readWorkspaceDirectory(input)
  })

  registerHandler('workspace:read-file', async (event, input) => {
    assertTrustedSender(event)
    return readWorkspaceFile(input)
  })

  registerHandler('workspace:write-file', async (event, input, content) => {
    assertTrustedSender(event)
    return writeWorkspaceFile(input, content)
  })

  registerHandler('workspace:search', async (event, query, options) => {
    assertTrustedSender(event)
    return searchWorkspace(query, options)
  })

  registerHandler('workspace:git-status', async (event) => {
    assertTrustedSender(event)
    return readGitStatus()
  })

  registerHandler('git:status', async (event) => {
    assertTrustedSender(event)
    return readGitRepositoryState(requireWorkspace())
  })

  registerHandler('git:diff', async (event, filePath, staged) => {
    assertTrustedSender(event)
    const targetPath = parseWorkspaceFilePath(filePath, 'Chemin du diff')
    if (typeof staged !== 'boolean') {
      throw new Error('Type de diff invalide.')
    }
    try {
      return await readGitDiff(requireWorkspace(), targetPath, staged)
    } catch (error) {
      throw new Error(getGitErrorMessage(error))
    }
  })

  registerHandler('git:stage', async (event, paths) => {
    assertTrustedSender(event)
    const entries = parseStringArray(paths, 'Liste des fichiers', 1_000)
    try {
      await stageGitPaths(requireWorkspace(), entries)
    } catch (error) {
      throw new Error(getGitErrorMessage(error))
    }
  })

  registerHandler('git:unstage', async (event, paths) => {
    assertTrustedSender(event)
    const entries = parseStringArray(paths, 'Liste des fichiers', 1_000)
    try {
      await unstageGitPaths(requireWorkspace(), entries)
    } catch (error) {
      throw new Error(getGitErrorMessage(error))
    }
  })

  registerHandler('git:stage-all', async (event) => {
    assertTrustedSender(event)
    try {
      await stageAllGitPaths(requireWorkspace())
    } catch (error) {
      throw new Error(getGitErrorMessage(error))
    }
  })

  registerHandler('git:unstage-all', async (event) => {
    assertTrustedSender(event)
    try {
      await unstageAllGitPaths(requireWorkspace())
    } catch (error) {
      throw new Error(getGitErrorMessage(error))
    }
  })

  registerHandler('git:commit', async (event, message) => {
    assertTrustedSender(event)
    if (typeof message !== 'string' || message.length > 10_000 || message.includes('\0')) {
      throw new Error('Message de validation invalide.')
    }
    try {
      return await commitGitChanges(requireWorkspace(), message)
    } catch (error) {
      throw new Error(getGitErrorMessage(error))
    }
  })

  registerHandler('git:branches', async (event) => {
    assertTrustedSender(event)
    return readGitBranches(requireWorkspace())
  })

  registerHandler('git:checkout', async (event, branch) => {
    assertTrustedSender(event)
    if (typeof branch !== 'string') {
      throw new Error('Nom de branche invalide.')
    }
    try {
      await checkoutGitBranch(requireWorkspace(), branch)
    } catch (error) {
      throw new Error(getGitErrorMessage(error))
    }
  })

  registerHandler('lsp:statuses', (event) => {
    assertTrustedSender(event)
    return lspManager.getStatuses()
  })

  registerHandler('lsp:ensure', async (event, languageId, filePath) => {
    assertTrustedSender(event)
    const targetPath = parseWorkspaceFilePath(filePath, 'Chemin du document')
    if (typeof languageId !== 'string' || languageId.length === 0 || languageId.length > 64) {
      throw new Error('Langage du document invalide.')
    }
    return lspManager.ensure(languageId, targetPath)
  })

  registerHandler('lsp:did-open', (event, filePath, languageId, version, text) => {
    assertTrustedSender(event)
    const targetPath = parseWorkspaceFilePath(filePath, 'Chemin du document')
    if (
      typeof languageId !== 'string' ||
      languageId.length === 0 ||
      languageId.length > 64 ||
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof text !== 'string' ||
      text.length > MAX_TEXT_FILE_BYTES
    ) {
      throw new Error('Document de langage invalide.')
    }
    lspManager.didOpen(targetPath, languageId, version, text)
  })

  registerHandler('lsp:did-change', (event, filePath, version, text) => {
    assertTrustedSender(event)
    const targetPath = parseWorkspaceFilePath(filePath, 'Chemin du document')
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof text !== 'string' ||
      text.length > MAX_TEXT_FILE_BYTES
    ) {
      throw new Error('Document de langage invalide.')
    }
    lspManager.didChange(targetPath, version, text)
  })

  registerHandler('lsp:did-save', (event, filePath) => {
    assertTrustedSender(event)
    lspManager.didSave(parseWorkspaceFilePath(filePath, 'Chemin du document'))
  })

  registerHandler('lsp:did-close', (event, filePath) => {
    assertTrustedSender(event)
    lspManager.didClose(parseWorkspaceFilePath(filePath, 'Chemin du document'))
  })

  registerHandler('lsp:hover', async (event, filePath, position) => {
    assertTrustedSender(event)
    return lspManager.hover(parseWorkspaceFilePath(filePath, 'Chemin du document'), position)
  })

  registerHandler('lsp:completion', async (event, filePath, position, triggerCharacter) => {
    assertTrustedSender(event)
    return lspManager.completion(
      parseWorkspaceFilePath(filePath, 'Chemin du document'),
      position,
      triggerCharacter
    )
  })

  registerHandler('lsp:definition', async (event, filePath, position) => {
    assertTrustedSender(event)
    return lspManager.definition(parseWorkspaceFilePath(filePath, 'Chemin du document'), position)
  })

  registerHandler('lsp:references', async (event, filePath, position) => {
    assertTrustedSender(event)
    return lspManager.references(parseWorkspaceFilePath(filePath, 'Chemin du document'), position)
  })

  registerHandler('lsp:document-symbols', async (event, filePath) => {
    assertTrustedSender(event)
    return lspManager.documentSymbols(parseWorkspaceFilePath(filePath, 'Chemin du document'))
  })

  registerHandler('lsp:workspace-symbols', async (event, query) => {
    assertTrustedSender(event)
    return lspManager.workspaceSymbols(typeof query === 'string' ? query.slice(0, 200) : '')
  })

  registerHandler('lsp:formatting', async (event, filePath, tabSize, insertSpaces) => {
    assertTrustedSender(event)
    return lspManager.formatting(
      parseWorkspaceFilePath(filePath, 'Chemin du document'),
      typeof tabSize === 'number' ? tabSize : 2,
      insertSpaces === true
    )
  })

  registerHandler('lsp:rename', async (event, filePath, position, newName) => {
    assertTrustedSender(event)
    if (typeof newName !== 'string' || newName.length === 0 || newName.length > 512) {
      throw new Error('Nouveau nom invalide.')
    }
    return lspManager.rename(
      parseWorkspaceFilePath(filePath, 'Chemin du document'),
      position,
      newName
    )
  })

  registerHandler('lsp:signature-help', async (event, filePath, position) => {
    assertTrustedSender(event)
    return lspManager.signatureHelp(
      parseWorkspaceFilePath(filePath, 'Chemin du document'),
      position
    )
  })

  registerHandler('tasks:list', async (event, activeFilePath) => {
    assertTrustedSender(event)
    return taskManager.list(
      requireWorkspace(),
      parseOptionalWorkspaceFilePath(activeFilePath, 'Fichier actif')
    )
  })

  registerHandler('tasks:run', async (event, taskId, activeFilePath) => {
    assertTrustedSender(event)
    if (typeof taskId !== 'string' || taskId.length === 0 || taskId.length > 4_096) {
      throw new Error('Identifiant de tâche invalide.')
    }
    return taskManager.run(
      requireWorkspace(),
      taskId,
      event.sender,
      parseOptionalWorkspaceFilePath(activeFilePath, 'Fichier actif')
    )
  })

  registerHandler('tasks:run-file', async (event, filePath) => {
    assertTrustedSender(event)
    return taskManager.runFile(
      requireWorkspace(),
      parseWorkspaceFilePath(filePath, 'Fichier à exécuter'),
      event.sender
    )
  })

  registerHandler('tasks:stop', (event, runId) => {
    assertTrustedSender(event)
    if (typeof runId !== 'string' || runId.length === 0 || runId.length > 128) {
      throw new Error('Identifiant d’exécution invalide.')
    }
    taskManager.stop(event.sender, runId)
  })

  registerHandler('debug:configurations', async (event, activeFilePath) => {
    assertTrustedSender(event)
    return debugManager.getConfigurations(
      parseOptionalWorkspaceFilePath(activeFilePath, 'Fichier actif')
    )
  })

  registerHandler('debug:start', async (event, configurationId, breakpoints, activeFilePath) => {
    assertTrustedSender(event)
    if (
      typeof configurationId !== 'string' ||
      configurationId.length === 0 ||
      configurationId.length > 200
    ) {
      throw new Error('Configuration de débogage invalide.')
    }
    return debugManager.start(
      configurationId,
      parseBreakpointFiles(breakpoints),
      parseOptionalWorkspaceFilePath(activeFilePath, 'Fichier actif')
    )
  })

  registerHandler('debug:start-file', async (event, filePath, breakpoints) => {
    assertTrustedSender(event)
    return debugManager.startFile(
      parseWorkspaceFilePath(filePath, 'Fichier à déboguer'),
      parseBreakpointFiles(breakpoints)
    )
  })

  registerHandler('debug:stop', async (event) => {
    assertTrustedSender(event)
    await debugManager.stop()
  })

  registerHandler('debug:continue', async (event) => {
    assertTrustedSender(event)
    await debugManager.continue()
  })

  registerHandler('debug:pause', async (event) => {
    assertTrustedSender(event)
    await debugManager.pause()
  })

  registerHandler('debug:next', async (event) => {
    assertTrustedSender(event)
    await debugManager.next()
  })

  registerHandler('debug:step-in', async (event) => {
    assertTrustedSender(event)
    await debugManager.stepIn()
  })

  registerHandler('debug:step-out', async (event) => {
    assertTrustedSender(event)
    await debugManager.stepOut()
  })

  registerHandler('debug:set-breakpoints', async (event, filePath, breakpoints) => {
    assertTrustedSender(event)
    return debugManager.setBreakpoints(
      parseWorkspaceFilePath(filePath, 'Fichier de point d’arrêt'),
      parseBreakpointInputs(breakpoints)
    )
  })

  registerHandler('debug:stack-trace', async (event) => {
    assertTrustedSender(event)
    return debugManager.stackTrace()
  })

  registerHandler('debug:scopes', async (event, frameId) => {
    assertTrustedSender(event)
    return debugManager.scopes(parseInteger(frameId, 'Identifiant de frame'))
  })

  registerHandler('debug:variables', async (event, reference) => {
    assertTrustedSender(event)
    return debugManager.variables(parseInteger(reference, 'Référence de variable', 1))
  })

  registerHandler('debug:evaluate', async (event, expression, frameId) => {
    assertTrustedSender(event)
    if (typeof expression !== 'string' || expression.length > 32_000) {
      throw new Error('Expression de débogage invalide.')
    }
    const normalizedFrameId =
      frameId === null || frameId === undefined
        ? null
        : parseInteger(frameId, 'Identifiant de frame')
    return debugManager.evaluate(expression, normalizedFrameId)
  })

  registerHandler('workspace:reveal', async (event, input) => {
    assertTrustedSender(event)
    await revealPath(input)
  })

  registerHandler('workspace:list-files', async (event) => {
    assertTrustedSender(event)
    return listWorkspaceFiles()
  })

  registerHandler('workspace:create-file', async (event, parentPath, name) => {
    assertTrustedSender(event)
    return createWorkspaceEntry(parentPath, name, false)
  })

  registerHandler('workspace:create-directory', async (event, parentPath, name) => {
    assertTrustedSender(event)
    return createWorkspaceEntry(parentPath, name, true)
  })

  registerHandler('workspace:rename', async (event, targetPath, newName) => {
    assertTrustedSender(event)
    return renameWorkspaceEntry(targetPath, newName)
  })

  registerHandler('workspace:delete', async (event, targetPath) => {
    assertTrustedSender(event)
    await deleteWorkspaceEntry(targetPath)
  })

  registerHandler('dialog:confirm-file-close', async (event, fileName) => {
    const window = assertTrustedSender(event)
    return confirmFileClose(window, fileName)
  })

  registerHandler('dialog:confirm-workspace-change', async (event, dirtyCount) => {
    const window = assertTrustedSender(event)
    return confirmWorkspaceChange(window, dirtyCount)
  })

  registerHandler('dialog:confirm-delete', async (event, name, hasDirtyFiles) => {
    const window = assertTrustedSender(event)
    return confirmDelete(window, name, hasDirtyFiles)
  })

  registerHandler('app:set-dirty-count', (event, count) => {
    assertTrustedSender(event)
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 10_000) {
      throw new Error('Nombre de fichiers modifiés invalide.')
    }

    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) {
      dirtyCounts.set(window, count)
    }
  })

  registerHandler('terminal:create', async (event, input) => {
    assertTrustedSender(event)
    return createTerminal(event, input)
  })

  registerHandler('gole:command', (event) => {
    assertTrustedSender(event)
    return getGoleCommand()
  })

  registerHandler('gole:preferences:get', (event) => {
    assertTrustedSender(event)
    return getGolePreferences()
  })

  registerHandler('gole:preferences:set', async (event, preferences) => {
    assertTrustedSender(event)
    return saveGolePreferences(preferences)
  })

  registerHandler('gole-chat:send', async (event, text, preferences) => {
    const window = assertTrustedSender(event)
    if (!isGolePreferences(preferences)) {
      throw new Error('Sélection de navigateur ou de fournisseur IA Gole invalide.')
    }
    const workspace = requireWorkspace()
    const setup = await getGoleSetup(preferences.browser)
    const bridgePath = path.join(path.dirname(setup.entry), 'camiBridge.js')
    try {
      await fs.access(bridgePath)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error('Le pont de chat Cami est absent dans les sources de Gole.')
      }
      throw error
    }

    goleChatManager.send(
      window,
      workspace,
      bridgePath,
      setup.binary,
      setup.goleHome,
      preferences,
      () => preferences.browser === 'cami-browser' ? getCompanionLayout(window) : null,
      text
    )
  })

  registerHandler('gole-chat:stop', (event) => {
    const window = assertTrustedSender(event)
    goleChatManager.stop(window.webContents)
  })

  registerHandler('terminal:write', (event, id, data) => {
    assertTrustedSender(event)
    if (typeof data !== 'string' || data.length > MAX_TERMINAL_DATA_LENGTH) {
      throw new Error('Entrée terminal invalide.')
    }

    const session = findOwnedTerminal(event, id)
    session?.pty.write(data)
  })

  registerHandler('terminal:resize', (event, id, cols, rows) => {
    assertTrustedSender(event)
    const session = findOwnedTerminal(event, id)
    if (!session) {
      return
    }

    session.pty.resize(
      validateDimension(cols, 2, 500, 80),
      validateDimension(rows, 1, 200, 24)
    )
  })

  registerHandler('terminal:dispose', (event, id) => {
    assertTrustedSender(event)
    const session = findOwnedTerminal(event, id)
    if (!session) {
      return
    }

    terminals.delete(session.id)

    try {
      session.pty.kill()
    } catch {
      // The process may already have exited.
    }
  })

  return () => {
    for (const channel of registeredChannels) {
      ipcMain.removeHandler(channel)
    }
    registeredChannels.clear()
    stopWorkspaceWatcher()
    invalidateQuickOpenCache()
    disposeAllTerminals()
    goleChatManager.dispose()
    workspaceRoot = null
  }
}
