import {
  AlertTriangle,
  Bug,
  CircleStop,
  GitBranch,
  LoaderCircle,
  Terminal as TerminalIcon
} from 'lucide-react'
import { useDebugStore } from '../store/debugStore'
import { useEditorStore } from '../store/editorStore'
import { LanguageIcon } from './LanguageIcon'
import { useLanguageStore } from '../store/languageStore'
import { useTaskStore } from '../store/taskStore'

const LANGUAGE_LABELS: Record<string, string> = {
  bat: 'Batch',
  c: 'C',
  clojure: 'Clojure',
  cmake: 'CMake',
  coffeescript: 'CoffeeScript',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  dart: 'Dart',
  dockerfile: 'Dockerfile',
  elixir: 'Elixir',
  fsharp: 'F#',
  go: 'Go',
  graphql: 'GraphQL',
  html: 'HTML',
  ini: 'INI',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  kotlin: 'Kotlin',
  less: 'Less',
  lua: 'Lua',
  makefile: 'Makefile',
  markdown: 'Markdown',
  mdx: 'MDX',
  php: 'PHP',
  plaintext: 'Texte brut',
  powershell: 'PowerShell',
  protobuf: 'Protocol Buffers',
  python: 'Python',
  r: 'R',
  ruby: 'Ruby',
  rust: 'Rust',
  scala: 'Scala',
  scss: 'SCSS',
  shell: 'Shell',
  sol: 'Solidity',
  sql: 'SQL',
  swift: 'Swift',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML'
}

function languageLabel(languageId: string | undefined): string {
  if (!languageId) {
    return 'Aucun fichier'
  }

  return (
    LANGUAGE_LABELS[languageId] ??
    `${languageId.charAt(0).toLocaleUpperCase()}${languageId.slice(1)}`
  )
}

export function StatusBar(): React.JSX.Element {
  const activeFile = useEditorStore(
    (state) =>
      state.openFiles.find(
        (file) =>
          file.path ===
          (state.splitOpen && state.activePane === 'secondary'
            ? state.secondaryFilePath
            : state.activeFilePath)
      ) ?? null
  )
  const cursor = useEditorStore((state) => state.cursor)
  const gitStatus = useEditorStore((state) => state.gitStatus)
  const workspace = useEditorStore((state) => state.workspace)
  const settings = useEditorStore((state) => state.settings)
  const panelOpen = useEditorStore((state) => state.panelOpen)
  const panelView = useEditorStore((state) => state.panelView)
  const toggleTerminal = useEditorStore((state) => state.toggleTerminal)
  const showPanel = useEditorStore((state) => state.showPanel)
  const refreshGitStatus = useEditorStore((state) => state.refreshGitStatus)
  const setSidebarView = useEditorStore((state) => state.setSidebarView)
  const debugState = useDebugStore((state) => state.state)
  const taskRuns = useTaskStore((state) => state.runs)
  const diagnosticCount = useLanguageStore((state) =>
    Object.values(state.diagnostics).reduce(
      (count, diagnostics) =>
        count + diagnostics.filter((diagnostic) => diagnostic.severity <= 2).length,
      0
    )
  )
  const taskProblemCount = taskRuns.reduce((count, run) => count + run.problems.length, 0)
  const runningTasks = taskRuns.filter((run) => run.status === 'running').length

  return (
    <footer className="statusbar" aria-label="Barre d’état">
      <div className="statusbar-group statusbar-left">
        <button
          type="button"
          className="statusbar-item statusbar-git"
          title="Afficher le contrôle de source"
          onClick={() => {
            setSidebarView('git')
            void refreshGitStatus()
          }}
        >
          <GitBranch size={12} strokeWidth={2} />
          {workspace ? (
            gitStatus?.isRepository ? (
              <>
                <span>{gitStatus.branch ?? 'HEAD'}</span>
                {gitStatus.ahead > 0 ? <span className="statusbar-ahead">↑{gitStatus.ahead}</span> : null}
                {gitStatus.behind > 0 ? (
                  <span className="statusbar-behind">↓{gitStatus.behind}</span>
                ) : null}
                {gitStatus.changes > 0 ? (
                  <span className="statusbar-changes">
                    <span className="statusbar-change-dot" />
                    {gitStatus.changes}
                  </span>
                ) : (
                  <span className="statusbar-clean">propre</span>
                )}
              </>
            ) : (
              <span>Aucun dépôt Git</span>
            )
          ) : (
            <span>Aucun dossier ouvert</span>
          )}
        </button>
      </div>

      <div className="statusbar-spacer" />

      <div className="statusbar-group statusbar-right">
        {debugState !== 'idle' ? (
          <button
            type="button"
            className={`statusbar-item statusbar-debug${
              debugState === 'paused'
                ? ' is-paused'
                : debugState === 'running' || debugState === 'starting'
                  ? ' is-running'
                  : debugState === 'error'
                    ? ' is-error'
                    : ''
            }`}
            title="Afficher Exécution et débogage"
            onClick={() => {
              setSidebarView('debug')
              showPanel('debug')
            }}
          >
            <Bug size={12} strokeWidth={2} />
            <span>
              {debugState === 'paused'
                ? 'En pause'
                : debugState === 'running'
                  ? 'Débogage'
                  : debugState === 'starting'
                    ? 'Démarrage'
                    : debugState === 'error'
                      ? 'Erreur de débogage'
                      : 'Débogage arrêté'}
            </span>
          </button>
        ) : null}

        {taskRuns.length > 0 ? (
          <button
            type="button"
            className={`statusbar-item statusbar-tasks${runningTasks > 0 ? ' is-running' : ''}`}
            title="Afficher les tâches"
            onClick={() => {
              setSidebarView('tasks')
              showPanel('tasks')
            }}
          >
            {runningTasks > 0 ? (
              <LoaderCircle size={12} className="spin" strokeWidth={2} />
            ) : (
              <CircleStop size={12} strokeWidth={1.9} />
            )}
            <span>
              {runningTasks > 0
                ? `${runningTasks} tâche${runningTasks > 1 ? 's' : ''}`
                : 'Tâches'}
            </span>
          </button>
        ) : null}

        <button
          type="button"
          className={`statusbar-item${panelOpen && panelView === 'problems' ? ' is-active' : ''}`}
          title="Afficher les problèmes"
          aria-pressed={panelOpen && panelView === 'problems'}
          onClick={() => {
            showPanel('problems')
          }}
        >
          <AlertTriangle size={12} strokeWidth={1.9} />
          <span>Problèmes</span>
          {diagnosticCount + taskProblemCount > 0 ? (
            <span className="statusbar-problem-count">
              {diagnosticCount + taskProblemCount}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          className={`statusbar-item statusbar-terminal${panelOpen && panelView === 'terminal' ? ' is-active' : ''}`}
          title="Afficher ou masquer le terminal intégré"
          aria-pressed={panelOpen && panelView === 'terminal'}
          onClick={toggleTerminal}
        >
          <TerminalIcon size={12} strokeWidth={1.9} />
          <span>Terminal</span>
        </button>

        {activeFile ? (
          <>
            <span className="statusbar-item" title="Position du curseur">
              Ln {cursor.line}, Col {cursor.column}
            </span>
            {cursor.selectionLength > 0 ? (
              <span className="statusbar-item" title="Texte sélectionné">
                ({cursor.selectionLength} sélectionné{cursor.selectionLength > 1 ? 's' : ''})
              </span>
            ) : null}
            <span className="statusbar-item" title="Indentation">
              Espaces : {settings.tabSize}
            </span>
            <span className="statusbar-item" title="Encodage du fichier">
              {activeFile.encoding}
            </span>
            <span className="statusbar-item" title="Fin de ligne">
              {activeFile.eol}
            </span>
            <span
              className="statusbar-item statusbar-language"
              title="Langage du fichier actif"
            >
              <LanguageIcon filePath={activeFile.path} size={13} />
              {languageLabel(activeFile.language)}
            </span>
          </>
        ) : (
          <span className="statusbar-item">Prêt</span>
        )}
      </div>
    </footer>
  )
}
