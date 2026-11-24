import { Bot, LoaderCircle, Send, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { GoleAIProvider, GoleBrowser, GoleChatEvent, GolePreferences } from '../../preload'
import { useEditorStore } from '../store/editorStore'

const DEFAULT_PREFERENCES: GolePreferences = { browser: 'cami-browser', ai: 'deepseek' }
const BROWSERS: { value: GoleBrowser; label: string }[] = [
  { value: 'cami-browser', label: 'Navigateur Cami' },
  { value: 'chromium', label: 'Chromium' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'brave', label: 'Brave' },
  { value: 'librewolf', label: 'LibreWolf' },
  { value: 'tor', label: 'Tor Browser' }
]
const AI_PROVIDERS: { value: GoleAIProvider; label: string }[] = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'gemini', label: 'Gemini' }
]

type ChatEntryKind = 'user' | 'assistant' | 'thought' | 'tool' | 'result' | 'error'

interface ChatEntry {
  id: string
  kind: ChatEntryKind
  text: string
}

function displayToolArgs(args: Record<string, unknown>): string {
  const entry = Object.entries(args).find(([, value]) => typeof value === 'string')
  if (!entry) {
    return ''
  }
  const [key, value] = entry
  return ` · ${key}: ${String(value).replace(/\s+/g, ' ').slice(0, 100)}`
}

function displayResult(result: unknown): string {
  if (typeof result === 'string') {
    return result.replace(/\s+/g, ' ').slice(0, 180)
  }
  if (result === null || result === undefined) {
    return ''
  }
  return String(result).slice(0, 180)
}

export function GoleChatPanel(): React.JSX.Element {
  const workspace = useEditorStore((state) => state.workspace)
  const openWorkspace = useEditorStore((state) => state.openWorkspace)
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<
    'idle' | 'starting' | 'running' | 'waiting-login' | 'ready'
  >('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preferences, setPreferences] = useState<GolePreferences>(DEFAULT_PREFERENCES)
  const [savedPreferences, setSavedPreferences] = useState<GolePreferences>(DEFAULT_PREFERENCES)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const [preferencesError, setPreferencesError] = useState<string | null>(null)
  const [savingPreferences, setSavingPreferences] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  const preferencesChanged =
    preferences.browser !== savedPreferences.browser || preferences.ai !== savedPreferences.ai

  const appendEntry = (kind: ChatEntryKind, text: string): void => {
    setEntries((current) => [...current, { id: crypto.randomUUID(), kind, text }])
  }

  useEffect(() => {
    let active = true
    void window.electronAPI.gole.getPreferences().then(
      (stored) => {
        if (active) {
          setPreferences(stored)
          setSavedPreferences(stored)
          setPreferencesLoaded(true)
        }
      },
      (cause: unknown) => {
        if (active) {
          const message = cause instanceof Error ? cause.message : String(cause)
          setPreferencesError(message)
          setPreferencesLoaded(true)
        }
      }
    )
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    return window.electronAPI.gole.onEvent((event: GoleChatEvent) => {
      switch (event.type) {
        case 'state':
          setStatus(event.state)
          if (event.state === 'running') {
            setBusy(true)
          }
          break
        case 'thought':
          appendEntry('thought', event.text)
          break
        case 'tool-call':
          appendEntry('tool', `${event.name}${displayToolArgs(event.args)}`)
          if (event.name === 'run_command' && typeof event.args.command === 'string') {
            useEditorStore.getState().appendOutput('info', `[Gole] $ ${event.args.command}`)
          }
          break
        case 'tool-result': {
          const result = displayResult(event.result)
          appendEntry('result', `${event.isError ? 'Échec' : 'Terminé'}${result ? ` · ${result}` : ''}`)
          if (event.name === 'run_command') {
            const output =
              typeof event.result === 'string' ? event.result.slice(0, 1_500) : result
            useEditorStore
              .getState()
              .appendOutput(
                event.isError ? 'error' : 'success',
                `[Gole] ${output || 'Commande terminée.'}`
              )
          }
          break
        }
        case 'assistant':
          appendEntry('assistant', event.text)
          setBusy(false)
          setError(null)
          break
        case 'login-required':
          appendEntry('thought', event.message)
          setStatus('waiting-login')
          break
        case 'login-restored':
          appendEntry('thought', 'Connexion rétablie. Gole reprend sa tâche.')
          setStatus('running')
          break
        case 'error':
          setError(event.message)
          appendEntry('error', event.message)
          setBusy(false)
          setStatus('idle')
          break
      }
    })
  }, [])

  useEffect(() => {
    setEntries([])
    setBusy(false)
    setStatus('idle')
    setError(null)
  }, [workspace?.path])

  useEffect(() => {
    const container = messagesRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  }, [entries])

  const applyPreferences = async (): Promise<void> => {
    setSavingPreferences(true)
    setPreferencesError(null)
    try {
      await window.electronAPI.gole.setPreferences(preferences)
      setSavedPreferences(preferences)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setPreferencesError(message)
    } finally {
      setSavingPreferences(false)
    }
  }

  const sendMessage = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || busy || !workspace || preferencesChanged || !preferencesLoaded) {
      return
    }

    setDraft('')
    setBusy(true)
    setError(null)
    appendEntry('user', text)

    try {
      const state = useEditorStore.getState()
      const activePath =
        state.splitOpen && state.activePane === 'secondary'
          ? state.secondaryFilePath
          : state.activeFilePath
      const file = state.openFiles.find((openFile) => openFile.path === activePath)
      const workspacePath = state.workspace?.path
      const relativePath =
        activePath && workspacePath && activePath.startsWith(`${workspacePath}/`)
          ? activePath.slice(workspacePath.length + 1).replace(/\\/g, '/')
          : null
      const context = relativePath
        ? `\n\nContexte Cami : le fichier actif est ${JSON.stringify(relativePath)}, curseur à la ligne ${state.cursor.line}.${file?.isDirty ? ' Ce fichier a des modifications non enregistrées dans l’éditeur ; le contenu sur disque peut être plus ancien.' : ''}`
        : ''
      await window.electronAPI.gole.send(
        context && text.length + context.length <= 8_000 ? `${text}${context}` : text,
        preferences
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      appendEntry('error', message)
      setBusy(false)
      setStatus('idle')
    }
  }

  return (
    <section className="sidebar-view gole-chat-panel" aria-label="Chat Gole">
      <div className="gole-chat-header">
        <div className="gole-chat-brand">
          <span className="gole-chat-mark"><Bot size={14} /></span>
          <span>Gole</span>
        </div>
        <span className={`gole-chat-status is-${status}`}>
          {status === 'starting'
            ? 'Démarrage…'
            : status === 'waiting-login'
              ? 'Reconnexion requise'
              : status === 'running'
                ? 'En cours'
                : status === 'ready'
                  ? 'Prêt'
                  : 'Hors ligne'}
        </span>
      </div>

      <div className="gole-chat-settings">
        <label>
          <span>Navigateur</span>
          <select
            value={preferences.browser}
            disabled={!preferencesLoaded || busy || savingPreferences}
            onChange={(event) =>
              setPreferences((current) => ({ ...current, browser: event.target.value as GoleBrowser }))
            }
          >
            {BROWSERS.map((browser) => (
              <option key={browser.value} value={browser.value}>{browser.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>IA</span>
          <select
            value={preferences.ai}
            disabled={!preferencesLoaded || busy || savingPreferences}
            onChange={(event) =>
              setPreferences((current) => ({ ...current, ai: event.target.value as GoleAIProvider }))
            }
          >
            {AI_PROVIDERS.map((provider) => (
              <option key={provider.value} value={provider.value}>{provider.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="gole-settings-apply"
          disabled={!preferencesLoaded || !preferencesChanged || busy || savingPreferences}
          onClick={() => void applyPreferences()}
        >
          {savingPreferences ? 'Enregistrement…' : 'Appliquer'}
        </button>
        <span className="gole-settings-hint">
          {!preferencesLoaded
            ? 'Chargement des préférences…'
            : preferencesChanged
              ? 'Appliquez les choix avant le prochain message.'
              : 'Les navigateurs externes doivent être installés.'}
        </span>
        {preferencesError ? <span className="gole-settings-error" role="alert">{preferencesError}</span> : null}
      </div>

      <div ref={messagesRef} className="gole-chat-messages" aria-live="polite">
        {!workspace ? (
          <div className="gole-chat-empty">
            <Bot size={25} strokeWidth={1.5} />
            <strong>Ouvrez un workspace</strong>
            <span>Gole travaillera dans le dossier actuellement ouvert dans Cami.</span>
            <button type="button" className="primary-button" onClick={() => void openWorkspace()}>
              Ouvrir un dossier
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="gole-chat-empty">
            <Bot size={25} strokeWidth={1.5} />
            <strong>Que souhaitez-vous faire ?</strong>
            <span>Gole peut lire et modifier les fichiers du workspace et exécuter des commandes. Utilisez-le uniquement dans un projet de confiance.</span>
          </div>
        ) : (
          entries.map((entry) => (
            <article key={entry.id} className={`gole-chat-entry is-${entry.kind}`}>
              {entry.kind === 'tool' || entry.kind === 'result' ? (
                <span className="gole-chat-entry-label">{entry.kind === 'tool' ? 'Outil' : 'Résultat'}</span>
              ) : null}
              <div>{entry.text}</div>
            </article>
          ))
        )}
        {busy ? (
          <div className="gole-chat-working" role="status">
            <LoaderCircle size={13} className="spin" />
            <span>
              {status === 'starting'
                ? 'Démarrage de Gole…'
                : status === 'waiting-login'
                  ? 'Reconnectez-vous dans la fenêtre du navigateur…'
                  : 'Gole travaille…'}
            </span>
          </div>
        ) : null}
      </div>

      {error ? <div className="gole-chat-error" role="alert">{error}</div> : null}

      <div className="gole-chat-composer">
        <textarea
          aria-label="Message pour Gole"
          placeholder={workspace ? 'Demander à Gole…' : 'Ouvrez un workspace pour commencer'}
          value={draft}
          disabled={!workspace || busy || !preferencesLoaded || preferencesChanged}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void sendMessage()
            }
          }}
        />
        <div className="gole-chat-composer-actions">
          <span>Entrée pour envoyer · Maj+Entrée pour une ligne</span>
          {busy ? (
            <button
              type="button"
              className="gole-chat-send"
              title="Arrêter Gole"
              aria-label="Arrêter Gole"
              onClick={() => {
                void window.electronAPI.gole.stop()
                setBusy(false)
              }}
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              className="gole-chat-send"
              title="Envoyer à Gole"
              aria-label="Envoyer à Gole"
              disabled={!draft.trim() || !workspace || !preferencesLoaded || preferencesChanged}
              onClick={() => void sendMessage()}
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
