import type { LspDocumentSymbol, LspPosition, LspRange } from '../../preload'

interface SymbolPattern {
  regex: RegExp
  kind: number
  nameGroup: number
  detailGroup?: number
  topLevelOnly?: boolean
  indentBased?: boolean
}

interface RawSymbol {
  name: string
  detail: string | null
  kind: number
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  indent: number
  level: number
}

const KIND = {
  file: 1,
  module: 2,
  namespace: 3,
  package: 4,
  class: 5,
  method: 6,
  property: 7,
  field: 8,
  constructor: 9,
  enum: 10,
  interface: 11,
  function: 12,
  variable: 13,
  constant: 14,
  string: 15,
  number: 16,
  boolean: 17,
  array: 18,
  object: 19,
  key: 20,
  null: 21,
  enumMember: 22,
  struct: 23,
  event: 24,
  operator: 25,
  typeParameter: 26
} as const

const COMMON_CONTROL_WORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'new',
  'typeof',
  'await',
  'with',
  'do',
  'else',
  'try',
  'throw',
  'case',
  'delete',
  'void',
  'yield'
])

const JAVASCRIPT_PATTERNS: SymbolPattern[] = [
  {
    regex:
      /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(class|interface|enum|type|namespace|module)\s+([A-Za-z_$][\w$]*)/,
    kind: KIND.class,
    nameGroup: 2,
    detailGroup: 1
  },
  {
    regex:
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
    kind: KIND.function,
    nameGroup: 1
  },
  {
    regex:
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
    kind: KIND.function,
    nameGroup: 1
  },
  {
    regex:
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/,
    kind: KIND.variable,
    nameGroup: 1,
    topLevelOnly: true
  },
  {
    regex:
      /^\s+((?:(?:public|private|protected|static|async|readonly|abstract|get|set|override|declare)\s+)*)(?:#?([A-Za-z_$][\w$]*))\s*(?:<[^>]*>)?\s*\([^;{}]*\)\s*(?::[^={]+)?\s*\{?/,
    kind: KIND.method,
    nameGroup: 2
  }
]

const PYTHON_PATTERNS: SymbolPattern[] = [
  {
    regex: /^(\s*)(?:async\s+)?(class|def)\s+([A-Za-z_]\w*)/,
    kind: KIND.function,
    nameGroup: 3,
    detailGroup: 2,
    indentBased: true
  }
]

const RUST_PATTERNS: SymbolPattern[] = [
  {
    regex:
      /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(fn|struct|enum|trait|impl|mod|const|static|type|union|macro_rules!)\s+([A-Za-z_]\w*)/,
    kind: KIND.function,
    nameGroup: 2,
    detailGroup: 1
  }
]

const GO_PATTERNS: SymbolPattern[] = [
  {
    regex: /^\s*(func|type|var|const)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/,
    kind: KIND.function,
    nameGroup: 2,
    detailGroup: 1
  }
]

const C_LIKE_PATTERNS: SymbolPattern[] = [
  {
    regex:
      /^\s*(?:(?:public|private|protected|static|final|abstract|sealed|open|internal|data|partial|export)\s+)*(class|interface|enum|record|object|struct|namespace|trait)\s+([A-Za-z_]\w*)/,
    kind: KIND.class,
    nameGroup: 2,
    detailGroup: 1
  },
  {
    regex:
      /^\s+(?:(?:public|private|protected|static|final|synchronized|abstract|override|async|virtual|internal|inline|constexpr|extern|unsigned|signed|volatile|explicit)\s+)+[\w:<>\[\],.?*&]+\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const|noexcept|override)?\s*\{?/,
    kind: KIND.method,
    nameGroup: 1
  },
  {
    regex: /^\s*(?:typedef\s+)?(?:struct|union)\s+([A-Za-z_]\w*)\s*\{/,
    kind: KIND.struct,
    nameGroup: 1
  },
  {
    regex: /^\s*(?:typedef\s+)?enum\s+(?:class\s+)?([A-Za-z_]\w*)/,
    kind: KIND.enum,
    nameGroup: 1
  }
]

const RUBY_PATTERNS: SymbolPattern[] = [
  {
    regex: /^\s*(class|module|def)\s+([A-Za-z_]\w*[!?=]?)/,
    kind: KIND.function,
    nameGroup: 2,
    detailGroup: 1,
    indentBased: true
  }
]

const PHP_PATTERNS: SymbolPattern[] = [
  {
    regex:
      /^\s*(?:(?:abstract|final|public|private|protected|static)\s+)*(class|interface|trait|function)\s+([A-Za-z_]\w*)/,
    kind: KIND.function,
    nameGroup: 2,
    detailGroup: 1
  }
]

const SHELL_PATTERNS: SymbolPattern[] = [
  {
    regex: /^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)\s*\{?/,
    kind: KIND.function,
    nameGroup: 1
  }
]

const LUA_PATTERNS: SymbolPattern[] = [
  {
    regex: /^\s*(?:local\s+)?function\s+([A-Za-z_][\w.:]*)/,
    kind: KIND.function,
    nameGroup: 1
  }
]

const YAML_PATTERNS: SymbolPattern[] = [
  {
    regex: /^([A-Za-z_][\w-]*)\s*:/,
    kind: KIND.property,
    nameGroup: 1
  }
]

const SQL_PATTERNS: SymbolPattern[] = [
  {
    regex:
      /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(TABLE|VIEW|FUNCTION|PROCEDURE|SCHEMA|INDEX|TRIGGER)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w.$]*)/i,
    kind: KIND.class,
    nameGroup: 2,
    detailGroup: 1
  }
]

const CSS_PATTERNS: SymbolPattern[] = [
  {
    regex: /^\s*([.#][A-Za-z_][\w-]*|@[A-Za-z-]+)\s*(?:[^{]*)\{/,
    kind: KIND.class,
    nameGroup: 1
  }
]

const MARKDOWN_PATTERNS: SymbolPattern[] = [
  {
    regex: /^(#{1,6})\s+(.+?)\s*#*\s*$/,
    kind: KIND.namespace,
    nameGroup: 2,
    detailGroup: 1,
    indentBased: true
  }
]

function patternsForLanguage(language: string): SymbolPattern[] {
  const normalized = language.toLocaleLowerCase()
  if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(normalized)) {
    return JAVASCRIPT_PATTERNS
  }
  if (normalized === 'python') {
    return PYTHON_PATTERNS
  }
  if (normalized === 'rust') {
    return RUST_PATTERNS
  }
  if (normalized === 'go') {
    return GO_PATTERNS
  }
  if (
    [
      'java',
      'kotlin',
      'csharp',
      'c',
      'cpp',
      'objective-c',
      'objective-cpp',
      'swift',
      'scala'
    ].includes(normalized)
  ) {
    return C_LIKE_PATTERNS
  }
  if (normalized === 'ruby') {
    return RUBY_PATTERNS
  }
  if (normalized === 'php') {
    return PHP_PATTERNS
  }
  if (['shell', 'bash', 'sh', 'zsh', 'fish'].includes(normalized)) {
    return SHELL_PATTERNS
  }
  if (normalized === 'lua') {
    return LUA_PATTERNS
  }
  if (['yaml', 'yml'].includes(normalized)) {
    return YAML_PATTERNS
  }
  if (normalized === 'sql') {
    return SQL_PATTERNS
  }
  if (['css', 'scss', 'less'].includes(normalized)) {
    return CSS_PATTERNS
  }
  if (normalized === 'markdown') {
    return MARKDOWN_PATTERNS
  }
  return []
}

function countIndent(line: string): number {
  let width = 0
  for (const character of line) {
    if (character === ' ') {
      width += 1
    } else if (character === '\t') {
      width += 4
    } else {
      break
    }
  }
  return width
}

function stripLineNoise(line: string): string {
  let result = ''
  let quote: string | null = null
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? ''
    if (quote) {
      result += ' '
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character
      result += ' '
      continue
    }
    if (character === '/' && line[index + 1] === '/') {
      break
    }
    result += character
  }
  return result
}

function findBraceEnd(
  lines: string[],
  startLine: number,
  startIndex: number,
  maximumLines: number
): { line: number; column: number } | null {
  let depth = 0
  let foundOpening = false
  let inBlockComment = false

  for (let lineIndex = startLine; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? ''
    const from = lineIndex === startLine ? startIndex : 0
    let quote: string | null = null
    let escaped = false

    for (let column = from; column < line.length; column += 1) {
      const character = line[column] ?? ''
      const next = line[column + 1] ?? ''

      if (inBlockComment) {
        if (character === '*' && next === '/') {
          inBlockComment = false
          column += 1
        }
        continue
      }
      if (quote) {
        if (escaped) {
          escaped = false
        } else if (character === '\\') {
          escaped = true
        } else if (character === quote) {
          quote = null
        }
        continue
      }
      if (character === '/' && next === '*') {
        inBlockComment = true
        column += 1
        continue
      }
      if (character === '/' && next === '/') {
        break
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character
        continue
      }
      if (character === '{') {
        foundOpening = true
        depth += 1
        continue
      }
      if (character === '}' && foundOpening) {
        depth -= 1
        if (depth === 0) {
          return {
            line: lineIndex,
            column: Math.max(0, column)
          }
        }
      }
    }

    if (foundOpening && depth === 0) {
      return { line: lineIndex, column: Math.max(0, line.length - 1) }
    }
    if (lineIndex - startLine > maximumLines) {
      break
    }
  }

  return foundOpening ? { line: Math.min(lines.length - 1, startLine + maximumLines), column: 0 } : null
}

function isLikelyMethod(line: string, name: string): boolean {
  if (COMMON_CONTROL_WORDS.has(name)) {
    return false
  }
  const trimmed = line.trim()
  if (!trimmed.includes('(')) {
    return false
  }
  if (trimmed.endsWith(';') || trimmed.endsWith(',')) {
    return false
  }
  return trimmed.includes('{') || trimmed.endsWith(')') || trimmed.endsWith(') {')
}

function collectRawSymbols(
  lines: string[],
  language: string,
  patterns: SymbolPattern[]
): RawSymbol[] {
  const raw: RawSymbol[] = []
  const maximum = Math.min(lines.length, 50_000)
  const indentLanguage = patterns.some((pattern) => pattern.indentBased)

  for (let lineIndex = 0; lineIndex < maximum; lineIndex += 1) {
    const line = lines[lineIndex] ?? ''
    if (!line.trim() || line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) {
      continue
    }

    for (const pattern of patterns) {
      const match = pattern.regex.exec(line)
      if (!match) {
        continue
      }
      const name = match[pattern.nameGroup]?.trim()
      if (!name) {
        continue
      }
      if (pattern.kind === KIND.method && !isLikelyMethod(line, name)) {
        continue
      }
      const indent = countIndent(line)
      if (pattern.topLevelOnly && indent > 0) {
        continue
      }

      const nameIndex = line.indexOf(name, match.index)
      const detail = pattern.detailGroup
        ? (match[pattern.detailGroup]?.trim() ?? null)
        : null
      const level =
        language === 'markdown'
          ? (match[1]?.length ?? 1)
          : indentLanguage
            ? indent
            : 0

      raw.push({
        name: name.slice(0, 512),
        detail: detail ? detail.slice(0, 512) : null,
        kind:
          pattern.kind === KIND.function
            ? language === 'python'
              ? detail === 'class'
                ? KIND.class
                : KIND.function
              : detail && /^(class|interface|enum|struct|trait|record|object)$/i.test(detail)
                ? KIND.class
                : pattern.kind
            : pattern.kind,
        startLine: lineIndex,
        startColumn: Math.max(0, nameIndex >= 0 ? nameIndex : 0),
        endLine: lineIndex,
        endColumn: Math.max(0, line.length),
        indent,
        level
      })
      break
    }
  }

  if (indentLanguage) {
    for (let index = 0; index < raw.length; index += 1) {
      const current = raw[index]
      if (!current) {
        continue
      }
      let endLine = lines.length - 1
      for (let next = index + 1; next < raw.length; next += 1) {
        const candidate = raw[next]
        if (!candidate) {
          continue
        }
        if (
          language === 'markdown'
            ? candidate.level <= current.level
            : candidate.indent <= current.indent
        ) {
          endLine = Math.max(current.startLine, candidate.startLine - 1)
          break
        }
      }
      if (language === 'markdown') {
        while (endLine > current.startLine && !(lines[endLine] ?? '').trim()) {
          endLine -= 1
        }
      }
      current.endLine = endLine
      current.endColumn =
        endLine === current.startLine
          ? (lines[current.startLine]?.length ?? current.endColumn)
          : (lines[endLine]?.length ?? 0)
    }
  } else {
    for (const symbol of raw) {
      const line = lines[symbol.startLine] ?? ''
      const body = findBraceEnd(
        lines,
        symbol.startLine,
        symbol.startColumn + symbol.name.length,
        2_000
      )
      if (body) {
        symbol.endLine = body.line
        symbol.endColumn = body.column
      } else {
        const trimmed = stripLineNoise(line).trimEnd()
        if (trimmed.endsWith(';')) {
          symbol.endLine = symbol.startLine
          symbol.endColumn = Math.max(symbol.startColumn, line.length)
        }
      }
    }
  }

  return raw
}

function rangeFor(symbol: RawSymbol): LspRange {
  return {
    start: { line: symbol.startLine, character: symbol.startColumn },
    end: { line: symbol.endLine, character: symbol.endColumn }
  }
}

function contains(outer: RawSymbol, inner: RawSymbol): boolean {
  if (outer === inner || outer.startLine > inner.startLine) {
    return false
  }
  if (outer.endLine < inner.endLine) {
    return false
  }
  if (outer.startLine === inner.startLine && outer.startColumn > inner.startColumn) {
    return false
  }
  if (outer.endLine === inner.endLine && outer.endColumn < inner.endColumn) {
    return false
  }
  return true
}

function buildHierarchy(raw: RawSymbol[]): LspDocumentSymbol[] {
  const sorted = [...raw].sort((left, right) => {
    if (left.startLine !== right.startLine) {
      return left.startLine - right.startLine
    }
    if (left.startColumn !== right.startColumn) {
      return left.startColumn - right.startColumn
    }
    if (left.endLine !== right.endLine) {
      return right.endLine - left.endLine
    }
    return right.endColumn - left.endColumn
  })

  const roots: LspDocumentSymbol[] = []
  const stack: Array<{ raw: RawSymbol; node: LspDocumentSymbol }> = []
  const duplicateKeys = new Set<string>()

  for (const symbol of sorted) {
    const key = `${symbol.name}:${symbol.startLine}:${symbol.startColumn}:${symbol.kind}`
    if (duplicateKeys.has(key)) {
      continue
    }
    duplicateKeys.add(key)

    const node: LspDocumentSymbol = {
      name: symbol.name,
      detail: symbol.detail,
      kind: symbol.kind,
      range: rangeFor(symbol),
      selectionRange: {
        start: {
          line: symbol.startLine,
          character: symbol.startColumn
        } satisfies LspPosition,
        end: {
          line: symbol.startLine,
          character: symbol.startColumn + symbol.name.length
        } satisfies LspPosition
      },
      children: []
    }

    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      if (top && contains(top.raw, symbol)) {
        break
      }
      stack.pop()
    }

    const parent = stack[stack.length - 1]
    if (parent) {
      parent.node.children.push(node)
    } else {
      roots.push(node)
    }
    stack.push({ raw: symbol, node })
  }

  return roots
}

export function fallbackDocumentSymbols(
  content: string,
  language: string
): LspDocumentSymbol[] {
  if (!content || content.length > 8 * 1024 * 1024) {
    return []
  }
  const patterns = patternsForLanguage(language)
  if (patterns.length === 0) {
    return []
  }

  const lines = content.split(/\r?\n/)
  const raw = collectRawSymbols(lines, language.toLocaleLowerCase(), patterns)
  return buildHierarchy(raw).slice(0, 2_000)
}

export function flattenDocumentSymbols(
  symbols: LspDocumentSymbol[]
): LspDocumentSymbol[] {
  const result: LspDocumentSymbol[] = []
  const visit = (entries: LspDocumentSymbol[]): void => {
    for (const symbol of entries) {
      result.push(symbol)
      visit(symbol.children)
      if (result.length >= 5_000) {
        return
      }
    }
  }
  visit(symbols)
  return result
}
