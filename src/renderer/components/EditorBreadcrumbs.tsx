import { ChevronRight, FileCode2 } from 'lucide-react'
import { useMemo } from 'react'
import type { LspDocumentSymbol } from '../../preload'
import { useEditorStore } from '../store/editorStore'
import { useLanguageStore } from '../store/languageStore'

const EMPTY_SYMBOLS: LspDocumentSymbol[] = []

function findSymbolChain(
  symbols: LspDocumentSymbol[],
  line: number,
  character: number,
  chain: LspDocumentSymbol[] = []
): LspDocumentSymbol[] {
  for (const symbol of symbols) {
    const { start, end } = symbol.range
    const startsBefore =
      start.line < line || (start.line === line && start.character <= character)
    const endsAfter =
      end.line > line || (end.line === line && end.character >= character)
    if (startsBefore && endsAfter) {
      const next = [...chain, symbol]
      const child = findSymbolChain(symbol.children, line, character, next)
      return child.length > next.length ? child : next
    }
  }
  return chain
}

export function EditorBreadcrumbs({
  filePath
}: {
  filePath: string
}): React.JSX.Element | null {
  const file = useEditorStore((state) =>
    state.openFiles.find((entry) => entry.path === filePath)
  )
  const cursor = useEditorStore((state) => state.cursor)
  const symbols = useLanguageStore((state) => state.symbols[filePath] ?? EMPTY_SYMBOLS)
  const openFile = useEditorStore((state) => state.openFile)

  const chain = useMemo(
    () => findSymbolChain(symbols, Math.max(0, cursor.line - 1), Math.max(0, cursor.column - 1)),
    [cursor.column, cursor.line, symbols]
  )

  if (!file) {
    return null
  }

  return (
    <nav className="editor-breadcrumbs" aria-label="Fil d’Ariane">
      <span className="breadcrumb-file" title={file.path}>
        <FileCode2 size={12} strokeWidth={1.9} />
        <span>{file.name}</span>
      </span>
      {chain.map((symbol, index) => (
        <span className="breadcrumb-segment" key={`${symbol.name}:${index}`}>
          <ChevronRight size={11} strokeWidth={2} className="breadcrumb-chevron" />
          <button
            type="button"
            className={`breadcrumb-symbol is-kind-${symbol.kind}`}
            title={symbol.detail ? `${symbol.name} — ${symbol.detail}` : symbol.name}
            onClick={() => {
              void openFile(
                filePath,
                symbol.selectionRange.start.line + 1,
                symbol.selectionRange.start.character + 1
              )
            }}
          >
            {symbol.name}
          </button>
        </span>
      ))}
      <span className="breadcrumb-position">
        Ln {cursor.line}, Col {cursor.column}
      </span>
    </nav>
  )
}
