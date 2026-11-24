import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import { useEffect, useRef } from 'react'
import {
  useEditorStore,
  type EditorPane as EditorPaneId,
  type EditorSettings
} from '../store/editorStore'
import { useDebugStore } from '../store/debugStore'
import { EditorBreadcrumbs } from './EditorBreadcrumbs'
import { EditorWelcome } from './EditorWelcome'
import { TabBar } from './TabBar'

interface MonacoWorkerEnvironment {
  getWorker: (workerId: string, label: string) => Worker
}

const workerEnvironment: MonacoWorkerEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'json':
        return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker()
      case 'typescript':
      case 'javascript':
        return new tsWorker()
      default:
        return new editorWorker()
    }
  }
}

;(globalThis as typeof globalThis & { MonacoEnvironment: MonacoWorkerEnvironment }).MonacoEnvironment =
  workerEnvironment

monaco.editor.defineTheme('cami-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '657184', fontStyle: 'italic' },
    { token: 'keyword', foreground: '7CA9F1' },
    { token: 'keyword.control', foreground: 'C792EA' },
    { token: 'string', foreground: 'A8CE9C' },
    { token: 'number', foreground: 'E9B57D' },
    { token: 'regexp', foreground: 'E9B57D' },
    { token: 'type', foreground: '70C7BA' },
    { token: 'type.identifier', foreground: '70C7BA' },
    { token: 'function', foreground: 'D7BA7D' },
    { token: 'variable', foreground: 'D6DEE9' },
    { token: 'constant', foreground: 'E9B57D' },
    { token: 'delimiter', foreground: '95A3B6' },
    { token: 'tag', foreground: '7CA9F1' },
    { token: 'attribute.name', foreground: '70C7BA' },
    { token: 'attribute.value', foreground: 'A8CE9C' },
    { token: 'metatag', foreground: 'C792EA' },
    { token: 'invalid', foreground: 'F37878' }
  ],
  colors: {
    'editor.background': '#0f141b',
    'editor.foreground': '#d6dee9',
    'editorLineNumber.foreground': '#394557',
    'editorLineNumber.activeForeground': '#8798ad',
    'editorGutter.background': '#0f141b',
    'editor.lineHighlightBackground': '#151c25',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#22415f',
    'editor.inactiveSelectionBackground': '#1a2f45',
    'editor.selectionHighlightBackground': '#1e344a',
    'editor.wordHighlightBackground': '#24384d',
    'editor.wordHighlightStrongBackground': '#2c4c69',
    'editor.findMatchBackground': '#544b22',
    'editor.findMatchHighlightBackground': '#3b371d',
    'editorCursor.foreground': '#68b5ff',
    'editorWhitespace.foreground': '#2b3747',
    'editorIndentGuide.background1': '#1a222d',
    'editorIndentGuide.activeBackground1': '#344356',
    'editorBracketMatch.background': '#1b2d40',
    'editorBracketMatch.border': '#3c6c96',
    'editorBracketHighlight.foreground1': '#7ca9f1',
    'editorBracketHighlight.foreground2': '#70c7ba',
    'editorBracketHighlight.foreground3': '#d7ba7d',
    'editorOverviewRuler.border': '#00000000',
    'editorOverviewRuler.findMatchForeground': '#8e7d36',
    'editorError.foreground': '#f37878',
    'editorWarning.foreground': '#e9b57d',
    'editorInfo.foreground': '#7ca9f1',
    'editorWidget.background': '#151b24',
    'editorWidget.border': '#2a3544',
    'editorSuggestWidget.background': '#151b24',
    'editorSuggestWidget.border': '#2a3544',
    'editorSuggestWidget.selectedBackground': '#203044',
    'editorHoverWidget.background': '#151b24',
    'editorHoverWidget.border': '#2a3544',
    'input.background': '#0d1219',
    'input.border': '#2a3544',
    'focusBorder': '#3b82c4',
    'scrollbarSlider.background': '#43506566',
    'scrollbarSlider.hoverBackground': '#5c6e8599',
    'scrollbarSlider.activeBackground': '#71869faa',
    'minimap.background': '#0f141b',
    'minimapSlider.background': '#26334355',
    'minimapSlider.hoverBackground': '#35465a88'
  }
})

function editorOptions(settings: EditorSettings): monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    automaticLayout: false,
    fontFamily: '"SFMono-Regular", "Cascadia Code", "Liberation Mono", Menlo, Consolas, monospace',
    fontSize: settings.fontSize,
    fontLigatures: settings.fontLigatures,
    lineHeight: 0,
    letterSpacing: 0.1,
    lineNumbers: settings.lineNumbers,
    lineNumbersMinChars: 3,
    glyphMargin: true,
    folding: true,
    foldingHighlight: true,
    showFoldingControls: 'mouseover',
    minimap: {
      enabled: settings.minimap,
      showSlider: 'mouseover',
      renderCharacters: false,
      maxColumn: 120
    },
    wordWrap: settings.wordWrap ? 'on' : 'off',
    tabSize: settings.tabSize,
    insertSpaces: true,
    detectIndentation: false,
    padding: {
      top: 16,
      bottom: 24
    },
    renderLineHighlight: 'all',
    renderWhitespace: 'selection',
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    smoothScrolling: true,
    scrollBeyondLastLine: false,
    scrollbar: {
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
      useShadows: false
    },
    overviewRulerBorder: false,
    overviewRulerLanes: 3,
    bracketPairColorization: { enabled: settings.bracketPairColorization },
    guides: {
      bracketPairs: true,
      indentation: true,
      highlightActiveIndentation: true
    },
    stickyScroll: { enabled: settings.stickyScroll, maxLineCount: 4 },
    suggest: {
      showWords: true,
      preview: true
    },
    quickSuggestions: {
      comments: false,
      strings: false,
      other: true
    },
    tabCompletion: 'on',
    fixedOverflowWidgets: true,
    accessibilitySupport: 'auto',
    ariaLabel: 'Éditeur de code Cami',
    theme: 'cami-dark'
  }
}

interface SharedModelEntry {
  model: monaco.editor.ITextModel
  users: number
}

const sharedModels = new Map<string, SharedModelEntry>()
const EMPTY_BREAKPOINTS: never[] = []

function acquireSharedModel(
  filePath: string,
  content: string,
  language: string
): monaco.editor.ITextModel {
  let entry = sharedModels.get(filePath)

  if (!entry) {
    entry = {
      model: monaco.editor.createModel(content, language, monaco.Uri.file(filePath)),
      users: 0
    }
    sharedModels.set(filePath, entry)
  }

  entry.users += 1
  return entry.model
}

function releaseSharedModel(filePath: string): void {
  const entry = sharedModels.get(filePath)
  if (!entry) {
    return
  }

  entry.users -= 1
  if (entry.users <= 0) {
    sharedModels.delete(filePath)
    entry.model.dispose()
  }
}

export function Editor(): React.JSX.Element {
  const splitOpen = useEditorStore((state) => state.splitOpen)
  const setActivePane = useEditorStore((state) => state.setActivePane)
  const openFiles = useEditorStore((state) => state.openFiles)
  const keeperPathsRef = useRef(new Set<string>())

  useEffect(() => {
    return window.electronAPI.menu.onCommand((command) => {
      if (command !== 'format-document') {
        return
      }

      const focused = monaco.editor.getEditors().find((editor) => editor.hasTextFocus())
      void focused?.getAction('editor.action.formatDocument')?.run()
    })
  }, [])

  useEffect(() => {
    const currentPaths = new Set(openFiles.map((file) => file.path))

    for (const filePath of [...keeperPathsRef.current]) {
      if (!currentPaths.has(filePath)) {
        releaseSharedModel(filePath)
        keeperPathsRef.current.delete(filePath)
      }
    }

    for (const file of openFiles) {
      if (!keeperPathsRef.current.has(file.path)) {
        acquireSharedModel(file.path, file.content, file.language)
        keeperPathsRef.current.add(file.path)
        continue
      }

      const entry = sharedModels.get(file.path)
      if (entry && entry.model.getValue() !== file.content) {
        entry.model.setValue(file.content)
      }
    }
  }, [openFiles])

  useEffect(() => {
    return () => {
      for (const filePath of keeperPathsRef.current) {
        releaseSharedModel(filePath)
      }
      keeperPathsRef.current.clear()
    }
  }, [])

  return (
    <div className={`editor-area${splitOpen ? ' is-split' : ''}`}>
      <section
        className="editor-pane"
        aria-label="Groupe d’éditeurs principal"
        onClick={() => {
          setActivePane('primary')
        }}
      >
        <TabBar pane="primary" />
        <EditorPaneView pane="primary" />
      </section>

      {splitOpen ? (
        <section
          className="editor-pane editor-pane-secondary"
          aria-label="Groupe d’éditeurs secondaire"
          onClick={() => {
            setActivePane('secondary')
          }}
        >
          <TabBar pane="secondary" />
          <EditorPaneView pane="secondary" />
        </section>
      ) : null}
    </div>
  )
}

function EditorPaneView({ pane }: { pane: EditorPaneId }): React.JSX.Element {
  const activeFile = useEditorStore(
    (state) =>
      state.openFiles.find(
        (file) =>
          file.path ===
          (pane === 'secondary' ? state.secondaryFilePath : state.activeFilePath)
      ) ?? null
  )
  const settings = useEditorStore((state) => state.settings)
  const pendingReveal = useEditorStore((state) => state.pendingReveal)
  const breakpoints = useDebugStore((state) =>
    activeFile ? (state.breakpoints[activeFile.path] ?? EMPTY_BREAKPOINTS) : EMPTY_BREAKPOINTS
  )
  const verifiedBreakpoints = useDebugStore((state) =>
    activeFile ? state.verifiedBreakpoints[activeFile.path] : undefined
  )
  const debugState = useDebugStore((state) => state.state)
  const currentDebugLocation = useDebugStore((state) => state.currentLocation)
  const splitOpen = useEditorStore((state) => state.splitOpen)
  const openCommandPalette = useEditorStore((state) => state.openCommandPalette)
  const closeSplit = useEditorStore((state) => state.closeSplit)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const viewStatesRef = useRef(new Map<string, monaco.editor.ICodeEditorViewState>())
  const currentModelPathRef = useRef<string | null>(null)
  const lastActivePathRef = useRef<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const initialSettings = useEditorStore.getState().settings
    const editor = monaco.editor.create(container, editorOptions(initialSettings))
    editorRef.current = editor

    const contentSubscription = editor.onDidChangeModelContent(() => {
      const model = editor.getModel()
      const modelPath = currentModelPathRef.current
      if (!model || !modelPath) {
        return
      }

      useEditorStore.getState().updateFileContent(modelPath, model.getValue())
    })

    const selectionSubscription = editor.onDidChangeCursorSelection(() => {
      const position = editor.getPosition()
      if (!position || !currentModelPathRef.current) {
        return
      }

      const state = useEditorStore.getState()
      if (state.splitOpen && state.activePane !== pane) {
        return
      }

      const model = editor.getModel()
      let selectionLength = 0
      if (model) {
        for (const selection of editor.getSelections() ?? []) {
          selectionLength += model.getValueInRange(selection).length
        }
      }

      state.setCursor({
        line: position.lineNumber,
        column: position.column,
        selectionLength
      })
    })

    const focusSubscription = editor.onDidFocusEditorText(() => {
      const state = useEditorStore.getState()
      state.setActivePane(pane)

      const position = editor.getPosition()
      if (position) {
        state.setCursor({
          line: position.lineNumber,
          column: position.column,
          selectionLength: 0
        })
      }
    })

    const mouseSubscription = editor.onMouseDown((event) => {
      if (
        event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        !event.target.position
      ) {
        return
      }
      const filePath = currentModelPathRef.current
      if (!filePath) {
        return
      }
      event.event.preventDefault()
      useDebugStore
        .getState()
        .toggleBreakpoint(filePath, event.target.position.lineNumber, 1)
    })

    let layoutFrame = 0
    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(layoutFrame)
      layoutFrame = window.requestAnimationFrame(() => {
        editor.layout()
      })
    })
    resizeObserver.observe(container)

    return () => {
      window.cancelAnimationFrame(layoutFrame)
      resizeObserver.disconnect()
      contentSubscription.dispose()
      selectionSubscription.dispose()
      focusSubscription.dispose()
      mouseSubscription.dispose()
      editor.dispose()

      const currentPath = currentModelPathRef.current
      if (currentPath) {
        releaseSharedModel(currentPath)
      }

      viewStatesRef.current.clear()
      editorRef.current = null
      currentModelPathRef.current = null
      lastActivePathRef.current = null
    }
  }, [pane])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    if (!activeFile) {
      const previousPath = currentModelPathRef.current
      if (previousPath) {
        const viewState = editor.saveViewState()
        if (viewState) {
          viewStatesRef.current.set(previousPath, viewState)
        }
        releaseSharedModel(previousPath)
      }

      editor.setModel(null)
      currentModelPathRef.current = null
      lastActivePathRef.current = null
      return
    }

    let model: monaco.editor.ITextModel
    const previousPath = currentModelPathRef.current

    if (previousPath === activeFile.path) {
      const entry = sharedModels.get(activeFile.path)
      model = entry
        ? entry.model
        : acquireSharedModel(activeFile.path, activeFile.content, activeFile.language)
    } else {
      if (previousPath) {
        const viewState = editor.saveViewState()
        if (viewState) {
          viewStatesRef.current.set(previousPath, viewState)
        }
        releaseSharedModel(previousPath)
      }

      model = acquireSharedModel(activeFile.path, activeFile.content, activeFile.language)
      currentModelPathRef.current = activeFile.path
    }

    const modelChanged = editor.getModel() !== model
    if (modelChanged) {
      editor.setModel(model)
    }

    if (model.getLanguageId() !== activeFile.language) {
      monaco.editor.setModelLanguage(model, activeFile.language)
    }

    const modelOptions = model.getOptions()
    if (modelOptions.tabSize !== settings.tabSize || !modelOptions.insertSpaces) {
      model.updateOptions({
        tabSize: settings.tabSize,
        insertSpaces: true
      })
    }

    if (model.getValue() !== activeFile.content) {
      const viewState = editor.saveViewState()
      model.setValue(activeFile.content)
      if (viewState) {
        editor.restoreViewState(viewState)
      }
    }

    currentModelPathRef.current = activeFile.path

    if (modelChanged) {
      const viewState = viewStatesRef.current.get(activeFile.path)
      if (viewState) {
        editor.restoreViewState(viewState)
      }
    }

    if (lastActivePathRef.current !== activeFile.path) {
      lastActivePathRef.current = activeFile.path
      const state = useEditorStore.getState()
      if (!state.splitOpen || state.activePane === pane) {
        editor.focus()
      }

      const position = editor.getPosition()
      state.setCursor({
        line: position?.lineNumber ?? 1,
        column: position?.column ?? 1,
        selectionLength: 0
      })
    }
  }, [activeFile, settings.tabSize, pane])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    editor.updateOptions({
      fontSize: settings.fontSize,
      tabSize: settings.tabSize,
      fontLigatures: settings.fontLigatures,
      lineNumbers: settings.lineNumbers,
      wordWrap: settings.wordWrap ? 'on' : 'off',
      bracketPairColorization: { enabled: settings.bracketPairColorization },
      stickyScroll: { enabled: settings.stickyScroll, maxLineCount: 4 },
      minimap: {
        enabled: settings.minimap
      }
    })

    const model = editor.getModel()
    if (model) {
      model.updateOptions({
        tabSize: settings.tabSize,
        insertSpaces: true
      })
    }
  }, [settings])

  useEffect(() => {
    const editor = editorRef.current
    if (
      !pendingReveal ||
      !editor ||
      !activeFile ||
      pendingReveal.pane !== pane ||
      pendingReveal.path !== activeFile.path
    ) {
      return
    }

    const entry = sharedModels.get(pendingReveal.path)
    const model = entry?.model
    if (!model) {
      return
    }

    const lineNumber = Math.min(Math.max(1, pendingReveal.line), model.getLineCount())
    const column = Math.min(
      Math.max(1, pendingReveal.column),
      model.getLineMaxColumn(lineNumber)
    )

    editor.setPosition({ lineNumber, column })
    editor.revealPositionInCenter({ lineNumber, column })
    useEditorStore.getState().setActivePane(pane)
    editor.focus()
    useEditorStore.getState().clearReveal()
  }, [activeFile, pendingReveal, pane])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeFile) {
      return
    }

    const decorations: monaco.editor.IModelDeltaDecoration[] = []
    for (const breakpoint of breakpoints) {
      const key = `${breakpoint.line}:${breakpoint.column ?? 1}`
      const verified = verifiedBreakpoints?.[key] !== false
      decorations.push({
        range: new monaco.Range(breakpoint.line, 1, breakpoint.line, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: `cami-breakpoint-glyph${verified ? '' : ' is-unverified'}`,
          linesDecorationsClassName: 'cami-breakpoint-line',
          hoverMessage: {
            value: `Point d’arrêt — ligne ${breakpoint.line}`
          }
        }
      })
    }

    if (
      debugState === 'paused' &&
      currentDebugLocation &&
      currentDebugLocation.path === activeFile.path
    ) {
      const line = Math.min(
        Math.max(1, currentDebugLocation.line),
        editor.getModel()?.getLineCount() ?? Number.MAX_SAFE_INTEGER
      )
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: 'cami-debug-current-line',
          glyphMarginClassName: 'cami-debug-current-glyph'
        }
      })
    }

    const collection = editor.createDecorationsCollection(decorations)
    return () => {
      collection.clear()
    }
  }, [activeFile, breakpoints, currentDebugLocation, debugState, verifiedBreakpoints])

  const showCompactEmptyState = splitOpen

  return (
    <div className={`editor-shell${activeFile ? ' has-breadcrumbs' : ''}`}>
      {activeFile ? <EditorBreadcrumbs filePath={activeFile.path} /> : null}
      <div ref={containerRef} className="monaco-host" />
      {!activeFile ? (
        showCompactEmptyState ? (
          <div className="editor-empty-pane">
            <p>Aucun éditeur dans ce groupe.</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                if (pane === 'secondary') {
                  closeSplit()
                } else {
                  openCommandPalette('files')
                }
              }}
            >
              {pane === 'secondary' ? 'Fermer la division' : 'Ouvrir un fichier'}
            </button>
          </div>
        ) : (
          <EditorWelcome />
        )
      ) : null}
    </div>
  )
}
