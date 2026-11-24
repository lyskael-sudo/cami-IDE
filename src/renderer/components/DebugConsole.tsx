import { ArrowRight, Bug, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDebugStore } from '../store/debugStore'

export function DebugConsole(): React.JSX.Element {
  const entries = useDebugStore((state) => state.consoleEntries)
  const state = useDebugStore((state) => state.state)
  const sessionName = useDebugStore((state) => state.sessionName)
  const selectedFrameId = useDebugStore((state) => state.selectedFrameId)
  const evaluate = useDebugStore((state) => state.evaluate)
  const clearConsole = useDebugStore((state) => state.clearConsole)
  const [expression, setExpression] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const canEvaluate = state === 'paused' || state === 'running'

  useEffect(() => {
    const list = listRef.current
    if (list) {
      list.scrollTop = list.scrollHeight
    }
  }, [entries, state])

  const submit = (): void => {
    const trimmed = expression.trim()
    if (!trimmed || !canEvaluate) {
      return
    }
    setHistory((current) => [...current.filter((entry) => entry !== trimmed), trimmed].slice(-100))
    setHistoryIndex(null)
    setExpression('')
    void evaluate(trimmed, selectedFrameId)
  }

  return (
    <div className="debug-console">
      <div className="debug-console-toolbar">
        <span className={`debug-console-state is-${state}`}>
          <span className="debug-console-state-dot" aria-hidden="true" />
          {state === 'paused'
            ? 'En pause'
            : state === 'running'
              ? 'En cours'
              : state === 'starting'
                ? 'Démarrage'
                : state === 'error'
                  ? 'Erreur'
                  : 'Inactif'}
        </span>
        {sessionName ? <span className="debug-console-session">{sessionName}</span> : null}
        <span className="debug-console-spacer" />
        <button
          type="button"
          className="icon-button icon-button-small"
          title="Effacer la console de débogage"
          aria-label="Effacer la console de débogage"
          disabled={entries.length === 0}
          onClick={clearConsole}
        >
          <Trash2 size={13} strokeWidth={1.8} />
        </button>
      </div>
      <div ref={listRef} className="debug-console-output" aria-live="polite">
        {entries.length === 0 ? (
          <div className="panel-empty debug-console-empty">
            <Bug size={20} strokeWidth={1.5} />
            <p>
              La console de débogage affiche la sortie du programme et permet d’évaluer des
              expressions pendant une pause.
            </p>
          </div>
        ) : (
          entries.map((entry) => (
            <div
              className={`debug-console-entry is-${entry.category}`}
              key={entry.id}
            >
              <span className="debug-console-time">
                {new Date(entry.timestamp).toLocaleTimeString('fr-FR', {
                  hour12: false
                })}
              </span>
              <span className="debug-console-text">{entry.text}</span>
            </div>
          ))
        )}
      </div>
      <div className={`debug-console-input-row${canEvaluate ? '' : ' is-disabled'}`}>
        <span className="debug-console-prompt" aria-hidden="true">
          ›
        </span>
        <input
          value={expression}
          placeholder={
            canEvaluate
              ? 'Évaluer une expression JavaScript…'
              : 'Lancez le débogage pour évaluer une expression.'
          }
          aria-label="Expression à évaluer dans la console de débogage"
          disabled={!canEvaluate}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setExpression(event.target.value)
            setHistoryIndex(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
              return
            }
            if (event.key === 'ArrowUp' && history.length > 0) {
              event.preventDefault()
              const nextIndex =
                historyIndex === null
                  ? history.length - 1
                  : Math.max(0, historyIndex - 1)
              setHistoryIndex(nextIndex)
              setExpression(history[nextIndex] ?? '')
              return
            }
            if (event.key === 'ArrowDown' && historyIndex !== null) {
              event.preventDefault()
              const nextIndex = historyIndex + 1
              if (nextIndex >= history.length) {
                setHistoryIndex(null)
                setExpression('')
              } else {
                setHistoryIndex(nextIndex)
                setExpression(history[nextIndex] ?? '')
              }
            }
          }}
        />
        <button
          type="button"
          className="debug-console-submit"
          title="Évaluer"
          aria-label="Évaluer l’expression"
          disabled={!canEvaluate || !expression.trim()}
          onClick={submit}
        >
          <ArrowRight size={13} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
