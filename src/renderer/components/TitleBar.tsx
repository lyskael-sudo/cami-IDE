import { Copy, Minus, Square, X } from 'lucide-react'
import { useEffect, useState, type MouseEvent } from 'react'
import { useEditorStore } from '../store/editorStore'

export function TitleBar(): React.JSX.Element {
  const platform = window.electronAPI.platform
  const workspaceName = useEditorStore((state) => state.workspace?.name ?? null)
  const activeFilePath = useEditorStore((state) =>
    state.splitOpen && state.activePane === 'secondary'
      ? state.secondaryFilePath
      : state.activeFilePath
  )
  const activeFileName = useEditorStore(
    (state) => state.openFiles.find((file) => file.path === activeFilePath)?.name ?? null
  )
  const activeFileIsDirty = useEditorStore(
    (state) =>
      state.openFiles.find((file) => file.path === activeFilePath)?.isDirty ?? false
  )
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let active = true

    void window.electronAPI.window
      .isMaximized()
      .then((maximized) => {
        if (active) {
          setIsMaximized(maximized)
        }
      })
      .catch(() => {
        // The initial state is cosmetic; a failed query must not block the UI.
      })

    const unsubscribe = window.electronAPI.window.onMaximizedChange((maximized) => {
      setIsMaximized(maximized)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const toggleMaximize = async (): Promise<void> => {
    try {
      const maximized = await window.electronAPI.window.toggleMaximize()
      setIsMaximized(maximized)
    } catch {
      // Window controls are best-effort and must never crash the renderer.
    }
  }

  const handleTitleBarDoubleClick = (event: MouseEvent<HTMLElement>): void => {
    if ((event.target as HTMLElement).closest('button')) {
      return
    }

    void toggleMaximize()
  }

  return (
    <header
      className="titlebar"
      data-platform={platform}
      onDoubleClick={handleTitleBarDoubleClick}
    >
      <div className="titlebar-brand" aria-label="Cami">
        <span className="brand-mark" aria-hidden="true">
          C
        </span>
        <span className="brand-name">Cami</span>
      </div>

      <div className="titlebar-document" title={activeFileName ?? workspaceName ?? 'Cami'}>
        {workspaceName ? <span className="titlebar-workspace">{workspaceName}</span> : null}
        {workspaceName && activeFileName ? (
          <span className="titlebar-separator" aria-hidden="true">
            /
          </span>
        ) : null}
        {activeFileName ? (
          <span className="titlebar-file">
            {activeFileName}
            {activeFileIsDirty ? (
              <span className="titlebar-dirty-dot" title="Fichier modifié" />
            ) : null}
          </span>
        ) : !workspaceName ? (
          <span className="titlebar-tagline">Éditeur de code</span>
        ) : null}
      </div>

      <div className="window-controls" aria-label="Contrôles de fenêtre">
        <button
          type="button"
          className="window-control"
          aria-label="Réduire la fenêtre"
          title="Réduire"
          onClick={() => {
            void window.electronAPI.window.minimize()
          }}
        >
          <Minus size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="window-control"
          aria-label={isMaximized ? 'Restaurer la fenêtre' : 'Agrandir la fenêtre'}
          title={isMaximized ? 'Restaurer' : 'Agrandir'}
          onClick={() => {
            void toggleMaximize()
          }}
        >
          {isMaximized ? (
            <Copy size={13} strokeWidth={1.7} />
          ) : (
            <Square size={12} strokeWidth={1.7} />
          )}
        </button>
        <button
          type="button"
          className="window-control window-control-close"
          aria-label="Fermer la fenêtre"
          title="Fermer"
          onClick={() => {
            void window.electronAPI.window.close()
          }}
        >
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  )
}
