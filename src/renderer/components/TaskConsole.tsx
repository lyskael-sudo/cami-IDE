import { CircleStop, ListChecks, LoaderCircle, Trash2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useTaskStore } from '../store/taskStore'

export function TaskConsole(): React.JSX.Element {
  const runs = useTaskStore((state) => state.runs)
  const activeRunId = useTaskStore((state) => state.activeRunId)
  const selectRun = useTaskStore((state) => state.selectRun)
  const stopRun = useTaskStore((state) => state.stopRun)
  const clearRun = useTaskStore((state) => state.clearRun)
  const openFile = useEditorStore((state) => state.openFile)
  const outputRef = useRef<HTMLDivElement>(null)
  const activeRun = runs.find((run) => run.id === activeRunId) ?? runs[0] ?? null

  useEffect(() => {
    const output = outputRef.current
    if (output) {
      output.scrollTop = output.scrollHeight
    }
  }, [activeRun?.output, activeRunId])

  if (!activeRun) {
    return (
      <div className="panel-empty">
        <ListChecks size={20} strokeWidth={1.5} />
        <p>Exécutez une tâche pour afficher sa sortie ici.</p>
      </div>
    )
  }

  return (
    <div className="task-console">
      <div className="task-console-toolbar">
        <select
          className="task-console-select"
          value={activeRun.id}
          aria-label="Choisir une exécution"
          onChange={(event) => {
            selectRun(event.target.value)
          }}
        >
          {runs.map((run) => (
            <option value={run.id} key={run.id}>
              {run.label} — {run.status}
            </option>
          ))}
        </select>
        <span className={`task-console-status is-${activeRun.status}`}>
          {activeRun.status === 'running' ? (
            <LoaderCircle size={12} className="spin" strokeWidth={2} />
          ) : (
            <span className="task-status-dot" aria-hidden="true" />
          )}
          {activeRun.status === 'running'
            ? 'En cours'
            : activeRun.status === 'success'
              ? 'Terminée'
              : activeRun.status === 'failed'
                ? 'Échec'
                : 'Arrêtée'}
        </span>
        {activeRun.problems.length > 0 ? (
          <button
            type="button"
            className="task-problem-badge"
            title="Afficher les problèmes détectés"
            onClick={() => {
              useEditorStore.getState().showPanel('problems')
            }}
          >
            {activeRun.problems.length} problème
            {activeRun.problems.length > 1 ? 's' : ''}
          </button>
        ) : null}
        <span className="task-console-spacer" />
        {activeRun.status === 'running' ? (
          <button
            type="button"
            className="icon-button icon-button-small"
            title="Arrêter la tâche"
            aria-label="Arrêter la tâche"
            onClick={() => {
              void stopRun(activeRun.id)
            }}
          >
            <CircleStop size={13} strokeWidth={2} />
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button icon-button-small"
          title="Retirer cette exécution"
          aria-label="Retirer cette exécution"
          onClick={() => {
            clearRun(activeRun.id)
          }}
        >
          <Trash2 size={13} strokeWidth={1.8} />
        </button>
      </div>
      <div ref={outputRef} className="task-console-output" aria-live="polite">
        {activeRun.output.length === 0 ? (
          <div className="task-console-waiting">
            {activeRun.status === 'running' ? 'En attente de sortie…' : 'Aucune sortie.'}
          </div>
        ) : (
          activeRun.output.map((chunk) => (
            <span className={`task-output-chunk is-${chunk.stream}`} key={chunk.id}>
              {chunk.text}
            </span>
          ))
        )}
      </div>
      {activeRun.problems.length > 0 ? (
        <div className="task-console-problems">
          {activeRun.problems.slice(0, 5).map((problem, index) => (
            <button
              type="button"
              key={`${problem.path}:${problem.line}:${problem.column}:${index}`}
              className={`task-problem is-${problem.severity}`}
              title={problem.message}
              onClick={() => {
                void openFile(problem.path, problem.line, problem.column)
              }}
            >
              <span className="task-problem-location">
                {problem.relativePath}:{problem.line}:{problem.column}
              </span>
              <span className="task-problem-message">{problem.message}</span>
            </button>
          ))}
          {activeRun.problems.length > 5 ? (
            <span className="task-problem-overflow">
              +{activeRun.problems.length - 5} autres problèmes
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
