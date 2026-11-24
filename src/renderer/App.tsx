import { AlertTriangle, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react'
import { useEditorStore } from './store/editorStore'
import { useDebugStore, installDebugEventBridge } from './store/debugStore'
import { useLanguageStore } from './store/languageStore'
import { installTaskEventBridge, useTaskStore } from './store/taskStore'
import { FileDialog } from './components/FileDialog'
import { EditorWelcome } from './components/EditorWelcome'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { TabBar } from './components/TabBar'
import { TitleBar } from './components/TitleBar'

const Editor = lazy(() =>
  import('./components/Editor').then(({ Editor: LazyEditor }) => ({
    default: LazyEditor
  }))
)
const BottomPanel = lazy(() =>
  import('./components/BottomPanel').then(({ BottomPanel: LazyBottomPanel }) => ({
    default: LazyBottomPanel
  }))
)
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then(({ CommandPalette: LazyCommandPalette }) => ({
    default: LazyCommandPalette
  }))
)
const GitDiffView = lazy(() =>
  import('./components/GitDiffView').then(({ GitDiffView: LazyGitDiffView }) => ({
    default: LazyGitDiffView
  }))
)
const WorkspaceLanguageServices = lazy(() =>
  import('./lsp/WorkspaceLanguageServices').then(
    ({ WorkspaceLanguageServices: LazyWorkspaceLanguageServices }) => ({
      default: LazyWorkspaceLanguageServices
    })
  )
)

function parentDirectoryOf(filePath: string): string {
  const separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return separatorIndex > 0 ? filePath.slice(0, separatorIndex) : filePath
}

function beginNewEntry(kind: 'file' | 'folder'): void {
  const store = useEditorStore.getState()
  const activePath =
    store.splitOpen && store.activePane === 'secondary'
      ? store.secondaryFilePath
      : store.activeFilePath
  const parentPath = activePath
    ? parentDirectoryOf(activePath)
    : (store.workspace?.path ?? null)

  if (!parentPath) {
    return
  }

  if (kind === 'file') {
    store.beginCreateFile(parentPath)
  } else {
    store.beginCreateFolder(parentPath)
  }
}

function startOrContinueDebug(): void {
  const debug = useDebugStore.getState()
  if (debug.state === 'paused') {
    void debug.continue()
    return
  }
  if (debug.state === 'starting' || debug.state === 'running') {
    return
  }

  void (async () => {
    await debug.loadConfigurations()
    const state = useDebugStore.getState()
    const configurations = state.configurations
    if (configurations.length === 1 && configurations[0]) {
      await state.startConfiguration(configurations[0].id)
      return
    }
    if (configurations.length === 0) {
      await state.startActiveFile()
      return
    }
    useEditorStore.getState().openCommandPalette('debug')
  })()
}

function toggleDebugBreakpointAtCursor(): void {
  const state = useEditorStore.getState()
  const filePath =
    state.splitOpen && state.activePane === 'secondary'
      ? state.secondaryFilePath
      : state.activeFilePath
  if (!filePath) {
    return
  }
  useDebugStore.getState().toggleBreakpoint(filePath, state.cursor.line, state.cursor.column)
}

export function App(): React.JSX.Element {
  const workspacePath = useEditorStore((state) => state.workspace?.path ?? null)
  const initialized = useEditorStore((state) => state.initialized)
  const openPathsSignature = useEditorStore((state) =>
    state.openFiles.map((file) => file.path).join('\0')
  )
  const panelOpen = useEditorStore((state) => state.panelOpen)
  const sidebarOpen = useEditorStore((state) => state.sidebarOpen)
  const sidebarWidth = useEditorStore((state) => state.sidebarWidth)
  const panelHeight = useEditorStore((state) => state.panelHeight)
  const commandPaletteOpen = useEditorStore((state) => state.commandPaletteOpen)
  const gitDiff = useEditorStore((state) => state.gitDiff)
  const gitDiffLoading = useEditorStore((state) => state.gitDiffLoading)
  const activeFilePath = useEditorStore((state) => state.activeFilePath)
  const secondaryFilePath = useEditorStore((state) => state.secondaryFilePath)
  const splitOpen = useEditorStore((state) => state.splitOpen)
  const activePane = useEditorStore((state) => state.activePane)
  const error = useEditorStore((state) => state.error)
  const dirtyCount = useEditorStore(
    (state) => state.openFiles.reduce((count, file) => count + (file.isDirty ? 1 : 0), 0)
  )
  const [hasOpenedPanel, setHasOpenedPanel] = useState(false)

  useEffect(() => {
    if (panelOpen) {
      setHasOpenedPanel(true)
    }
  }, [panelOpen])

  useEffect(() => {
    const disposeTaskEvents = installTaskEventBridge()
    const disposeDebugEvents = installDebugEventBridge()
    return () => {
      disposeTaskEvents()
      disposeDebugEvents()
    }
  }, [])

  useEffect(() => {
    void useEditorStore.getState().initialize()
  }, [])

  useEffect(() => {
    useLanguageStore.getState().clearWorkspace()
    useTaskStore.getState().reset()
    useDebugStore.getState().reset()
  }, [workspacePath])

  useEffect(() => {
    const unsubscribe = window.electronAPI.menu.onCommand((command) => {
      const store = useEditorStore.getState()

      switch (command) {
        case 'open-workspace':
          void store.openWorkspace()
          break
        case 'save-active':
          void store.saveActiveFile()
          break
        case 'save-all':
          void store.saveAllFiles()
          break
        case 'close-active-tab':
          void store.closeActiveFile()
          break
        case 'close-all-tabs':
          void store.closeAllFiles()
          break
        case 'toggle-terminal':
          store.toggleTerminal()
          break
        case 'toggle-panel':
          store.togglePanel()
          break
        case 'toggle-sidebar':
          store.toggleSidebar()
          break
        case 'focus-search':
          store.focusSearch()
          break
        case 'quick-open':
          store.openCommandPalette('files')
          break
        case 'command-palette':
          store.openCommandPalette('commands')
          break
        case 'new-file':
          beginNewEntry('file')
          break
        case 'new-folder':
          beginNewEntry('folder')
          break
        case 'split-editor':
          store.toggleSplit()
          break
        case 'close-split-editor':
          store.closeSplit()
          break
        case 'show-problems':
          store.showPanel('problems')
          break
        case 'show-output':
          store.showPanel('output')
          break
        case 'show-git':
          store.setSidebarView('git')
          void store.refreshGitStatus()
          break
        case 'show-debug':
          store.setSidebarView('debug')
          void useDebugStore.getState().loadConfigurations()
          break
        case 'show-tasks':
          store.setSidebarView('tasks')
          void useTaskStore.getState().loadTasks()
          break
        case 'show-debug-console':
          store.showPanel('debug')
          break
        case 'show-symbols':
          store.openCommandPalette('symbols')
          break
        case 'workspace-symbols':
          store.openCommandPalette('workspace-symbols')
          break
        case 'run-task':
          store.setSidebarView('tasks')
          void useTaskStore.getState().loadTasks()
          store.openCommandPalette('tasks')
          break
        case 'debug-start-or-continue':
          startOrContinueDebug()
          break
        case 'debug-stop':
          void useDebugStore.getState().stop()
          break
        case 'debug-step-over':
          void useDebugStore.getState().next()
          break
        case 'debug-step-into':
          void useDebugStore.getState().stepIn()
          break
        case 'debug-step-out':
          void useDebugStore.getState().stepOut()
          break
        case 'debug-toggle-breakpoint':
          toggleDebugBreakpointAtCursor()
          break
        default:
          break
      }
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    return window.electronAPI.app.onSaveAllBeforeClose(() => {
      void (async () => {
        const store = useEditorStore.getState()
        const saved = await store.saveAllFiles()
        if (!saved) {
          return
        }

        try {
          await window.electronAPI.app.setDirtyCount(0)
          await window.electronAPI.window.close()
        } catch (cause) {
          console.warn('[Cami] Fermeture impossible après enregistrement :', cause)
        }
      })()
    })
  }, [])

  useEffect(() => {
    return window.electronAPI.workspace.onDidChange(() => {
      void useEditorStore.getState().refreshAfterWorkspaceChange()
    })
  }, [])

  useEffect(() => {
    if (!initialized) {
      return
    }

    const timer = window.setTimeout(() => {
      useEditorStore.getState().persistSession()
    }, 250)

    return () => {
      window.clearTimeout(timer)
    }
  }, [
    activeFilePath,
    activePane,
    initialized,
    openPathsSignature,
    secondaryFilePath,
    splitOpen,
    workspacePath
  ])

  useEffect(() => {
    if (!workspacePath) {
      return
    }

    void useEditorStore.getState().refreshGitStatus()

    const timer = window.setInterval(() => {
      void useEditorStore.getState().refreshGitStatus()
    }, 15_000)

    const handleWindowFocus = (): void => {
      void useEditorStore.getState().refreshGitStatus()
    }

    window.addEventListener('focus', handleWindowFocus)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [workspacePath])

  useEffect(() => {
    void window.electronAPI.app.setDirtyCount(dirtyCount).catch((cause: unknown) => {
      console.warn('[Cami] Impossible de synchroniser les modifications :', cause)
    })
  }, [dirtyCount])

  useEffect(() => {
    if (!error) {
      return
    }

    const timer = window.setTimeout(() => {
      useEditorStore.getState().dismissError()
    }, 8_000)

    return () => {
      window.clearTimeout(timer)
    }
  }, [error])

  return (
    <>
      <div
        className={`app-shell${sidebarOpen ? '' : ' is-sidebar-hidden'}`}
        style={
          {
            '--sidebar-width': `${sidebarWidth}px`,
            '--sidebar-visible-width': `${sidebarOpen ? sidebarWidth : 0}px`,
            '--terminal-height': `${panelHeight}px`
          } as CSSProperties
        }
      >
        <TitleBar />
        <Sidebar />
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label="Redimensionner la barre latérale"
          aria-orientation="vertical"
          aria-valuemin={180}
          aria-valuemax={480}
          aria-valuenow={sidebarWidth}
          tabIndex={sidebarOpen ? 0 : -1}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1 && sidebarOpen) {
              useEditorStore.getState().setSidebarWidth(event.clientX - 48)
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              useEditorStore
                .getState()
                .setSidebarWidth(sidebarWidth + (event.key === 'ArrowRight' ? 16 : -16))
            }
          }}
        />
        <main className="main-area">
          {openPathsSignature || splitOpen ? (
            <Suspense fallback={<div className="editor-area" aria-busy="true" />}>
              <Editor />
            </Suspense>
          ) : (
            <div className="editor-area">
              <section className="editor-pane" aria-label="Groupe d’éditeurs principal">
                <TabBar pane="primary" />
                <div className="editor-shell">
                  <EditorWelcome />
                </div>
              </section>
            </div>
          )}
          {hasOpenedPanel ? (
            <Suspense fallback={null}>
              {panelOpen ? (
                <div
                  className="panel-resizer"
                  role="separator"
                  aria-label="Redimensionner le panneau inférieur"
                  aria-orientation="horizontal"
                  aria-valuemin={160}
                  aria-valuemax={600}
                  aria-valuenow={panelHeight}
                  tabIndex={0}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    if (event.buttons === 1) {
                      useEditorStore
                        .getState()
                        .setPanelHeight(window.innerHeight - event.clientY - 24)
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                      event.preventDefault()
                      useEditorStore
                        .getState()
                        .setPanelHeight(panelHeight + (event.key === 'ArrowUp' ? 16 : -16))
                    }
                  }}
                />
              ) : null}
              <BottomPanel key={workspacePath ?? 'home'} />
            </Suspense>
          ) : null}
        </main>
        <StatusBar />
      </div>

      {commandPaletteOpen ? (
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      ) : null}
      <FileDialog />
      {gitDiff || gitDiffLoading ? (
        <Suspense fallback={null}>
          <GitDiffView />
        </Suspense>
      ) : null}
      {workspacePath && openPathsSignature ? (
        <Suspense fallback={null}>
          <WorkspaceLanguageServices key={workspacePath} />
        </Suspense>
      ) : null}

      {error ? (
        <div className="toast" role="alert">
          <AlertTriangle size={17} strokeWidth={1.9} />
          <p>{error}</p>
          <button
            type="button"
            className="toast-close"
            aria-label="Fermer la notification"
            onClick={() => {
              useEditorStore.getState().dismissError()
            }}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </>
  )
}
