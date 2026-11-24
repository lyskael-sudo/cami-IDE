import {
  Bug,
  Bot,
  ChevronDown,
  FilePlus2,
  Files,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  GitBranch,
  ListChecks,
  ListTree,
  LoaderCircle,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Type,
  WrapText
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { SearchMatch, SearchResponse } from '../../preload'
import {
  getErrorMessage,
  useEditorStore,
  type EditorSettings,
  type SidebarView
} from '../store/editorStore'
import { DebugPanel } from './DebugPanel'
import { FileTree } from './FileTree'
import { GoleChatPanel } from './GoleChatPanel'
import { GitPanel } from './GitPanel'
import { OutlinePanel } from './OutlinePanel'
import { TaskPanel } from './TaskPanel'

interface ActivityItem {
  id: SidebarView
  label: string
  icon: typeof Files
}

const PRIMARY_ACTIVITIES: ActivityItem[] = [
  { id: 'explorer', label: 'Explorateur', icon: Files },
  { id: 'search', label: 'Recherche', icon: Search },
  { id: 'git', label: 'Contrôle de source', icon: GitBranch },
  { id: 'debug', label: 'Exécution et débogage', icon: Bug },
  { id: 'tasks', label: 'Tâches', icon: ListChecks },
  { id: 'outline', label: 'Plan du fichier', icon: ListTree },
  { id: 'gole', label: 'Gole', icon: Bot }
]

function ActivityButton({
  item,
  isActive,
  onClick
}: {
  item: ActivityItem
  isActive: boolean
  onClick: () => void
}): React.JSX.Element {
  const Icon = item.icon

  return (
    <button
      type="button"
      className={`activity-button${isActive ? ' is-active' : ''}`}
      title={item.label}
      aria-label={item.label}
      aria-pressed={isActive}
      onClick={onClick}
    >
      <Icon size={20} strokeWidth={1.7} />
      <span className="activity-indicator" aria-hidden="true" />
    </button>
  )
}

function SidebarHeader({
  title,
  children
}: {
  title: string
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="sidebar-header">
      <span>{title}</span>
      {children ? <div className="sidebar-header-actions">{children}</div> : null}
    </div>
  )
}

function ExplorerPanel(): React.JSX.Element {
  const workspace = useEditorStore((state) => state.workspace)
  const treeLoading = useEditorStore((state) => state.treeLoading)
  const openWorkspace = useEditorStore((state) => state.openWorkspace)
  const refreshWorkspace = useEditorStore((state) => state.refreshWorkspace)
  const beginCreateFile = useEditorStore((state) => state.beginCreateFile)
  const beginCreateFolder = useEditorStore((state) => state.beginCreateFolder)

  const revealWorkspace = async (): Promise<void> => {
    if (!workspace) {
      return
    }

    try {
      await window.electronAPI.workspace.reveal(workspace.path)
    } catch (error) {
      useEditorStore.setState({ error: getErrorMessage(error) })
    }
  }

  return (
    <section className="sidebar-view" aria-label="Explorateur">
      <SidebarHeader title="Explorateur">
        <button
          type="button"
          className="icon-button"
          title="Ouvrir un dossier"
          aria-label="Ouvrir un dossier"
          onClick={() => {
            void openWorkspace()
          }}
        >
          <FolderOpen size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Nouveau fichier"
          aria-label="Nouveau fichier"
          disabled={!workspace}
          onClick={() => {
            if (workspace) {
              beginCreateFile(workspace.path)
            }
          }}
        >
          <FilePlus2 size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Nouveau dossier"
          aria-label="Nouveau dossier"
          disabled={!workspace}
          onClick={() => {
            if (workspace) {
              beginCreateFolder(workspace.path)
            }
          }}
        >
          <FolderPlus size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Révéler le dossier dans le gestionnaire de fichiers"
          aria-label="Révéler le dossier dans le gestionnaire de fichiers"
          disabled={!workspace}
          onClick={() => {
            void revealWorkspace()
          }}
        >
          <FolderSearch size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Actualiser l’explorateur"
          aria-label="Actualiser l’explorateur"
          disabled={!workspace || treeLoading}
          onClick={() => {
            void refreshWorkspace()
          }}
        >
          <RefreshCw
            size={14}
            strokeWidth={1.8}
            className={treeLoading ? 'spin' : undefined}
          />
        </button>
      </SidebarHeader>

      {workspace ? (
        <>
          <div className="workspace-caption" title={workspace.path}>
            <ChevronDown size={13} strokeWidth={2} />
            <span className="workspace-caption-name">{workspace.name}</span>
          </div>
          <div className="sidebar-scroll">
            <FileTree />
          </div>
        </>
      ) : (
        <div className="sidebar-empty">
          <div className="sidebar-empty-icon" aria-hidden="true">
            <FolderOpen size={26} strokeWidth={1.4} />
          </div>
          <h2>Votre espace de travail</h2>
          <p>Ouvrez un dossier pour parcourir vos fichiers et commencer à éditer.</p>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              void openWorkspace()
            }}
          >
            <FolderOpen size={15} strokeWidth={1.9} />
            Ouvrir un dossier
          </button>
        </div>
      )}
    </section>
  )
}

function HighlightedText({
  text,
  query,
  caseSensitive
}: {
  text: string
  query: string
  caseSensitive: boolean
}): React.JSX.Element {
  if (!query) {
    return <>{text}</>
  }

  const haystack = caseSensitive ? text : text.toLocaleLowerCase()
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let matchIndex = haystack.indexOf(needle)
  let partIndex = 0

  while (matchIndex !== -1 && partIndex < 20) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex))
    }

    parts.push(
      <mark key={`match-${partIndex}`}>
        {text.slice(matchIndex, matchIndex + query.length)}
      </mark>
    )
    cursor = matchIndex + query.length
    matchIndex = haystack.indexOf(needle, cursor)
    partIndex += 1
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }

  return <>{parts.length > 0 ? parts : text}</>
}

interface SearchGroup {
  path: string
  relativePath: string
  matches: SearchMatch[]
}

function SearchPanel(): React.JSX.Element {
  const workspace = useEditorStore((state) => state.workspace)
  const openFile = useEditorStore((state) => state.openFile)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchFocusNonce = useEditorStore((state) => state.searchFocusNonce)
  const inputRef = useRef<HTMLInputElement>(null)
  const normalizedQuery = query.trim()

  useEffect(() => {
    inputRef.current?.focus()
  }, [searchFocusNonce, workspace])

  useEffect(() => {
    if (!workspace || normalizedQuery.length < 2) {
      setResults(null)
      setSearching(false)
      setSearchError(null)
      return
    }

    let cancelled = false
    setSearching(true)
    setSearchError(null)

    const timer = window.setTimeout(() => {
      void window.electronAPI.workspace
        .search(normalizedQuery, { caseSensitive })
        .then((response) => {
          if (!cancelled) {
            setResults(response)
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setResults(null)
            setSearchError(getErrorMessage(error))
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearching(false)
          }
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [caseSensitive, normalizedQuery, workspace])

  const groups = useMemo<SearchGroup[]>(() => {
    if (!results) {
      return []
    }

    const grouped = new Map<string, SearchGroup>()
    for (const match of results.matches) {
      const existing = grouped.get(match.path)
      if (existing) {
        existing.matches.push(match)
      } else {
        grouped.set(match.path, {
          path: match.path,
          relativePath: match.relativePath,
          matches: [match]
        })
      }
    }

    return [...grouped.values()]
  }, [results])

  if (!workspace) {
    return (
      <section className="sidebar-view" aria-label="Recherche">
        <SidebarHeader title="Recherche" />
        <div className="sidebar-empty">
          <div className="sidebar-empty-icon" aria-hidden="true">
            <Search size={26} strokeWidth={1.4} />
          </div>
          <h2>Recherche globale</h2>
          <p>Ouvrez un dossier pour rechercher dans tous vos fichiers.</p>
        </div>
      </section>
    )
  }

  const matchCount = results?.matches.length ?? 0
  const fileCount = groups.length

  return (
    <section className="sidebar-view" aria-label="Recherche">
      <SidebarHeader title="Recherche" />
      <div className="search-controls" role="search">
        <div className="search-input-wrap">
          <Search size={14} className="search-input-icon" strokeWidth={1.9} />
          <input
            ref={inputRef}
            className="search-input"
            type="search"
            value={query}
            placeholder="Rechercher dans les fichiers"
            aria-label="Rechercher dans les fichiers"
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('')
                inputRef.current?.blur()
              }
            }}
          />
          <button
            type="button"
            className={`search-case-button${caseSensitive ? ' is-active' : ''}`}
            title="Respecter la casse"
            aria-label="Respecter la casse"
            aria-pressed={caseSensitive}
            onClick={() => {
              setCaseSensitive((current) => !current)
            }}
          >
            Aa
          </button>
        </div>
        <div className="search-summary" aria-live="polite">
          {searching ? (
            <>
              <LoaderCircle size={12} className="spin" />
              <span>Recherche…</span>
            </>
          ) : normalizedQuery.length < 2 ? (
            <span>Saisissez au moins deux caractères.</span>
          ) : matchCount > 0 ? (
            <span>
              {matchCount} résultat{matchCount > 1 ? 's' : ''} dans {fileCount} fichier
              {fileCount > 1 ? 's' : ''}
            </span>
          ) : (
            <span>Aucun résultat.</span>
          )}
        </div>
      </div>

      <div className="sidebar-scroll search-results">
        {searchError ? <p className="inline-error">{searchError}</p> : null}

        {!searching && normalizedQuery.length >= 2 && matchCount === 0 && !searchError ? (
          <div className="search-empty">
            <p>Aucune correspondance pour « {normalizedQuery} ».</p>
            <span>Essayez un autre terme ou activez la casse.</span>
          </div>
        ) : null}

        {results?.truncated ? (
          <p className="search-truncated">
            Résultats limités. Affinez votre recherche pour voir davantage de fichiers.
          </p>
        ) : null}

        {groups.map((group) => (
          <div className="search-group" key={group.path}>
            <div className="search-file-header" title={group.path}>
              <span className="search-file-name">{group.relativePath}</span>
              <span className="search-file-count">{group.matches.length}</span>
            </div>
            {group.matches.map((match) => (
              <button
                type="button"
                className="search-result"
                key={`${match.path}:${match.line}:${match.column}`}
                onClick={() => {
                  void openFile(match.path, match.line, match.column)
                }}
              >
                <span className="search-result-line">{match.line}</span>
                <span className="search-result-preview">
                  <HighlightedText
                    text={match.preview}
                    query={normalizedQuery}
                    caseSensitive={caseSensitive}
                  />
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}

function Stepper({
  value,
  minimum,
  maximum,
  onChange,
  label
}: {
  value: number
  minimum: number
  maximum: number
  onChange: (value: number) => void
  label: string
}): React.JSX.Element {
  return (
    <div className="stepper" aria-label={label}>
      <button
        type="button"
        aria-label={`Diminuer ${label}`}
        disabled={value <= minimum}
        onClick={() => {
          onChange(Math.max(minimum, value - 1))
        }}
      >
        <Minus size={13} strokeWidth={2} />
      </button>
      <span>{value}</span>
      <button
        type="button"
        aria-label={`Augmenter ${label}`}
        disabled={value >= maximum}
        onClick={() => {
          onChange(Math.min(maximum, value + 1))
        }}
      >
        <Plus size={13} strokeWidth={2} />
      </button>
    </div>
  )
}

function SettingToggle({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="setting-toggle">
      <span className="setting-copy">
        <span className="setting-label">{label}</span>
        <span className="setting-description">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </label>
  )
}

function SettingsPanel(): React.JSX.Element {
  const settings = useEditorStore((state) => state.settings)
  const updateSettings = useEditorStore((state) => state.updateSettings)
  const resetSettings = useEditorStore((state) => state.resetSettings)

  const changeSetting = <Key extends keyof EditorSettings>(
    key: Key,
    value: EditorSettings[Key]
  ): void => {
    updateSettings({ [key]: value } as Partial<EditorSettings>)
  }

  return (
    <section className="sidebar-view" aria-label="Paramètres">
      <SidebarHeader title="Paramètres" />
      <div className="sidebar-scroll settings-panel">
        <div className="theme-card">
          <span className="theme-preview" aria-hidden="true">
            <span className="theme-preview-sidebar" />
            <span className="theme-preview-editor">
              <i />
              <i />
              <i />
            </span>
          </span>
          <span className="theme-copy">
            <span className="theme-name">Cami Sombre</span>
            <span className="theme-description">Conçu pour les longues sessions de code.</span>
          </span>
          <Palette size={16} strokeWidth={1.7} aria-hidden="true" />
        </div>

        <div className="settings-section">
          <div className="settings-section-title">
            <Type size={13} strokeWidth={1.8} />
            Éditeur
          </div>

          <div className="setting-row">
            <span className="setting-copy">
              <span className="setting-label">Taille de police</span>
              <span className="setting-description">Texte de l’éditeur Monaco.</span>
            </span>
            <Stepper
              label="la taille de police"
              value={settings.fontSize}
              minimum={10}
              maximum={24}
              onChange={(value) => {
                changeSetting('fontSize', value)
              }}
            />
          </div>

          <div className="setting-row">
            <span className="setting-copy">
              <span className="setting-label">Taille des tabulations</span>
              <span className="setting-description">Nombre d’espaces par indentation.</span>
            </span>
            <select
              className="setting-select"
              aria-label="Taille des tabulations"
              value={settings.tabSize}
              onChange={(event) => {
                changeSetting('tabSize', Number(event.target.value))
              }}
            >
              <option value={2}>2</option>
              <option value={4}>4</option>
              <option value={8}>8</option>
            </select>
          </div>

          <SettingToggle
            label="Retour à la ligne"
            description="Adapte les longues lignes à la largeur visible."
            checked={settings.wordWrap}
            onChange={(checked) => {
              changeSetting('wordWrap', checked)
            }}
          />

          <SettingToggle
            label="Mini-carte"
            description="Affiche un aperçu du fichier à droite."
            checked={settings.minimap}
            onChange={(checked) => {
              changeSetting('minimap', checked)
            }}
          />

          <div className="setting-row">
            <span className="setting-copy">
              <span className="setting-label">Numéros de ligne</span>
              <span className="setting-description">Affichage absolu ou relatif.</span>
            </span>
            <select
              className="setting-select"
              aria-label="Affichage des numéros de ligne"
              value={settings.lineNumbers}
              onChange={(event) => {
                const value = event.target.value
                if (value === 'on' || value === 'relative' || value === 'off') {
                  changeSetting('lineNumbers', value)
                }
              }}
            >
              <option value="on">Absolus</option>
              <option value="relative">Relatifs</option>
              <option value="off">Masqués</option>
            </select>
          </div>

          <SettingToggle
            label="Ligatures"
            description="Relie certains caractères dans les polices compatibles."
            checked={settings.fontLigatures}
            onChange={(checked) => {
              changeSetting('fontLigatures', checked)
            }}
          />

          <SettingToggle
            label="Coloration des paires"
            description="Utilise une couleur distincte pour chaque niveau d’accolades."
            checked={settings.bracketPairColorization}
            onChange={(checked) => {
              changeSetting('bracketPairColorization', checked)
            }}
          />

          <SettingToggle
            label="Défilement épinglé"
            description="Garde le contexte des blocs visibles en haut de l’éditeur."
            checked={settings.stickyScroll}
            onChange={(checked) => {
              changeSetting('stickyScroll', checked)
            }}
          />
        </div>

        <div className="settings-section">
          <div className="settings-section-title">
            <WrapText size={13} strokeWidth={1.8} />
            Terminal
          </div>
          <div className="setting-row">
            <span className="setting-copy">
              <span className="setting-label">Taille de police</span>
              <span className="setting-description">Texte du terminal intégré.</span>
            </span>
            <Stepper
              label="la taille de police du terminal"
              value={settings.terminalFontSize}
              minimum={10}
              maximum={22}
              onChange={(value) => {
                changeSetting('terminalFontSize', value)
              }}
            />
          </div>
        </div>

        <button
          type="button"
          className="settings-reset"
          onClick={resetSettings}
        >
          <RotateCcw size={14} strokeWidth={1.8} />
          Réinitialiser les préférences
        </button>

        <p className="settings-footnote">
          Les préférences sont enregistrées localement sur cet appareil.
        </p>
      </div>
    </section>
  )
}

export function Sidebar(): React.JSX.Element {
  const view = useEditorStore((state) => state.sidebarView)
  const sidebarOpen = useEditorStore((state) => state.sidebarOpen)
  const setView = useEditorStore((state) => state.setSidebarView)
  const toggleSidebar = useEditorStore((state) => state.toggleSidebar)
  const focusSearch = useEditorStore((state) => state.focusSearch)
  const [hasOpenedGole, setHasOpenedGole] = useState(view === 'gole')

  useEffect(() => {
    if (view === 'gole') {
      setHasOpenedGole(true)
    }
  }, [view])

  return (
    <>
      <nav className="activity-bar" aria-label="Vues de la barre latérale">
        <div className="activity-group">
          {PRIMARY_ACTIVITIES.map((item) => (
            <ActivityButton
              key={item.id}
              item={item}
              isActive={view === item.id}
              onClick={() => {
                if (item.id === 'search') {
                  if (sidebarOpen && view === 'search') {
                    toggleSidebar()
                    return
                  }
                  focusSearch()
                  return
                }

                if (sidebarOpen && view === item.id) {
                  toggleSidebar()
                  return
                }
                setView(item.id)
              }}
            />
          ))}
        </div>
        <div className="activity-group activity-group-bottom">
          <ActivityButton
            item={{ id: 'settings', label: 'Paramètres', icon: Settings }}
            isActive={view === 'settings'}
            onClick={() => {
              if (sidebarOpen && view === 'settings') {
                toggleSidebar()
                return
              }
              setView('settings')
            }}
          />
        </div>
      </nav>

      <aside className="sidebar" aria-label="Barre latérale">
        {view === 'explorer' ? <ExplorerPanel /> : null}
        {view === 'search' ? <SearchPanel /> : null}
        {view === 'git' ? <GitPanel /> : null}
        {view === 'debug' ? <DebugPanel /> : null}
        {view === 'tasks' ? <TaskPanel /> : null}
        {view === 'outline' ? <OutlinePanel /> : null}
        {hasOpenedGole ? (
          <div className={`gole-chat-view${view === 'gole' ? '' : ' is-hidden'}`}>
            <GoleChatPanel />
          </div>
        ) : null}
        {view === 'settings' ? <SettingsPanel /> : null}
      </aside>
    </>
  )
}
