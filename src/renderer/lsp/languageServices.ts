import * as monaco from 'monaco-editor'
import { useEffect } from 'react'
import type {
  LspCompletionItem,
  LspDiagnostic,
  LspDocumentSymbol,
  LspRange,
  LspServerStatus,
  LspTextEdit
} from '../../preload'
import { useEditorStore, type OpenFile } from '../store/editorStore'
import { useLanguageStore } from '../store/languageStore'
import { fallbackDocumentSymbols } from './fallbackSymbols'

const MARKER_OWNER = 'cami-lsp'
const MAX_DIAGNOSTICS = 2_000
const DOCUMENT_SYNC_DELAY_MS = 220
const SYMBOL_REFRESH_DELAY_MS = 350

let installed = false
const providerLanguages = new Set<string>()
let initialStatusesRequested = false
const documentHandles = new Map<string, string>()

interface OpenDocument {
  path: string
  languageId: string
  version: number
  sentText: string
  pendingText: string
  savedAt: number
  pendingSave: boolean
}

const openDocuments = new Map<string, OpenDocument>()
const openingDocuments = new Set<string>()
const failedLanguages = new Set<string>()
const documentTimers = new Map<string, number>()

function toMonacoRange(range: LspRange): monaco.Range {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1
  )
}

function toLspPosition(position: monaco.Position): { line: number; character: number } {
  return {
    line: Math.max(0, position.lineNumber - 1),
    character: Math.max(0, position.column - 1)
  }
}

function toModelPath(model: monaco.editor.ITextModel): string | null {
  if (model.uri.scheme !== 'file') {
    return null
  }
  return model.uri.fsPath
}

function markdown(value: string): monaco.IMarkdownString {
  return { value, isTrusted: false }
}

function completionKind(kind: number): monaco.languages.CompletionItemKind {
  switch (kind) {
    case 2:
      return monaco.languages.CompletionItemKind.Method
    case 3:
      return monaco.languages.CompletionItemKind.Function
    case 4:
      return monaco.languages.CompletionItemKind.Constructor
    case 5:
      return monaco.languages.CompletionItemKind.Field
    case 6:
      return monaco.languages.CompletionItemKind.Variable
    case 7:
      return monaco.languages.CompletionItemKind.Class
    case 8:
      return monaco.languages.CompletionItemKind.Interface
    case 9:
      return monaco.languages.CompletionItemKind.Module
    case 10:
      return monaco.languages.CompletionItemKind.Property
    case 11:
      return monaco.languages.CompletionItemKind.Unit
    case 12:
      return monaco.languages.CompletionItemKind.Value
    case 13:
      return monaco.languages.CompletionItemKind.Enum
    case 14:
      return monaco.languages.CompletionItemKind.Keyword
    case 15:
      return monaco.languages.CompletionItemKind.Snippet
    case 16:
      return monaco.languages.CompletionItemKind.Color
    case 17:
      return monaco.languages.CompletionItemKind.File
    case 18:
      return monaco.languages.CompletionItemKind.Reference
    case 19:
      return monaco.languages.CompletionItemKind.Folder
    case 20:
      return monaco.languages.CompletionItemKind.EnumMember
    case 21:
      return monaco.languages.CompletionItemKind.Constant
    case 22:
      return monaco.languages.CompletionItemKind.Struct
    case 23:
      return monaco.languages.CompletionItemKind.Event
    case 24:
      return monaco.languages.CompletionItemKind.Operator
    case 25:
      return monaco.languages.CompletionItemKind.TypeParameter
    default:
      return monaco.languages.CompletionItemKind.Text
  }
}

function symbolKind(kind: number): monaco.languages.SymbolKind {
  switch (kind) {
    case 2:
      return monaco.languages.SymbolKind.Module
    case 3:
      return monaco.languages.SymbolKind.Namespace
    case 4:
      return monaco.languages.SymbolKind.Package
    case 5:
      return monaco.languages.SymbolKind.Class
    case 6:
      return monaco.languages.SymbolKind.Method
    case 7:
      return monaco.languages.SymbolKind.Property
    case 8:
      return monaco.languages.SymbolKind.Field
    case 9:
      return monaco.languages.SymbolKind.Constructor
    case 10:
      return monaco.languages.SymbolKind.Enum
    case 11:
      return monaco.languages.SymbolKind.Interface
    case 12:
      return monaco.languages.SymbolKind.Function
    case 13:
      return monaco.languages.SymbolKind.Variable
    case 14:
      return monaco.languages.SymbolKind.Constant
    case 15:
      return monaco.languages.SymbolKind.String
    case 16:
      return monaco.languages.SymbolKind.Number
    case 17:
      return monaco.languages.SymbolKind.Boolean
    case 18:
      return monaco.languages.SymbolKind.Array
    case 19:
      return monaco.languages.SymbolKind.Object
    case 20:
      return monaco.languages.SymbolKind.Key
    case 21:
      return monaco.languages.SymbolKind.Null
    case 22:
      return monaco.languages.SymbolKind.EnumMember
    case 23:
      return monaco.languages.SymbolKind.Struct
    case 24:
      return monaco.languages.SymbolKind.Event
    case 25:
      return monaco.languages.SymbolKind.Operator
    case 26:
      return monaco.languages.SymbolKind.TypeParameter
    default:
      return monaco.languages.SymbolKind.Variable
  }
}

function toMonacoDocumentSymbols(
  symbols: LspDocumentSymbol[]
): monaco.languages.DocumentSymbol[] {
  return symbols.map((symbol) => ({
    name: symbol.name,
    detail: symbol.detail ?? '',
    kind: symbolKind(symbol.kind),
    tags: [],
    range: toMonacoRange(symbol.range),
    selectionRange: toMonacoRange(symbol.selectionRange),
    children: toMonacoDocumentSymbols(symbol.children)
  }))
}

function toMonacoTextEdits(edits: LspTextEdit[]): monaco.languages.TextEdit[] {
  return edits.map((edit) => ({
    range: toMonacoRange(edit.range),
    text: edit.newText
  }))
}

function markersForDiagnostics(diagnostics: LspDiagnostic[]): monaco.editor.IMarkerData[] {
  const severityMap: Record<number, monaco.MarkerSeverity> = {
    1: monaco.MarkerSeverity.Error,
    2: monaco.MarkerSeverity.Warning,
    3: monaco.MarkerSeverity.Info,
    4: monaco.MarkerSeverity.Hint
  }

  return diagnostics.slice(0, MAX_DIAGNOSTICS).map((diagnostic) => ({
    severity: severityMap[diagnostic.severity] ?? monaco.MarkerSeverity.Info,
    message: diagnostic.message.slice(0, 16_000) || 'Diagnostic du serveur de langage.',
    source: diagnostic.source ?? 'LSP',
    code: diagnostic.code ?? undefined,
    startLineNumber: diagnostic.range.start.line + 1,
    startColumn: diagnostic.range.start.character + 1,
    endLineNumber: Math.max(
      diagnostic.range.start.line + 1,
      diagnostic.range.end.line + 1
    ),
    endColumn: Math.max(1, diagnostic.range.end.character + 1)
  }))
}

function applyDiagnostics(path: string): void {
  const model = monaco.editor.getModel(monaco.Uri.file(path))
  if (!model || model.isDisposed()) {
    return
  }
  const diagnostics = useLanguageStore.getState().diagnostics[path] ?? []
  monaco.editor.setModelMarkers(model, MARKER_OWNER, markersForDiagnostics(diagnostics))
}

function clearDiagnostics(path: string): void {
  useLanguageStore.getState().clearDiagnostics(path)
  const model = monaco.editor.getModel(monaco.Uri.file(path))
  if (model && !model.isDisposed()) {
    monaco.editor.setModelMarkers(model, MARKER_OWNER, [])
  }
}

function appendLanguageOutput(level: 'info' | 'warning' | 'error', message: string): void {
  const outputLevel = level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info'
  useEditorStore
    .getState()
    .appendOutput(outputLevel, `[Langage] ${message.slice(0, 16_000)}`)
}

function registerProvider(
  languages: string[],
  register: (language: string) => monaco.IDisposable
): void {
  for (const language of languages) {
    if (providerLanguages.has(language)) {
      continue
    }
    providerLanguages.add(language)
    documentHandles.set(`provider:${language}`, '')
    register(language)
  }
}

function installProvidersFor(server: LspServerStatus): void {
  if (server.state !== 'running' || server.languages.length === 0) {
    return
  }

  registerProvider(server.languages, (language) => {
    const hover = monaco.languages.registerHoverProvider(language, {
      async provideHover(model, position) {
        const filePath = toModelPath(model)
        if (!filePath) {
          return null
        }
        try {
          const result = await window.electronAPI.lsp.hover(filePath, toLspPosition(position))
          if (!result) {
            return null
          }
          return {
            contents: [markdown(result.contents)],
            range: result.range ? toMonacoRange(result.range) : undefined
          }
        } catch {
          return null
        }
      }
    })

    const completion = monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: ['.', ':', '/', '"', "'", '(', '<', '@', '#', '$'],
      async provideCompletionItems(model, position, context) {
        const filePath = toModelPath(model)
        if (!filePath) {
          return { suggestions: [] }
        }
        try {
          const items = await window.electronAPI.lsp.completion(
            filePath,
            toLspPosition(position),
            context.triggerCharacter ?? null
          )
          const word = model.getWordUntilPosition(position)
          const defaultRange = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          )
          const suggestions = items.slice(0, 2_000).map((item: LspCompletionItem) => {
            const textEditRange =
              item.textEdit && item.textEdit.range.start.line === item.textEdit.range.end.line
                ? toMonacoRange(item.textEdit.range)
                : defaultRange
            const completionItem: monaco.languages.CompletionItem = {
              label: item.label.slice(0, 1_000),
              kind: completionKind(item.kind),
              detail: item.detail ?? undefined,
              documentation: item.documentation
                ? markdown(item.documentation.slice(0, 32_000))
                : undefined,
              insertText: item.textEdit?.newText ?? item.insertText,
              range: textEditRange,
              sortText: item.sortText ?? undefined,
              filterText: item.filterText ?? undefined,
              additionalTextEdits:
                item.additionalTextEdits.length > 0
                  ? toMonacoTextEdits(item.additionalTextEdits)
                  : undefined
            }
            if (item.insertTextFormat === 2) {
              completionItem.insertTextRules =
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            }
            return completionItem
          })
          return {
            suggestions,
            incomplete: false,
            duration: 0
          }
        } catch {
          return { suggestions: [] }
        }
      }
    })

    const definition = monaco.languages.registerDefinitionProvider(language, {
      async provideDefinition(model, position) {
        const filePath = toModelPath(model)
        if (!filePath) {
          return null
        }
        try {
          const locations = await window.electronAPI.lsp.definition(
            filePath,
            toLspPosition(position)
          )
          if (locations.length === 0) {
            return null
          }

          const first = locations[0]
          if (!first) {
            return null
          }
          if (locations.length > 1) {
            if (locations.every((location) => location.path === filePath)) {
              return locations.map((location) => ({
                uri: model.uri,
                range: toMonacoRange(location.range)
              }))
            }
          }
          if (first.path === filePath) {
            return {
              uri: model.uri,
              range: toMonacoRange(first.range)
            }
          }

          await useEditorStore
            .getState()
            .openFile(first.path, first.range.start.line + 1, first.range.start.character + 1)
          return null
        } catch {
          return null
        }
      }
    })

    const references = monaco.languages.registerReferenceProvider(language, {
      async provideReferences(model, position) {
        const filePath = toModelPath(model)
        if (!filePath) {
          return null
        }
        try {
          const locations = await window.electronAPI.lsp.references(
            filePath,
            toLspPosition(position)
          )
          return locations.slice(0, 5_000).map((location) => ({
            uri: monaco.Uri.file(location.path),
            range: toMonacoRange(location.range)
          }))
        } catch {
          return null
        }
      }
    })

    const documentSymbols = monaco.languages.registerDocumentSymbolProvider(language, {
      async provideDocumentSymbols(model) {
        const filePath = toModelPath(model)
        if (!filePath) {
          return []
        }
        try {
          const symbols = await window.electronAPI.lsp.documentSymbols(filePath)
          if (symbols.length > 0) {
            return toMonacoDocumentSymbols(symbols)
          }
        } catch {
          // Fall through to the local extractor.
        }
        return toMonacoDocumentSymbols(
          fallbackDocumentSymbols(model.getValue(), model.getLanguageId())
        )
      }
    })

    const formatting = monaco.languages.registerDocumentFormattingEditProvider(language, {
      async provideDocumentFormattingEdits(model, options) {
        const filePath = toModelPath(model)
        if (!filePath) {
          return []
        }
        try {
          const edits = await window.electronAPI.lsp.formatting(
            filePath,
            options.tabSize,
            options.insertSpaces
          )
          return toMonacoTextEdits(edits)
        } catch (error) {
          appendLanguageOutput(
            'error',
            error instanceof Error
              ? error.message
              : 'Le formatage par le serveur de langage a échoué.'
          )
          return []
        }
      }
    })

    const rename = monaco.languages.registerRenameProvider(language, {
      async provideRenameEdits(model, position, newName) {
        const filePath = toModelPath(model)
        if (!filePath) {
          return null
        }
        try {
          const result = await window.electronAPI.lsp.rename(
            filePath,
            toLspPosition(position),
            newName
          )
          if (!result) {
            return null
          }
          return {
            edits: result.changes.flatMap((change) =>
              change.edits.map((edit) => ({
                resource: monaco.Uri.file(change.path),
                textEdit: {
                  range: toMonacoRange(edit.range),
                  text: edit.newText
                },
                versionId: undefined
              }))
            )
          }
        } catch (error) {
          return {
            edits: [],
            rejectReason:
              error instanceof Error ? error.message : 'Le renommage a été refusé.'
          }
        }
      }
    })

    const signatureHelp = monaco.languages.registerSignatureHelpProvider(language, {
      signatureHelpTriggerCharacters: ['(', ',', '<'],
      signatureHelpRetriggerCharacters: [','],
      async provideSignatureHelp(model, position) {
        const filePath = toModelPath(model)
        if (!filePath) {
          return null
        }
        try {
          const result = await window.electronAPI.lsp.signatureHelp(
            filePath,
            toLspPosition(position)
          )
          if (!result || result.signatures.length === 0) {
            return null
          }
          const activeSignature = Math.max(
            0,
            Math.min(result.activeSignature, result.signatures.length - 1)
          )
          const active = result.signatures[activeSignature]
          return {
            value: {
              signatures: result.signatures.map((signature) => ({
                label: signature.label,
                documentation: signature.documentation
                  ? markdown(signature.documentation)
                  : undefined,
                parameters: signature.parameters.map((parameter) => ({
                  label: parameter.label,
                  documentation: parameter.documentation
                    ? markdown(parameter.documentation)
                    : undefined
                })),
                activeParameter: signature.activeParameter
              })),
              activeSignature,
              activeParameter: active?.activeParameter ?? 0
            },
            dispose: () => undefined
          }
        } catch {
          return null
        }
      }
    })

    documentHandles.set(
      `providers:${language}`,
      [hover, completion, definition, references, documentSymbols, formatting, rename, signatureHelp]
        .map((disposable) => disposable)
        .join(',')
    )
    return {
      dispose: () => {
        hover.dispose()
        completion.dispose()
        definition.dispose()
        references.dispose()
        documentSymbols.dispose()
        formatting.dispose()
        rename.dispose()
        signatureHelp.dispose()
      }
    }
  })
}

export function installLanguageServices(): void {
  if (installed) {
    return
  }
  installed = true

  window.electronAPI.lsp.onStatus((event) => {
    const previous = new Map(
      useLanguageStore.getState().servers.map((server) => [server.id, server.state])
    )
    useLanguageStore.getState().setServers(event.servers)
    for (const server of event.servers) {
      installProvidersFor(server)
      if (server.state === 'running') {
        for (const language of server.languages) {
          failedLanguages.delete(language)
        }
        void openDocumentsForLanguages(new Set(server.languages))
        if (previous.get(server.id) !== 'running') {
          appendLanguageOutput('info', `${server.label} est prêt.`)
        }
      } else if (
        (server.state === 'error' || server.state === 'unavailable') &&
        previous.get(server.id) !== server.state
      ) {
        appendLanguageOutput('warning', server.message)
      }
    }
  })

  window.electronAPI.lsp.onDiagnostics((event) => {
    useLanguageStore.getState().setDiagnostics(event.path, event.diagnostics)
    applyDiagnostics(event.path)
  })

  window.electronAPI.lsp.onLog((event) => {
    appendLanguageOutput(event.level, event.message)
  })

  monaco.editor.onDidCreateModel((model) => {
    const filePath = toModelPath(model)
    if (filePath) {
      applyDiagnostics(filePath)
    }
  })

  if (!initialStatusesRequested) {
    initialStatusesRequested = true
    void window.electronAPI.lsp
      .statuses()
      .then((servers) => {
        useLanguageStore.getState().setServers(servers)
        for (const server of servers) {
          installProvidersFor(server)
        }
      })
      .catch(() => undefined)
  }
}

function canSyncDocuments(): boolean {
  return Boolean(useEditorStore.getState().workspace)
}

function currentOpenFile(filePath: string): OpenFile | null {
  return (
    useEditorStore.getState().openFiles.find((file) => file.path === filePath) ?? null
  )
}

async function openDocument(file: OpenFile): Promise<void> {
  if (
    !canSyncDocuments() ||
    openDocuments.has(file.path) ||
    openingDocuments.has(file.path) ||
    failedLanguages.has(file.language)
  ) {
    return
  }

  openingDocuments.add(file.path)
  try {
    const ensured = await window.electronAPI.lsp.ensure(file.language, file.path)
    if (!ensured.available) {
      failedLanguages.add(file.language)
      return
    }
    if (!currentOpenFile(file.path)) {
      return
    }

    const current = currentOpenFile(file.path)
    if (!current) {
      return
    }
    await window.electronAPI.lsp.didOpen(
      current.path,
      current.language,
      1,
      current.content
    )
    const document: OpenDocument = {
      path: current.path,
      languageId: current.language,
      version: 1,
      sentText: current.content,
      pendingText: current.content,
      savedAt: current.lastSavedAt,
      pendingSave: false
    }
    openDocuments.set(current.path, document)
  } catch (error) {
    failedLanguages.add(file.language)
    appendLanguageOutput(
      'warning',
      error instanceof Error
        ? `Synchronisation impossible pour ${file.name} : ${error.message}`
        : `Synchronisation impossible pour ${file.name}.`
    )
  } finally {
    openingDocuments.delete(file.path)
  }
}

function scheduleDocumentFlush(filePath: string): void {
  const existing = documentTimers.get(filePath)
  if (existing !== undefined) {
    window.clearTimeout(existing)
  }
  const timer = window.setTimeout(() => {
    documentTimers.delete(filePath)
    void flushDocument(filePath)
  }, DOCUMENT_SYNC_DELAY_MS)
  documentTimers.set(filePath, timer)
}

async function flushDocument(filePath: string): Promise<void> {
  const document = openDocuments.get(filePath)
  if (!document) {
    return
  }
  try {
    if (document.pendingText !== document.sentText) {
      document.version += 1
      await window.electronAPI.lsp.didChange(
        filePath,
        document.version,
        document.pendingText
      )
      document.sentText = document.pendingText
    }
    if (document.pendingSave) {
      document.pendingSave = false
      await window.electronAPI.lsp.didSave(filePath)
    }
  } catch (error) {
    appendLanguageOutput(
      'warning',
      error instanceof Error
        ? `Synchronisation du document interrompue : ${error.message}`
        : 'Synchronisation du document interrompue.'
    )
  }
}

async function closeDocument(filePath: string, notifyServer: boolean): Promise<void> {
  const timer = documentTimers.get(filePath)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    documentTimers.delete(filePath)
  }
  const document = openDocuments.get(filePath)
  openDocuments.delete(filePath)
  if (document && notifyServer) {
    try {
      await window.electronAPI.lsp.didClose(filePath)
    } catch {
      // The server may already be stopped after a workspace change.
    }
  }
  clearDiagnostics(filePath)
  useLanguageStore.getState().clearSymbols(filePath)
}

export async function openDocumentsForLanguages(languages: Set<string>): Promise<void> {
  if (!canSyncDocuments()) {
    return
  }
  const files = useEditorStore
    .getState()
    .openFiles.filter((file) => languages.has(file.language))
  for (const file of files) {
    await openDocument(file)
  }
}

export function resetLanguageDocuments(notifyServer: boolean): void {
  for (const filePath of [...documentTimers.keys()]) {
    window.clearTimeout(documentTimers.get(filePath) ?? 0)
  }
  documentTimers.clear()
  for (const document of openDocuments.values()) {
    if (notifyServer) {
      void window.electronAPI.lsp.didClose(document.path).catch(() => undefined)
    }
  }
  openDocuments.clear()
  openingDocuments.clear()
  failedLanguages.clear()
}

export function useLanguageDocumentSync(): void {
  const openFiles = useEditorStore((state) => state.openFiles)
  const workspacePath = useEditorStore((state) => state.workspace?.path ?? null)

  useEffect(() => {
    if (!workspacePath) {
      resetLanguageDocuments(false)
      return
    }

    const paths = new Set(openFiles.map((file) => file.path))
    for (const path of [...openDocuments.keys()]) {
      if (!paths.has(path)) {
        void closeDocument(path, true)
      }
    }

    for (const file of openFiles) {
      const document = openDocuments.get(file.path)
      if (document && document.languageId !== file.language) {
        void closeDocument(file.path, true).then(() => openDocument(file))
        continue
      }
      if (!document) {
        void openDocument(file)
        continue
      }

      if (document.pendingText !== file.content) {
        document.pendingText = file.content
        scheduleDocumentFlush(file.path)
      }
      if (file.lastSavedAt > document.savedAt) {
        document.savedAt = file.lastSavedAt
        document.pendingSave = true
        scheduleDocumentFlush(file.path)
      }
    }
  }, [openFiles, workspacePath])

  useEffect(() => {
    return () => {
      resetLanguageDocuments(false)
    }
  }, [workspacePath])
}

export function useActiveDocumentSymbols(): void {
  const activePath = useEditorStore((state) => state.activeFilePath)
  const activeFile = useEditorStore((state) =>
    state.openFiles.find((file) => file.path === state.activeFilePath)
  )
  const serverSignature = useLanguageStore((state) =>
    state.servers
      .map((server) => `${server.id}:${server.state}`)
      .sort()
      .join('|')
  )

  useEffect(() => {
    if (!activePath || !activeFile) {
      return
    }

    let cancelled = false
    const timer = window.setTimeout(
      () => {
        useLanguageStore.getState().setSymbolsLoading(activePath, true)
        void window.electronAPI.lsp
          .documentSymbols(activePath)
          .catch(() => [])
          .then((symbols) => {
            if (cancelled || useEditorStore.getState().activeFilePath !== activePath) {
              return
            }
            const result =
              symbols.length > 0
                ? symbols
                : fallbackDocumentSymbols(activeFile.content, activeFile.language)
            useLanguageStore.getState().setSymbols(activePath, result)
          })
      },
      activeFile.isDirty ? SYMBOL_REFRESH_DELAY_MS : 0
    )

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    activePath,
    activeFile?.content,
    activeFile?.language,
    activeFile?.isDirty,
    serverSignature
  ])
}

export async function documentSymbolsWithFallback(
  filePath: string
): Promise<LspDocumentSymbol[]> {
  const file = useEditorStore.getState().openFiles.find((entry) => entry.path === filePath)
  if (!file) {
    return []
  }
  try {
    const symbols = await window.electronAPI.lsp.documentSymbols(filePath)
    if (symbols.length > 0) {
      return symbols
    }
  } catch {
    // Use the local extractor below.
  }
  return fallbackDocumentSymbols(file.content, file.language)
}

export function clearLanguagePath(path: string): void {
  clearDiagnostics(path)
  useLanguageStore.getState().clearSymbols(path)
}
