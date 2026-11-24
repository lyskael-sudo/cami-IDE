import { create } from 'zustand'
import type { LspDiagnostic, LspDocumentSymbol, LspServerStatus } from '../../preload'

interface LanguageState {
  servers: LspServerStatus[]
  diagnostics: Record<string, LspDiagnostic[]>
  symbols: Record<string, LspDocumentSymbol[]>
  symbolsLoading: Record<string, boolean>
  clearWorkspace: () => void
  setServers: (servers: LspServerStatus[]) => void
  setDiagnostics: (path: string, diagnostics: LspDiagnostic[]) => void
  clearDiagnostics: (path: string) => void
  setSymbols: (path: string, symbols: LspDocumentSymbol[]) => void
  setSymbolsLoading: (path: string, loading: boolean) => void
  clearSymbols: (path: string) => void
}

export const useLanguageStore = create<LanguageState>((set) => ({
  servers: [],
  diagnostics: {},
  symbols: {},
  symbolsLoading: {},

  clearWorkspace: () => {
    set({ servers: [], diagnostics: {}, symbols: {}, symbolsLoading: {} })
  },

  setServers: (servers) => {
    set({ servers })
  },

  setDiagnostics: (path, diagnostics) => {
    set((state) => ({
      diagnostics: {
        ...state.diagnostics,
        [path]: diagnostics
      }
    }))
  },

  clearDiagnostics: (path) => {
    set((state) => {
      if (!(path in state.diagnostics)) {
        return state
      }
      const diagnostics = { ...state.diagnostics }
      delete diagnostics[path]
      return { diagnostics }
    })
  },

  setSymbols: (path, symbols) => {
    set((state) => ({
      symbols: {
        ...state.symbols,
        [path]: symbols
      },
      symbolsLoading: {
        ...state.symbolsLoading,
        [path]: false
      }
    }))
  },

  setSymbolsLoading: (path, loading) => {
    set((state) => ({
      symbolsLoading: {
        ...state.symbolsLoading,
        [path]: loading
      }
    }))
  },

  clearSymbols: (path) => {
    set((state) => {
      if (!(path in state.symbols) && !(path in state.symbolsLoading)) {
        return state
      }
      const symbols = { ...state.symbols }
      const symbolsLoading = { ...state.symbolsLoading }
      delete symbols[path]
      delete symbolsLoading[path]
      return { symbols, symbolsLoading }
    })
  }
}))
