import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  ListTree,
  LoaderCircle,
  RefreshCw
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { LspDocumentSymbol } from '../../preload'
import { documentSymbolsWithFallback } from '../lsp/languageServices'
import { useEditorStore } from '../store/editorStore'
import { useLanguageStore } from '../store/languageStore'

const EMPTY_SYMBOLS: LspDocumentSymbol[] = []

function OutlineNode({
  symbol,
  depth,
  filePath
}: {
  symbol: LspDocumentSymbol
  depth: number
  filePath: string
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)
  const openFile = useEditorStore((state) => state.openFile)
  const hasChildren = symbol.children.length > 0

  return (
    <div className="outline-node">
      <div
        className="outline-row"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        role="button"
        tabIndex={0}
        title={`${symbol.name}${symbol.detail ? ` — ${symbol.detail}` : ''}`}
        onClick={() => {
          void openFile(
            filePath,
            symbol.selectionRange.start.line + 1,
            symbol.selectionRange.start.character + 1
          )
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            void openFile(
              filePath,
              symbol.selectionRange.start.line + 1,
              symbol.selectionRange.start.character + 1
            )
          }
        }}
      >
        <button
          type="button"
          className="outline-toggle"
          aria-label={expanded ? 'Réduire' : 'Développer'}
          tabIndex={hasChildren ? 0 : -1}
          onClick={(event) => {
            event.stopPropagation()
            if (hasChildren) {
              setExpanded((current) => !current)
            }
          }}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown size={12} strokeWidth={2} />
            ) : (
              <ChevronRight size={12} strokeWidth={2} />
            )
          ) : (
            <span className="outline-spacer" />
          )}
        </button>
        <span className={`outline-kind is-${symbol.kind}`} aria-hidden="true" />
        <span className="outline-name">{symbol.name}</span>
        {symbol.detail ? <span className="outline-detail">{symbol.detail}</span> : null}
        <span className="outline-line">{symbol.selectionRange.start.line + 1}</span>
      </div>
      {hasChildren && expanded
        ? symbol.children.map((child, index) => (
            <OutlineNode
              key={`${child.name}:${child.selectionRange.start.line}:${index}`}
              symbol={child}
              depth={depth + 1}
              filePath={filePath}
            />
          ))
        : null}
    </div>
  )
}

export function OutlinePanel(): React.JSX.Element {
  const activeFilePath = useEditorStore((state) => state.activeFilePath)
  const activeFile = useEditorStore(
    (state) => state.openFiles.find((file) => file.path === state.activeFilePath) ?? null
  )
  const symbols = useLanguageStore((state) =>
    activeFilePath ? (state.symbols[activeFilePath] ?? EMPTY_SYMBOLS) : EMPTY_SYMBOLS
  )
  const loading = useLanguageStore((state) =>
    activeFilePath ? (state.symbolsLoading[activeFilePath] ?? false) : false
  )
  const setSymbols = useLanguageStore((state) => state.setSymbols)
  const setSymbolsLoading = useLanguageStore((state) => state.setSymbolsLoading)

  useEffect(() => {
    if (!activeFilePath || !activeFile) {
      return
    }
    if (symbols.length > 0) {
      return
    }
    let cancelled = false
    setSymbolsLoading(activeFilePath, true)
    void documentSymbolsWithFallback(activeFilePath)
      .then((result) => {
        if (!cancelled) {
          setSymbols(activeFilePath, result)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSymbols(activeFilePath, [])
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    activeFile?.path,
    activeFilePath,
    setSymbols,
    setSymbolsLoading,
    symbols.length
  ])

  const refresh = (): void => {
    if (!activeFilePath) {
      return
    }
    setSymbolsLoading(activeFilePath, true)
    void documentSymbolsWithFallback(activeFilePath)
      .then((result) => {
        setSymbols(activeFilePath, result)
      })
      .catch(() => {
        setSymbols(activeFilePath, [])
      })
  }

  return (
    <section className="sidebar-view" aria-label="Plan du fichier">
      <div className="sidebar-header">
        <span>Plan</span>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className="icon-button"
            title="Actualiser le plan"
            aria-label="Actualiser le plan"
            disabled={!activeFilePath || loading}
            onClick={refresh}
          >
            <RefreshCw size={14} strokeWidth={1.8} className={loading ? 'spin' : undefined} />
          </button>
        </div>
      </div>

      {!activeFilePath || !activeFile ? (
        <div className="sidebar-empty compact">
          <ListTree size={26} strokeWidth={1.4} />
          <h2>Aucun fichier actif</h2>
          <p>Ouvrez un fichier pour afficher ses classes, fonctions et symboles.</p>
        </div>
      ) : (
        <div className="sidebar-scroll outline-panel">
          <div className="outline-file" title={activeFilePath}>
            <FileCode2 size={13} strokeWidth={1.8} />
            <span>{activeFile.name}</span>
          </div>
          {loading && symbols.length === 0 ? (
            <div className="outline-loading">
              <LoaderCircle size={14} className="spin" strokeWidth={2} />
              Analyse du fichier…
            </div>
          ) : symbols.length === 0 ? (
            <div className="outline-empty">
              Aucun symbole détecté dans ce fichier.
            </div>
          ) : (
            symbols.map((symbol, index) => (
              <OutlineNode
                key={`${symbol.name}:${symbol.selectionRange.start.line}:${index}`}
                symbol={symbol}
                depth={0}
                filePath={activeFilePath}
              />
            ))
          )}
        </div>
      )}
    </section>
  )
}
