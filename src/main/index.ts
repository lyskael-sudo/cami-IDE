import { app, BrowserWindow, session, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { guardWindowClose, registerIpcHandlers } from './ipcHandlers'
import { installApplicationMenu, installWindowShortcuts } from './menu'

app.setName('Cami')
app.setAppUserModelId('com.cami.ide')

const hasSingleInstanceLock = app.requestSingleInstanceLock()
let mainWindow: BrowserWindow | null = null
let disposeIpcHandlers: (() => void) | null = null
const developmentUrl = process.env.VITE_DEV_SERVER_URL
const productionEntryUrl = pathToFileURL(path.join(__dirname, '../../dist/index.html'))

function isApplicationNavigation(rawUrl: string): boolean {
  try {
    const targetUrl = new URL(rawUrl)

    if (developmentUrl) {
      return targetUrl.origin === new URL(developmentUrl).origin
    }

    return (
      targetUrl.protocol === 'file:' &&
      targetUrl.pathname === productionEntryUrl.pathname
    )
  } catch {
    return false
  }
}

function openExternalUrl(rawUrl: string): void {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      void shell.openExternal(url.toString())
    }
  } catch {
    // Invalid or unsupported URLs are intentionally ignored.
  }
}

function hardenWebContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      openExternalUrl(url)
      return { action: 'deny' }
    })

    contents.on('will-navigate', (event, navigationUrl) => {
      if (isApplicationNavigation(navigationUrl)) {
        return
      }

      event.preventDefault()
      openExternalUrl(navigationUrl)
    })

    contents.on('will-redirect', (event, redirectUrl) => {
      if (isApplicationNavigation(redirectUrl)) {
        return
      }

      event.preventDefault()
    })

    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })
}

function configureSession(): void {
  const allowedPermissions = new Set(['clipboard-read', 'clipboard-sanitized-write'])

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission))
  })

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return allowedPermissions.has(permission)
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    title: 'Cami',
    ...(process.platform === 'linux'
      ? { icon: path.join(__dirname, '../../assets/icons/512x512.png') }
      : {}),
    backgroundColor: '#0b0e13',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })

  mainWindow = window
  guardWindowClose(window)
  installWindowShortcuts(window)

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show()
    }
  })

  const sendMaximizedState = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send('window:maximized', window.isMaximized())
    }
  }

  window.on('maximize', sendMaximizedState)
  window.on('unmaximize', sendMaximizedState)
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  if (developmentUrl) {
    void window.loadURL(developmentUrl)
  } else {
    void window.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  return window
}

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
  })

  hardenWebContents()

  void app
    .whenReady()
    .then(() => {
      app.setAboutPanelOptions({
        applicationName: 'Cami',
        applicationVersion: app.getVersion(),
        version: `Electron ${process.versions.electron}`,
        copyright: 'Copyright © 2026 Cami',
        credits: 'Éditeur de code de bureau propulsé par Electron, React et Monaco.'
      })

      configureSession()
      disposeIpcHandlers = registerIpcHandlers(() => mainWindow)
      installApplicationMenu(() => mainWindow)
      createWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow()
        }
      })
    })
    .catch((error: unknown) => {
      console.error('[Cami] Impossible de démarrer l’application :', error)
      app.quit()
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    disposeIpcHandlers?.()
    disposeIpcHandlers = null
  })
}

process.on('unhandledRejection', (reason) => {
  console.error('[Cami] Promesse rejetée sans gestionnaire :', reason)
})
