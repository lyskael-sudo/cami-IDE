import {
  AlertCircle,
  AlertTriangle,
  Bug,
  CheckCircle2,
  Info,
  ListChecks,
  ScrollText,
  Terminal as TerminalIcon,
  Trash2,
  X
} from 'lucide-react'
import * as monaco from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { useTaskStore } from '../store/taskStore'
import { DebugConsole } from './DebugConsole'
import { TaskConsole } from './TaskConsole'
import { TerminalView } from './Terminal'

type ProblemSeverity = 'error' | 'warning' | 'info'

interface ProblemItem {
  key: string
  path: string
  name: string
  relativePath: string
  line: number
  column: number
  message: string
  severity: ProblemSeverity
  origin: 'language' | 'task'
}

function fileNameOf(filePath: string): string {
  const segments = filePath.split(/[\\/]/)
  return segments[segments.length - 1] || filePath
}

function relativeToWorkspace(filePath: string, workspacePath: string): string {
  if (filePath.startsWith(workspacePath)) {
    return filePath
      .slice(workspacePath.length)
      .replace(/^[/\\]+/, '')
      .split('\\')
      .join('/')
  }

  return filePath
}

function severityFromMarker(severity: monaco.MarkerSeverity): ProblemSeverity {
  if (severity === monaco.MarkerSeverity.Error) {
    return 'error'
  }
  if (severity === monaco.MarkerSeverity.Warning) {
    return 'warning'
  }
  return 'info'
}

function problemsFromMarkers(
  markers: monaco.editor.IMarker[],
  workspacePath: string | null
): ProblemItem[] {
  const problems: ProblemItem[] = []

  for (const marker of markers) {
    if (problems.length >= 1_000) {
      break
    }

    const filePath = marker.resource.fsPath
    problems.push({
      key: `${filePath}:${marker.startLineNumber}:${marker.startColumn}:${marker.message}`,
      path: filePath,
      name: fileNameOf(filePath),
      relativePath: workspacePath
        ? relativeToWorkspace(filePath, workspacePath)
        : fileNameOf(filePath),
      line: marker.startLineNumber,
      column: marker.startColumn,
      message: marker.message,
      severity: severityFromMarker(marker.severity),
      origin: 'language'
    })
  }

  problems.sort((left, right) => {
    const pathOrder = left.relativePath.localeCompare(right.relativePath, undefined, {
      numeric: true,
      sensitivity: 'base'
    })
    if (pathOrder !== 0) {
      return pathOrder
    }
    return left.line - right.line || left.column - right.column
  })

  return problems
}

export function BottomPanel(): React.JSX.Element {
  const panelOpen = useEditorStore((state) => state.panelOpen)
  const panelView = useEditorStore((state) => state.panelView)
  const setPanelOpen = useEditorStore((state) => state.setPanelOpen)
  const setPanelView = useEditorStore((state) => state.setPanelView)
  const workspace = useEditorStore((state) => state.workspace)
  const openPathSignature = useEditorStore((state) =>
    state.openFiles
      .map((file) => file.path)
      .sort()
      .join('\0')
  )
  const outputEntries = useEditorStore((state) => state.outputEntries)
  const clearOutput = useEditorStore((state) => state.clearOutput)
  const openFile = useEditorStore((state) => state.openFile)
  const taskRuns = useTaskStore((state) => state.runs)
  const [markerProblems, setMarkerProblems] = useState<ProblemItem[]>([])
  const [problemRefreshNonce, setProblemRefreshNonce] = useState(0)
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let refreshTimer = 0

    const refresh = (): void => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        const openPaths = new Set(
          useEditorStore.getState().openFiles.map((file) => file.path)
        )
        const markers = monaco.editor.getModelMarkers({}).filter((marker) =>
          openPaths.has(marker.resource.fsPath)
        )
        setMarkerProblems(
          problemsFromMarkers(
            markers,
            useEditorStore.getState().workspace?.path ?? null
          )
        )
      }, 120)
    }

    const subscription = monaco.editor.onDidChangeMarkers(refresh)
    refresh()

    return () => {
      window.clearTimeout(refreshTimer)
      subscription.dispose()
    }
  }, [openPathSignature, problemRefreshNonce, workspace?.path])

  useEffect(() => {
    if (panelOpen && panelView === 'output') {
      outputRef.current?.scrollTo({
        top: outputRef.current.scrollHeight,
        behavior: 'smooth'
      })
    }
  }, [outputEntries, panelOpen, panelView])

  const problems = [
    ...markerProblems,
    ...taskRuns.flatMap((run) =>
      run.problems.map((problem) => ({
        key: `task:${run.id}:${problem.path}:${problem.line}:${problem.column}:${problem.message}`,
        path: problem.path,
        name: problem.path.split(/[\\/]/).pop() ?? problem.relativePath,
        relativePath: problem.relativePath,
        line: problem.line,
        column: problem.column,
        message: problem.message,
        severity: problem.severity,
        origin: 'task' as const
      }))
    )
  ].sort((left, right) => {
    const pathOrder = left.relativePath.localeCompare(right.relativePath, undefined, {
      numeric: true,
      sensitivity: 'base'
    })
    return pathOrder !== 0 ? pathOrder : left.line - right.line || left.column - right.column
  })

  const errorCount = problems.filter((problem) => problem.severity === 'error').length
  const warningCount = problems.filter((problem) => problem.severity === 'warning').length

  const problemsByFile = new Map<string, ProblemItem[]>()
  for (const problem of problems) {
    const existing = problemsByFile.get(problem.path)
    if (existing) {
      existing.push(problem)
    } else {
      problemsByFile.set(problem.path, [problem])
    }
  }

  return (
    <section
      className={`bottom-panel${panelOpen ? '' : ' is-hidden'}`}
      aria-label="Panneau inférieur"
    >
      <header className="panel-header">
        <div className="panel-tabs" role="tablist" aria-label="Vues du panneau">
          <button
            type="button"
            role="tab"
            aria-selected={panelView === 'terminal'}
            className={`panel-tab${panelView === 'terminal' ? ' is-active' : ''}`}
            onClick={() => {
              setPanelView('terminal')
            }}
          >
            <TerminalIcon size={13} strokeWidth={1.9} />
            Terminal
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={panelView === 'problems'}
            className={`panel-tab${panelView === 'problems' ? ' is-active' : ''}`}
            onClick={() => {
              setPanelView('problems')
            }}
          >
            <AlertTriangle size={13} strokeWidth={1.9} />
            Problèmes
            {problems.length > 0 ? (
              <span className="panel-badge">
                {problems.length}
                {errorCount > 0 || warningCount > 0 ? (
                  <span className="panel-badge-details">
                    {errorCount > 0 ? `${errorCount} erreur${errorCount > 1 ? 's' : ''}` : ''}
                    {errorCount > 0 && warningCount > 0 ? ' · ' : ''}
                    {warningCount > 0
                      ? `${warningCount} avertissement${warningCount > 1 ? 's' : ''}`
                      : ''}
                  </span>
                ) : null}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={panelView === 'output'}
            className={`panel-tab${panelView === 'output' ? ' is-active' : ''}`}
            onClick={() => {
              setPanelView('output')
            }}
          >
            <ScrollText size={13} strokeWidth={1.9} />
            Sortie
            {outputEntries.length > 0 ? (
              <span className="panel-count">{outputEntries.length}</span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={panelView === 'tasks'}
            className={`panel-tab${panelView === 'tasks' ? ' is-active' : ''}`}
            onClick={() => {
              setPanelView('tasks')
            }}
          >
            <ListChecks size={13} strokeWidth={1.9} />
            Tâches
            {taskRuns.some((run) => run.status === 'running') ? (
              <span className="panel-badge is-running" aria-label="Tâche en cours" />
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={panelView === 'debug'}
            className={`panel-tab${panelView === 'debug' ? ' is-active' : ''}`}
            onClick={() => {
              setPanelView('debug')
            }}
          >
            <Bug size={13} strokeWidth={1.9} />
            Console de débogage
          </button>
        </div>

        <div className="panel-actions">
          {panelView === 'problems' ? (
            <button
              type="button"
              className="icon-button"
              title="Actualiser les problèmes"
              aria-label="Actualiser les problèmes"
              onClick={() => {
                setProblemRefreshNonce((current) => current + 1)
              }}
            >
              <CheckCircle2 size={14} strokeWidth={1.8} />
            </button>
          ) : null}
          {panelView === 'output' ? (
            <button
              type="button"
              className="icon-button"
              title="Effacer la sortie"
              aria-label="Effacer la sortie"
              disabled={outputEntries.length === 0}
              onClick={clearOutput}
            >
              <Trash2 size={14} strokeWidth={1.8} />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            title="Fermer le panneau"
            aria-label="Fermer le panneau"
            onClick={() => {
              setPanelOpen(false)
            }}
          >
            <X size={14} strokeWidth={1.9} />
          </button>
        </div>
      </header>

      <div className="panel-body">
        <div
          className="panel-view panel-terminal"
          role="tabpanel"
          aria-label="Terminal"
          hidden={panelView !== 'terminal'}
        >
          <TerminalView active={panelOpen && panelView === 'terminal'} />
        </div>

        <div
          className="panel-view panel-problems"
          role="tabpanel"
          aria-label="Problèmes"
          hidden={panelView !== 'problems'}
        >
          {problems.length === 0 ? (
            <div className="panel-empty">
              <CheckCircle2 size={20} strokeWidth={1.5} />
              <p>Aucun problème détecté dans les fichiers ouverts.</p>
            </div>
          ) : (
            <div className="problems-list">
              {[...problemsByFile.entries()].map(([filePath, fileProblems]) => (
                <section className="problem-group" key={filePath}>
                  <div className="problem-file-header">
                    <span className="problem-file-name">
                      {fileProblems[0]?.relativePath ?? fileNameOf(filePath)}
                    </span>
                    <span className="problem-file-count">{fileProblems.length}</span>
                  </div>
                  {fileProblems.map((problem) => {
                    const Icon =
                      problem.severity === 'error'
                        ? AlertCircle
                        : problem.severity === 'warning'
                          ? AlertTriangle
                          : Info
                    return (
                      <button
                        key={problem.key}
                        type="button"
                        className={`problem-item is-${problem.severity}`}
                        title={problem.message}
                        onClick={() => {
                          void openFile(problem.path, problem.line, problem.column)
                        }}
                      >
                        <Icon size={14} strokeWidth={1.9} className="problem-icon" />
                        <span className="problem-message">{problem.message}</span>
                        {problem.origin === 'task' ? (
                          <span className="problem-origin">tâche</span>
                        ) : null}
                        <span className="problem-location">
                          Ln {problem.line}, Col {problem.column}
                        </span>
                      </button>
                    )
                  })}
                </section>
              ))}
            </div>
          )}
        </div>

        <div
          className="panel-view panel-tasks"
          role="tabpanel"
          aria-label="Tâches"
          hidden={panelView !== 'tasks'}
        >
          <TaskConsole />
        </div>

        <div
          className="panel-view panel-debug-console"
          role="tabpanel"
          aria-label="Console de débogage"
          hidden={panelView !== 'debug'}
        >
          <DebugConsole />
        </div>

        <div
          className="panel-view panel-output"
          role="tabpanel"
          aria-label="Sortie"
          hidden={panelView !== 'output'}
        >
          {outputEntries.length === 0 ? (
            <div className="panel-empty">
              <ScrollText size={20} strokeWidth={1.5} />
              <p>La sortie des actions de Cami apparaîtra ici.</p>
            </div>
          ) : (
            <div ref={outputRef} className="output-list" aria-live="polite">
              {outputEntries.map((entry) => (
                <div className={`output-entry is-${entry.level}`} key={entry.id}>
                  <span className="output-time">
                    {new Date(entry.timestamp).toLocaleTimeString('fr-FR', {
                      hour12: false
                    })}
                  </span>
                  <span className="output-message">{entry.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
