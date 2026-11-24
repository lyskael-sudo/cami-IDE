import { useEffect } from 'react'
import {
  installLanguageServices,
  resetLanguageDocuments,
  useActiveDocumentSymbols,
  useLanguageDocumentSync
} from './languageServices'

export function WorkspaceLanguageServices(): null {
  useLanguageDocumentSync()
  useActiveDocumentSymbols()

  useEffect(() => {
    installLanguageServices()
    return () => {
      resetLanguageDocuments(false)
    }
  }, [])

  return null
}
