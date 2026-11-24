import { create } from 'zustand'
import type {
  DebugBreakpointFile,
  DebugBreakpointInput,
  DebugConfiguration,
  DebugConfigurationList,
  DebugEvaluateResult,
  DebugEvent,
  DebugScope,
  DebugSessionState,
  DebugStackFrame,
  DebugVerifiedBreakpoint
} from '../../preload'
import { useEditorStore } from './editorStore'

export interface DebugConsoleEntry {
  id: number
  category: 'stdout' | 'stderr' | 'console' | 'system' | 'input' | 'result'
  text: string
  timestamp: number
}

interface DebugState {
  state: DebugSessionState
  sessionName: string | null
  message: string | null
  configurations: DebugConfiguration[]
  configurationSource: DebugConfigurationList['source']
  configurationError: string | null
  configurationsLoading: boolean
  breakpoints: Record<string, DebugBreakpointInput[]>
  verifiedBreakpoints: Record<string, Record<string, boolean>>
  frames: DebugStackFrame[]
  framesLoading: boolean
  selectedFrameId: number | null
  scopes: DebugScope[]
  scopesLoading: boolean
  stopReason: string | null
  stopDescription: string | null
  currentLocation: { path: string; line: number; column: number } | null
  consoleEntries: DebugConsoleEntry[]
  error: string | null
  loadConfigurations: () => Promise<void>
  toggleBreakpoint: (filePath: string, line: number, column?: number) => void
  removeBreakpoint: (filePath: string, line: number) => void
  clearBreakpoints: (filePath?: string) => void
  startConfiguration: (configurationId: string) => Promise<boolean>
  startActiveFile: () => Promise<boolean>
  stop: () => Promise<void>
  continue: () => Promise<void>
  pause: () => Promise<void>
  next: () => Promise<void>
  stepIn: () => Promise<void>
  stepOut: () => Promise<void>
  loadFrames: () => Promise<void>
  selectFrame: (frameId: number) => Promise<void>
  evaluate: (expression: string, frameId?: number | null) => Promise<DebugEvaluateResult | null>
  appendConsole: (
    category: DebugConsoleEntry['category'],
    text: string
  ) => void
  clearConsole: () => void
  reset: () => void
}

const MAX_CONSOLE_ENTRIES = 2_000
const MAX_CONSOLE_CHARACTERS = 600_000
let nextConsoleId = 1

function trimConsole(entries: DebugConsoleEntry[]): DebugConsoleEntry[] {
  let total = entries.reduce((sum, entry) => sum + entry.text.length, 0)
  let start = 0
  while (
    start < entries.length - 1 &&
    (entries.length - start > MAX_CONSOLE_ENTRIES || total > MAX_CONSOLE_CHARACTERS)
  ) {
    total -= entries[start]?.text.length ?? 0
    start += 1
  }
  return start > 0 ? entries.slice(start) : entries
}

function breakpointKey(line: number, column?: number): string {
  return `${line}:${column ?? 1}`
}

function normalizeBreakpointList(
  breakpoints: DebugBreakpointInput[]
): DebugBreakpointInput[] {
  const seen = new Set<string>()
  return breakpoints
    .filter((breakpoint) => {
      if (
        !Number.isInteger(breakpoint.line) ||
        breakpoint.line < 1 ||
        (breakpoint.column !== undefined &&
          (!Number.isInteger(breakpoint.column) || breakpoint.column < 1))
      ) {
        return false
      }
      const key = breakpointKey(breakpoint.line, breakpoint.column)
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .sort(
      (left, right) =>
        left.line - right.line || (left.column ?? 1) - (right.column ?? 1)
    )
}

function allBreakpointFiles(state: DebugState): DebugBreakpointFile[] {
  return Object.entries(state.breakpoints)
    .map(([path, breakpoints]) => ({
      path,
      breakpoints: normalizeBreakpointList(breakpoints)
    }))
    .filter((file) => file.breakpoints.length > 0)
}

function updateVerifiedFor(
  current: Record<string, Record<string, boolean>>,
  breakpoints: DebugVerifiedBreakpoint[]
): Record<string, Record<string, boolean>> {
  const next = { ...current }
  for (const breakpoint of breakpoints) {
    const file = { ...(next[breakpoint.path] ?? {}) }
    file[breakpointKey(breakpoint.line, breakpoint.column)] = breakpoint.verified
    next[breakpoint.path] = file
  }
  return next
}

function eventStateMessage(event: Extract<DebugEvent, { type: 'state' }>): string {
  if (event.message) {
    return event.message
  }
  switch (event.state) {
    case 'starting':
      return 'Démarrage du débogage…'
    case 'running':
      return 'Le programme est en cours d’exécution.'
    case 'paused':
      return 'Le programme est en pause.'
    case 'stopped':
      return 'La session de débogage est arrêtée.'
    case 'error':
      return 'Le débogage a rencontré une erreur.'
    default:
      return ''
  }
}

export const useDebugStore = create<DebugState>((set, get) => ({
  state: 'idle',
  sessionName: null,
  message: null,
  configurations: [],
  configurationSource: 'none',
  configurationError: null,
  configurationsLoading: false,
  breakpoints: {},
  verifiedBreakpoints: {},
  frames: [],
  framesLoading: false,
  selectedFrameId: null,
  scopes: [],
  scopesLoading: false,
  stopReason: null,
  stopDescription: null,
  currentLocation: null,
  consoleEntries: [],
  error: null,

  loadConfigurations: async () => {
    if (!useEditorStore.getState().workspace) {
      set({
        configurations: [],
        configurationSource: 'none',
        configurationError: null,
        configurationsLoading: false
      })
      return
    }
    set({ configurationsLoading: true })
    try {
      const activeFilePath = useEditorStore.getState().activeFilePath
      const result = await window.electronAPI.debug.configurations(activeFilePath)
      set({
        configurations: result.configurations,
        configurationSource: result.source,
        configurationError: result.error,
        configurationsLoading: false
      })
    } catch (error) {
      set({
        configurations: [],
        configurationSource: 'none',
        configurationError:
          error instanceof Error
            ? error.message
            : 'Impossible de charger les configurations de débogage.',
        configurationsLoading: false
      })
    }
  },

  toggleBreakpoint: (filePath, line, _column = 1) => {
    if (!Number.isInteger(line) || line < 1) {
      return
    }
    const current = get().breakpoints[filePath] ?? []
    const exists = current.some((breakpoint) => breakpoint.line === line)
    const breakpoints = exists
      ? current.filter((breakpoint) => breakpoint.line !== line)
      : normalizeBreakpointList([...current, { path: filePath, line, column: 1 }])

    set((state) => ({
      breakpoints: {
        ...state.breakpoints,
        [filePath]: breakpoints
      }
    }))

    if (['starting', 'running', 'paused'].includes(get().state)) {
      void window.electronAPI.debug
        .setBreakpoints(filePath, breakpoints)
        .then((verified) => {
          set((state) => ({
            verifiedBreakpoints: updateVerifiedFor(state.verifiedBreakpoints, verified)
          }))
        })
        .catch(() => undefined)
    }
  },

  removeBreakpoint: (filePath, line) => {
    const current = get().breakpoints[filePath] ?? []
    const breakpoints = current.filter((breakpoint) => breakpoint.line !== line)
    set((state) => ({
      breakpoints: {
        ...state.breakpoints,
        [filePath]: breakpoints
      }
    }))
    if (['starting', 'running', 'paused'].includes(get().state)) {
      void window.electronAPI.debug
        .setBreakpoints(filePath, breakpoints)
        .catch(() => undefined)
    }
  },

  clearBreakpoints: (filePath) => {
    if (filePath) {
      set((state) => ({
        breakpoints: {
          ...state.breakpoints,
          [filePath]: []
        }
      }))
      if (['starting', 'running', 'paused'].includes(get().state)) {
        void window.electronAPI.debug.setBreakpoints(filePath, []).catch(() => undefined)
      }
      return
    }

    const previous = get().breakpoints
    set({ breakpoints: {}, verifiedBreakpoints: {} })
    if (['starting', 'running', 'paused'].includes(get().state)) {
      for (const path of Object.keys(previous)) {
        void window.electronAPI.debug.setBreakpoints(path, []).catch(() => undefined)
      }
    }
  },

  startConfiguration: async (configurationId) => {
    set({ error: null, message: 'Démarrage du débogage…' })
    useEditorStore.getState().setSidebarView('debug')
    useEditorStore.getState().showPanel('debug')
    try {
      const verified = await window.electronAPI.debug.start(
        configurationId,
        allBreakpointFiles(get()),
        useEditorStore.getState().activeFilePath
      )
      set((state) => ({
        verifiedBreakpoints: updateVerifiedFor(state.verifiedBreakpoints, verified)
      }))
      return true
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Impossible de démarrer le débogage.'
      set({ error: message })
      get().appendConsole('system', `${message}\n`)
      return false
    }
  },

  startActiveFile: async () => {
    const state = useEditorStore.getState()
    const filePath = state.activeFilePath
    if (!filePath) {
      set({ error: 'Aucun fichier actif à déboguer.' })
      return false
    }
    if (!['js', 'mjs', 'cjs'].includes(filePath.split('.').pop()?.toLocaleLowerCase() ?? '')) {
      set({
        error:
          'Le débogage direct est disponible pour les fichiers JavaScript (.js, .mjs, .cjs). Choisissez une configuration pour les autres langages.'
      })
      return false
    }

    set({ error: null, message: 'Démarrage du débogage…' })
    useEditorStore.getState().setSidebarView('debug')
    useEditorStore.getState().showPanel('debug')
    try {
      const verified = await window.electronAPI.debug.startFile(
        filePath,
        allBreakpointFiles(get())
      )
      set((debugState) => ({
        verifiedBreakpoints: updateVerifiedFor(
          debugState.verifiedBreakpoints,
          verified
        )
      }))
      return true
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Impossible de démarrer le débogage.'
      set({ error: message })
      get().appendConsole('system', `${message}\n`)
      return false
    }
  },

  stop: async () => {
    try {
      await window.electronAPI.debug.stop()
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Impossible d’arrêter le débogage.'
      })
    }
  },

  continue: async () => {
    try {
      await window.electronAPI.debug.continue()
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : 'Impossible de reprendre l’exécution.'
      })
    }
  },

  pause: async () => {
    try {
      await window.electronAPI.debug.pause()
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Impossible de mettre en pause.'
      })
    }
  },

  next: async () => {
    try {
      await window.electronAPI.debug.next()
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : 'Impossible d’avancer pas à pas.'
      })
    }
  },

  stepIn: async () => {
    try {
      await window.electronAPI.debug.stepIn()
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : 'Impossible d’entrer dans la fonction.'
      })
    }
  },

  stepOut: async () => {
    try {
      await window.electronAPI.debug.stepOut()
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : 'Impossible de sortir de la fonction.'
      })
    }
  },

  loadFrames: async () => {
    if (get().state !== 'paused') {
      return
    }
    set({ framesLoading: true })
    try {
      const frames = await window.electronAPI.debug.stackTrace()
      set({ frames, framesLoading: false })
      const first = frames[0]
      if (first) {
        set({
          selectedFrameId: first.id,
          currentLocation: first.path
            ? { path: first.path, line: first.line, column: first.column }
            : null
        })
        if (first.path) {
          void useEditorStore
            .getState()
            .openFile(first.path, first.line, first.column)
        }
        await get().selectFrame(first.id)
      } else {
        set({ selectedFrameId: null, currentLocation: null, scopes: [] })
      }
    } catch (error) {
      set({
        framesLoading: false,
        error:
          error instanceof Error
            ? error.message
            : 'Impossible de charger la pile d’appels.'
      })
    }
  },

  selectFrame: async (frameId) => {
    set({ selectedFrameId: frameId, scopesLoading: true, scopes: [] })
    try {
      const scopes = await window.electronAPI.debug.scopes(frameId)
      if (get().selectedFrameId !== frameId) {
        return
      }
      set({ scopes, scopesLoading: false })
      const frame = get().frames.find((entry) => entry.id === frameId)
      if (frame?.path) {
        set({
          currentLocation: {
            path: frame.path,
            line: frame.line,
            column: frame.column
          }
        })
        void useEditorStore
          .getState()
          .openFile(frame.path, frame.line, frame.column)
      }
    } catch (error) {
      set({
        scopesLoading: false,
        error:
          error instanceof Error
            ? error.message
            : 'Impossible de charger les variables.'
      })
    }
  },

  evaluate: async (expression, frameId = null) => {
    const trimmed = expression.trim()
    if (!trimmed) {
      return null
    }
    get().appendConsole('input', `› ${trimmed}\n`)
    try {
      const selectedFrame = frameId ?? get().selectedFrameId
      const result = await window.electronAPI.debug.evaluate(trimmed, selectedFrame)
      get().appendConsole(
        'result',
        `${result.value}${result.type ? `  ${result.type}` : ''}\n`
      )
      return result
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'L’évaluation a échoué.'
      get().appendConsole('stderr', `${message}\n`)
      return null
    }
  },

  appendConsole: (category, text) => {
    if (!text) {
      return
    }
    set((state) => ({
      consoleEntries: trimConsole([
        ...state.consoleEntries,
        {
          id: nextConsoleId++,
          category,
          text: text.slice(0, 256_000),
          timestamp: Date.now()
        }
      ])
    }))
  },

  clearConsole: () => {
    set({ consoleEntries: [] })
  },

  reset: () => {
    set({
      state: 'idle',
      sessionName: null,
      message: null,
      frames: [],
      framesLoading: false,
      selectedFrameId: null,
      scopes: [],
      scopesLoading: false,
      stopReason: null,
      stopDescription: null,
      currentLocation: null,
      consoleEntries: [],
      error: null,
      verifiedBreakpoints: {},
      breakpoints: {}
    })
  }
}))

export function installDebugEventBridge(): () => void {
  return window.electronAPI.debug.onEvent((event) => {
    const store = useDebugStore.getState()

    if (event.type === 'state') {
      store.appendConsole('system', `${eventStateMessage(event)}\n`)
      useDebugStore.setState({
        state: event.state,
        sessionName: event.sessionName,
        message: event.message
      })
      if (event.state === 'stopped' || event.state === 'error') {
        useDebugStore.setState({
          frames: [],
          scopes: [],
          selectedFrameId: null,
          currentLocation: null
        })
      }
      return
    }

    if (event.type === 'stopped') {
      const description = event.description ? ` — ${event.description}` : ''
      store.appendConsole('system', `Pause (${event.reason})${description}\n`)
      useDebugStore.setState({
        state: 'paused',
        stopReason: event.reason,
        stopDescription: event.description
      })
      void useDebugStore.getState().loadFrames()
      return
    }

    if (event.type === 'continued') {
      useDebugStore.setState({
        state: 'running',
        stopReason: null,
        stopDescription: null,
        frames: [],
        scopes: [],
        selectedFrameId: null,
        currentLocation: null
      })
      return
    }

    if (event.type === 'console') {
      store.appendConsole(event.category, event.text)
      return
    }

    if (event.type === 'terminated') {
      useDebugStore.setState({
        state: 'stopped',
        sessionName: null,
        frames: [],
        scopes: [],
        selectedFrameId: null,
        currentLocation: null
      })
      return
    }

    if (event.type === 'breakpoints') {
      useDebugStore.setState((state) => ({
        verifiedBreakpoints: updateVerifiedFor(
          state.verifiedBreakpoints,
          event.breakpoints
        )
      }))
    }
  })
}

export function currentBreakpointFiles(): DebugBreakpointFile[] {
  return allBreakpointFiles(useDebugStore.getState())
}
