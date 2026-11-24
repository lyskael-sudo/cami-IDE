import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../preload'

type WindowGetter = () => BrowserWindow | null

interface ShortcutDefinition {
  code: string
  command: MenuCommand
  primary?: boolean
  shift?: boolean
  alt?: boolean
}

const shortcutDefinitions: ShortcutDefinition[] = [
  { code: 'KeyP', command: 'quick-open' },
  { code: 'KeyO', command: 'open-workspace' },
  { code: 'KeyN', command: 'new-file' },
  { code: 'KeyN', command: 'new-folder', shift: true },
  { code: 'KeyS', command: 'save-active' },
  { code: 'KeyS', command: 'save-all', alt: true },
  { code: 'KeyW', command: 'close-active-tab' },
  { code: 'KeyP', command: 'command-palette', shift: true },
  { code: 'KeyF', command: 'focus-search', shift: true },
  { code: 'Backslash', command: 'split-editor' },
  { code: 'KeyJ', command: 'toggle-panel' },
  { code: 'KeyB', command: 'toggle-sidebar' },
  { code: 'Backquote', command: 'toggle-terminal' },
  { code: 'KeyM', command: 'show-problems', shift: true },
  { code: 'KeyU', command: 'show-output', shift: true },
  { code: 'KeyG', command: 'show-git', shift: true },
  { code: 'KeyD', command: 'show-debug', shift: true },
  { code: 'KeyB', command: 'run-task', shift: true },
  { code: 'KeyY', command: 'show-debug-console', shift: true },
  { code: 'KeyO', command: 'show-symbols', shift: true },
  { code: 'KeyT', command: 'workspace-symbols' },
  { code: 'KeyF', command: 'format-document', shift: true, alt: true },
  { code: 'F5', command: 'debug-start-or-continue', primary: false },
  { code: 'F5', command: 'debug-stop', primary: false, shift: true },
  { code: 'F9', command: 'debug-toggle-breakpoint', primary: false },
  { code: 'F10', command: 'debug-step-over', primary: false },
  { code: 'F11', command: 'debug-step-into', primary: false },
  { code: 'F11', command: 'debug-step-out', primary: false, shift: true }
]

function dispatchCommand(getWindow: WindowGetter, command: MenuCommand): void {
  const target = BrowserWindow.getFocusedWindow() ?? getWindow()
  if (!target || target.isDestroyed()) {
    return
  }

  target.webContents.send('menu:command', command)
}

export function installWindowShortcuts(window: BrowserWindow): void {
  const usesCommandKey = process.platform === 'darwin'

  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') {
      return
    }

    const primaryModifier = usesCommandKey ? input.meta : input.control
    const oppositeModifier = usesCommandKey ? input.control : input.meta
    if (oppositeModifier) {
      return
    }

    if (primaryModifier && input.code === 'KeyW' && input.shift && !input.alt) {
      event.preventDefault()
      if (!input.isAutoRepeat) {
        window.close()
      }
      return
    }

    if (primaryModifier && input.code === 'KeyQ' && !input.shift && !input.alt) {
      event.preventDefault()
      if (!input.isAutoRepeat) {
        app.quit()
      }
      return
    }

    const shortcut = shortcutDefinitions.find((candidate) => {
      return (
        candidate.code === input.code &&
        Boolean(candidate.primary ?? true) === primaryModifier &&
        Boolean(candidate.shift) === input.shift &&
        Boolean(candidate.alt) === input.alt
      )
    })

    if (!shortcut) {
      return
    }

    event.preventDefault()
    if (!input.isAutoRepeat) {
      dispatchCommand(() => window, shortcut.command)
    }
  })
}

export function installApplicationMenu(getWindow: WindowGetter): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: 'À propos de Cami' },
        { type: 'separator' },
        { role: 'services', label: 'Services' },
        { type: 'separator' },
        { role: 'hide', label: 'Masquer Cami' },
        { role: 'hideOthers', label: 'Masquer les autres' },
        { role: 'unhide', label: 'Tout afficher' },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter Cami' }
      ]
    })
  }

  template.push({
    label: 'Fichier',
    submenu: [
      {
        label: 'Ouvrir rapidement un fichier…',
        accelerator: 'CmdOrCtrl+P',
        click: () => dispatchCommand(getWindow, 'quick-open')
      },
      { type: 'separator' },
      {
        label: 'Ouvrir un dossier…',
        accelerator: 'CmdOrCtrl+O',
        click: () => dispatchCommand(getWindow, 'open-workspace')
      },
      {
        label: 'Nouveau fichier',
        accelerator: 'CmdOrCtrl+N',
        click: () => dispatchCommand(getWindow, 'new-file')
      },
      {
        label: 'Nouveau dossier',
        accelerator: 'CmdOrCtrl+Shift+N',
        click: () => dispatchCommand(getWindow, 'new-folder')
      },
      { type: 'separator' },
      {
        label: 'Enregistrer',
        accelerator: 'CmdOrCtrl+S',
        click: () => dispatchCommand(getWindow, 'save-active')
      },
      {
        label: 'Enregistrer tout',
        accelerator: 'CmdOrCtrl+Alt+S',
        click: () => dispatchCommand(getWindow, 'save-all')
      },
      { type: 'separator' },
      {
        label: 'Fermer l’onglet',
        accelerator: 'CmdOrCtrl+W',
        click: () => dispatchCommand(getWindow, 'close-active-tab')
      },
      {
        label: 'Fermer tous les onglets',
        click: () => dispatchCommand(getWindow, 'close-all-tabs')
      },
      {
        label: 'Fermer la fenêtre',
        accelerator: 'CmdOrCtrl+Shift+W',
        role: 'close'
      },
      { type: 'separator' },
      isMac
        ? { role: 'quit', label: 'Quitter Cami' }
        : { role: 'quit', label: 'Quitter Cami', accelerator: 'CmdOrCtrl+Q' }
    ]
  })

  template.push({
    label: 'Édition',
    submenu: [
      { role: 'undo', label: 'Annuler' },
      { role: 'redo', label: 'Rétablir' },
      { type: 'separator' },
      { role: 'cut', label: 'Couper' },
      { role: 'copy', label: 'Copier' },
      { role: 'paste', label: 'Coller' },
      { role: 'delete', label: 'Supprimer' },
      { type: 'separator' },
      { role: 'selectAll', label: 'Tout sélectionner' },
      { type: 'separator' },
      {
        label: 'Formater le document',
        accelerator: 'Shift+Alt+F',
        click: () => dispatchCommand(getWindow, 'format-document')
      }
    ]
  })

  template.push({
    label: 'Affichage',
    submenu: [
      {
        label: 'Palette de commandes…',
        accelerator: 'CmdOrCtrl+Shift+P',
        click: () => dispatchCommand(getWindow, 'command-palette')
      },
      {
        label: 'Rechercher dans le dossier',
        accelerator: 'CmdOrCtrl+Shift+F',
        click: () => dispatchCommand(getWindow, 'focus-search')
      },
      { type: 'separator' },
      {
        label: 'Diviser l’éditeur',
        accelerator: 'CmdOrCtrl+\\',
        click: () => dispatchCommand(getWindow, 'split-editor')
      },
      {
        label: 'Fermer la division',
        click: () => dispatchCommand(getWindow, 'close-split-editor')
      },
      { type: 'separator' },
      {
        label: 'Afficher le panneau',
        accelerator: 'CmdOrCtrl+J',
        click: () => dispatchCommand(getWindow, 'toggle-panel')
      },
      {
        label: 'Afficher la barre latérale',
        accelerator: 'CmdOrCtrl+B',
        click: () => dispatchCommand(getWindow, 'toggle-sidebar')
      },
      {
        label: 'Terminal intégré',
        accelerator: 'CmdOrCtrl+`',
        click: () => dispatchCommand(getWindow, 'toggle-terminal')
      },
      {
        label: 'Problèmes',
        accelerator: 'CmdOrCtrl+Shift+M',
        click: () => dispatchCommand(getWindow, 'show-problems')
      },
      {
        label: 'Sortie',
        accelerator: 'CmdOrCtrl+Shift+U',
        click: () => dispatchCommand(getWindow, 'show-output')
      },
      { type: 'separator' },
      {
        label: 'Contrôle de source',
        accelerator: 'CmdOrCtrl+Shift+G',
        click: () => dispatchCommand(getWindow, 'show-git')
      },
      {
        label: 'Exécuter et déboguer',
        accelerator: 'CmdOrCtrl+Shift+D',
        click: () => dispatchCommand(getWindow, 'show-debug')
      },
      {
        label: 'Tâches',
        accelerator: 'CmdOrCtrl+Shift+B',
        click: () => dispatchCommand(getWindow, 'run-task')
      },
      {
        label: 'Console de débogage',
        accelerator: 'CmdOrCtrl+Shift+Y',
        click: () => dispatchCommand(getWindow, 'show-debug-console')
      },
      {
        label: 'Plan du fichier',
        accelerator: 'CmdOrCtrl+Shift+O',
        click: () => dispatchCommand(getWindow, 'show-symbols')
      },
      {
        label: 'Symboles du dossier',
        accelerator: 'CmdOrCtrl+T',
        click: () => dispatchCommand(getWindow, 'workspace-symbols')
      },
      { type: 'separator' },
      ...(app.isPackaged
        ? []
        : ([
            { role: 'reload', label: 'Recharger' },
            { role: 'forceReload', label: 'Forcer le rechargement' },
            { role: 'toggleDevTools', label: 'Outils de développement' },
            { type: 'separator' }
          ] satisfies MenuItemConstructorOptions[])),
      { role: 'resetZoom', label: 'Taille réelle' },
      { role: 'zoomIn', label: 'Zoom avant' },
      { role: 'zoomOut', label: 'Zoom arrière' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Plein écran' }
    ]
  })

  template.push({
    label: 'Exécution',
    submenu: [
      {
        label: 'Démarrer ou continuer',
        accelerator: 'F5',
        click: () => dispatchCommand(getWindow, 'debug-start-or-continue')
      },
      {
        label: 'Arrêter le débogage',
        accelerator: 'Shift+F5',
        click: () => dispatchCommand(getWindow, 'debug-stop')
      },
      { type: 'separator' },
      {
        label: 'Pas à pas par-dessus',
        accelerator: 'F10',
        click: () => dispatchCommand(getWindow, 'debug-step-over')
      },
      {
        label: 'Pas à pas dans',
        accelerator: 'F11',
        click: () => dispatchCommand(getWindow, 'debug-step-into')
      },
      {
        label: 'Sortir de la fonction',
        accelerator: 'Shift+F11',
        click: () => dispatchCommand(getWindow, 'debug-step-out')
      },
      {
        label: 'Activer ou désactiver un point d’arrêt',
        accelerator: 'F9',
        click: () => dispatchCommand(getWindow, 'debug-toggle-breakpoint')
      },
      { type: 'separator' },
      {
        label: 'Exécuter une tâche…',
        accelerator: 'CmdOrCtrl+Shift+B',
        click: () => dispatchCommand(getWindow, 'run-task')
      }
    ]
  })

  if (isMac) {
    template.push({
      label: 'Fenêtre',
      submenu: [
        { role: 'minimize', label: 'Réduire' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Tout ramener au premier plan' }
      ]
    })
  }

  template.push({
    label: 'Aide',
    submenu: [
      {
        label: 'À propos de Cami',
        click: () => app.showAboutPanel()
      }
    ]
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
