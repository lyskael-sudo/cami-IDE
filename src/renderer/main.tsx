import '@xterm/xterm/css/xterm.css'
import './index.css'
import {
  Component,
  StrictMode,
  type ErrorInfo,
  type ReactNode
} from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    hasError: false
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Cami] Erreur de rendu :', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="fatal-error">
          <span className="fatal-error-mark" aria-hidden="true">
            C
          </span>
          <h1>L’interface a rencontré une erreur.</h1>
          <p>
            Vos fichiers restent sur le disque. Rechargez l’interface pour reprendre votre
            session.
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              window.location.reload()
            }}
          >
            Recharger Cami
          </button>
        </main>
      )
    }

    return this.props.children
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('L’élément racine de Cami est introuvable.')
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
