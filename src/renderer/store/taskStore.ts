import { create } from 'zustand'
import type {
  TaskDefinition,
  TaskExitEvent,
  TaskOutputEvent,
  TaskProblem,
  TaskProblemsEvent,
  TaskRun,
  TaskRunStatus
} from '../../preload'
import { useEditorStore } from './editorStore'

export interface TaskOutputChunk {
  id: number
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

export interface TaskRunView extends TaskRun {
  output: TaskOutputChunk[]
  problems: TaskProblem[]
}

interface TaskState {
  tasks: TaskDefinition[]
  loading: boolean
  error: string | null
  runs: TaskRunView[]
  activeRunId: string | null
  loadTasks: () => Promise<void>
  runTask: (taskId: string) => Promise<void>
  runFile: (filePath: string) => Promise<void>
  stopRun: (runId: string) => Promise<void>
  selectRun: (runId: string) => void
  clearRun: (runId: string) => void
  reset: () => void
}

const MAX_RUNS = 20
const MAX_OUTPUT_CHUNKS = 2_000
const MAX_OUTPUT_CHARACTERS = 750_000
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g

let nextOutputId = 1
const pendingOutput = new Map<string, TaskOutputEvent[]>()
const pendingProblems = new Map<string, TaskProblemsEvent[]>()

function cleanOutput(text: string): string {
  return text
    .replace(ANSI_ESCAPE, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .slice(0, 256_000)
}

function trimOutput(chunks: TaskOutputChunk[]): TaskOutputChunk[] {
  let total = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
  let start = 0
  while (
    start < chunks.length - 1 &&
    (chunks.length - start > MAX_OUTPUT_CHUNKS || total > MAX_OUTPUT_CHARACTERS)
  ) {
    total -= chunks[start]?.text.length ?? 0
    start += 1
  }
  return start > 0 ? chunks.slice(start) : chunks
}

function withSystemOutput(run: TaskRunView, text: string): TaskRunView {
  return {
    ...run,
    output: trimOutput([
      ...run.output,
      {
        id: nextOutputId++,
        stream: 'system',
        text
      }
    ])
  }
}

function statusLabel(status: TaskRunStatus, exitCode: number | null): string {
  switch (status) {
    case 'success':
      return '\n[La tâche est terminée avec succès.]\n'
    case 'failed':
      return `\n[La tâche a échoué${exitCode === null ? '' : ` avec le code ${exitCode}`}.]\n`
    case 'stopped':
      return '\n[La tâche a été arrêtée.]\n'
    default:
      return ''
  }
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  loading: false,
  error: null,
  runs: [],
  activeRunId: null,

  loadTasks: async () => {
    if (!useEditorStore.getState().workspace) {
      set({ tasks: [], error: null, loading: false })
      return
    }
    set({ loading: true, error: null })
    try {
      const tasks = await window.electronAPI.tasks.list(
        useEditorStore.getState().activeFilePath
      )
      set({ tasks, loading: false })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Impossible de charger les tâches.'
      })
    }
  },

  runTask: async (taskId) => {
    set({ error: null })
    try {
      const run = await window.electronAPI.tasks.run(
        taskId,
        useEditorStore.getState().activeFilePath
      )
      set((state) => {
        const existing = state.runs.find((entry) => entry.id === run.id)
        const view: TaskRunView = existing
          ? { ...existing, ...run }
          : { ...run, output: [], problems: [] }
        const queuedOutput = pendingOutput.get(run.id) ?? []
        const queuedProblems = pendingProblems.get(run.id) ?? []
        pendingOutput.delete(run.id)
        pendingProblems.delete(run.id)
        for (const output of queuedOutput) {
          view.output = trimOutput([
            ...view.output,
            {
              id: nextOutputId++,
              stream: output.stream,
              text: cleanOutput(output.text)
            }
          ])
        }
        for (const problemEvent of queuedProblems) {
          view.problems = problemEvent.problems
        }
        const runs = [view, ...state.runs.filter((entry) => entry.id !== run.id)].slice(
          0,
          MAX_RUNS
        )
        return { runs, activeRunId: run.id }
      })
      useEditorStore.getState().showPanel('tasks')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Impossible de démarrer la tâche.'
      set({ error: message })
      useEditorStore.getState().appendOutput('error', `[Tâches] ${message}`)
    }
  },

  runFile: async (filePath) => {
    set({ error: null })
    try {
      const run = await window.electronAPI.tasks.runFile(filePath)
      set((state) => ({
        runs: [{ ...run, output: [], problems: [] }, ...state.runs].slice(0, MAX_RUNS),
        activeRunId: run.id
      }))
      useEditorStore.getState().showPanel('tasks')
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Impossible d’exécuter le fichier actif.'
      set({ error: message })
      useEditorStore.getState().appendOutput('error', `[Tâches] ${message}`)
    }
  },

  stopRun: async (runId) => {
    try {
      await window.electronAPI.tasks.stop(runId)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Impossible d’arrêter la tâche.'
      set({ error: message })
    }
  },

  selectRun: (runId) => {
    set({ activeRunId: runId })
  },

  clearRun: (runId) => {
    set((state) => {
      const runs = state.runs.filter((run) => run.id !== runId)
      return {
        runs,
        activeRunId:
          state.activeRunId === runId ? (runs[0]?.id ?? null) : state.activeRunId
      }
    })
  },

  reset: () => {
    pendingOutput.clear()
    pendingProblems.clear()
    set({ tasks: [], loading: false, error: null, runs: [], activeRunId: null })
  }
}))

export function installTaskEventBridge(): () => void {
  const offOutput = window.electronAPI.tasks.onOutput((event) => {
    let found = false
    useTaskStore.setState((state) => {
      const runs = state.runs.map((run) => {
        if (run.id !== event.runId) {
          return run
        }
        found = true
        return {
          ...run,
          output: trimOutput([
            ...run.output,
            {
              id: nextOutputId++,
              stream: event.stream,
              text: cleanOutput(event.text)
            }
          ])
        }
      })
      if (!found) {
        const queued = pendingOutput.get(event.runId) ?? []
        queued.push(event)
        pendingOutput.set(event.runId, queued.slice(-MAX_OUTPUT_CHUNKS))
      }
      return found ? { runs } : state
    })
  })

  const offExit = window.electronAPI.tasks.onExit((event: TaskExitEvent) => {
    useTaskStore.setState((state) => {
      if (!state.runs.some((run) => run.id === event.runId)) {
        return state
      }
      return {
        runs: state.runs.map((run) => {
          if (run.id !== event.runId) {
            return run
          }
          const updated: TaskRunView = {
            ...run,
            status: event.status,
            exitCode: event.exitCode,
            endedAt: Date.now()
          }
          return withSystemOutput(updated, statusLabel(event.status, event.exitCode))
        })
      }
    })
    const run = useTaskStore.getState().runs.find((entry) => entry.id === event.runId)
    if (run && event.status === 'failed') {
      useEditorStore
        .getState()
        .appendOutput('error', `[Tâches] ${run.label} a échoué.`)
    }
  })

  const offProblems = window.electronAPI.tasks.onProblems((event: TaskProblemsEvent) => {
    let found = false
    useTaskStore.setState((state) => {
      const runs = state.runs.map((run) => {
        if (run.id !== event.runId) {
          return run
        }
        found = true
        return { ...run, problems: event.problems }
      })
      if (!found) {
        const queued = pendingProblems.get(event.runId) ?? []
        queued.push(event)
        pendingProblems.set(event.runId, queued.slice(-20))
      }
      return found ? { runs } : state
    })
  })

  return () => {
    offOutput()
    offExit()
    offProblems()
  }
}

export function currentTaskProblems(): TaskProblem[] {
  return useTaskStore.getState().runs.flatMap((run) =>
    run.status === 'running' || run.status === 'failed' ? run.problems : []
  )
}
