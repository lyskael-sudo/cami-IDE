import {
  ChevronRight,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  Pencil,
  Trash2
} from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import {
  getErrorMessage,
  useEditorStore,
  type FileTreeNode
} from '../store/editorStore'
import { LanguageIcon } from './LanguageIcon'

interface TreeNodeProps {
  node: FileTreeNode
  depth: number
  onContextMenu: (event: MouseEvent, node: FileTreeNode) => void
}

interface ContextMenuState {
  x: number
  y: number
  node: FileTreeNode | null
}

function parentDirectoryOf(filePath: string): string {
  const separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return separatorIndex > 0 ? filePath.slice(0, separatorIndex) : filePath
}

function TreeNode({
  node,
  depth,
  onContextMenu
}: TreeNodeProps): React.JSX.Element {
  const isActive = useEditorStore(
    (state) =>
      !node.isDirectory &&
      (state.activeFilePath === node.path || state.secondaryFilePath === node.path)
  )
  const toggleDirectory = useEditorStore((state) => state.toggleDirectory)
  const openFile = useEditorStore((state) => state.openFile)

  const activate = (): void => {
    if (node.isDirectory) {
      void toggleDirectory(node.path)
    } else {
      void openFile(node.path)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
      return
    }

    if (event.key === 'ArrowRight' && node.isDirectory && !node.isExpanded) {
      event.preventDefault()
      void toggleDirectory(node.path)
      return
    }

    if (event.key === 'ArrowLeft' && node.isDirectory && node.isExpanded) {
      event.preventDefault()
      void toggleDirectory(node.path)
    }
  }

  const rowStyle = {
    '--tree-depth': depth
  } as CSSProperties

  return (
    <div
      className="tree-node"
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={node.isDirectory ? node.isExpanded : undefined}
      aria-selected={!node.isDirectory ? isActive : undefined}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`tree-row${isActive ? ' is-active' : ''}`}
        style={rowStyle}
        title={node.path}
        onClick={activate}
        onContextMenu={(event) => {
          onContextMenu(event, node)
        }}
      >
        <span className="tree-chevron" aria-hidden="true">
          {node.isDirectory ? (
            <ChevronRight
              size={14}
              className={node.isExpanded ? 'is-expanded' : undefined}
              strokeWidth={2}
            />
          ) : null}
        </span>

        <span
          className={`tree-icon${node.isDirectory ? ' tree-icon-folder' : ''}`}
          aria-hidden="true"
        >
          {node.isDirectory ? (
            node.isExpanded ? (
              <FolderOpen size={15} strokeWidth={1.7} />
            ) : (
              <Folder size={15} strokeWidth={1.7} />
            )
          ) : (
            <LanguageIcon filePath={node.path} size={15} />
          )}
        </span>

        <span className="tree-label">{node.name}</span>

        {node.isLoading ? (
          <LoaderCircle size={12} className="spin tree-loading-icon" aria-label="Chargement" />
        ) : null}
      </div>

      {node.isDirectory && node.isExpanded ? (
        node.isLoading ? null : node.children && node.children.length > 0 ? (
          <div className="tree-children" role="group">
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                onContextMenu={onContextMenu}
              />
            ))}
          </div>
        ) : (
          <div className="tree-empty-directory" style={rowStyle}>
            <span>Dossier vide</span>
          </div>
        )
      ) : null}
    </div>
  )
}

export function FileTree(): React.JSX.Element {
  const tree = useEditorStore((state) => state.tree)
  const treeLoading = useEditorStore((state) => state.treeLoading)
  const workspace = useEditorStore((state) => state.workspace)
  const openWorkspace = useEditorStore((state) => state.openWorkspace)
  const beginCreateFile = useEditorStore((state) => state.beginCreateFile)
  const beginCreateFolder = useEditorStore((state) => state.beginCreateFolder)
  const beginRename = useEditorStore((state) => state.beginRename)
  const deleteEntry = useEditorStore((state) => state.deleteEntry)
  const refreshWorkspace = useEditorStore((state) => state.refreshWorkspace)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    const closeMenu = (event: globalThis.MouseEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) {
        return
      }
      setContextMenu(null)
    }

    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }

    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    })

    window.addEventListener('pointerdown', closeMenu, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', closeMenu, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [contextMenu])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!contextMenu || !menu) {
      return
    }

    const bounds = menu.getBoundingClientRect()
    const x = Math.max(
      8,
      Math.min(contextMenu.x, window.innerWidth - bounds.width - 8)
    )
    const y = Math.max(
      8,
      Math.min(contextMenu.y, window.innerHeight - bounds.height - 8)
    )

    if (x !== contextMenu.x || y !== contextMenu.y) {
      setContextMenu((current) => (current ? { ...current, x, y } : current))
    }
  }, [contextMenu])

  if (!workspace) {
    return (
      <div className="tree-placeholder">
        <p>Aucun dossier ouvert.</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            void openWorkspace()
          }}
        >
          Ouvrir un dossier
        </button>
      </div>
    )
  }

  if (treeLoading && tree.length === 0) {
    return (
      <div className="tree-placeholder" aria-live="polite">
        <LoaderCircle size={18} className="spin" />
        <p>Lecture du dossier…</p>
      </div>
    )
  }

  if (tree.length === 0) {
    return (
      <div className="tree-placeholder">
        <Folder size={20} strokeWidth={1.5} />
        <p>Ce dossier est vide.</p>
        <div className="tree-placeholder-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              beginCreateFile(workspace.path)
            }}
          >
            <FilePlus2 size={14} strokeWidth={1.8} />
            Nouveau fichier
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              beginCreateFolder(workspace.path)
            }}
          >
            <FolderPlus size={14} strokeWidth={1.8} />
            Nouveau dossier
          </button>
        </div>
      </div>
    )
  }

  const openContextMenu = (event: MouseEvent, node: FileTreeNode | null): void => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      node
    })
  }

  const targetParentPath = contextMenu?.node
    ? contextMenu.node.isDirectory
      ? contextMenu.node.path
      : parentDirectoryOf(contextMenu.node.path)
    : workspace.path

  const runAction = (action: () => void): void => {
    setContextMenu(null)
    action()
  }

  return (
    <div
      className="file-tree"
      role="tree"
      aria-label="Explorateur de fichiers"
      onContextMenu={(event) => {
        openContextMenu(event, null)
      }}
    >
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          onContextMenu={(event, target) => {
            openContextMenu(event, target)
          }}
        />
      ))}
      {treeLoading ? (
        <div className="tree-root-loading" aria-live="polite">
          <LoaderCircle size={12} className="spin" />
          <span>Actualisation…</span>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          ref={menuRef}
          className="tree-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => {
            event.preventDefault()
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="context-menu-item"
            onClick={() => {
              runAction(() => {
                beginCreateFile(targetParentPath)
              })
            }}
          >
            <FilePlus2 size={14} strokeWidth={1.8} />
            Nouveau fichier
          </button>
          <button
            type="button"
            role="menuitem"
            className="context-menu-item"
            onClick={() => {
              runAction(() => {
                beginCreateFolder(targetParentPath)
              })
            }}
          >
            <FolderPlus size={14} strokeWidth={1.8} />
            Nouveau dossier
          </button>

          {contextMenu.node ? (
            <>
              <div className="context-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                onClick={() => {
                  const node = contextMenu.node
                  if (!node) {
                    return
                  }
                  runAction(() => {
                    beginRename(node.path)
                  })
                }}
              >
                <Pencil size={14} strokeWidth={1.8} />
                Renommer
              </button>
              <button
                type="button"
                role="menuitem"
                className="context-menu-item is-danger"
                onClick={() => {
                  const node = contextMenu.node
                  if (!node) {
                    return
                  }
                  runAction(() => {
                    void deleteEntry(node.path)
                  })
                }}
              >
                <Trash2 size={14} strokeWidth={1.8} />
                Supprimer
              </button>
              <div className="context-menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                className="context-menu-item"
                onClick={() => {
                  const node = contextMenu.node
                  if (!node) {
                    return
                  }
                  runAction(() => {
                    void window.electronAPI.workspace.reveal(node.path).catch((error) => {
                      useEditorStore.setState({ error: getErrorMessage(error) })
                    })
                  })
                }}
              >
                <FolderOpen size={14} strokeWidth={1.8} />
                Révéler dans le gestionnaire
              </button>
            </>
          ) : null}

          <div className="context-menu-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="context-menu-item"
            onClick={() => {
              runAction(() => {
                void refreshWorkspace()
              })
            }}
          >
            <LoaderCircle size={14} strokeWidth={1.8} />
            Actualiser
          </button>
        </div>
      ) : null}
    </div>
  )
}
