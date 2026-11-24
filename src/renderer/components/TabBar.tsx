import { X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  useEditorStore,
  type EditorPane,
  type OpenFile
} from '../store/editorStore'
import { LanguageIcon } from './LanguageIcon'

interface TabBarProps {
  pane: EditorPane
}

export function TabBar({ pane }: TabBarProps): React.JSX.Element {
  const openFiles = useEditorStore((state) => state.openFiles)
  const activeFilePath = useEditorStore((state) =>
    pane === 'secondary' ? state.secondaryFilePath : state.activeFilePath
  )
  const activateFileInPane = useEditorStore((state) => state.activateFileInPane)
  const closeFile = useEditorStore((state) => state.closeFile)
  const closeAllFiles = useEditorStore((state) => state.closeAllFiles)
  const reorderOpenFiles = useEditorStore((state) => state.reorderOpenFiles)
  const [draggingPath, setDraggingPath] = useState<string | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const tabElements = useRef(new Map<string, HTMLDivElement>())
  const activeTabElement = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    activeTabElement.current?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth'
    })
  }, [activeFilePath])

  const handleClose = (event: React.MouseEvent, file: OpenFile): void => {
    event.preventDefault()
    event.stopPropagation()
    void closeFile(file.path)
  }

  const focusTabAt = (index: number): void => {
    const target = openFiles[index]
    if (!target) {
      return
    }

    activateFileInPane(target.path, pane)
    window.requestAnimationFrame(() => {
      tabElements.current.get(target.path)?.focus()
    })
  }

  const handleKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    file: OpenFile,
    index: number
  ): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activateFileInPane(file.path, pane)
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusTabAt((index - 1 + openFiles.length) % openFiles.length)
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusTabAt((index + 1) % openFiles.length)
      return
    }

    if (event.key === 'Delete' && event.shiftKey) {
      event.preventDefault()
      void closeFile(file.path)
    }
  }

  if (openFiles.length === 0) {
    return (
      <div className="tabbar tabbar-empty">
        <span>Aucun fichier ouvert</span>
      </div>
    )
  }

  return (
    <div className="tabbar">
      <div
        className="tabbar-scroll"
        role="tablist"
        aria-label={pane === 'secondary' ? 'Fichiers ouverts — secondaire' : 'Fichiers ouverts'}
      >
        {openFiles.map((file, index) => {
          const isActive = activeFilePath === file.path
          const isDragging = draggingPath === file.path
          const isDropTarget = dropTargetPath === file.path && draggingPath !== file.path

          return (
            <div
              key={file.path}
              ref={(element) => {
                if (element) {
                  tabElements.current.set(file.path, element)
                  if (isActive) {
                    activeTabElement.current = element
                  }
                } else {
                  tabElements.current.delete(file.path)
                }
              }}
              className={`editor-tab${isActive ? ' is-active' : ''}${file.isDirty ? ' is-dirty' : ''}${isDragging ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
              role="tab"
              aria-selected={isActive}
              aria-label={`${file.name}${file.isDirty ? ', modifié' : ''}`}
              title={`${file.path}${file.isDirty ? ' — Modifié' : ''}`}
              tabIndex={isActive ? 0 : -1}
              draggable
              onClick={() => {
                activateFileInPane(file.path, pane)
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault()
                  void closeFile(file.path)
                }
              }}
              onKeyDown={(event) => {
                handleKeyDown(event, file, index)
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', file.path)
                setDraggingPath(file.path)
                setDropTargetPath(null)
              }}
              onDragOver={(event) => {
                if (!draggingPath || draggingPath === file.path) {
                  return
                }

                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDropTargetPath(file.path)
              }}
              onDragLeave={() => {
                setDropTargetPath((current) => (current === file.path ? null : current))
              }}
              onDrop={(event) => {
                event.preventDefault()
                const sourcePath = event.dataTransfer.getData('text/plain') || draggingPath
                if (sourcePath && sourcePath !== file.path) {
                  reorderOpenFiles(sourcePath, file.path)
                }
                setDraggingPath(null)
                setDropTargetPath(null)
              }}
              onDragEnd={() => {
                setDraggingPath(null)
                setDropTargetPath(null)
              }}
            >
              <span className="tab-file-icon" aria-hidden="true">
                <LanguageIcon filePath={file.path} size={15} />
              </span>
              <span className="tab-label">{file.name}</span>
              <span className="tab-dirty-indicator" aria-hidden="true" />
              <button
                type="button"
                className="tab-close"
                title={`Fermer ${file.name}`}
                aria-label={`Fermer ${file.name}`}
                onClick={(event) => {
                  handleClose(event, file)
                }}
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          )
        })}
      </div>
      {openFiles.length > 1 ? (
        <button
          type="button"
          className="tabbar-action"
          title="Fermer tous les onglets"
          aria-label="Fermer tous les onglets"
          onClick={() => {
            void closeAllFiles()
          }}
        >
          <X size={14} strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  )
}
