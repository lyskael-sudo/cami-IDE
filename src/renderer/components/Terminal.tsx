import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTermTerminal } from '@xterm/xterm'
import { Bot, Plus, RotateCw, Terminal as TerminalIcon, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getErrorMessage, useEditorStore } from '../store/editorStore'

type TerminalStatus = 'starting' | 'running' | 'exited' | 'error'

interface TerminalTab {
  id: string
  ordinal: number
  shell: string
  status: TerminalStatus
  exitMessage: string | null
  initialCommand: string | null
}

const MAX_TERMINALS = 4
const TERMINAL_FONT_FAMILY =
  '"SFMono-Regular", "Cascadia Code", "Liberation Mono", Menlo, Consolas, monospace'

function cleanTerminalMessage(message: string): string {
  return message.replace(/[\r\n]+/g, ' ').trim()
}

function terminalLabel(tab: TerminalTab): string {
  if (tab.shell === 'shell') {
    return `Terminal ${tab.ordinal}`
  }

  return tab.ordinal > 1 ? `${tab.shell} ${tab.ordinal}` : tab.shell
}

function statusLabel(status: TerminalStatus): string {
  switch (status) {
    case 'starting':
      return 'Démarrage…'
    case 'running':
      return 'En cours'
    case 'exited':
      return 'Terminé'
    default:
      return 'Erreur'
  }
}

interface TerminalSessionViewProps {
  session: TerminalTab
  active: boolean
  fontSize: number
  onReady: (id: string, shell: string) => void
  onStatus: (id: string, status: TerminalStatus, message: string | null) => void
  onRestart: (id: string) => void
}

function TerminalSessionView({
  session,
  active,
  fontSize,
  onReady,
  onStatus,
  onRestart
}: TerminalSessionViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTermTerminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const activeRef = useRef(active)

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    let disposed = false
    let layoutFrame = 0
    let commandTimer = 0
    const term = new XTermTerminal({
      allowTransparency: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'outline',
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: useEditorStore.getState().settings.terminalFontSize,
      lineHeight: 1.25,
      letterSpacing: 0.2,
      scrollback: 7_500,
      smoothScrollDuration: 100,
      minimumContrastRatio: 4.5,
      theme: {
        background: '#0d1219',
        foreground: '#d2dae5',
        cursor: '#68b5ff',
        cursorAccent: '#0d1219',
        selectionBackground: '#27435f',
        selectionForeground: '#f0f5fb',
        black: '#1a212b',
        red: '#f37878',
        green: '#8bd49c',
        yellow: '#e9c46a',
        blue: '#7ca9f1',
        magenta: '#c792ea',
        cyan: '#70c7ba',
        white: '#d2dae5',
        brightBlack: '#657184',
        brightRed: '#ff9a9a',
        brightGreen: '#a5e8b3',
        brightYellow: '#f6da8f',
        brightBlue: '#9dc2ff',
        brightMagenta: '#dcb4f5',
        brightCyan: '#93e0d3',
        brightWhite: '#f3f7fc'
      }
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    terminalRef.current = term
    fitAddonRef.current = fitAddon

    const fit = (): void => {
      if (disposed) {
        return
      }

      try {
        fitAddon.fit()
      } catch {
        // xterm can briefly report a zero-size viewport while the panel is hidden.
      }
    }

    layoutFrame = window.requestAnimationFrame(fit)

    const dataSubscription = term.onData((data) => {
      if (disposed) {
        return
      }

      void window.electronAPI.terminal.write(session.id, data).catch(() => {
        // A closing session can race with the last keystroke.
      })
    })

    const resizeSubscription = term.onResize(({ cols, rows }) => {
      void window.electronAPI.terminal.resize(session.id, cols, rows).catch(() => {
        // The PTY may already be closed.
      })
    })

    const unsubscribeData = window.electronAPI.terminal.onData((event) => {
      if (!disposed && event.id === session.id) {
        term.write(event.data)
      }
    })

    const unsubscribeExit = window.electronAPI.terminal.onExit((event) => {
      if (disposed || event.id !== session.id) {
        return
      }

      const message = `Processus terminé avec le code ${event.exitCode}.`
      onStatus(session.id, 'exited', message)
      useEditorStore
        .getState()
        .appendOutput('warning', `${terminalLabel(session)} : ${message}`)
      term.write(
        `\r\n\x1b[38;5;244m[Session terminée — code ${event.exitCode}]\x1b[0m\r\n`
      )
    })

    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(layoutFrame)
      layoutFrame = window.requestAnimationFrame(fit)
    })
    resizeObserver.observe(container)

    void document.fonts.ready.then(fit)

    // Defer PTY creation by one macrotask so React StrictMode's development-only
    // setup/cleanup probe never creates a terminal that is immediately destroyed.
    const creationTimer = window.setTimeout(() => {
      if (disposed) {
        return
      }

      void window.electronAPI.terminal
        .create({
          id: session.id,
          cols: term.cols,
          rows: term.rows
        })
        .then((createdSession) => {
          if (disposed) {
            void window.electronAPI.terminal.dispose(createdSession.id).catch(() => {
              // The session may already have been cleaned up with the window.
            })
            return
          }

          onReady(session.id, createdSession.shell)
          useEditorStore
            .getState()
            .appendOutput(
              'success',
              `${terminalLabel(session)} démarré (${createdSession.shell}).`
            )

          if (session.initialCommand) {
            commandTimer = window.setTimeout(() => {
              if (!disposed) {
                void window.electronAPI.terminal
                  .write(session.id, `${session.initialCommand}\r`)
                  .catch((error: unknown) => {
                    useEditorStore
                      .getState()
                      .appendOutput('error', `Gole : ${cleanTerminalMessage(getErrorMessage(error))}`)
                  })
              }
            }, 250)
          }

          if (activeRef.current) {
            term.focus()
            fit()
          }
        })
        .catch((error: unknown) => {
          if (disposed) {
            return
          }

          const message = cleanTerminalMessage(getErrorMessage(error))
          onStatus(session.id, 'error', message)
          useEditorStore
            .getState()
            .appendOutput('error', `${terminalLabel(session)} : ${message}`)
          term.write(`\x1b[31mTerminal indisponible : ${message}\x1b[0m\r\n`)
        })
    }, 0)

    return () => {
      disposed = true
      window.clearTimeout(creationTimer)
      window.clearTimeout(commandTimer)
      window.cancelAnimationFrame(layoutFrame)
      resizeObserver.disconnect()
      unsubscribeData()
      unsubscribeExit()
      dataSubscription.dispose()
      resizeSubscription.dispose()

      void window.electronAPI.terminal.dispose(session.id).catch(() => {
        // Ignore teardown races.
      })

      term.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      container.replaceChildren()
    }
  }, [onReady, onStatus, session.id])

  useEffect(() => {
    const term = terminalRef.current
    if (!term) {
      return
    }

    term.options.fontSize = fontSize
    window.requestAnimationFrame(() => {
      if (!active) {
        return
      }
      try {
        fitAddonRef.current?.fit()
      } catch {
        // Ignore transient sizing errors.
      }
    })
  }, [active, fontSize])

  useEffect(() => {
    if (!active) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const term = terminalRef.current
      if (!term) {
        return
      }

      try {
        fitAddonRef.current?.fit()
      } catch {
        // Ignore transient sizing errors.
      }
      term.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [active])

  return (
    <div className={`terminal-session${active ? ' is-active' : ''}`}>
      <div ref={containerRef} className="terminal-container" />
      {session.status === 'error' || session.status === 'exited' ? (
        <div className="terminal-session-message" aria-live="polite">
          <span>{session.exitMessage ?? 'Session terminée.'}</span>
          <button
            type="button"
            className="terminal-restart-button"
            onClick={() => {
              onRestart(session.id)
            }}
          >
            Nouvelle session
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function TerminalView({ active }: { active: boolean }): React.JSX.Element {
  const [sessions, setSessions] = useState<TerminalTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [goleError, setGoleError] = useState<string | null>(null)
  const [goleLaunching, setGoleLaunching] = useState(false)
  const startedRef = useRef(false)
  const counterRef = useRef(0)
  const fontSize = useEditorStore((state) => state.settings.terminalFontSize)

  const handleReady = useCallback((id: string, shell: string) => {
    setSessions((current) =>
      current.map((session) =>
        session.id === id
          ? {
              ...session,
              shell: session.shell === 'shell' ? shell : session.shell,
              status: 'running',
              exitMessage: null
            }
          : session
      )
    )
  }, [])

  const handleStatus = useCallback(
    (id: string, status: TerminalStatus, message: string | null) => {
      setSessions((current) =>
        current.map((session) =>
          session.id === id
            ? {
                ...session,
                status,
                exitMessage: message
              }
            : session
        )
      )
    },
    []
  )

  const createSession = (initialCommand: string | null = null): void => {
    if (sessions.length >= MAX_TERMINALS) {
      return
    }

    counterRef.current += 1
    const ordinal = counterRef.current
    const id = crypto.randomUUID()
    setSessions((current) =>
      current.length >= MAX_TERMINALS
        ? current
        : [
            ...current,
            {
              id,
              ordinal,
              shell: initialCommand ? 'Gole' : 'shell',
              status: 'starting',
              exitMessage: null,
              initialCommand
            }
          ]
    )
    setActiveSessionId(id)
  }

  const launchGole = async (): Promise<void> => {
    if (sessions.length >= MAX_TERMINALS || goleLaunching) {
      return
    }
    setGoleLaunching(true)
    setGoleError(null)
    try {
      const command = await window.electronAPI.gole.command()
      createSession(command)
    } catch (error) {
      const message = cleanTerminalMessage(getErrorMessage(error))
      setGoleError(message)
      useEditorStore.getState().appendOutput('error', `Gole : ${message}`)
    } finally {
      setGoleLaunching(false)
    }
  }

  useEffect(() => {
    if (active && !startedRef.current) {
      startedRef.current = true
      createSession()
    }
  }, [active])

  const closeSession = (id: string): void => {
    const index = sessions.findIndex((session) => session.id === id)
    if (index === -1) {
      return
    }

    const remaining = sessions.filter((session) => session.id !== id)
    setSessions(remaining)
    if (activeSessionId === id) {
      setActiveSessionId(remaining[Math.max(0, index - 1)]?.id ?? null)
    }

    void window.electronAPI.terminal.dispose(id).catch(() => {
      // The session may already be gone.
    })
  }

  const restartSession = (id: string): void => {
    const session = sessions.find((candidate) => candidate.id === id)
    if (!session) {
      return
    }

    const nextId = crypto.randomUUID()
    setSessions((current) =>
      current.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              id: nextId,
              status: 'starting',
              exitMessage: null
            }
          : candidate
      )
    )
    setActiveSessionId((current) => (current === id ? nextId : current))
  }

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0] ?? null

  return (
    <div className="terminal-view">
      <div className="terminal-tabs">
        <div className="terminal-tabs-scroll" role="tablist" aria-label="Sessions de terminal">
          {sessions.map((session) => {
            const isActive = activeSession?.id === session.id
            return (
              <div
                key={session.id}
                className={`terminal-tab${isActive ? ' is-active' : ''}`}
                role="presentation"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className="terminal-tab-label"
                  title={terminalLabel(session)}
                  onClick={() => {
                    setActiveSessionId(session.id)
                  }}
                >
                  <span
                    className={`terminal-status-dot status-${session.status}`}
                    aria-hidden="true"
                  />
                  <span>{terminalLabel(session)}</span>
                </button>
                <button
                  type="button"
                  className="terminal-tab-close"
                  title={`Fermer ${terminalLabel(session)}`}
                  aria-label={`Fermer ${terminalLabel(session)}`}
                  onClick={() => {
                    closeSession(session.id)
                  }}
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            )
          })}
        </div>

        <div className="terminal-actions">
          {activeSession ? (
            <span className="terminal-status-label">{statusLabel(activeSession.status)}</span>
          ) : null}
          <button
            type="button"
            className="icon-button"
            title="Lancer Gole dans un terminal du dossier de travail"
            aria-label="Lancer Gole"
            disabled={sessions.length >= MAX_TERMINALS || goleLaunching}
            onClick={() => {
              void launchGole()
            }}
          >
            <Bot size={14} strokeWidth={1.8} />
          </button>
          {activeSession ? (
            <button
              type="button"
              className="icon-button"
              title="Redémarrer le terminal actif"
              aria-label="Redémarrer le terminal actif"
              onClick={() => {
                restartSession(activeSession.id)
              }}
            >
              <RotateCw size={13} strokeWidth={1.8} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            title="Nouveau terminal"
            aria-label="Nouveau terminal"
            disabled={sessions.length >= MAX_TERMINALS}
            onClick={() => createSession()}
          >
            <Plus size={14} strokeWidth={1.9} />
          </button>
        </div>
      </div>

      <div className="terminal-body">
        {goleError ? (
          <div className="terminal-session-message" role="alert">
            <span>{goleError}</span>
            <button
              type="button"
              className="terminal-restart-button"
              onClick={() => setGoleError(null)}
            >
              Fermer
            </button>
          </div>
        ) : null}
        {sessions.length === 0 ? (
          <div className="terminal-empty">
            <TerminalIcon size={22} strokeWidth={1.5} />
            <p>Aucun terminal ouvert.</p>
            <button type="button" className="secondary-button" onClick={() => createSession()}>
              <Plus size={14} strokeWidth={1.9} />
              Nouveau terminal
            </button>
          </div>
        ) : (
          <div className="terminal-sessions">
            {sessions.map((session) => (
              <TerminalSessionView
                key={session.id}
                session={session}
                active={active && activeSession?.id === session.id}
                fontSize={fontSize}
                onReady={handleReady}
                onStatus={handleStatus}
                onRestart={restartSession}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
