import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  CloseDialogAction,
  FileContents,
  FileEntry,
  GitDiffData,
  GitRepositoryState,
  GitStatus,
  PanelView,
  WorkspaceInfo
} from '../../preload'

export type SidebarView =
  | 'explorer'
  | 'search'
  | 'git'
  | 'debug'
  | 'tasks'
  | 'outline'
  | 'gole'
  | 'settings'
export type EditorPane = 'primary' | 'secondary'
export type FileDialogMode = 'create-file' | 'create-folder' | 'rename'
export type CommandPaletteMode =
  | 'files'
  | 'commands'
  | 'symbols'
  | 'workspace-symbols'
  | 'tasks'
  | 'debug'
export type OutputLevel = 'info' | 'success' | 'warning' | 'error'

export interface EditorSettings {
  fontSize: number
  tabSize: number
  wordWrap: boolean
  minimap: boolean
  terminalFontSize: number
  fontLigatures: boolean
  bracketPairColorization: boolean
  stickyScroll: boolean
  lineNumbers: 'on' | 'relative' | 'off'
}

export interface OpenFile {
  path: string
  name: string
  content: string
  savedContent: string
  language: string
  encoding: FileContents['encoding']
  eol: FileContents['eol']
  isDirty: boolean
  lastSavedAt: number
}

export interface FileTreeNode extends FileEntry {
  children: FileTreeNode[] | null
  isExpanded: boolean
  isLoading: boolean
}

export interface CursorPosition {
  line: number
  column: number
  selectionLength: number
}

export interface RevealTarget {
  path: string
  line: number
  column: number
  nonce: number
  pane: EditorPane
}

export interface FileDialogState {
  mode: FileDialogMode
  parentPath: string
  targetPath: string | null
  initialValue: string
  value: string
  error: string | null
  isSubmitting: boolean
}

export interface OutputEntry {
  id: number
  timestamp: number
  level: OutputLevel
  message: string
}

interface PersistedEditorSession {
  workspacePath: string
  openPaths: string[]
  activeFilePath: string | null
  secondaryFilePath: string | null
  splitOpen: boolean
  activePane: EditorPane
}

interface EditorState {
  workspace: WorkspaceInfo | null
  tree: FileTreeNode[]
  treeLoading: boolean
  initialized: boolean
  openFiles: OpenFile[]
  activeFilePath: string | null
  secondaryFilePath: string | null
  splitOpen: boolean
  activePane: EditorPane
  sidebarView: SidebarView
  sidebarOpen: boolean
  sidebarWidth: number
  panelOpen: boolean
  panelView: PanelView
  panelHeight: number
  commandPaletteOpen: boolean
  commandPaletteMode: CommandPaletteMode
  fileDialog: FileDialogState | null
  outputEntries: OutputEntry[]
  settings: EditorSettings
  cursor: CursorPosition
  gitStatus: GitStatus | null
  gitRepository: GitRepositoryState | null
  gitLoading: boolean
  gitBusy: boolean
  gitMessage: string
  gitError: string | null
  gitBranches: string[]
  gitDiff: GitDiffData | null
  gitDiffLoading: boolean
  error: string | null
  pendingReveal: RevealTarget | null
  searchFocusNonce: number
  initialize: () => Promise<void>
  openWorkspace: () => Promise<void>
  refreshWorkspace: () => Promise<void>
  refreshAfterWorkspaceChange: () => Promise<void>
  toggleDirectory: (directoryPath: string) => Promise<void>
  openFile: (filePath: string, line?: number, column?: number) => Promise<void>
  activateFileInPane: (filePath: string, pane: EditorPane) => void
  setActivePane: (pane: EditorPane) => void
  toggleSplit: () => void
  closeSplit: () => void
  reorderOpenFiles: (sourcePath: string, targetPath: string) => void
  updateFileContent: (filePath: string, content: string) => void
  saveFile: (filePath: string) => Promise<boolean>
  saveActiveFile: () => Promise<boolean>
  saveAllFiles: () => Promise<boolean>
  closeFile: (filePath: string) => Promise<void>
  closeActiveFile: () => Promise<void>
  closeAllFiles: () => Promise<void>
  setSidebarView: (view: SidebarView) => void
  toggleSidebar: () => void
  setSidebarWidth: (width: number) => void
  setPanelHeight: (height: number) => void
  focusSearch: () => void
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  setPanelView: (view: PanelView) => void
  toggleTerminal: () => void
  showPanel: (view: PanelView) => void
  openCommandPalette: (mode: CommandPaletteMode) => void
  closeCommandPalette: () => void
  beginCreateFile: (parentPath: string) => void
  beginCreateFolder: (parentPath: string) => void
  beginRename: (targetPath: string) => void
  closeFileDialog: () => void
  updateFileDialogValue: (value: string) => void
  submitFileDialog: () => Promise<void>
  deleteEntry: (targetPath: string) => Promise<void>
  appendOutput: (level: OutputLevel, message: string) => void
  clearOutput: () => void
  setCursor: (cursor: CursorPosition) => void
  refreshGitStatus: () => Promise<void>
  setGitMessage: (message: string) => void
  stageGitPaths: (paths: string[]) => Promise<void>
  unstageGitPaths: (paths: string[]) => Promise<void>
  stageAllGitChanges: () => Promise<void>
  unstageAllGitChanges: () => Promise<void>
  commitGitChanges: () => Promise<boolean>
  loadGitBranches: () => Promise<void>
  checkoutGitBranch: (branch: string) => Promise<void>
  openGitDiff: (filePath: string, staged: boolean) => Promise<void>
  closeGitDiff: () => void
  clearReveal: () => void
  dismissError: () => void
  persistSession: () => void
  updateSettings: (settings: Partial<EditorSettings>) => void
  resetSettings: () => void
}

export const DEFAULT_SETTINGS: EditorSettings = {
  fontSize: 13,
  tabSize: 2,
  wordWrap: false,
  minimap: true,
  terminalFontSize: 13,
  fontLigatures: true,
  bracketPairColorization: true,
  stickyScroll: true,
  lineNumbers: 'on'
}

const LANGUAGES_BY_EXTENSION: Record<string, string> = {
  bat: 'bat',
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  clj: 'clojure',
  cljs: 'clojure',
  cmake: 'cmake',
  coffee: 'coffeescript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  cxx: 'cpp',
  dart: 'dart',
  diff: 'diff',
  dockerfile: 'dockerfile',
  elm: 'elm',
  env: 'ini',
  ex: 'elixir',
  exs: 'elixir',
  fs: 'fsharp',
  fsx: 'fsharp',
  go: 'go',
  gql: 'graphql',
  graphql: 'graphql',
  h: 'c',
  hpp: 'cpp',
  hs: 'haskell',
  htm: 'html',
  html: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  md: 'markdown',
  mdx: 'mdx',
  mjs: 'javascript',
  php: 'php',
  pl: 'perl',
  properties: 'ini',
  proto: 'protobuf',
  ps1: 'powershell',
  psm1: 'powershell',
  py: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  sass: 'scss',
  scala: 'scala',
  scss: 'scss',
  sh: 'shell',
  sol: 'sol',
  sql: 'sql',
  svelte: 'html',
  swift: 'swift',
  tex: 'latex',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  vue: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shell'
}

const SPECIAL_LANGUAGES: Record<string, string> = {
  '.bashrc': 'shell',
  '.env': 'ini',
  '.gitignore': 'plaintext',
  '.npmrc': 'ini',
  '.prettierrc': 'json',
  '.zshrc': 'shell',
  'cmakelists.txt': 'cmake',
  'dockerfile': 'dockerfile',
  'gemfile': 'ruby',
  'makefile': 'makefile',
  'procfile': 'shell',
  'rakefile': 'ruby'
}

const pendingOpenRequests = new Map<string, Promise<void>>()
const saveQueues = new Map<string, Promise<boolean>>()
let initializePromise: Promise<void> | null = null
let revealNonce = 0
let outputSequence = 0
let treeRefreshSequence = 0
const SESSION_STORAGE_KEY = 'cami:editor-session'
const MAX_RESTORED_FILES = 30
const MAX_OUTPUT_ENTRIES = 500

function fileNameOf(filePath: string): string {
  const segments = filePath.split(/[\\/]/)
  return segments[segments.length - 1] || filePath
}

function extensionOf(filePath: string): string {
  const name = fileNameOf(filePath).toLocaleLowerCase()
  const dotIndex = name.lastIndexOf('.')
  return dotIndex === -1 ? '' : name.slice(dotIndex + 1)
}

function pathIsInside(parentPath: string, candidatePath: string): boolean {
  if (candidatePath === parentPath) {
    return true
  }

  if (!candidatePath.startsWith(parentPath)) {
    return false
  }

  const boundary = candidatePath.charAt(parentPath.length)
  return boundary === '/' || boundary === '\\'
}

function activePathOf(state: {
  activeFilePath: string | null
  secondaryFilePath: string | null
  splitOpen: boolean
  activePane: EditorPane
}): string | null {
  if (state.splitOpen && state.activePane === 'secondary') {
    return state.secondaryFilePath
  }

  return state.activeFilePath
}

function paneForOpenFile(state: {
  splitOpen: boolean
  activePane: EditorPane
}): EditorPane {
  return state.splitOpen && state.activePane === 'secondary' ? 'secondary' : 'primary'
}

function toOpenFile(filePath: string, file: FileContents): OpenFile {
  return {
    path: filePath,
    name: fileNameOf(filePath),
    content: file.content,
    savedContent: file.content,
    language: languageForPath(filePath),
    encoding: file.encoding,
    eol: file.eol,
    isDirty: false,
    lastSavedAt: file.mtimeMs
  }
}

function readPersistedSession(): PersistedEditorSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<PersistedEditorSession>
    if (
      typeof parsed.workspacePath !== 'string' ||
      !Array.isArray(parsed.openPaths) ||
      !parsed.openPaths.every((entry) => typeof entry === 'string')
    ) {
      return null
    }

    const openPaths = [...new Set(parsed.openPaths)].slice(0, MAX_RESTORED_FILES)
    return {
      workspacePath: parsed.workspacePath,
      openPaths,
      activeFilePath:
        typeof parsed.activeFilePath === 'string' ? parsed.activeFilePath : null,
      secondaryFilePath:
        typeof parsed.secondaryFilePath === 'string' ? parsed.secondaryFilePath : null,
      splitOpen: parsed.splitOpen === true,
      activePane: parsed.activePane === 'secondary' ? 'secondary' : 'primary'
    }
  } catch {
    return null
  }
}

export function languageForPath(filePath: string): string {
  const fileName = fileNameOf(filePath).toLocaleLowerCase()
  const specialLanguage = SPECIAL_LANGUAGES[fileName]
  if (specialLanguage) {
    return specialLanguage
  }

  return LANGUAGES_BY_EXTENSION[extensionOf(filePath)] ?? 'plaintext'
}

export function getErrorMessage(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error)
  return rawMessage.replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
    ''
  )
}

function toTreeNodes(entries: FileEntry[]): FileTreeNode[] {
  return entries.map((entry) => ({
    ...entry,
    children: null,
    isExpanded: false,
    isLoading: false
  }))
}

async function buildTreeWithExpansion(
  entries: FileEntry[],
  previousNodes: FileTreeNode[]
): Promise<FileTreeNode[]> {
  const previousByPath = new Map(previousNodes.map((node) => [node.path, node]))

  return Promise.all(
    entries.map(async (entry): Promise<FileTreeNode> => {
      const previous = previousByPath.get(entry.path)
      const node: FileTreeNode = {
        ...entry,
        children: null,
        isExpanded: previous?.isExpanded ?? false,
        isLoading: false
      }

      if (entry.isDirectory && previous?.isExpanded) {
        try {
          const childEntries = await window.electronAPI.workspace.readDirectory(entry.path)
          node.children = await buildTreeWithExpansion(
            childEntries,
            previous.children ?? []
          )
        } catch {
          node.isExpanded = false
        }
      }

      return node
    })
  )
}

function updateTreeNode(
  nodes: FileTreeNode[],
  targetPath: string,
  updater: (node: FileTreeNode) => FileTreeNode
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return updater(node)
    }

    if (!node.children) {
      return node
    }

    const children = updateTreeNode(node.children, targetPath, updater)
    return children === node.children ? node : { ...node, children }
  })
}

function findTreeNode(nodes: FileTreeNode[], targetPath: string): FileTreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node
    }

    if (node.children) {
      const match = findTreeNode(node.children, targetPath)
      if (match) {
        return match
      }
    }
  }

  return null
}

function makeRevealTarget(
  filePath: string,
  line: number,
  column: number,
  pane: EditorPane
): RevealTarget {
  revealNonce += 1
  return {
    path: filePath,
    line: Math.max(1, line),
    column: Math.max(1, column),
    nonce: revealNonce,
    pane
  }
}

function clampSetting(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

function normalizeSettings(input: unknown): EditorSettings {
  const candidate =
    input && typeof input === 'object'
      ? (input as Partial<Record<keyof EditorSettings, unknown>>)
      : {}
  const fontSize =
    typeof candidate.fontSize === 'number' && Number.isFinite(candidate.fontSize)
      ? clampSetting(candidate.fontSize, 10, 24)
      : DEFAULT_SETTINGS.fontSize
  const terminalFontSize =
    typeof candidate.terminalFontSize === 'number' && Number.isFinite(candidate.terminalFontSize)
      ? clampSetting(candidate.terminalFontSize, 10, 22)
      : DEFAULT_SETTINGS.terminalFontSize
  const tabSize =
    typeof candidate.tabSize === 'number' && [2, 4, 8].includes(candidate.tabSize)
      ? candidate.tabSize
      : DEFAULT_SETTINGS.tabSize

  return {
    fontSize,
    terminalFontSize,
    tabSize,
    wordWrap:
      typeof candidate.wordWrap === 'boolean'
        ? candidate.wordWrap
        : DEFAULT_SETTINGS.wordWrap,
    minimap:
      typeof candidate.minimap === 'boolean'
        ? candidate.minimap
        : DEFAULT_SETTINGS.minimap,
    fontLigatures:
      typeof candidate.fontLigatures === 'boolean'
        ? candidate.fontLigatures
        : DEFAULT_SETTINGS.fontLigatures,
    bracketPairColorization:
      typeof candidate.bracketPairColorization === 'boolean'
        ? candidate.bracketPairColorization
        : DEFAULT_SETTINGS.bracketPairColorization,
    stickyScroll:
      typeof candidate.stickyScroll === 'boolean'
        ? candidate.stickyScroll
        : DEFAULT_SETTINGS.stickyScroll,
    lineNumbers:
      candidate.lineNumbers === 'on' ||
      candidate.lineNumbers === 'relative' ||
      candidate.lineNumbers === 'off'
        ? candidate.lineNumbers
        : DEFAULT_SETTINGS.lineNumbers
  }
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      workspace: null,
      tree: [],
      treeLoading: false,
      initialized: false,
      openFiles: [],
      activeFilePath: null,
      secondaryFilePath: null,
      splitOpen: false,
      activePane: 'primary',
      sidebarView: 'explorer',
      sidebarOpen: true,
      sidebarWidth: 264,
      panelOpen: false,
      panelView: 'terminal',
      panelHeight: 246,
      commandPaletteOpen: false,
      commandPaletteMode: 'files',
      fileDialog: null,
      outputEntries: [],
      settings: { ...DEFAULT_SETTINGS },
      cursor: {
        line: 1,
        column: 1,
        selectionLength: 0
      },
      gitStatus: null,
      gitRepository: null,
      gitLoading: false,
      gitBusy: false,
      gitMessage: '',
      gitError: null,
      gitBranches: [],
      gitDiff: null,
      gitDiffLoading: false,
      error: null,
      pendingReveal: null,
      searchFocusNonce: 0,

      initialize: () => {
        if (get().initialized) {
          return Promise.resolve()
        }

        if (initializePromise) {
          return initializePromise
        }

        initializePromise = (async () => {
          try {
            let workspace = await window.electronAPI.workspace.current()
            if (!workspace) {
              workspace = await window.electronAPI.workspace.restoreLast()
            }

            if (!workspace) {
              set({ initialized: true })
              return
            }

            set({
              workspace,
              treeLoading: true
            })

            const entries = await window.electronAPI.workspace.readDirectory()
            if (get().workspace?.path !== workspace.path) {
              return
            }

            let openFiles: OpenFile[] = []
            let activeFilePath: string | null = null
            let secondaryFilePath: string | null = null
            let splitOpen = false
            let activePane: EditorPane = 'primary'
            const persisted = readPersistedSession()

            if (persisted && persisted.workspacePath === workspace.path) {
              const restoredFiles = await Promise.all(
                persisted.openPaths.map(async (filePath): Promise<OpenFile | null> => {
                  try {
                    const file = await window.electronAPI.workspace.readFile(filePath)
                    return toOpenFile(filePath, file)
                  } catch {
                    return null
                  }
                })
              )

              if (get().workspace?.path !== workspace.path) {
                return
              }

              openFiles = restoredFiles.filter((file): file is OpenFile => file !== null)
              const openPaths = new Set(openFiles.map((file) => file.path))

              activeFilePath =
                persisted.activeFilePath && openPaths.has(persisted.activeFilePath)
                  ? persisted.activeFilePath
                  : (openFiles[0]?.path ?? null)
              secondaryFilePath =
                persisted.splitOpen &&
                persisted.secondaryFilePath &&
                openPaths.has(persisted.secondaryFilePath)
                  ? persisted.secondaryFilePath
                  : null
              splitOpen = persisted.splitOpen && secondaryFilePath !== null
              activePane =
                splitOpen && persisted.activePane === 'secondary' ? 'secondary' : 'primary'
            }

            set({
              tree: toTreeNodes(entries),
              treeLoading: false,
              initialized: true,
              openFiles,
              activeFilePath,
              secondaryFilePath,
              splitOpen,
              activePane,
              pendingReveal: null,
              error: null
            })

            if (openFiles.length > 0) {
              get().appendOutput(
                'info',
                `Session restaurée : ${openFiles.length} fichier${openFiles.length > 1 ? 's' : ''} ouvert${openFiles.length > 1 ? 's' : ''}.`
              )
            }

            void get().refreshGitStatus()
          } catch (error) {
            set({
              error: getErrorMessage(error),
              treeLoading: false,
              initialized: true
            })
          } finally {
            initializePromise = null
          }
        })()

        return initializePromise
      },

      openWorkspace: async () => {
        const dirtyCount = get().openFiles.reduce(
          (count, file) => count + (file.isDirty ? 1 : 0),
          0
        )

        if (dirtyCount > 0) {
          try {
            const action = await window.electronAPI.dialog.confirmWorkspaceChange(dirtyCount)
            if (action === 'cancel') {
              return
            }

            if (action === 'save') {
              const saved = await get().saveAllFiles()
              if (!saved) {
                return
              }
            }
          } catch (error) {
            set({ error: getErrorMessage(error) })
            return
          }
        }

        let requestedWorkspace: WorkspaceInfo | null = null

        try {
          const workspace = await window.electronAPI.workspace.open()
          if (!workspace) {
            return
          }

          requestedWorkspace = workspace
          pendingOpenRequests.clear()

          set({
            workspace,
            tree: [],
            treeLoading: true,
            openFiles: [],
            activeFilePath: null,
            secondaryFilePath: null,
            splitOpen: false,
            activePane: 'primary',
            pendingReveal: null,
            gitStatus: null,
            gitRepository: null,
            gitBranches: [],
            gitDiff: null,
            gitError: null,
            gitBusy: false,
            gitMessage: '',
            panelOpen: false,
            panelView: 'terminal',
            commandPaletteOpen: false,
            fileDialog: null,
            error: null
          })

          const entries = await window.electronAPI.workspace.readDirectory()
          if (get().workspace?.path !== workspace.path) {
            return
          }

          set({
            tree: toTreeNodes(entries),
            treeLoading: false
          })
          get().appendOutput('info', `Dossier ouvert : ${workspace.path}`)
          void get().refreshGitStatus()
        } catch (error) {
          if (!requestedWorkspace || get().workspace?.path === requestedWorkspace.path) {
            set({
              error: getErrorMessage(error),
              treeLoading: false
            })
          }
        }
      },

      refreshWorkspace: async () => {
        const workspace = get().workspace
        if (!workspace) {
          return
        }

        const sequence = ++treeRefreshSequence
        const previousTree = get().tree
        if (previousTree.length === 0) {
          set({ treeLoading: true })
        }

        try {
          const entries = await window.electronAPI.workspace.readDirectory()
          if (sequence !== treeRefreshSequence || get().workspace?.path !== workspace.path) {
            return
          }

          const tree = await buildTreeWithExpansion(entries, previousTree)
          if (sequence !== treeRefreshSequence || get().workspace?.path !== workspace.path) {
            return
          }

          set({
            tree,
            treeLoading: false,
            error: null
          })
        } catch (error) {
          if (get().workspace?.path === workspace.path) {
            set({
              error: getErrorMessage(error),
              treeLoading: false
            })
          }
        }
      },

      refreshAfterWorkspaceChange: async () => {
        const workspacePath = get().workspace?.path
        if (!workspacePath) {
          return
        }

        const openFiles = get().openFiles
        await Promise.all([get().refreshWorkspace(), get().refreshGitStatus()])

        const refreshedFiles = await Promise.all(
          openFiles.map(async (file) => {
            try {
              return {
                path: file.path,
                contents: await window.electronAPI.workspace.readFile(file.path),
                error: null
              }
            } catch (error) {
              return {
                path: file.path,
                contents: null,
                error: getErrorMessage(error)
              }
            }
          })
        )

        if (get().workspace?.path !== workspacePath) {
          return
        }

        for (const refreshed of refreshedFiles) {
          if (refreshed.error) {
            if (get().openFiles.some((file) => file.path === refreshed.path)) {
              get().appendOutput(
                'warning',
                `Impossible d’actualiser ${fileNameOf(refreshed.path)} : ${refreshed.error}`
              )
            }
            continue
          }

          const contents = refreshed.contents
          if (!contents) {
            continue
          }

          const currentFile = get().openFiles.find((file) => file.path === refreshed.path)
          if (!currentFile) {
            continue
          }

          if (currentFile.isDirty) {
            if (
              contents.content !== currentFile.savedContent &&
              contents.content !== currentFile.content
            ) {
              get().appendOutput(
                'warning',
                `${fileNameOf(refreshed.path)} a changé sur le disque avec des modifications locales non enregistrées. Le buffer Cami a été conservé ; comparez les versions avant d’enregistrer.`
              )
              continue
            }

            if (contents.content !== currentFile.content) {
              continue
            }
          }

          set((state) => {
            let changed = false
            const openFiles = state.openFiles.map((file) => {
              if (file.path !== refreshed.path || (file.isDirty && file.content !== contents.content)) {
                return file
              }

              if (
                file.content === contents.content &&
                file.lastSavedAt === contents.mtimeMs
              ) {
                return file
              }

              changed = true
              return {
                ...file,
                content: contents.content,
                savedContent: contents.content,
                encoding: contents.encoding,
                eol: contents.eol,
                isDirty: false,
                lastSavedAt: contents.mtimeMs
              }
            })

            return changed ? { openFiles } : state
          })
        }
      },

      toggleDirectory: async (directoryPath) => {
        const workspace = get().workspace
        if (!workspace) {
          return
        }

        const node = findTreeNode(get().tree, directoryPath)
        if (!node || !node.isDirectory || node.isLoading) {
          return
        }

        if (node.isExpanded) {
          set((state) => ({
            tree: updateTreeNode(state.tree, directoryPath, (current) => ({
              ...current,
              isExpanded: false
            }))
          }))
          return
        }

        if (node.children) {
          set((state) => ({
            tree: updateTreeNode(state.tree, directoryPath, (current) => ({
              ...current,
              isExpanded: true
            }))
          }))
          return
        }

        set((state) => ({
          tree: updateTreeNode(state.tree, directoryPath, (current) => ({
            ...current,
            isExpanded: true,
            isLoading: true
          }))
        }))

        try {
          const entries = await window.electronAPI.workspace.readDirectory(directoryPath)
          if (!findTreeNode(get().tree, directoryPath)) {
            return
          }

          set((state) => ({
            tree: updateTreeNode(state.tree, directoryPath, (current) => ({
              ...current,
              children: toTreeNodes(entries),
              isLoading: false
            }))
          }))
        } catch (error) {
          if (get().workspace?.path === workspace.path) {
            set((state) => ({
              tree: updateTreeNode(state.tree, directoryPath, (current) => ({
                ...current,
                isExpanded: false,
                isLoading: false
              })),
              error: getErrorMessage(error)
            }))
          }
        }
      },

      openFile: (filePath, line, column) => {
        const targetPane = paneForOpenFile(get())
        const existing = get().openFiles.find((file) => file.path === filePath)
        if (existing) {
          set((state) => ({
            ...(targetPane === 'secondary'
              ? {
                  splitOpen: true,
                  secondaryFilePath: filePath,
                  activePane: 'secondary' as const
                }
              : {
                  activeFilePath: filePath,
                  activePane: 'primary' as const
                }),
            pendingReveal:
              line !== undefined
                ? makeRevealTarget(filePath, line, column ?? 1, targetPane)
                : state.pendingReveal
          }))
          return Promise.resolve()
        }

        const pendingRequest = pendingOpenRequests.get(filePath)
        if (pendingRequest) {
          return pendingRequest.then(() => {
            const state = get()
            if (!state.openFiles.some((file) => file.path === filePath)) {
              return
            }

            set(
              targetPane === 'secondary'
                ? {
                    splitOpen: true,
                    secondaryFilePath: filePath,
                    activePane: 'secondary',
                    pendingReveal:
                      line !== undefined
                        ? makeRevealTarget(filePath, line, column ?? 1, targetPane)
                        : state.pendingReveal
                  }
                : {
                    activeFilePath: filePath,
                    activePane: 'primary',
                    pendingReveal:
                      line !== undefined
                        ? makeRevealTarget(filePath, line, column ?? 1, targetPane)
                        : state.pendingReveal
                  }
            )
          })
        }

        const request = (async () => {
          const requestedWorkspacePath = get().workspace?.path ?? null

          try {
            const file = await window.electronAPI.workspace.readFile(filePath)
            if (get().workspace?.path !== requestedWorkspacePath) {
              return
            }

            if (get().openFiles.some((openFile) => openFile.path === filePath)) {
              set(
                targetPane === 'secondary'
                  ? {
                      splitOpen: true,
                      secondaryFilePath: filePath,
                      activePane: 'secondary'
                    }
                  : {
                      activeFilePath: filePath,
                      activePane: 'primary'
                    }
              )
              return
            }

            const openFile = toOpenFile(filePath, file)

            set((state) => ({
              openFiles: [...state.openFiles, openFile],
              ...(targetPane === 'secondary'
                ? {
                    splitOpen: true,
                    secondaryFilePath: filePath,
                    activePane: 'secondary' as const
                  }
                : {
                    activeFilePath: filePath,
                    activePane: 'primary' as const
                  }),
              pendingReveal:
                line !== undefined
                  ? makeRevealTarget(filePath, line, column ?? 1, targetPane)
                  : null,
              error: null
            }))
          } catch (error) {
            if (get().workspace?.path === requestedWorkspacePath) {
              const message = getErrorMessage(error)
              set({ error: message })
              get().appendOutput('error', `Impossible d’ouvrir ${fileNameOf(filePath)} : ${message}`)
            }
          }
        })()

        pendingOpenRequests.set(filePath, request)
        void request.finally(() => {
          if (pendingOpenRequests.get(filePath) === request) {
            pendingOpenRequests.delete(filePath)
          }
        })

        return request
      },

      activateFileInPane: (filePath, pane) => {
        if (!get().openFiles.some((file) => file.path === filePath)) {
          return
        }

        set(
          pane === 'secondary'
            ? {
                splitOpen: true,
                secondaryFilePath: filePath,
                activePane: 'secondary',
                pendingReveal: null
              }
            : {
                activeFilePath: filePath,
                activePane: 'primary',
                pendingReveal: null
              }
        )
      },

      setActivePane: (pane) => {
        const state = get()
        if (pane === 'secondary') {
          if (!state.splitOpen) {
            return
          }

          if (state.activePane !== 'secondary') {
            set({ activePane: 'secondary' })
          }
          return
        }

        if (state.activePane !== 'primary') {
          set({ activePane: 'primary' })
        }
      },

      toggleSplit: () => {
        const state = get()
        if (state.splitOpen) {
          set({
            splitOpen: false,
            secondaryFilePath: null,
            activePane: state.activePane === 'secondary' ? 'primary' : state.activePane,
            pendingReveal:
              state.pendingReveal?.pane === 'secondary' ? null : state.pendingReveal
          })
          return
        }

        set({
          splitOpen: true,
          secondaryFilePath: state.activeFilePath,
          activePane: 'secondary',
          pendingReveal: null
        })
      },

      closeSplit: () => {
        const state = get()
        if (!state.splitOpen) {
          return
        }

        set({
          splitOpen: false,
          secondaryFilePath: null,
          activePane: state.activePane === 'secondary' ? 'primary' : state.activePane,
          pendingReveal:
            state.pendingReveal?.pane === 'secondary' ? null : state.pendingReveal
        })
      },

      reorderOpenFiles: (sourcePath, targetPath) => {
        if (sourcePath === targetPath) {
          return
        }

        set((state) => {
          const sourceIndex = state.openFiles.findIndex((file) => file.path === sourcePath)
          const targetIndex = state.openFiles.findIndex((file) => file.path === targetPath)
          if (sourceIndex === -1 || targetIndex === -1) {
            return state
          }

          const openFiles = state.openFiles.slice()
          const [movedFile] = openFiles.splice(sourceIndex, 1)
          if (!movedFile) {
            return state
          }

          openFiles.splice(targetIndex, 0, movedFile)
          return { openFiles }
        })
      },

      updateFileContent: (filePath, content) => {
        set((state) => {
          const index = state.openFiles.findIndex((file) => file.path === filePath)
          if (index === -1) {
            return state
          }

          const file = state.openFiles[index]
          if (!file || file.content === content) {
            return state
          }

          const updatedFile: OpenFile = {
            ...file,
            content,
            isDirty: content !== file.savedContent
          }
          const openFiles = state.openFiles.slice()
          openFiles[index] = updatedFile

          return { openFiles }
        })
      },

      saveFile: (filePath) => {
        const previous = saveQueues.get(filePath) ?? Promise.resolve(true)
        const queuedSave = previous
          .catch(() => false)
          .then(async () => {
            const file = get().openFiles.find((candidate) => candidate.path === filePath)
            if (!file) {
              return false
            }

            if (!file.isDirty) {
              return true
            }

            const contentSnapshot = file.content
            const requestedWorkspacePath = get().workspace?.path ?? null

            try {
              const result = await window.electronAPI.workspace.writeFile(
                filePath,
                contentSnapshot
              )

              if (get().workspace?.path !== requestedWorkspacePath) {
                return false
              }

              set((state) => ({
                openFiles: state.openFiles.map((current) => {
                  if (current.path !== filePath) {
                    return current
                  }

                  return {
                    ...current,
                    savedContent: contentSnapshot,
                    isDirty: current.content !== contentSnapshot,
                    lastSavedAt: result.mtimeMs
                  }
                })
              }))

              get().appendOutput('success', `Enregistré : ${fileNameOf(filePath)}`)
              void get().refreshGitStatus()
              return true
            } catch (error) {
              if (get().workspace?.path === requestedWorkspacePath) {
                set({ error: getErrorMessage(error) })
              }
              return false
            }
          })

        saveQueues.set(filePath, queuedSave)
        void queuedSave.finally(() => {
          if (saveQueues.get(filePath) === queuedSave) {
            saveQueues.delete(filePath)
          }
        })

        return queuedSave
      },

      saveActiveFile: async () => {
        const state = get()
        const activeFilePath = activePathOf(state)
        if (!activeFilePath) {
          return false
        }

        return get().saveFile(activeFilePath)
      },

      saveAllFiles: async () => {
        const dirtyFiles = get().openFiles.filter((file) => file.isDirty)
        if (dirtyFiles.length === 0) {
          return true
        }

        let allSaved = true
        for (const file of dirtyFiles) {
          const saved = await get().saveFile(file.path)
          if (!saved) {
            allSaved = false
          }
        }

        return allSaved && get().openFiles.every((file) => !file.isDirty)
      },

      closeFile: async (filePath) => {
        const file = get().openFiles.find((candidate) => candidate.path === filePath)
        if (!file) {
          return
        }

        if (file.isDirty) {
          try {
            const action: CloseDialogAction =
              await window.electronAPI.dialog.confirmFileClose(file.name)
            if (action === 'cancel') {
              return
            }

            if (action === 'save') {
              const saved = await get().saveFile(filePath)
              if (!saved) {
                return
              }

              const currentFile = get().openFiles.find(
                (candidate) => candidate.path === filePath
              )
              if (currentFile?.isDirty) {
                set({
                  error:
                    'Le fichier a été modifié pendant l’enregistrement. Fermez-le à nouveau.'
                })
                return
              }
            }
          } catch (error) {
            set({ error: getErrorMessage(error) })
            return
          }
        }

        const state = get()
        const index = state.openFiles.findIndex((candidate) => candidate.path === filePath)
        if (index === -1) {
          return
        }

        const remainingFiles = state.openFiles.filter((candidate) => candidate.path !== filePath)
        const nextFile =
          remainingFiles[index] ?? remainingFiles[remainingFiles.length - 1] ?? null
        let nextActiveFile = state.activeFilePath
        let nextSecondaryFile = state.secondaryFilePath
        let nextActivePane = state.activePane

        if (state.activeFilePath === filePath) {
          nextActiveFile = nextFile?.path ?? null
        }

        if (state.secondaryFilePath === filePath) {
          nextSecondaryFile = nextFile?.path ?? null
        }

        if (remainingFiles.length === 0) {
          nextActiveFile = null
          nextSecondaryFile = null
          nextActivePane = 'primary'
        } else if (nextActivePane === 'secondary' && !nextSecondaryFile) {
          nextActivePane = 'primary'
        }

        set({
          openFiles: remainingFiles,
          activeFilePath: nextActiveFile,
          secondaryFilePath: nextSecondaryFile,
          splitOpen: state.splitOpen && remainingFiles.length > 0,
          activePane: nextActivePane,
          pendingReveal: state.pendingReveal?.path === filePath ? null : state.pendingReveal
        })
        get().appendOutput('info', `Fermé : ${file.name}`)
      },

      closeActiveFile: async () => {
        const activeFilePath = activePathOf(get())
        if (!activeFilePath) {
          return
        }

        await get().closeFile(activeFilePath)
      },

      closeAllFiles: async () => {
        for (const file of [...get().openFiles]) {
          if (!get().openFiles.some((candidate) => candidate.path === file.path)) {
            continue
          }

          await get().closeFile(file.path)

          if (get().openFiles.some((candidate) => candidate.path === file.path)) {
            break
          }
        }
      },

      setSidebarView: (view) => {
        set({ sidebarView: view, sidebarOpen: true })
      },

      toggleSidebar: () => {
        set((state) => ({ sidebarOpen: !state.sidebarOpen }))
      },

      setSidebarWidth: (width) => {
        set({ sidebarWidth: Math.max(180, Math.min(480, Math.round(width))) })
      },

      setPanelHeight: (height) => {
        set({ panelHeight: Math.max(160, Math.min(600, Math.round(height))) })
      },

      focusSearch: () => {
        const state = get()
        set({
          sidebarView: 'search',
          sidebarOpen: true,
          searchFocusNonce: state.searchFocusNonce + 1
        })
      },

      setPanelOpen: (open) => {
        set({ panelOpen: open })
      },

      togglePanel: () => {
        set((state) => ({ panelOpen: !state.panelOpen }))
      },

      setPanelView: (view) => {
        set({ panelView: view, panelOpen: true })
      },

      toggleTerminal: () => {
        set((state) =>
          state.panelOpen && state.panelView === 'terminal'
            ? { panelOpen: false }
            : { panelOpen: true, panelView: 'terminal' }
        )
      },

      showPanel: (view) => {
        set({ panelOpen: true, panelView: view })
      },

      openCommandPalette: (mode) => {
        set({ commandPaletteOpen: true, commandPaletteMode: mode })
      },

      closeCommandPalette: () => {
        if (get().commandPaletteOpen) {
          set({ commandPaletteOpen: false })
        }
      },

      beginCreateFile: (parentPath) => {
        if (!get().workspace) {
          return
        }

        set({
          fileDialog: {
            mode: 'create-file',
            parentPath,
            targetPath: null,
            initialValue: '',
            value: '',
            error: null,
            isSubmitting: false
          }
        })
      },

      beginCreateFolder: (parentPath) => {
        if (!get().workspace) {
          return
        }

        set({
          fileDialog: {
            mode: 'create-folder',
            parentPath,
            targetPath: null,
            initialValue: '',
            value: '',
            error: null,
            isSubmitting: false
          }
        })
      },

      beginRename: (targetPath) => {
        const node = findTreeNode(get().tree, targetPath)
        const name = node?.name ?? fileNameOf(targetPath)
        set({
          fileDialog: {
            mode: 'rename',
            parentPath: targetPath,
            targetPath,
            initialValue: name,
            value: name,
            error: null,
            isSubmitting: false
          }
        })
      },

      closeFileDialog: () => {
        const dialog = get().fileDialog
        if (dialog && !dialog.isSubmitting) {
          set({ fileDialog: null })
        }
      },

      updateFileDialogValue: (value) => {
        set((state) =>
          state.fileDialog
            ? {
                fileDialog: {
                  ...state.fileDialog,
                  value,
                  error: null
                }
              }
            : state
        )
      },

      submitFileDialog: async () => {
        const dialog = get().fileDialog
        if (!dialog || dialog.isSubmitting) {
          return
        }

        const name = dialog.value.trim()
        if (!name) {
          set({
            fileDialog: {
              ...dialog,
              error: 'Saisissez un nom.'
            }
          })
          return
        }

        set({
          fileDialog: {
            ...dialog,
            value: name,
            isSubmitting: true,
            error: null
          }
        })

        try {
          let resultPath: string

          if (dialog.mode === 'rename') {
            if (!dialog.targetPath) {
              throw new Error('Élément à renommer introuvable.')
            }

            const oldPath = dialog.targetPath
            resultPath = await window.electronAPI.workspace.rename(oldPath, name)
            set((state) => {
              const remap = (candidate: string): string =>
                pathIsInside(oldPath, candidate)
                  ? `${resultPath}${candidate.slice(oldPath.length)}`
                  : candidate
              const openFiles = state.openFiles.map((file) => {
                const mappedPath = remap(file.path)
                return mappedPath === file.path
                  ? file
                  : {
                      ...file,
                      path: mappedPath,
                      name: fileNameOf(mappedPath),
                      language: languageForPath(mappedPath)
                    }
              })

              return {
                openFiles,
                activeFilePath: state.activeFilePath
                  ? remap(state.activeFilePath)
                  : null,
                secondaryFilePath: state.secondaryFilePath
                  ? remap(state.secondaryFilePath)
                  : null,
                pendingReveal: state.pendingReveal
                  ? { ...state.pendingReveal, path: remap(state.pendingReveal.path) }
                  : null
              }
            })
          } else if (dialog.mode === 'create-file') {
            resultPath = await window.electronAPI.workspace.createFile(
              dialog.parentPath,
              name
            )
          } else {
            resultPath = await window.electronAPI.workspace.createDirectory(
              dialog.parentPath,
              name
            )
          }

          set({ fileDialog: null })
          await get().refreshWorkspace()

          if (dialog.mode === 'create-file') {
            await get().openFile(resultPath)
          }

          get().appendOutput(
            'success',
            dialog.mode === 'rename'
              ? `Renommé : ${name}`
              : `${dialog.mode === 'create-folder' ? 'Dossier créé' : 'Fichier créé'} : ${resultPath}`
          )
          void get().refreshGitStatus()
        } catch (error) {
          const message = getErrorMessage(error)
          set((state) =>
            state.fileDialog
              ? {
                  fileDialog: {
                    ...state.fileDialog,
                    isSubmitting: false,
                    error: message
                  }
                }
              : {}
          )
        }
      },

      deleteEntry: async (targetPath) => {
        const state = get()
        const node = findTreeNode(state.tree, targetPath)
        const name = node?.name ?? fileNameOf(targetPath)
        const affectedFiles = state.openFiles.filter((file) =>
          pathIsInside(targetPath, file.path)
        )
        const hasDirtyFiles = affectedFiles.some((file) => file.isDirty)

        try {
          const confirmed = await window.electronAPI.dialog.confirmDelete(
            name,
            hasDirtyFiles
          )
          if (!confirmed) {
            return
          }

          await window.electronAPI.workspace.deleteEntry(targetPath)
        } catch (error) {
          set({ error: getErrorMessage(error) })
          return
        }

        const current = get()
        const remainingFiles = current.openFiles.filter(
          (file) => !pathIsInside(targetPath, file.path)
        )
        const fallbackPath = remainingFiles[0]?.path ?? null
        let activeFilePath = current.activeFilePath
        let secondaryFilePath = current.secondaryFilePath
        let activePane = current.activePane

        if (activeFilePath && pathIsInside(targetPath, activeFilePath)) {
          activeFilePath = fallbackPath
        }

        if (secondaryFilePath && pathIsInside(targetPath, secondaryFilePath)) {
          secondaryFilePath = fallbackPath
        }

        if (remainingFiles.length === 0) {
          activeFilePath = null
          secondaryFilePath = null
          activePane = 'primary'
        } else if (activePane === 'secondary' && !secondaryFilePath) {
          activePane = 'primary'
        }

        set({
          openFiles: remainingFiles,
          activeFilePath,
          secondaryFilePath,
          splitOpen: current.splitOpen && remainingFiles.length > 0,
          activePane,
          pendingReveal:
            current.pendingReveal &&
            pathIsInside(targetPath, current.pendingReveal.path)
              ? null
              : current.pendingReveal
        })

        await get().refreshWorkspace()
        get().appendOutput('warning', `Supprimé : ${name}`)
        void get().refreshGitStatus()
      },

      appendOutput: (level, message) => {
        const trimmed = message.trim()
        if (!trimmed) {
          return
        }

        outputSequence += 1
        const entry: OutputEntry = {
          id: outputSequence,
          timestamp: Date.now(),
          level,
          message: trimmed
        }

        set((state) => ({
          outputEntries: [...state.outputEntries, entry].slice(-MAX_OUTPUT_ENTRIES)
        }))
      },

      clearOutput: () => {
        set({ outputEntries: [] })
      },

      persistSession: () => {
        const state = get()
        if (!state.initialized) {
          return
        }

        if (!state.workspace) {
          try {
            localStorage.removeItem(SESSION_STORAGE_KEY)
          } catch {
            // Session persistence is optional.
          }
          return
        }

        const session: PersistedEditorSession = {
          workspacePath: state.workspace.path,
          openPaths: state.openFiles.map((file) => file.path),
          activeFilePath: state.activeFilePath,
          secondaryFilePath: state.secondaryFilePath,
          splitOpen: state.splitOpen,
          activePane: state.activePane
        }

        try {
          localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
        } catch {
          // A full or unavailable localStorage must not affect the editor.
        }
      },

      setCursor: (cursor) => {
        const current = get().cursor
        if (
          current.line === cursor.line &&
          current.column === cursor.column &&
          current.selectionLength === cursor.selectionLength
        ) {
          return
        }

        set({ cursor })
      },

      refreshGitStatus: async () => {
        const workspace = get().workspace
        if (!workspace) {
          set({ gitStatus: null, gitRepository: null, gitBranches: [] })
          return
        }

        set({ gitLoading: true })
        try {
          const repository = await window.electronAPI.git.status()
          if (get().workspace?.path === workspace.path) {
            set({
              gitRepository: repository,
              gitLoading: false,
              gitStatus: repository.isRepository
                ? {
                    isRepository: true,
                    branch: repository.branch,
                    ahead: repository.ahead,
                    behind: repository.behind,
                    changes: repository.changes
                  }
                : {
                    isRepository: false,
                    branch: null,
                    ahead: 0,
                    behind: 0,
                    changes: 0
                  }
            })
          }
        } catch (error) {
          if (get().workspace?.path === workspace.path) {
            set({
              gitRepository: null,
              gitStatus: null,
              gitLoading: false,
              gitError: getErrorMessage(error)
            })
          }
        }
      },

      setGitMessage: (message) => {
        set({ gitMessage: message.slice(0, 10_000) })
      },

      stageGitPaths: async (paths) => {
        if (paths.length === 0) {
          return
        }
        set({ gitBusy: true, gitError: null })
        try {
          await window.electronAPI.git.stage(paths)
          await get().refreshGitStatus()
          set({ gitBusy: false })
        } catch (error) {
          set({ gitBusy: false, gitError: getErrorMessage(error) })
        }
      },

      unstageGitPaths: async (paths) => {
        if (paths.length === 0) {
          return
        }
        set({ gitBusy: true, gitError: null })
        try {
          await window.electronAPI.git.unstage(paths)
          await get().refreshGitStatus()
          set({ gitBusy: false })
        } catch (error) {
          set({ gitBusy: false, gitError: getErrorMessage(error) })
        }
      },

      stageAllGitChanges: async () => {
        set({ gitBusy: true, gitError: null })
        try {
          await window.electronAPI.git.stageAll()
          await get().refreshGitStatus()
          set({ gitBusy: false })
        } catch (error) {
          set({ gitBusy: false, gitError: getErrorMessage(error) })
        }
      },

      unstageAllGitChanges: async () => {
        set({ gitBusy: true, gitError: null })
        try {
          await window.electronAPI.git.unstageAll()
          await get().refreshGitStatus()
          set({ gitBusy: false })
        } catch (error) {
          set({ gitBusy: false, gitError: getErrorMessage(error) })
        }
      },

      commitGitChanges: async () => {
        const message = get().gitMessage.trim()
        if (!message) {
          set({ gitError: 'Saisissez un message de validation.' })
          return false
        }

        set({ gitBusy: true, gitError: null })
        try {
          const result = await window.electronAPI.git.commit(message)
          set({ gitBusy: false, gitMessage: '' })
          get().appendOutput('success', result.message)
          await get().refreshGitStatus()
          return result.success
        } catch (error) {
          set({ gitBusy: false, gitError: getErrorMessage(error) })
          return false
        }
      },

      loadGitBranches: async () => {
        const workspace = get().workspace
        if (!workspace) {
          set({ gitBranches: [] })
          return
        }
        try {
          const result = await window.electronAPI.git.branches()
          if (get().workspace?.path === workspace.path) {
            set({ gitBranches: result.branches })
          }
        } catch (error) {
          if (get().workspace?.path === workspace.path) {
            set({ gitBranches: [], gitError: getErrorMessage(error) })
          }
        }
      },

      checkoutGitBranch: async (branch) => {
        set({ gitBusy: true, gitError: null })
        try {
          await window.electronAPI.git.checkout(branch)
          await get().refreshGitStatus()
          await get().loadGitBranches()
          set({ gitBusy: false })
          get().appendOutput('success', `Branche active : ${branch}`)
        } catch (error) {
          set({ gitBusy: false, gitError: getErrorMessage(error) })
        }
      },

      openGitDiff: async (filePath, staged) => {
        set({ gitDiffLoading: true, gitError: null })
        try {
          const diff = await window.electronAPI.git.diff(filePath, staged)
          set({ gitDiff: diff, gitDiffLoading: false })
        } catch (error) {
          set({ gitDiffLoading: false, gitError: getErrorMessage(error) })
        }
      },

      closeGitDiff: () => {
        set({ gitDiff: null, gitDiffLoading: false })
      },

      clearReveal: () => {
        if (get().pendingReveal) {
          set({ pendingReveal: null })
        }
      },

      dismissError: () => {
        if (get().error) {
          set({ error: null })
        }
      },

      updateSettings: (settings) => {
        set((state) => ({
          settings: normalizeSettings({
            ...state.settings,
            ...settings
          })
        }))
      },

      resetSettings: () => {
        set({ settings: { ...DEFAULT_SETTINGS } })
      }
    }),
    {
      name: 'cami:editor-preferences',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        settings: state.settings,
        sidebarView: state.sidebarView,
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        panelOpen: state.panelOpen,
        panelView: state.panelView,
        panelHeight: state.panelHeight
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as
          | Partial<
              Pick<
                EditorState,
                | 'settings'
                | 'sidebarView'
                | 'sidebarOpen'
                | 'sidebarWidth'
                | 'panelOpen'
                | 'panelView'
                | 'panelHeight'
              >
            >
          | undefined
        const sidebarWidth = persisted?.sidebarWidth
        const panelHeight = persisted?.panelHeight

        return {
          ...currentState,
          settings: normalizeSettings(persisted?.settings),
          sidebarView: persisted?.sidebarView ?? currentState.sidebarView,
          sidebarOpen: persisted?.sidebarOpen ?? currentState.sidebarOpen,
          sidebarWidth:
            typeof sidebarWidth === 'number' && Number.isFinite(sidebarWidth)
              ? Math.max(180, Math.min(480, Math.round(sidebarWidth)))
              : currentState.sidebarWidth,
          panelOpen: persisted?.panelOpen ?? currentState.panelOpen,
          panelView: persisted?.panelView ?? currentState.panelView,
          panelHeight:
            typeof panelHeight === 'number' && Number.isFinite(panelHeight)
              ? Math.max(160, Math.min(600, Math.round(panelHeight)))
              : currentState.panelHeight
        }
      }
    }
  )
)
