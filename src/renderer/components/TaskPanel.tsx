import {
  AlertTriangle,
  ChevronRight,
  CircleStop,
  FilePlay,
  ListChecks,
  LoaderCircle,
  Play,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { useEffect, useMemo } from 'react'
import type { TaskDefinition, TaskRunStatus } from '../../preload'
import { useEditorStore } from '../store/editorStore'
import { useTaskStore } from '../store/taskStore'

function statusIcon(status: TaskRunStatus): React.JSX.Element {
  if (status === 'running') {
    return <LoaderCircle size={13} className="spin" strokeWidth={2} />
  }
  if (status === 'success') {
    return <span className="task-status-dot is-success" aria-hidden="true" />
  }
  if (status === 'failed') {
    return <span className="task-status-dot is-failed" aria-hidden="true" />
  }
  return <span className="task-status-dot is-stopped" aria-hidden="true" />
}

function sourceLabel(task: TaskDefinition): string {
  if (task.source === 'package') {
    return 'package.json'
  }
  if (task.source === 'auto') {
    return 'Détection automatique'
  }
  return 'Configuration'
}

export function TaskPanel(): React.JSX.Element {
  const workspace = useEditorStore((state) => state.workspace)
  const activeFilePath = useEditorStore((state) => state.activeFilePath)
  const tasks = useTaskStore((state) => state.tasks)
  const runs = useTaskStore((state) => state.runs)
  const activeRunId = useTaskStore((state) => state.activeRunId)
  const loading = useTaskStore((state) => state.loading)
  const error = useTaskStore((state) => state.error)
  const loadTasks = useTaskStore((state) => state.loadTasks)
  const runTask = useTaskStore((state) => state.runTask)
  const runFile = useTaskStore((state) => state.runFile)
  const stopRun = useTaskStore((state) => state.stopRun)
  const selectRun = useTaskStore((state) => state.selectRun)
  const clearRun = useTaskStore((state) => state.clearRun)
  const reset = useTaskStore((state) => state.reset)
  const showPanel = useEditorStore((state) => state.showPanel)

  useEffect(() => {
    if (!workspace) {
      reset()
      return
    }
    void loadTasks()
  }, [loadTasks, reset, workspace])

  const groups = useMemo(() => {
    const result = new Map<string, TaskDefinition[]>()
    for (const task of tasks) {
      const key = task.group || sourceLabel(task)
      const list = result.get(key)
      if (list) {
        list.push(task)
      } else {
        result.set(key, [task])
      }
    }
    return [...result.entries()]
  }, [tasks])

  const runningTaskIds = new Set(
    runs.filter((run) => run.status === 'running').map((run) => run.taskId)
  )

  if (!workspace) {
    return (
      <section className="sidebar-view" aria-label="Tâches">
        <div className="sidebar-header">
          <span>Tâches</span>
        </div>
        <div className="sidebar-empty compact">
          <ListChecks size={26} strokeWidth={1.4} />
          <h2>Aucun dossier ouvert</h2>
          <p>Ouvrez un dossier pour découvrir ses tâches.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="sidebar-view" aria-label="Tâches">
      <div className="sidebar-header">
        <span>Tâches</span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="icon-button"
            title="Actualiser les tâches"
            aria-label="Actualiser les tâches"
            disabled={loading}
            onClick={() => {
              void loadTasks()
            }}
          >
            <RefreshCw
              size={14}
              strokeWidth={1.8}
              className={loading ? 'spin' : undefined}
            />
          </button>
        </div>
      </div>

      <div className="sidebar-scroll task-panel">
        <button
          type="button"
          className="task-run-file"
          disabled={!activeFilePath}
          title={
            activeFilePath
              ? 'Exécuter le fichier actif avec la commande adaptée'
              : 'Aucun fichier actif'
          }
          onClick={() => {
            if (activeFilePath) {
              void runFile(activeFilePath)
            }
          }}
        >
          <FilePlay size={15} strokeWidth={1.8} />
          <span>
            Exécuter le fichier actif
            {activeFilePath ? (
              <small>{activeFilePath.split(/[\\/]/).pop()}</small>
            ) : null}
          </span>
          <Play size={13} strokeWidth={2} />
        </button>

        {error ? (
          <div className="task-error" role="alert">
            <AlertTriangle size={14} strokeWidth={1.9} />
            <span>{error}</span>
          </div>
        ) : null}

        {groups.length === 0 && !loading ? (
          <div className="sidebar-empty compact task-empty">
            <ListChecks size={22} strokeWidth={1.5} />
            <h2>Aucune tâche</h2>
            <p>
              Ajoutez un script dans package.json ou un fichier .cami/tasks.json.
            </p>
          </div>
        ) : (
          groups.map(([group, groupTasks]) => (
            <section className="task-group" key={group}>
              <div className="task-group-title">{group}</div>
              {groupTasks.map((task) => {
                const isRunning = runningTaskIds.has(task.id)
                return (
                  <div className="task-row" key={task.id}>
                    <button
                      type="button"
                      className="task-run-button"
                      title={task.detail || task.label}
                      onClick={() => {
                        void runTask(task.id)
                      }}
                    >
                      <Play size={13} strokeWidth={2} />
                      <span className="task-row-copy">
                        <span className="task-row-label">{task.label}</span>
                        <span className="task-row-detail">
                          {task.detail || sourceLabel(task)}
                        </span>
                      </span>
                    </button>
                    {isRunning ? (
                      <button
                        type="button"
                        className="icon-button icon-button-small"
                        title="Arrêter la tâche"
                        aria-label="Arrêter la tâche"
                        onClick={() => {
                          const run = runs.find(
                            (entry) => entry.taskId === task.id && entry.status === 'running'
                          )
                          if (run) {
                            void stopRun(run.id)
                          }
                        }}
                      >
                        <CircleStop size={13} strokeWidth={2} />
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </section>
          ))
        )}

        {runs.length > 0 ? (
          <section className="task-runs">
            <div className="task-group-title">Exécutions récentes</div>
            {runs.map((run) => (
              <div
                key={run.id}
                className={`task-run-row${
                  run.id === activeRunId ? ' is-active' : ''
                }`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  selectRun(run.id)
                  showPanel('tasks')
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    selectRun(run.id)
                    showPanel('tasks')
                  }
                }}
              >
                <span className="task-run-status">{statusIcon(run.status)}</span>
                <span className="task-run-copy">
                  <span className="task-run-label">{run.label}</span>
                  <span className="task-run-meta">
                    {new Date(run.startedAt).toLocaleTimeString('fr-FR', {
                      hour12: false
                    })}
                    {run.exitCode !== null ? ` · code ${run.exitCode}` : ''}
                  </span>
                </span>
                {run.status === 'running' ? (
                  <button
                    type="button"
                    className="icon-button icon-button-small"
                    title="Arrêter"
                    aria-label="Arrêter l’exécution"
                    onClick={(event) => {
                      event.stopPropagation()
                      void stopRun(run.id)
                    }}
                  >
                    <CircleStop size={13} strokeWidth={2} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="icon-button icon-button-small"
                    title="Retirer de la liste"
                    aria-label="Retirer de la liste"
                    onClick={(event) => {
                      event.stopPropagation()
                      clearRun(run.id)
                    }}
                  >
                    <Trash2 size={13} strokeWidth={1.8} />
                  </button>
                )}
                <ChevronRight size={13} strokeWidth={2} className="task-run-chevron" />
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </section>
  )
}
