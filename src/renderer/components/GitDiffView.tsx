import { FileCode2, LoaderCircle, X } from 'lucide-react'
import * as monaco from 'monaco-editor'
import { useEffect, useRef } from 'react'
import type { GitDiffData } from '../../preload'
import { useEditorStore } from '../store/editorStore'

function languageForFile(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop()?.toLocaleLowerCase() ?? ''
  const extension = name.includes('.') ? `.${name.split('.').pop()}` : ''

  for (const language of monaco.languages.getLanguages()) {
    if (language.filenames?.some((filename) => filename.toLocaleLowerCase() === name)) {
      return language.id
    }
    if (language.extensions?.some((candidate) => candidate.toLocaleLowerCase() === extension)) {
      return language.id
    }
  }
  return 'plaintext'
}

function DiffEditor({
  diff,
  fontSize
}: {
  diff: GitDiffData
  fontSize: number
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || diff.isBinary) {
      return
    }

    const language = languageForFile(diff.path)
    const originalModel = monaco.editor.createModel(
      diff.original,
      language,
      monaco.Uri.from({
        scheme: 'cami-diff-original',
        path: diff.path
      })
    )
    const modifiedModel = monaco.editor.createModel(
      diff.modified,
      language,
      monaco.Uri.from({
        scheme: 'cami-diff-modified',
        path: diff.path
      })
    )
    const editor = monaco.editor.createDiffEditor(container, {
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      fontFamily:
        '"SFMono-Regular", "Cascadia Code", "Liberation Mono", Menlo, Consolas, monospace',
      fontSize,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: false,
      theme: 'cami-dark',
      diffWordWrap: 'on',
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      useInlineViewWhenSpaceIsLimited: true
    })
    editor.setModel({
      original: originalModel,
      modified: modifiedModel
    })

    return () => {
      editor.dispose()
      originalModel.dispose()
      modifiedModel.dispose()
    }
  }, [diff, fontSize])

  if (diff.isBinary) {
    return (
      <div className="git-diff-binary">
        <FileCode2 size={24} strokeWidth={1.4} />
        <p>Ce fichier est binaire. Le diff textuel n’est pas disponible.</p>
      </div>
    )
  }

  return <div ref={containerRef} className="git-diff-editor" />
}

export function GitDiffView(): React.JSX.Element | null {
  const diff = useEditorStore((state) => state.gitDiff)
  const loading = useEditorStore((state) => state.gitDiffLoading)
  const close = useEditorStore((state) => state.closeGitDiff)
  const fontSize = useEditorStore((state) => state.settings.fontSize)

  useEffect(() => {
    if (!diff && !loading) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [close, diff, loading])

  if (!diff && !loading) {
    return null
  }

  return (
    <div
      className="git-diff-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close()
        }
      }}
    >
      <section className="git-diff-dialog" role="dialog" aria-modal="true" aria-label="Diff Git">
        <header className="git-diff-header">
          <div className="git-diff-title">
            <FileCode2 size={15} strokeWidth={1.9} />
            <span>{diff?.relativePath ?? 'Chargement du diff…'}</span>
            {diff ? (
              <span className={`git-diff-badge${diff.staged ? ' is-staged' : ''}`}>
                {diff.staged ? 'Indexé' : 'Non indexé'}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="icon-button"
            title="Fermer le diff"
            aria-label="Fermer le diff"
            onClick={close}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </header>
        <div className="git-diff-body">
          {loading ? (
            <div className="git-diff-loading">
              <LoaderCircle size={18} className="spin" strokeWidth={2} />
              Calcul du diff…
            </div>
          ) : diff ? (
            <DiffEditor diff={diff} fontSize={fontSize} />
          ) : null}
        </div>
      </section>
    </div>
  )
}
