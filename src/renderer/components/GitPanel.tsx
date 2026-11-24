import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  GitBranch,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { GitChange, GitFileStatusCode } from '../../preload'
import { useEditorStore } from '../store/editorStore'

function statusLabel(status: GitFileStatusCode): string {
  switch (status) {
    case 'M':
      return 'M'
    case 'A':
      return 'A'
    case 'D':
      return 'D'
    case 'R':
      return 'R'
    case 'C':
      return 'C'
    case 'U':
      return '!'
    case 'T':
      return 'T'
    default:
      return '?'
  }
}

function splitRelativePath(relativePath: string): { name: string; directory: string } {
  const index = relativePath.lastIndexOf('/')
  return index >= 0
    ? { name: relativePath.slice(index + 1), directory: relativePath.slice(0, index) }
    : { name: relativePath, directory: '' }
}

function GitChangeRow({
  change,
  staged,
  busy
}: {
  change: GitChange
  staged: boolean
  busy: boolean
}): React.JSX.Element {
  const openFile = useEditorStore((state) => state.openFile)
  const openGitDiff = useEditorStore((state) => state.openGitDiff)
  const stageGitPaths = useEditorStore((state) => state.stageGitPaths)
  const unstageGitPaths = useEditorStore((state) => state.unstageGitPaths)
  const { name, directory } = splitRelativePath(change.relativePath)

  return (
    <div
      className="git-change-row"
      role="button"
      tabIndex={0}
      title={`${change.relativePath} — ${staged ? 'indexé' : 'non indexé'}`}
      onClick={() => {
        void openGitDiff(change.path, staged)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          void openGitDiff(change.path, staged)
        }
      }}
    >
      <span
        className={`git-status-mark is-${statusLabel(change.status).toLocaleLowerCase()}`}
        aria-label={`Statut ${change.status}`}
      >
        {statusLabel(change.status)}
      </span>
      <span className="git-change-copy">
        <span className="git-change-name">{name}</span>
        {directory ? <span className="git-change-directory">{directory}</span> : null}
      </span>
      <span className="git-change-actions">
        <button
          type="button"
          className="icon-button icon-button-small"
          title="Ouvrir le fichier"
          aria-label={`Ouvrir ${name}`}
          onClick={(event) => {
            event.stopPropagation()
            void openFile(change.path)
          }}
        >
          <FileText size={13} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-button icon-button-small"
          title={staged ? 'Retirer de l’index' : 'Indexer la modification'}
          aria-label={staged ? 'Désindexer' : 'Indexer'}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation()
            if (staged) {
              void unstageGitPaths([change.path])
            } else {
              void stageGitPaths([change.path])
            }
          }}
        >
          {staged ? <Minus size={13} strokeWidth={2} /> : <Plus size={13} strokeWidth={2} />}
        </button>
      </span>
    </div>
  )
}

function GitSection({
  title,
  changes,
  staged,
  busy,
  actionLabel,
  actionIcon,
  onAction
}: {
  title: string
  changes: GitChange[]
  staged: boolean
  busy: boolean
  actionLabel: string
  actionIcon: 'plus' | 'minus'
  onAction: () => void
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(true)
  if (changes.length === 0) {
    return null
  }
  const ActionIcon = actionIcon === 'plus' ? Plus : Minus

  return (
    <section className="git-section">
      <div className="git-section-header">
        <button
          type="button"
          className="git-section-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <ChevronDown size={13} strokeWidth={2} />
          ) : (
            <ChevronRight size={13} strokeWidth={2} />
          )}
          <span>{title}</span>
          <span className="git-section-count">{changes.length}</span>
        </button>
        <button
          type="button"
          className="icon-button icon-button-small"
          title={actionLabel}
          aria-label={actionLabel}
          disabled={busy}
          onClick={onAction}
        >
          <ActionIcon size={13} strokeWidth={2} />
        </button>
      </div>
      {expanded ? (
        <div className="git-section-list">
          {changes.map((change) => (
            <GitChangeRow
              key={`${change.path}:${staged ? 'staged' : 'unstaged'}`}
              change={change}
              staged={staged}
              busy={busy}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function GitPanel(): React.JSX.Element {
  const workspace = useEditorStore((state) => state.workspace)
  const repository = useEditorStore((state) => state.gitRepository)
  const loading = useEditorStore((state) => state.gitLoading)
  const busy = useEditorStore((state) => state.gitBusy)
  const message = useEditorStore((state) => state.gitMessage)
  const error = useEditorStore((state) => state.gitError)
  const branches = useEditorStore((state) => state.gitBranches)
  const refresh = useEditorStore((state) => state.refreshGitStatus)
  const setMessage = useEditorStore((state) => state.setGitMessage)
  const stageAll = useEditorStore((state) => state.stageAllGitChanges)
  const unstageAll = useEditorStore((state) => state.unstageAllGitChanges)
  const commit = useEditorStore((state) => state.commitGitChanges)
  const loadBranches = useEditorStore((state) => state.loadGitBranches)
  const checkout = useEditorStore((state) => state.checkoutGitBranch)
  const [branchesOpen, setBranchesOpen] = useState(false)

  useEffect(() => {
    if (!workspace) {
      return
    }
    void refresh()
    void loadBranches()
  }, [loadBranches, refresh, workspace])

  const stagedChanges = useMemo(
    () => repository?.entries.filter((entry) => entry.staged) ?? [],
    [repository]
  )
  const unstagedChanges = useMemo(
    () => repository?.entries.filter((entry) => entry.unstaged || entry.untracked) ?? [],
    [repository]
  )

  if (!workspace) {
    return (
      <section className="sidebar-view" aria-label="Contrôle de source">
        <div className="sidebar-header">
          <span>Contrôle de source</span>
        </div>
        <div className="sidebar-empty compact">
          <GitBranch size={26} strokeWidth={1.4} />
          <h2>Aucun dossier ouvert</h2>
          <p>Ouvrez un dossier pour afficher son état Git.</p>
        </div>
      </section>
    )
  }

  if (!repository?.isRepository) {
    return (
      <section className="sidebar-view" aria-label="Contrôle de source">
        <div className="sidebar-header">
          <span>Contrôle de source</span>
          <div className="sidebar-header-actions">
            <button
              type="button"
              className="icon-button"
              title="Actualiser"
              aria-label="Actualiser l’état Git"
              disabled={loading}
              onClick={() => {
                void refresh()
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
        <div className="sidebar-empty compact">
          <GitBranch size={26} strokeWidth={1.4} />
          <h2>Aucun dépôt Git</h2>
          <p>Ce dossier n’est pas suivi par Git. Initialisez un dépôt pour gérer ses versions.</p>
        </div>
      </section>
    )
  }

  const branchValue = repository.branch ?? ''
  const branchOptions =
    branchValue && !branches.includes(branchValue) ? [branchValue, ...branches] : branches

  return (
    <section className="sidebar-view" aria-label="Contrôle de source">
      <div className="sidebar-header">
        <span>Contrôle de source</span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="icon-button"
            title="Actualiser"
            aria-label="Actualiser l’état Git"
            disabled={loading || busy}
            onClick={() => {
              void refresh()
              void loadBranches()
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

      <div className="sidebar-scroll git-panel">
        <div className="git-branch-card">
          <button
            type="button"
            className="git-branch-current"
            aria-expanded={branchesOpen}
            onClick={() => {
              setBranchesOpen((current) => !current)
              if (!branchesOpen) {
                void loadBranches()
              }
            }}
          >
            <GitBranch size={14} strokeWidth={1.9} />
            <span>{repository.branch ?? 'HEAD détachée'}</span>
            <span className="git-ahead-behind">
              {repository.ahead > 0 ? `↑${repository.ahead}` : ''}
              {repository.behind > 0 ? ` ↓${repository.behind}` : ''}
            </span>
            <ChevronDown size={13} strokeWidth={2} />
          </button>
          {branchesOpen ? (
            <div className="git-branch-list" role="listbox" aria-label="Branches">
              {branchOptions.length === 0 ? (
                <div className="git-branch-empty">Aucune branche locale.</div>
              ) : (
                branchOptions.map((branch) => (
                  <button
                    key={branch}
                    type="button"
                    role="option"
                    aria-selected={branch === repository.branch}
                    className={`git-branch-option${
                      branch === repository.branch ? ' is-current' : ''
                    }`}
                    disabled={busy}
                    onClick={() => {
                      setBranchesOpen(false)
                      if (branch !== repository.branch) {
                        void checkout(branch)
                      }
                    }}
                  >
                    <span>{branch}</span>
                    {branch === repository.branch ? (
                      <Check size={13} strokeWidth={2.2} />
                    ) : null}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="git-error" role="alert">
            <AlertTriangle size={14} strokeWidth={1.9} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="git-commit-box">
          <textarea
            value={message}
            rows={3}
            maxLength={10_000}
            placeholder="Message de validation (Ctrl+Entrée pour valider)"
            aria-label="Message de validation Git"
            onChange={(event) => {
              setMessage(event.target.value)
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                if (stagedChanges.length > 0 && message.trim()) {
                  void commit()
                }
              }
            }}
          />
          <button
            type="button"
            className="primary-button git-commit-button"
            disabled={busy || stagedChanges.length === 0 || !message.trim()}
            onClick={() => {
              void commit()
            }}
          >
            {busy ? (
              <LoaderCircle size={14} className="spin" strokeWidth={2} />
            ) : (
              <Check size={14} strokeWidth={2.2} />
            )}
            Valider{stagedChanges.length > 0 ? ` (${stagedChanges.length})` : ''}
          </button>
        </div>

        {repository.hasConflicts ? (
          <div className="git-warning">
            <AlertTriangle size={14} strokeWidth={1.9} />
            Des conflits doivent être résolus avant de valider.
          </div>
        ) : null}

        <GitSection
          title="Modifications indexées"
          changes={stagedChanges}
          staged
          busy={busy}
          actionLabel="Tout désindexer"
          actionIcon="minus"
          onAction={() => {
            void unstageAll()
          }}
        />
        <GitSection
          title="Modifications"
          changes={unstagedChanges}
          staged={false}
          busy={busy}
          actionLabel="Tout indexer"
          actionIcon="plus"
          onAction={() => {
            void stageAll()
          }}
        />

        {stagedChanges.length === 0 && unstagedChanges.length === 0 ? (
          <div className="git-clean">
            <Check size={18} strokeWidth={1.8} />
            <span>Aucune modification en attente.</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
