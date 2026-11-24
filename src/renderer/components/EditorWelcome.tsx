import { FolderOpen, Keyboard } from 'lucide-react'
import { useEditorStore } from '../store/editorStore'

export function EditorWelcome(): React.JSX.Element {
  const workspace = useEditorStore((state) => state.workspace)
  const openWorkspace = useEditorStore((state) => state.openWorkspace)
  const setSidebarView = useEditorStore((state) => state.setSidebarView)
  const openCommandPalette = useEditorStore((state) => state.openCommandPalette)
  const modifierKey = window.electronAPI.platform === 'darwin' ? '⌘' : 'Ctrl'

  return (
    <div className="editor-welcome">
      <div className="welcome-mark" aria-hidden="true">
        <span>C</span>
      </div>
      <p className="welcome-kicker">ÉDITEUR DE CODE</p>
      <h1>Cami</h1>
      <p className="welcome-description">
        Un espace de travail net, rapide et concentré sur votre code.
      </p>

      {workspace ? (
        <div className="welcome-workspace">
          <span>Espace de travail</span>
          <strong>{workspace.name}</strong>
          <p>Sélectionnez un fichier dans l’explorateur pour commencer.</p>
          <div className="welcome-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setSidebarView('explorer')
              }}
            >
              Parcourir les fichiers
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                openCommandPalette('files')
              }}
            >
              Ouvrir rapidement
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="primary-button welcome-open-button"
          onClick={() => {
            void openWorkspace()
          }}
        >
          <FolderOpen size={16} strokeWidth={1.9} />
          Ouvrir un dossier
        </button>
      )}

      <div className="welcome-shortcuts" aria-label="Raccourcis utiles">
        <div className="welcome-shortcut">
          <span>Ouvrir rapidement</span>
          <kbd>{modifierKey}+P</kbd>
        </div>
        <div className="welcome-shortcut">
          <span>Palette de commandes</span>
          <kbd>{modifierKey}+Shift+P</kbd>
        </div>
        <div className="welcome-shortcut">
          <span>Enregistrer</span>
          <kbd>{modifierKey}+S</kbd>
        </div>
        <div className="welcome-shortcut">
          <span>Terminal</span>
          <kbd>{modifierKey}+`</kbd>
        </div>
      </div>

      <p className="welcome-hint">
        <Keyboard size={13} strokeWidth={1.8} />
        Astuce : Ctrl+Maj+P ouvre toutes les commandes de Cami.
      </p>
    </div>
  )
}
