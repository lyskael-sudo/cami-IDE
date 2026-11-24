import {
  AlertTriangle,
  Bug,
  Code2,
  Columns2,
  FilePlus2,
  FileSearch,
  Files,
  FolderOpen,
  FolderPlus,
  GitBranch,
  ListChecks,
  ListTree,
  LoaderCircle,
  PanelBottom,
  Play,
  RefreshCw,
  Save,
  SaveAll,
  ScrollText,
  Search,
  Settings,
  Terminal,
  X,
  type LucideIcon
} from 'lucide-react'
import * as monaco from 'monaco-editor'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { QuickOpenFile } from '../../preload'
import { flattenDocumentSymbols } from '../lsp/fallbackSymbols'
import { documentSymbolsWithFallback } from '../lsp/languageServices'
import { useDebugStore } from '../store/debugStore'
import {
  getErrorMessage,
  useEditorStore,
  type CommandPaletteMode
} from '../store/editorStore'
import { useTaskStore } from '../store/taskStore'
import { LanguageIcon } from './LanguageIcon'

interface CommandItem {
  id: string
  label: string
  detail: string
  shortcut?: string
  icon: LucideIcon
  run: () => void
}

interface SymbolPaletteEntry {
  id: string
  name: string
  detail: string
  path: string
  line: number
  column: number
}

interface WorkspaceSymbolPaletteEntry extends SymbolPaletteEntry {
  containerName: string | null
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
}

function commandMatches(command: CommandItem, query: string): boolean {
  const needle = normalize(query.trim())
  if (!needle) {
    return true
  }

  const haystack = normalize(`${command.label} ${command.detail}`)
  return needle
    .split(/\s+/)
    .every((token) => haystack.includes(token))
}

function fileNameOf(filePath: string): string {
  const segments = filePath.split(/[\\/]/)
  return segments[segments.length - 1] || filePath
}

function scoreFile(file: QuickOpenFile, query: string): number {
  const needle = normalize(query.trim())
  if (!needle) {
    return 1
  }

  const pathValue = normalize(file.relativePath)
  const nameValue = normalize(fileNameOf(file.relativePath))
  const tokens = needle.split(/\s+/).filter(Boolean)

  if (!tokens.every((token) => pathValue.includes(token))) {
    return -1
  }

  const directIndex = pathValue.indexOf(needle)
  let score = directIndex === -1 ? 1 : 200 - directIndex
  if (nameValue.startsWith(needle)) {
    score += 120
  }
  if (nameValue === needle) {
    score += 200
  }
  if (pathValue.startsWith(needle)) {
    score += 80
  }
  return score
}

function parentDirectory(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return index > 0 ? filePath.slice(0, index) : filePath
}

export function CommandPalette(): React.JSX.Element | null {
  const isOpen = useEditorStore((state) => state.commandPaletteOpen)
  const mode = useEditorStore((state) => state.commandPaletteMode)
  const closePalette = useEditorStore((state) => state.closeCommandPalette)
  const openPalette = useEditorStore((state) => state.openCommandPalette)
  const workspace = useEditorStore((state) => state.workspace)
  const splitOpen = useEditorStore((state) => state.splitOpen)
  const panelOpen = useEditorStore((state) => state.panelOpen)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [files, setFiles] = useState<QuickOpenFile[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [filesError, setFilesError] = useState<string | null>(null)
  const [symbolEntries, setSymbolEntries] = useState<SymbolPaletteEntry[]>([])
  const [workspaceSymbolEntries, setWorkspaceSymbolEntries] = useState<
    WorkspaceSymbolPaletteEntry[]
  >([])
  const [symbolsLoading, setSymbolsLoading] = useState(false)
  const [workspaceSymbolsLoading, setWorkspaceSymbolsLoading] = useState(false)
  const [symbolsError, setSymbolsError] = useState<string | null>(null)
  const taskDefinitions = useTaskStore((state) => state.tasks)
  const taskLoading = useTaskStore((state) => state.loading)
  const taskError = useTaskStore((state) => state.error)
  const loadTasks = useTaskStore((state) => state.loadTasks)
  const debugConfigurations = useDebugStore((state) => state.configurations)
  const debugLoading = useDebugStore((state) => state.configurationsLoading)
  const debugError = useDebugStore((state) => state.configurationError)
  const loadDebugConfigurations = useDebugStore((state) => state.loadConfigurations)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const store = useEditorStore
  const commands = useMemo<CommandItem[]>(() => {
    const getState = () => store.getState()
    const activePath = (): string | null => {
      const state = getState()
      return state.splitOpen && state.activePane === 'secondary'
        ? state.secondaryFilePath
        : state.activeFilePath
    }
    const createParentPath = (): string | null => {
      const target = activePath()
      return target ? parentDirectory(target) : getState().workspace?.path ?? null
    }
    const closeThen = (action: () => void) => (): void => {
      closePalette()
      action()
    }

    const items: Array<CommandItem | null> = [
      workspace
        ? {
            id: 'new-file',
            label: 'Nouveau fichier',
            detail: 'Explorateur',
            shortcut: 'Ctrl+N',
            icon: FilePlus2,
            run: closeThen(() => {
              const parent = createParentPath()
              if (parent) {
                getState().beginCreateFile(parent)
              }
            })
          }
        : null,
      workspace
        ? {
            id: 'new-folder',
            label: 'Nouveau dossier',
            detail: 'Explorateur',
            icon: FolderPlus,
            run: closeThen(() => {
              const parent = createParentPath()
              if (parent) {
                getState().beginCreateFolder(parent)
              }
            })
          }
        : null,
      {
        id: 'open-workspace',
        label: 'Ouvrir un dossier…',
        detail: 'Fichier',
        shortcut: 'Ctrl+O',
        icon: FolderOpen,
        run: closeThen(() => {
          void getState().openWorkspace()
        })
      },
      {
        id: 'quick-open',
        label: 'Ouvrir rapidement un fichier…',
        detail: 'Navigation',
        shortcut: 'Ctrl+P',
        icon: FileSearch,
        run: () => {
          openPalette('files')
          setQuery('')
          setSelectedIndex(0)
        }
      },
      {
        id: 'command-palette',
        label: 'Palette de commandes',
        detail: 'Navigation',
        icon: Search,
        run: () => {
          openPalette('commands')
          setQuery('')
          setSelectedIndex(0)
        }
      },
      {
        id: 'save-active',
        label: 'Enregistrer le fichier actif',
        detail: 'Fichier',
        shortcut: 'Ctrl+S',
        icon: Save,
        run: closeThen(() => {
          void getState().saveActiveFile()
        })
      },
      {
        id: 'save-all',
        label: 'Enregistrer tous les fichiers',
        detail: 'Fichier',
        shortcut: 'Ctrl+Alt+S',
        icon: SaveAll,
        run: closeThen(() => {
          void getState().saveAllFiles()
        })
      },
      {
        id: 'close-tab',
        label: 'Fermer l’onglet actif',
        detail: 'Éditeur',
        shortcut: 'Ctrl+W',
        icon: X,
        run: closeThen(() => {
          void getState().closeActiveFile()
        })
      },
      {
        id: 'close-all-tabs',
        label: 'Fermer tous les onglets',
        detail: 'Éditeur',
        icon: X,
        run: closeThen(() => {
          void getState().closeAllFiles()
        })
      },
      {
        id: 'split-editor',
        label: splitOpen ? 'Fermer la division de l’éditeur' : 'Diviser l’éditeur',
        detail: 'Affichage',
        shortcut: 'Ctrl+\\',
        icon: Columns2,
        run: closeThen(() => {
          if (getState().splitOpen) {
            getState().closeSplit()
          } else {
            getState().toggleSplit()
          }
        })
      },
      {
        id: 'toggle-panel',
        label: panelOpen ? 'Masquer le panneau inférieur' : 'Afficher le panneau inférieur',
        detail: 'Affichage',
        shortcut: 'Ctrl+J',
        icon: PanelBottom,
        run: closeThen(() => {
          getState().togglePanel()
        })
      },
      {
        id: 'toggle-sidebar',
        label: 'Afficher / masquer la barre latérale',
        detail: 'Affichage',
        shortcut: 'Ctrl+B',
        icon: PanelBottom,
        run: closeThen(() => {
          getState().toggleSidebar()
        })
      },
      {
        id: 'toggle-terminal',
        label: 'Terminal intégré',
        detail: 'Affichage',
        shortcut: 'Ctrl+`',
        icon: Terminal,
        run: closeThen(() => {
          getState().toggleTerminal()
        })
      },
      {
        id: 'show-problems',
        label: 'Afficher les problèmes',
        detail: 'Affichage',
        shortcut: 'Ctrl+Shift+M',
        icon: AlertTriangle,
        run: closeThen(() => {
          getState().showPanel('problems')
        })
      },
      {
        id: 'show-output',
        label: 'Afficher la sortie',
        detail: 'Affichage',
        shortcut: 'Ctrl+Shift+U',
        icon: ScrollText,
        run: closeThen(() => {
          getState().showPanel('output')
        })
      },
      {
        id: 'focus-search',
        label: 'Rechercher dans le dossier',
        detail: 'Navigation',
        shortcut: 'Ctrl+Shift+F',
        icon: Search,
        run: closeThen(() => {
          getState().focusSearch()
        })
      },
      {
        id: 'show-explorer',
        label: 'Afficher l’explorateur',
        detail: 'Affichage',
        icon: Files,
        run: closeThen(() => {
          getState().setSidebarView('explorer')
        })
      },
      {
        id: 'show-settings',
        label: 'Ouvrir les paramètres',
        detail: 'Affichage',
        icon: Settings,
        run: closeThen(() => {
          getState().setSidebarView('settings')
        })
      },
      {
        id: 'refresh-explorer',
        label: 'Actualiser l’explorateur',
        detail: 'Espace de travail',
        icon: RefreshCw,
        run: closeThen(() => {
          void getState().refreshWorkspace()
        })
      },
      {
        id: 'refresh-git',
        label: 'Actualiser l’état Git',
        detail: 'Git',
        icon: GitBranch,
        run: closeThen(() => {
          void getState().refreshGitStatus()
        })
      },
      {
        id: 'show-git',
        label: 'Afficher le contrôle de source',
        detail: 'Git',
        shortcut: 'Ctrl+Shift+G',
        icon: GitBranch,
        run: closeThen(() => {
          getState().setSidebarView('git')
          void getState().refreshGitStatus()
        })
      },
      {
        id: 'show-debug',
        label: 'Afficher Exécution et débogage',
        detail: 'Débogage',
        shortcut: 'Ctrl+Shift+D',
        icon: Bug,
        run: closeThen(() => {
          getState().setSidebarView('debug')
          void useDebugStore.getState().loadConfigurations()
        })
      },
      {
        id: 'show-tasks',
        label: 'Afficher les tâches',
        detail: 'Tâches',
        icon: ListChecks,
        run: closeThen(() => {
          getState().setSidebarView('tasks')
          void useTaskStore.getState().loadTasks()
        })
      },
      {
        id: 'show-outline',
        label: 'Afficher le plan du fichier',
        detail: 'Affichage',
        icon: ListTree,
        run: closeThen(() => {
          getState().setSidebarView('outline')
        })
      },
      {
        id: 'show-debug-console',
        label: 'Afficher la console de débogage',
        detail: 'Débogage',
        shortcut: 'Ctrl+Shift+Y',
        icon: Bug,
        run: closeThen(() => {
          getState().showPanel('debug')
        })
      },
      {
        id: 'document-symbols',
        label: 'Symboles du fichier…',
        detail: 'Navigation',
        shortcut: 'Ctrl+Shift+O',
        icon: Code2,
        run: () => {
          openPalette('symbols')
          setQuery('')
          setSelectedIndex(0)
        }
      },
      {
        id: 'workspace-symbols',
        label: 'Symboles du dossier…',
        detail: 'Navigation',
        shortcut: 'Ctrl+T',
        icon: Code2,
        run: () => {
          openPalette('workspace-symbols')
          setQuery('')
          setSelectedIndex(0)
        }
      },
      {
        id: 'run-task-palette',
        label: 'Exécuter une tâche…',
        detail: 'Tâches',
        shortcut: 'Ctrl+Shift+B',
        icon: ListChecks,
        run: () => {
          openPalette('tasks')
          setQuery('')
          setSelectedIndex(0)
        }
      },
      {
        id: 'debug-palette',
        label: 'Démarrer le débogage…',
        detail: 'Débogage',
        shortcut: 'F5',
        icon: Play,
        run: () => {
          closePalette()
          void useDebugStore
            .getState()
            .loadConfigurations()
            .then(() => {
              useEditorStore.getState().openCommandPalette('debug')
            })
        }
      },
      {
        id: 'debug-stop',
        label: 'Arrêter le débogage',
        detail: 'Débogage',
        shortcut: 'Shift+F5',
        icon: Bug,
        run: closeThen(() => {
          void useDebugStore.getState().stop()
        })
      },
      {
        id: 'toggle-breakpoint',
        label: 'Activer ou désactiver un point d’arrêt',
        detail: 'Débogage',
        shortcut: 'F9',
        icon: Bug,
        run: closeThen(() => {
          const state = getState()
          const filePath =
            state.splitOpen && state.activePane === 'secondary'
              ? state.secondaryFilePath
              : state.activeFilePath
          if (filePath) {
            useDebugStore
              .getState()
              .toggleBreakpoint(filePath, state.cursor.line, state.cursor.column)
          }
        })
      },
      {
        id: 'format-document',
        label: 'Formater le document',
        detail: 'Éditeur',
        shortcut: 'Shift+Alt+F',
        icon: Code2,
        run: closeThen(() => {
          const editors = monaco.editor.getEditors()
          const focused = editors.find((editor) => editor.hasTextFocus())
          void focused?.getAction('editor.action.formatDocument')?.run()
        })
      }
    ]

    return items.filter((item): item is CommandItem => item !== null)
  }, [closePalette, openPalette, panelOpen, splitOpen, store, workspace])

  const filteredFiles = useMemo(
    () =>
      files
        .map((file) => ({ file, score: scoreFile(file, query) }))
        .filter((entry) => entry.score >= 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 100)
        .map((entry) => entry.file),
    [files, query]
  )
  const modeEntries = useMemo<CommandItem[]>(() => {
    const relativePath = (filePath: string): string => {
      if (!workspace) {
        return filePath
      }
      const prefix = `${workspace.path}/`
      return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
    }

    if (mode === 'symbols') {
      return symbolEntries.map((entry) => ({
        id: `symbol:${entry.path}:${entry.line}:${entry.column}:${entry.name}`,
        label: entry.name,
        detail: `${entry.detail ? `${entry.detail} · ` : ''}${relativePath(entry.path)}:${entry.line}`,
        icon: Code2,
        run: () => {
          closePalette()
          void useEditorStore.getState().openFile(entry.path, entry.line, entry.column)
        }
      }))
    }

    if (mode === 'workspace-symbols') {
      return workspaceSymbolEntries.map((entry) => ({
        id: `workspace-symbol:${entry.path}:${entry.line}:${entry.column}:${entry.name}`,
        label: entry.name,
        detail: `${entry.containerName ? `${entry.containerName} · ` : ''}${relativePath(entry.path)}:${entry.line}`,
        icon: Code2,
        run: () => {
          closePalette()
          void useEditorStore.getState().openFile(entry.path, entry.line, entry.column)
        }
      }))
    }

    if (mode === 'tasks') {
      return taskDefinitions.map((task) => ({
        id: `task:${task.id}`,
        label: task.label,
        detail: task.detail || task.group || task.source,
        icon: Play,
        run: () => {
          closePalette()
          void useTaskStore.getState().runTask(task.id)
        }
      }))
    }

    if (mode === 'debug') {
      return debugConfigurations.map((configuration) => ({
        id: `debug:${configuration.id}`,
        label: configuration.name,
        detail: `${configuration.type === 'node' ? 'Node.js' : 'DAP'}${configuration.program ? ` · ${fileNameOf(configuration.program)}` : ''}`,
        icon: Bug,
        run: () => {
          closePalette()
          void useDebugStore.getState().startConfiguration(configuration.id)
        }
      }))
    }

    return commands
  }, [
    closePalette,
    commands,
    debugConfigurations,
    mode,
    symbolEntries,
    taskDefinitions,
    workspace,
    workspaceSymbolEntries
  ])
  const filteredEntries = useMemo(
    () => modeEntries.filter((entry) => commandMatches(entry, query)).slice(0, 200),
    [modeEntries, query]
  )
  const resultCount = mode === 'files' ? filteredFiles.length : filteredEntries.length

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setQuery('')
    setSelectedIndex(0)
  }, [isOpen, mode])

  useEffect(() => {
    if (!isOpen || mode !== 'files') {
      return
    }

    if (!workspace) {
      setFiles([])
      setFilesError(null)
      setFilesLoading(false)
      return
    }

    let cancelled = false
    setFilesLoading(true)
    setFilesError(null)

    void window.electronAPI.workspace
      .listFiles()
      .then((entries) => {
        if (!cancelled) {
          setFiles(entries)
          setFilesLoading(false)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setFilesError(getErrorMessage(error))
          setFilesLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, mode, workspace])

  useEffect(() => {
    if (!isOpen || mode !== 'symbols') {
      return
    }

    const activePath = useEditorStore.getState().activeFilePath
    if (!activePath) {
      setSymbolEntries([])
      setSymbolsError('Aucun fichier actif.')
      setSymbolsLoading(false)
      return
    }

    let cancelled = false
    setSymbolsLoading(true)
    setSymbolsError(null)
    void documentSymbolsWithFallback(activePath)
      .then((symbols) => {
        if (cancelled) {
          return
        }
        const flattened = flattenDocumentSymbols(symbols)
        setSymbolEntries(
          flattened.slice(0, 5_000).map((symbol, index) => ({
            id: `${symbol.name}:${index}`,
            name: symbol.name,
            detail: symbol.detail ?? '',
            path: activePath,
            line: symbol.selectionRange.start.line + 1,
            column: symbol.selectionRange.start.character + 1
          }))
        )
        setSymbolsLoading(false)
      })
      .catch((error) => {
        if (!cancelled) {
          setSymbolEntries([])
          setSymbolsError(getErrorMessage(error))
          setSymbolsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, mode])

  useEffect(() => {
    if (!isOpen || mode !== 'workspace-symbols') {
      return
    }

    if (!workspace) {
      setWorkspaceSymbolEntries([])
      setSymbolsError('Ouvrez un dossier pour rechercher ses symboles.')
      setWorkspaceSymbolsLoading(false)
      return
    }

    let cancelled = false
    setWorkspaceSymbolsLoading(true)
    setSymbolsError(null)
    const timer = window.setTimeout(
      () => {
        void window.electronAPI.lsp
          .workspaceSymbols(query.trim())
          .then((symbols) => {
            if (!cancelled) {
              setWorkspaceSymbolEntries(
                symbols.slice(0, 5_000).map((symbol, index) => ({
                  id: `${symbol.location.path}:${symbol.location.range.start.line}:${symbol.name}:${index}`,
                  name: symbol.name,
                  detail: '',
                  path: symbol.location.path,
                  line: symbol.location.range.start.line + 1,
                  column: symbol.location.range.start.character + 1,
                  containerName: symbol.containerName
                }))
              )
              setWorkspaceSymbolsLoading(false)
            }
          })
          .catch((error) => {
            if (!cancelled) {
              setWorkspaceSymbolEntries([])
              setSymbolsError(getErrorMessage(error))
              setWorkspaceSymbolsLoading(false)
            }
          })
      },
      query.trim() ? 180 : 0
    )

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [isOpen, mode, query, workspace])

  useEffect(() => {
    if (isOpen && mode === 'tasks') {
      void loadTasks()
    }
  }, [isOpen, loadTasks, mode])

  useEffect(() => {
    if (isOpen && mode === 'debug') {
      void loadDebugConfigurations()
    }
  }, [isOpen, loadDebugConfigurations, mode])

  useEffect(() => {
    setSelectedIndex((current) => {
      if (resultCount === 0) {
        return 0
      }
      return Math.min(current, resultCount - 1)
    })
  }, [resultCount])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [isOpen, mode])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const selected = listRef.current?.querySelector<HTMLElement>('.command-item.is-selected')
    selected?.scrollIntoView({ block: 'nearest' })
  }, [isOpen, selectedIndex, resultCount])

  if (!isOpen) {
    return null
  }

  const runSelected = (): void => {
    if (mode === 'files') {
      const file = filteredFiles[selectedIndex]
      if (!file) {
        return
      }
      closePalette()
      void useEditorStore.getState().openFile(file.path)
      return
    }

    const entry = filteredEntries[selectedIndex]
    if (!entry) {
      return
    }
    entry.run()
  }

  const handleModeChange = (nextMode: CommandPaletteMode): void => {
    setQuery('')
    setSelectedIndex(0)
    openPalette(nextMode)
  }

  const selectedId =
    mode === 'files'
      ? filteredFiles[selectedIndex]
        ? `command-file-${selectedIndex}`
        : undefined
      : filteredEntries[selectedIndex]
        ? `command-${filteredEntries[selectedIndex]?.id}`
        : undefined

  const entriesLoading =
    mode === 'tasks'
      ? taskLoading
      : mode === 'debug'
        ? debugLoading
        : mode === 'symbols'
          ? symbolsLoading
          : mode === 'workspace-symbols'
            ? workspaceSymbolsLoading
            : false
  const entriesError =
    mode === 'tasks'
      ? taskError
      : mode === 'debug'
        ? debugError
        : symbolsError
  const modeTitle =
    mode === 'files'
      ? 'un fichier'
      : mode === 'symbols'
        ? 'un symbole'
        : mode === 'workspace-symbols'
          ? 'un symbole du dossier'
          : mode === 'tasks'
            ? 'une tâche'
            : mode === 'debug'
              ? 'une configuration'
              : 'une commande'
  const placeholder =
    mode === 'files'
      ? 'Rechercher un fichier par son nom ou son chemin…'
      : mode === 'symbols'
        ? 'Rechercher une classe, une fonction ou un symbole…'
        : mode === 'workspace-symbols'
          ? 'Rechercher un symbole dans tout le dossier…'
          : mode === 'tasks'
            ? 'Rechercher une tâche à exécuter…'
            : mode === 'debug'
              ? 'Choisir une configuration de débogage…'
              : 'Taper le nom d’une commande…'
  const emptyMessage =
    mode === 'tasks'
      ? taskDefinitions.length === 0
        ? 'Aucune tâche disponible. Ajoutez un script package.json ou .cami/tasks.json.'
        : `Aucune tâche ne correspond à « ${query} ».`
      : mode === 'debug'
        ? debugConfigurations.length === 0
          ? 'Aucune configuration. Déboguez le fichier actif ou créez .cami/launch.json.'
          : `Aucune configuration ne correspond à « ${query} ».`
        : mode === 'workspace-symbols'
          ? 'Aucun symbole du dossier détecté. Un serveur de langage actif est nécessaire.'
          : mode === 'symbols'
            ? 'Aucun symbole détecté dans ce fichier.'
            : `Aucune commande ne correspond à « ${query} ».`

  return (
    <div
      className="command-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closePalette()
        }
      }}
    >
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Palette">
        <div className="command-mode-tabs">
          <button
            type="button"
            className={mode === 'files' ? 'is-active' : undefined}
            onClick={() => handleModeChange('files')}
          >
            <FileSearch size={13} strokeWidth={1.9} />
            Fichiers
            <kbd>Ctrl+P</kbd>
          </button>
          <button
            type="button"
            className={mode === 'commands' ? 'is-active' : undefined}
            onClick={() => handleModeChange('commands')}
          >
            <Search size={13} strokeWidth={1.9} />
            Commandes
            <kbd>Ctrl+Shift+P</kbd>
          </button>
          <button
            type="button"
            className={
              mode === 'symbols' || mode === 'workspace-symbols'
                ? 'is-active'
                : undefined
            }
            onClick={() => handleModeChange('symbols')}
          >
            <Code2 size={13} strokeWidth={1.9} />
            Symboles
            <kbd>Ctrl+Shift+O</kbd>
          </button>
          {mode === 'tasks' || mode === 'debug' ? (
            <span className="command-mode-chip">
              {mode === 'tasks' ? <ListChecks size={12} strokeWidth={1.9} /> : <Bug size={12} strokeWidth={1.9} />}
              {mode === 'tasks' ? 'Tâches' : 'Débogage'}
            </span>
          ) : null}
          <button
            type="button"
            className="command-close"
            title="Fermer"
            aria-label="Fermer"
            onClick={closePalette}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="command-search">
          <Search size={16} strokeWidth={1.9} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            aria-label={`Rechercher ${modeTitle}`}
            aria-controls="command-results"
            aria-activedescendant={selectedId}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closePalette()
                return
              }

              if (event.key === 'ArrowDown') {
                event.preventDefault()
                if (resultCount > 0) {
                  setSelectedIndex((current) => (current + 1) % resultCount)
                }
                return
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault()
                if (resultCount > 0) {
                  setSelectedIndex((current) => (current - 1 + resultCount) % resultCount)
                }
                return
              }

              if (event.key === 'Enter') {
                event.preventDefault()
                runSelected()
              }
            }}
          />
          {filesLoading && mode === 'files' ? (
            <LoaderCircle size={14} className="spin" aria-label="Chargement des fichiers" />
          ) : entriesLoading ? (
            <LoaderCircle size={14} className="spin" aria-label={`Chargement des résultats`} />
          ) : null}
        </div>

        <div
          id="command-results"
          ref={listRef}
          className="command-results"
          role="listbox"
          aria-label={mode === 'files' ? 'Fichiers' : 'Résultats'}
        >
          {mode === 'files' ? (
            !workspace ? (
              <div className="command-empty">
                <FolderOpen size={18} strokeWidth={1.5} />
                <span>Ouvrez un dossier pour parcourir ses fichiers.</span>
              </div>
            ) : filesError ? (
              <div className="command-empty is-error" role="alert">
                <span>{filesError}</span>
              </div>
            ) : filteredFiles.length === 0 && !filesLoading ? (
              <div className="command-empty">
                <FileSearch size={18} strokeWidth={1.5} />
                <span>Aucun fichier ne correspond à « {query} ».</span>
              </div>
            ) : (
              filteredFiles.map((file, index) => {
                const name = fileNameOf(file.relativePath)
                const lastSeparator = file.relativePath.lastIndexOf('/')
                const detail =
                  lastSeparator > 0 ? file.relativePath.slice(0, lastSeparator) : ''
                return (
                  <button
                    key={file.path}
                    id={`command-file-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === selectedIndex}
                    className={`command-item${index === selectedIndex ? ' is-selected' : ''}`}
                    title={file.path}
                    onMouseEnter={() => {
                      setSelectedIndex(index)
                    }}
                    onClick={() => {
                      closePalette()
                      void useEditorStore.getState().openFile(file.path)
                    }}
                  >
                    <span
                      className="command-file-icon"
                      aria-hidden="true"
                    >
                      <LanguageIcon filePath={file.path} size={15} />
                    </span>
                    <span className="command-item-copy">
                      <span className="command-item-label">{name}</span>
                      <span className="command-item-detail">{detail}</span>
                    </span>
                  </button>
                )
              })
            )
          ) : entriesError && filteredEntries.length === 0 ? (
            <div className="command-empty is-error" role="alert">
              <AlertTriangle size={18} strokeWidth={1.5} />
              <span>{entriesError}</span>
            </div>
          ) : entriesLoading && filteredEntries.length === 0 ? (
            <div className="command-empty">
              <LoaderCircle size={18} className="spin" strokeWidth={1.8} />
              <span>Chargement…</span>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="command-empty">
              <Search size={18} strokeWidth={1.5} />
              <span>{emptyMessage}</span>
            </div>
          ) : (
            filteredEntries.map((entry, index) => {
              const Icon = entry.icon
              return (
                <button
                  key={entry.id}
                  id={`command-${entry.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={`command-item${index === selectedIndex ? ' is-selected' : ''}`}
                  onMouseEnter={() => {
                    setSelectedIndex(index)
                  }}
                  onClick={entry.run}
                >
                  <span className="command-icon" aria-hidden="true">
                    <Icon size={15} strokeWidth={1.8} />
                  </span>
                  <span className="command-item-copy">
                    <span className="command-item-label">{entry.label}</span>
                    <span className="command-item-detail">{entry.detail}</span>
                  </span>
                  {entry.shortcut ? (
                    <kbd className="command-shortcut">{entry.shortcut}</kbd>
                  ) : null}
                </button>
              )
            })
          )}
        </div>

        <div className="command-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> naviguer
          </span>
          <span>
            <kbd>Entrée</kbd> ouvrir
          </span>
          <span>
            <kbd>Échap</kbd> fermer
          </span>
          <span className="command-count">
            {mode === 'files' ? `${filteredFiles.length} fichier(s)` : `${filteredEntries.length} résultat(s)`}
          </span>
        </div>
      </div>
    </div>
  )
}
