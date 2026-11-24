import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bug,
  ChevronDown,
  ChevronRight,
  CircleStop,
  FileCode2,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DebugScope, DebugVariable } from '../../preload'
import { useDebugStore } from '../store/debugStore'
import { useEditorStore } from '../store/editorStore'

function DebugVariableNode({
  variable,
  depth
}: {
  variable: DebugVariable
  depth: number
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [variables, setVariables] = useState<DebugVariable[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setExpanded(false)
    setVariables([])
    setFailed(false)
  }, [variable.variablesReference])

  useEffect(() => {
    if (!expanded || variable.variablesReference <= 0 || variables.length > 0) {
      return
    }
    let cancelled = false
    setLoading(true)
    void window.electronAPI.debug
      .variables(variable.variablesReference)
      .then((entries) => {
        if (!cancelled) {
          setVariables(entries)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [expanded, variable.variablesReference, variables.length])

  const expandable = variable.variablesReference > 0

  return (
    <div className="debug-variable">
      <div
        className="debug-variable-row"
        style={{ paddingLeft: `${depth * 14}px` }}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        onClick={() => {
          if (expandable) {
            setExpanded((current) => !current)
          }
        }}
        onKeyDown={(event) => {
          if (expandable && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            setExpanded((current) => !current)
          }
        }}
      >
        <span className="debug-variable-toggle" aria-hidden="true">
          {expandable ? (
            expanded ? (
              <ChevronDown size={12} strokeWidth={2} />
            ) : (
              <ChevronRight size={12} strokeWidth={2} />
            )
          ) : null}
        </span>
        <span className="debug-variable-name">{variable.name}</span>
        <span className="debug-variable-value" title={variable.value}>
          {variable.value}
        </span>
        {variable.type ? (
          <span className="debug-variable-type">{variable.type}</span>
        ) : null}
      </div>
      {expanded ? (
        <div className="debug-variable-children">
          {loading ? (
            <div className="debug-variable-loading" style={{ paddingLeft: `${(depth + 1) * 14}px` }}>
              <LoaderCircle size={12} className="spin" strokeWidth={2} />
              Chargement…
            </div>
          ) : failed ? (
            <div className="debug-variable-loading" style={{ paddingLeft: `${(depth + 1) * 14}px` }}>
              Impossible de lire cette valeur.
            </div>
          ) : variables.length === 0 ? (
            <div className="debug-variable-loading" style={{ paddingLeft: `${(depth + 1) * 14}px` }}>
              Aucune propriété.
            </div>
          ) : (
            variables.map((child, index) => (
              <DebugVariableNode
                key={`${child.name}:${child.variablesReference}:${index}`}
                variable={child}
                depth={depth + 1}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

function DebugScopeView({ scope }: { scope: DebugScope }): React.JSX.Element {
  const [expanded, setExpanded] = useState(scope.expensive !== true)
  const [variables, setVariables] = useState<DebugVariable[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setVariables([])
    setFailed(false)
  }, [scope.variablesReference])

  useEffect(() => {
    if (!expanded || variables.length > 0) {
      return
    }
    let cancelled = false
    setLoading(true)
    void window.electronAPI.debug
      .variables(scope.variablesReference)
      .then((entries) => {
        if (!cancelled) {
          setVariables(entries)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [expanded, scope.variablesReference, variables.length])

  return (
    <section className="debug-scope">
      <button
        type="button"
        className="debug-scope-title"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded((current) => !current)
        }}
      >
        {expanded ? (
          <ChevronDown size={12} strokeWidth={2} />
        ) : (
          <ChevronRight size={12} strokeWidth={2} />
        )}
        <span>{scope.name}</span>
      </button>
      {expanded ? (
        <div className="debug-scope-variables">
          {loading ? (
            <div className="debug-variable-loading">
              <LoaderCircle size={12} className="spin" strokeWidth={2} />
              Chargement…
            </div>
          ) : failed ? (
            <div className="debug-variable-loading">Impossible de charger les variables.</div>
          ) : variables.length === 0 ? (
            <div className="debug-variable-loading">Aucune variable.</div>
          ) : (
            variables.map((variable, index) => (
              <DebugVariableNode
                key={`${variable.name}:${variable.variablesReference}:${index}`}
                variable={variable}
                depth={0}
              />
            ))
          )}
        </div>
      ) : null}
    </section>
  )
}

export function DebugPanel(): React.JSX.Element {
  const sessionState = useDebugStore((state) => state.state)
  const sessionName = useDebugStore((state) => state.sessionName)
  const message = useDebugStore((state) => state.message)
  const configurations = useDebugStore((state) => state.configurations)
  const configurationSource = useDebugStore((state) => state.configurationSource)
  const configurationError = useDebugStore((state) => state.configurationError)
  const configurationsLoading = useDebugStore((state) => state.configurationsLoading)
  const frames = useDebugStore((state) => state.frames)
  const framesLoading = useDebugStore((state) => state.framesLoading)
  const selectedFrameId = useDebugStore((state) => state.selectedFrameId)
  const scopes = useDebugStore((state) => state.scopes)
  const scopesLoading = useDebugStore((state) => state.scopesLoading)
  const breakpoints = useDebugStore((state) => state.breakpoints)
  const verifiedBreakpoints = useDebugStore((state) => state.verifiedBreakpoints)
  const error = useDebugStore((state) => state.error)
  const loadConfigurations = useDebugStore((state) => state.loadConfigurations)
  const startConfiguration = useDebugStore((state) => state.startConfiguration)
  const startActiveFile = useDebugStore((state) => state.startActiveFile)
  const stop = useDebugStore((state) => state.stop)
  const continueExecution = useDebugStore((state) => state.continue)
  const pause = useDebugStore((state) => state.pause)
  const next = useDebugStore((state) => state.next)
  const stepIn = useDebugStore((state) => state.stepIn)
  const stepOut = useDebugStore((state) => state.stepOut)
  const selectFrame = useDebugStore((state) => state.selectFrame)
  const removeBreakpoint = useDebugStore((state) => state.removeBreakpoint)
  const clearBreakpoints = useDebugStore((state) => state.clearBreakpoints)
  const workspace = useEditorStore((state) => state.workspace)
  const activeFilePath = useEditorStore((state) => state.activeFilePath)
  const openFile = useEditorStore((state) => state.openFile)
  const showPanel = useEditorStore((state) => state.showPanel)
  const [configurationsOpen, setConfigurationsOpen] = useState(true)

  useEffect(() => {
    if (workspace) {
      void loadConfigurations()
    }
  }, [activeFilePath, loadConfigurations, workspace])

  const breakpointFiles = useMemo(
    () =>
      Object.entries(breakpoints)
        .map(([path, entries]) => ({
          path,
          name: path.split(/[\\/]/).pop() ?? path,
          entries: [...entries].sort((left, right) => left.line - right.line)
        }))
        .filter((file) => file.entries.length > 0),
    [breakpoints]
  )
  const totalBreakpoints = breakpointFiles.reduce(
    (count, file) => count + file.entries.length,
    0
  )
  const isActive = ['starting', 'running', 'paused'].includes(sessionState)
  const canResume = sessionState === 'paused'
  const canPause = sessionState === 'running'
  const canStop = isActive

  if (!workspace) {
    return (
      <section className="sidebar-view" aria-label="Exécution et débogage">
        <div className="sidebar-header">
          <span>Exécution et débogage</span>
        </div>
        <div className="sidebar-empty compact">
          <Bug size={26} strokeWidth={1.4} />
          <h2>Aucun dossier ouvert</h2>
          <p>Ouvrez un dossier pour configurer et lancer le débogage.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="sidebar-view" aria-label="Exécution et débogage">
      <div className="sidebar-header">
        <span>Exécution et débogage</span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="icon-button"
            title="Actualiser les configurations"
            aria-label="Actualiser les configurations"
            disabled={configurationsLoading}
            onClick={() => {
              void loadConfigurations()
            }}
          >
            <RefreshCw
              size={14}
              strokeWidth={1.8}
              className={configurationsLoading ? 'spin' : undefined}
            />
          </button>
        </div>
      </div>

      <div className="debug-toolbar" role="toolbar" aria-label="Contrôles de débogage">
        <button
          type="button"
          className="debug-control is-primary"
          title={
            canResume
              ? 'Continuer'
              : isActive
                ? 'Le débogage est déjà actif'
                : 'Démarrer le débogage'
          }
          aria-label="Démarrer ou continuer"
          disabled={sessionState === 'starting' || sessionState === 'running'}
          onClick={() => {
            if (canResume) {
              void continueExecution()
              return
            }
            if (configurations.length === 1 && configurations[0]) {
              void startConfiguration(configurations[0].id)
              return
            }
            setConfigurationsOpen(true)
          }}
        >
          <Play size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="debug-control"
          title="Mettre en pause"
          aria-label="Mettre en pause"
          disabled={!canPause}
          onClick={() => {
            void pause()
          }}
        >
          <Pause size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="debug-control"
          title="Arrêter"
          aria-label="Arrêter le débogage"
          disabled={!canStop}
          onClick={() => {
            void stop()
          }}
        >
          <CircleStop size={14} strokeWidth={2} />
        </button>
        <span className="debug-toolbar-separator" />
        <button
          type="button"
          className="debug-control"
          title="Pas à pas par-dessus (F10)"
          aria-label="Pas à pas par-dessus"
          disabled={!canResume}
          onClick={() => {
            void next()
          }}
        >
          <ArrowRight size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="debug-control"
          title="Pas à pas dans (F11)"
          aria-label="Pas à pas dans"
          disabled={!canResume}
          onClick={() => {
            void stepIn()
          }}
        >
          <ArrowDown size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="debug-control"
          title="Sortir de la fonction (Maj+F11)"
          aria-label="Sortir de la fonction"
          disabled={!canResume}
          onClick={() => {
            void stepOut()
          }}
        >
          <ArrowUp size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className="debug-control debug-console-button"
          title="Console de débogage"
          aria-label="Ouvrir la console de débogage"
          onClick={() => {
            showPanel('debug')
          }}
        >
          <Bug size={13} strokeWidth={1.9} />
        </button>
      </div>

      {isActive || sessionState === 'stopped' || sessionState === 'error' ? (
        <div className={`debug-session-banner is-${sessionState}`}>
          <span className="debug-session-dot" aria-hidden="true" />
          <span className="debug-session-copy">
            <strong>{sessionName ?? 'Session de débogage'}</strong>
            <span>{message ?? (sessionState === 'paused' ? 'En pause' : sessionState)}</span>
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="debug-error" role="alert">
          <AlertTriangle size={14} strokeWidth={1.9} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="sidebar-scroll debug-panel">
        <section className="debug-section">
          <button
            type="button"
            className="debug-section-header"
            aria-expanded={configurationsOpen}
            onClick={() => {
              setConfigurationsOpen((current) => !current)
            }}
          >
            {configurationsOpen ? (
              <ChevronDown size={13} strokeWidth={2} />
            ) : (
              <ChevronRight size={13} strokeWidth={2} />
            )}
            <span>Configurations</span>
            <span className="debug-section-count">{configurations.length}</span>
          </button>
          {configurationsOpen ? (
            <div className="debug-section-body">
              {configurationError ? (
                <div className="debug-config-warning">{configurationError}</div>
              ) : null}
              {configurations.length === 0 ? (
                <div className="debug-config-empty">
                  {configurationSource === 'none'
                    ? 'Aucun fichier launch.json. Démarrez le fichier actif ou créez .cami/launch.json.'
                    : 'Aucune configuration exploitable dans launch.json.'}
                </div>
              ) : (
                configurations.map((configuration) => (
                  <button
                    key={configuration.id}
                    type="button"
                    className="debug-config-item"
                    title={configuration.program ?? configuration.name}
                    onClick={() => {
                      void startConfiguration(configuration.id)
                    }}
                  >
                    <span className="debug-config-icon">
                      <Bug size={13} strokeWidth={1.9} />
                    </span>
                    <span className="debug-config-copy">
                      <span className="debug-config-name">{configuration.name}</span>
                      <span className="debug-config-detail">
                        {configuration.type === 'node' ? 'Node.js' : 'DAP'}
                        {configuration.program
                          ? ` · ${configuration.program.split(/[\\/]/).pop()}`
                          : ''}
                      </span>
                    </span>
                    <Play size={12} strokeWidth={2} />
                  </button>
                ))
              )}
              <button
                type="button"
                className="debug-active-file-button"
                disabled={!activeFilePath || isActive}
                title={
                  activeFilePath
                    ? 'Déboguer le fichier JavaScript actif'
                    : 'Aucun fichier actif'
                }
                onClick={() => {
                  void startActiveFile()
                }}
              >
                <FileCode2 size={13} strokeWidth={1.9} />
                Déboguer le fichier actif
              </button>
            </div>
          ) : null}
        </section>

        {(frames.length > 0 || sessionState === 'paused') && (
          <section className="debug-section">
            <div className="debug-section-header static">
              <span className="debug-section-heading">Pile d’appels</span>
              {framesLoading ? (
                <LoaderCircle size={12} className="spin" strokeWidth={2} />
              ) : null}
            </div>
            <div className="debug-section-body">
              {frames.length === 0 && !framesLoading ? (
                <div className="debug-config-empty">Aucune frame disponible.</div>
              ) : (
                frames.map((frame) => (
                  <button
                    key={`${frame.id}:${frame.name}`}
                    type="button"
                    className={`debug-frame${
                      frame.id === selectedFrameId ? ' is-active' : ''
                    }`}
                    title={
                      frame.path
                        ? `${frame.path}:${frame.line}:${frame.column}`
                        : frame.name
                    }
                    onClick={() => {
                      void selectFrame(frame.id)
                    }}
                  >
                    <span className="debug-frame-name">{frame.name}</span>
                    <span className="debug-frame-location">
                      {frame.relativePath
                        ? `${frame.relativePath}:${frame.line}`
                        : `ligne ${frame.line}`}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        )}

        {sessionState === 'paused' ? (
          <section className="debug-section">
            <div className="debug-section-header static">
              <span className="debug-section-heading">Variables</span>
              {scopesLoading ? (
                <LoaderCircle size={12} className="spin" strokeWidth={2} />
              ) : null}
            </div>
            <div className="debug-section-body debug-scopes">
              {scopes.length === 0 && !scopesLoading ? (
                <div className="debug-config-empty">Aucune variable accessible.</div>
              ) : (
                scopes.map((scope) => (
                  <DebugScopeView
                    key={`${selectedFrameId}:${scope.name}:${scope.variablesReference}`}
                    scope={scope}
                  />
                ))
              )}
            </div>
          </section>
        ) : null}

        <section className="debug-section">
          <div className="debug-section-header static">
            <span className="debug-section-heading">Points d’arrêt</span>
            <span className="debug-section-count">{totalBreakpoints}</span>
            {totalBreakpoints > 0 ? (
              <button
                type="button"
                className="icon-button icon-button-small debug-clear-breakpoints"
                title="Supprimer tous les points d’arrêt"
                aria-label="Supprimer tous les points d’arrêt"
                onClick={() => {
                  clearBreakpoints()
                }}
              >
                <Trash2 size={12} strokeWidth={1.9} />
              </button>
            ) : null}
          </div>
          <div className="debug-section-body">
            {breakpointFiles.length === 0 ? (
              <div className="debug-config-empty">
                Cliquez dans la marge de l’éditeur ou appuyez sur F9 pour ajouter un point
                d’arrêt.
              </div>
            ) : (
              breakpointFiles.map((file) => (
                <div className="debug-breakpoint-file" key={file.path}>
                  <div className="debug-breakpoint-file-header">
                    <button
                      type="button"
                      className="debug-breakpoint-file-name"
                      title={file.path}
                      onClick={() => {
                        void openFile(file.path)
                      }}
                    >
                      {file.name}
                    </button>
                    <button
                      type="button"
                      className="icon-button icon-button-small"
                      title="Supprimer les points d’arrêt du fichier"
                      aria-label="Supprimer les points d’arrêt du fichier"
                      onClick={() => {
                        clearBreakpoints(file.path)
                      }}
                    >
                      <Trash2 size={12} strokeWidth={1.9} />
                    </button>
                  </div>
                  {file.entries.map((breakpoint) => {
                    const verified =
                      verifiedBreakpoints[file.path]?.[
                        `${breakpoint.line}:${breakpoint.column ?? 1}`
                      ] !== false
                    return (
                      <div className="debug-breakpoint-row" key={`${breakpoint.line}:${breakpoint.column}`}>
                        <button
                          type="button"
                          className="debug-breakpoint-location"
                          onClick={() => {
                            void openFile(file.path, breakpoint.line, breakpoint.column ?? 1)
                          }}
                        >
                          <span
                            className={`debug-breakpoint-dot${
                              verified ? ' is-verified' : ''
                            }`}
                            aria-hidden="true"
                          />
                          Ligne {breakpoint.line}
                        </button>
                        <button
                          type="button"
                          className="icon-button icon-button-small"
                          title="Supprimer le point d’arrêt"
                          aria-label="Supprimer le point d’arrêt"
                          onClick={() => {
                            removeBreakpoint(file.path, breakpoint.line)
                          }}
                        >
                          <Trash2 size={12} strokeWidth={1.9} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  )
}
