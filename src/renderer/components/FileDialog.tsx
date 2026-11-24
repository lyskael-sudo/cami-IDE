import { FilePlus2, FolderPlus, LoaderCircle, Pencil, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'

export function FileDialog(): React.JSX.Element | null {
  const fileDialog = useEditorStore((state) => state.fileDialog)
  const closeFileDialog = useEditorStore((state) => state.closeFileDialog)
  const updateFileDialogValue = useEditorStore((state) => state.updateFileDialogValue)
  const submitFileDialog = useEditorStore((state) => state.submitFileDialog)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!fileDialog) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [fileDialog?.mode, fileDialog?.targetPath])

  if (!fileDialog) {
    return null
  }

  const isRename = fileDialog.mode === 'rename'
  const isFolder = fileDialog.mode === 'create-folder'
  const title = isRename
    ? 'Renommer'
    : isFolder
      ? 'Nouveau dossier'
      : 'Nouveau fichier'
  const label = isRename ? 'Nouveau nom' : isFolder ? 'Nom du dossier' : 'Nom du fichier'
  const submitLabel = isRename ? 'Renommer' : 'Créer'
  const Icon = isRename ? Pencil : isFolder ? FolderPlus : FilePlus2
  const location = fileDialog.targetPath ?? fileDialog.parentPath

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeFileDialog()
        }
      }}
    >
      <form
        className="file-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-dialog-title"
        onSubmit={(event) => {
          event.preventDefault()
          void submitFileDialog()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeFileDialog()
          }
        }}
      >
        <div className="file-dialog-header">
          <div className="file-dialog-title">
            <span className="file-dialog-icon" aria-hidden="true">
              <Icon size={16} strokeWidth={1.9} />
            </span>
            <h2 id="file-dialog-title">{title}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            title="Fermer"
            aria-label="Fermer"
            disabled={fileDialog.isSubmitting}
            onClick={closeFileDialog}
          >
            <X size={15} strokeWidth={1.9} />
          </button>
        </div>

        <p className="file-dialog-location" title={location}>
          {location}
        </p>

        <label className="file-dialog-label" htmlFor="file-dialog-input">
          {label}
        </label>
        <input
          ref={inputRef}
          id="file-dialog-input"
          className={`file-dialog-input${fileDialog.error ? ' has-error' : ''}`}
          value={fileDialog.value}
          placeholder={isFolder ? 'mon-dossier' : 'mon-fichier.ts'}
          autoComplete="off"
          spellCheck={false}
          disabled={fileDialog.isSubmitting}
          onChange={(event) => {
            updateFileDialogValue(event.target.value)
          }}
        />

        {fileDialog.error ? (
          <p className="file-dialog-error" role="alert">
            {fileDialog.error}
          </p>
        ) : null}

        <div className="file-dialog-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={fileDialog.isSubmitting}
            onClick={closeFileDialog}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={fileDialog.isSubmitting || fileDialog.value.trim().length === 0}
          >
            {fileDialog.isSubmitting ? (
              <LoaderCircle size={14} className="spin" strokeWidth={2} />
            ) : null}
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
