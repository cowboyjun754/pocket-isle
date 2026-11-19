import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  safeStorage,
  screen,
  shell,
  Tray,
  type WebContents
} from 'electron'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { extname, join } from 'path'
import { DEFAULT_AI_BASE_URL, DEFAULT_AI_MODEL } from '../shared/aiProvider'
import { SUPPORTED_LOCALES, getMessages, resolveLocale } from '../shared/i18n'
import {
  PANEL,
  STAGE,
  clampPanelBoundsToWorkArea,
  getStageOffsetX,
  isInsideIsland,
  reconcileIslandPosOnDisplayChange,
  resolveSnapSide,
  type DockSide,
  type ExpandMode
} from '../shared/shape'
import type {
  AddResult,
  AiBreakdownResult,
  AiConfigInput,
  AiJointSummaryResult,
  AiOrganizeResult,
  AiTaskKind,
  AppLocale,
  DecorationState,
  FocusStep,
  IslandMemory,
  IslandPose,
  OtterReactionPayload,
  ParcelKind,
  Settings,
  SettingsPatch
} from '../shared/types'
import { AiCredentialStore, validateAiEndpointUrl, type SecretCodec } from './aiSecrets'
import {
  breakdownFocusGoal,
  extractFilesBatch,
  IMAGE_EXTS,
  isAbortError,
  organizeAndSummarize,
  readTextFilePreview,
  recommendDecoration,
  summarizeDocumentsTogether,
  TEXT_EXTS,
  testConnection
} from './aiService'
import { buildClipboardFilename } from './clipboardRules'
import { Dock } from './dock'
import { FocusController } from './focusTimer'
import { makeDragIcon, makeTrayIcon } from './icons'
import { applySettingsPatch } from './settingsRules'
import { Store } from './store'
import { disposeExtractWorker, extractTextInWorker } from './workerExtractRunner'

const exitEarly = process.argv.includes('--quit')
if (!app.requestSingleInstanceLock() || exitEarly) {
  app.quit()
}

let island: BrowserWindow | null = null
let panel: BrowserWindow | null = null
let tray: Tray | null = null
let store: Store
let aiSecrets: AiCredentialStore
let dock: Dock
let focusCtrl: FocusController
let quitting = false
let dragOutActive = false
let dragGraceUntil = 0
let movingIsland = false
let justSnapped = false
let dragOrigin: {
  curX: number
  curY: number
  winX: number
  winY: number
  lastX: number
  lastY: number
  startSide: DockSide
  wa: Electron.Rectangle
} | null = null
let panelHiddenAt = 0
let panelPinned = false
let panelCustomMoved = false
let positioningPanel = false
let ignorePanelMoveUntil = 0
let lastPanelSize: { w: number; h: number } | null = null
let holdExpandUntil = 0
let ignoringMouse = true
let hovering = false
let expandMode: ExpandMode = 'docked'
let collapseTimer: NodeJS.Timeout | null = null
let pollTimer: NodeJS.Timeout | null = null
let activeAiAbort: AbortController | null = null
const MAX_THUMB_CACHE = 128
const thumbCache = new Map<string, string | null>()
const EXECUTABLE_EXTS = new Set([
  'exe',
  'msi',
  'bat',
  'cmd',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'ps1',
  'psm1',
  'scr',
  'com',
  'lnk',
  'hta',
  'reg',
  'jar'
])
const SHORTCUT = 'Control+Alt+Space'

// ---------- General Helpers ----------

function webPrefs(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false
  }
}

function harden(wc: WebContents): void {
  wc.on('will-navigate', (e) => e.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
}

async function readClipboardImagePng(): Promise<Buffer | null> {
  try {
    const entries = await clipboard.read()
    for (const item of entries) {
      const imgMime = item.types.find((t) => t === 'image/png' || t.startsWith('image/'))
      if (!imgMime) continue
      const blob = await item.getType(imgMime)
      if (!(blob instanceof Blob)) continue
      const raw = Buffer.from(await blob.arrayBuffer())
      if (!raw.length) continue
      if (imgMime === 'image/png') return raw
      const img = nativeImage.createFromBuffer(raw)
      if (!img.isEmpty()) return img.toPNG()
    }
  } catch {
    /* Fall back to text clipboard detection when image read is empty or unsupported */
  }
  return null
}

function loadView(win: BrowserWindow, view: 'island' | 'panel'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) win.loadURL(`${devUrl}#${view}`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash: view })
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of [island, panel]) if (w && !w.isDestroyed()) w.webContents.send(channel, ...args)
}

function currentLocale(): AppLocale {
  return resolveLocale(store?.data?.settings?.locale)
}

function publicSettings(): Settings {
  return {
    ...store.data.settings,
    locale: currentLocale(),
    ai: aiSecrets.toPublicAiConfig(store.data.settings.ai)
  }
}

/**
 * Emits contextual otter reactions while enforcing UX constraints:
 * 1. Never force-expands the island when docked;
 * 2. Keeps the otter quiet without bubble popups while focus timer is actively running.
 */
function emitOtterReaction(react: OtterReactionPayload, allowDuringFocus = false): void {
  const f = store.data.focus
  if (!allowDuringFocus && f.phase === 'focus' && f.running) {
    return
  }
  broadcast('otter:react', react)
}

function currentSide(): DockSide {
  return store.data.dockSide ?? 'right'
}

function currentPose(): IslandPose {
  const side = currentSide()
  return {
    side,
    mode: side === 'free' ? 'full' : expandMode,
    hover: hovering
  }
}

function pushPose(): void {
  if (island && !island.isDestroyed()) {
    island.webContents.send('island:pose', currentPose())
  }
}

function cancelCollapse(): void {
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
}

function scheduleCollapse(delayMs = 1500): void {
  cancelCollapse()
  if (currentSide() === 'free') return
  const actualDelay = Math.max(delayMs, holdExpandUntil - Date.now())
  collapseTimer = setTimeout(() => {
    if (hovering || movingIsland || dragOutActive || Date.now() < dragGraceUntil || panel?.isVisible()) {
      return
    }
    if (Date.now() < holdExpandUntil) {
      scheduleCollapse(holdExpandUntil - Date.now())
      return
    }
    if (expandMode !== 'docked') {
      expandMode = 'docked'
      pushPose()
    }
  }, actualDelay)
}

function setMode(next: ExpandMode): void {
  cancelCollapse()
  const side = currentSide()
  const target: ExpandMode = side === 'free' ? 'full' : next
  if (expandMode !== target) {
    expandMode = target
    pushPose()
  }
  if (!hovering && target !== 'docked' && !panel?.isVisible()) {
    scheduleCollapse(1600)
  }
}

// ---------- Island Window & Left/Right Edge Positioning ----------

function defaultPos(side: DockSide = 'right'): { x: number; y: number } {
  const wa = screen.getPrimaryDisplay().workArea
  const x = side === 'left' ? wa.x : wa.x + wa.width - STAGE.w
  const y = Math.round(wa.y + wa.height * 0.62)
  return { x, y }
}

function clampToEdge(pos: { x: number; y: number }, side: DockSide): { x: number; y: number } {
  const disp = screen.getDisplayMatching({ x: pos.x, y: pos.y, width: STAGE.w, height: STAGE.h })
  const wa = disp.workArea
  const y = Math.min(Math.max(pos.y, wa.y), wa.y + wa.height - STAGE.h)
  if (side === 'right') return { x: wa.x + wa.width - STAGE.w, y }
  if (side === 'left') return { x: wa.x, y }
  const x = Math.min(Math.max(pos.x, wa.x), wa.x + wa.width - STAGE.w)
  return { x, y }
}

function isPosVisible(p?: { x: number; y: number }): p is { x: number; y: number } {
  if (!p) return false
  const cx = p.x + STAGE.w / 2
  const cy = p.y + STAGE.h / 2
  return screen
    .getAllDisplays()
    .some(({ workArea: a }) => cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height)
}

function createIsland(): void {
  const side = currentSide()
  const saved = store.data.islandPos
  const rawPos = isPosVisible(saved) ? saved : defaultPos(side === 'free' ? 'right' : side)
  const pos = clampToEdge(rawPos, side)
  store.update((d) => (d.islandPos = pos))
  expandMode = side === 'free' ? 'full' : 'docked'

  island = new BrowserWindow({
    width: STAGE.w,
    height: STAGE.h,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: store.data.settings.alwaysOnTop,
    show: false,
    title: getMessages(currentLocale()).appName,
    webPreferences: webPrefs()
  })
  island.setIgnoreMouseEvents(true, { forward: true })
  const showOnce = (): void => {
    if (!island || island.isDestroyed()) return
    island.show()
    island.setAlwaysOnTop(store.data.settings.alwaysOnTop, 'screen-saver')
    island.moveTop()
    pushPose()
  }
  island.once('ready-to-show', showOnce)
  island.webContents.once('did-finish-load', showOnce)
  island.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      hideIsland()
    }
  })
  harden(island.webContents)
  loadView(island, 'island')
}

function syncIslandMouseIgnore(forceApply = false, forward = true): boolean {
  if (!island || island.isDestroyed()) return false
  const p = screen.getCursorScreenPoint()
  const b = island.getBounds()
  const side = currentSide()
  const mode: ExpandMode = side === 'free' ? 'full' : expandMode
  const inside = isInsideIsland(
    p.x - b.x,
    p.y - b.y,
    side,
    mode,
    dock.items.length > 0,
    dock.hasActiveUndo()
  )

  if (!inside && justSnapped) {
    justSnapped = false
  }

  if (forceApply || inside === ignoringMouse) {
    ignoringMouse = !inside
    if (forward) {
      island.setIgnoreMouseEvents(ignoringMouse, { forward: true })
    } else {
      island.setIgnoreMouseEvents(ignoringMouse)
    }
  }
  return inside
}

function startPointerPoll(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    if (!island || island.isDestroyed() || !island.isVisible()) return
    if (movingIsland || dragOutActive) return

    const inside = syncIslandMouseIgnore(false)
    const side = currentSide()

    if (inside !== hovering) {
      hovering = inside
      if (inside) {
        cancelCollapse()
        if (side !== 'free' && expandMode === 'docked' && !justSnapped) {
          expandMode = 'peek'
        }
      } else if (!movingIsland && !panel?.isVisible()) {
        scheduleCollapse(1500)
      }
      pushPose()
    }
  }, 33)
}

function stopPointerPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function showIsland(): void {
  if (!island) return
  if (!isPosVisible(store.data.islandPos)) resetPosition('right')
  island.show()
  island.setAlwaysOnTop(store.data.settings.alwaysOnTop, 'screen-saver')
  startPointerPoll()
  pushPose()
  rebuildTrayMenu()
}

function hideIsland(): void {
  hidePanel()
  stopPointerPoll()
  island?.hide()
  rebuildTrayMenu()
}

function toggleIsland(): void {
  if (island?.isVisible()) hideIsland()
  else showIsland()
}

function resetPosition(side: DockSide = 'right'): void {
  const p = defaultPos(side)
  store.update((d) => {
    d.dockSide = side
    d.islandPos = p
  })
  const panelOpen = !!panel?.isVisible()
  expandMode = side === 'free' || panelOpen ? 'full' : 'docked'
  island?.setPosition(p.x, p.y)
  pushPose()
  rebuildTrayMenu()
  if (panelOpen) positionPanel()
}

function snapAfterMove(origin: { winX: number; startSide: DockSide } | null): void {
  if (!island || island.isDestroyed()) return
  const b = island.getBounds()
  const cur = screen.getCursorScreenPoint()
  const disp = screen.getDisplayMatching(b)
  const wa = disp.workArea

  const nextSide = resolveSnapSide({
    winX: b.x,
    curX: cur.x,
    workAreaX: wa.x,
    workAreaWidth: wa.width,
    startSide: origin?.startSide ?? currentSide(),
    startWinX: origin?.winX ?? b.x
  })

  const clamped = clampToEdge({ x: b.x, y: b.y }, nextSide)
  island.setPosition(Math.round(clamped.x), Math.round(clamped.y))
  store.update((d) => {
    d.dockSide = nextSide
    d.islandPos = clamped
  })
  cancelCollapse()
  if (nextSide === 'free') {
    expandMode = 'full'
  } else {
    expandMode = 'docked'
    justSnapped = true
    hovering = false
  }
  pushPose()
  rebuildTrayMenu()
  if (panel?.isVisible()) positionPanel()
}

// ---------- Operations Panel ----------

function createPanel(): void {
  panel = new BrowserWindow({
    width: PANEL.w,
    height: PANEL.h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: getMessages(currentLocale()).appName,
    webPreferences: webPrefs()
  })
  panel.on('blur', () => {
    if (dragOutActive || Date.now() < dragGraceUntil || panelPinned) return
    hidePanel()
  })
  panel.on('system-context-menu', (e) => e.preventDefault())
  const markCustomMoved = (): void => {
    if (movingIsland || positioningPanel || Date.now() < ignorePanelMoveUntil || !panel?.isVisible()) {
      return
    }
    panelCustomMoved = true
  }
  panel.on('will-move', markCustomMoved)
  panel.on('move', markCustomMoved)
  panel.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      hidePanel()
    }
  })
  harden(panel.webContents)
  loadView(panel, 'panel')
}

function positionPanelAt(
  ibX: number,
  ibY: number,
  origin?: { wa: Electron.Rectangle } | null
): void {
  if (!panel || !island || panelCustomMoved) return
  const cx = ibX + STAGE.w / 2
  const cy = ibY + STAGE.h / 2
  let wa = origin?.wa
  if (
    !wa ||
    cx < wa.x ||
    cx > wa.x + wa.width ||
    cy < wa.y ||
    cy > wa.y + wa.height
  ) {
    wa = screen.getDisplayMatching({ x: ibX, y: ibY, width: STAGE.w, height: STAGE.h }).workArea
    if (origin) origin.wa = wa
  }
  const h = Math.min(PANEL.h, wa.height - 16)
  const gap = 8
  const side = currentSide()

  let x: number
  if (side === 'left') {
    x = ibX + STAGE.w + gap
    if (x + PANEL.w > wa.x + wa.width) x = ibX - PANEL.w - gap
  } else {
    x = ibX - PANEL.w - gap
    if (x < wa.x) x = ibX + STAGE.w + gap
  }
  x = Math.min(Math.max(x, wa.x + gap), wa.x + wa.width - PANEL.w - gap)
  let y = ibY + Math.round((STAGE.h - h) / 2)
  y = Math.min(Math.max(y, wa.y + gap), wa.y + wa.height - h - gap)
  const rx = Math.round(x)
  const ry = Math.round(y)

  positioningPanel = true
  ignorePanelMoveUntil = Date.now() + 140
  try {
    // Use setPosition during high-frequency moves to avoid transparent window DWM resize stutter
    if (lastPanelSize && lastPanelSize.w === PANEL.w && lastPanelSize.h === h) {
      panel.setPosition(rx, ry)
    } else {
      panel.setBounds({ x: rx, y: ry, width: PANEL.w, height: h })
      lastPanelSize = { w: PANEL.w, h }
    }
  } finally {
    positioningPanel = false
    ignorePanelMoveUntil = Date.now() + 140
  }
}

function positionPanel(): void {
  if (!panel || !island || panelCustomMoved) return
  const ib = island.getBounds()
  positionPanelAt(ib.x, ib.y)
}

function showPanel(): void {
  if (!panel) createPanel()
  setMode('full')
  positionPanel()
  panel!.show()
  panel!.focus()
  panel!.webContents.send('dock:changed')
  panel!.webContents.send('dock:undoChanged', dock.getUndoState())
}

function hidePanel(): void {
  panelCustomMoved = false
  if (panel?.isVisible()) {
    panel.hide()
    panelHiddenAt = Date.now()
    if (!hovering) scheduleCollapse(1200)
  }
}

function togglePanel(): void {
  if (panel?.isVisible()) return hidePanel()
  if (Date.now() - panelHiddenAt < 250) return
  showPanel()
}

// ---------- System Tray ----------

function applySettingsUpdate(rawPatch: SettingsPatch): Settings {
  const res = applySettingsPatch(store.data.settings, rawPatch, app.isPackaged)
  store.update((d) => {
    d.settings = res.next
  })
  if (res.alwaysOnTopChanged) {
    island?.setAlwaysOnTop(res.next.alwaysOnTop, 'screen-saver')
  }
  if (res.openAtLoginChanged) {
    app.setLoginItemSettings({ openAtLogin: res.next.openAtLogin })
  }
  if (res.localeChanged) {
    const m = getMessages(res.next.locale)
    island?.setTitle(m.appName)
    panel?.setTitle(m.appName)
    tray?.setToolTip(m.tray.tooltip)
  }
  if (typeof rawPatch?.focusMinutes === 'number') {
    focusCtrl.syncIdleDuration()
  }
  rebuildTrayMenu()
  const pub = publicSettings()
  broadcast('settings:changed', pub)
  return pub
}

function rebuildTrayMenu(): void {
  if (!tray) return
  const s = store.data.settings
  const loc = currentLocale()
  const t = getMessages(loc).tray
  const side = currentSide()
  const menu = Menu.buildFromTemplate([
    { label: island?.isVisible() ? t.hideIsland : t.showIsland, click: toggleIsland },
    { label: t.openPanel, click: () => (island?.isVisible() || showIsland(), showPanel()) },
    { type: 'separator' },
    {
      label: t.dockRight,
      type: 'radio',
      checked: side === 'right',
      click: () => (resetPosition('right'), showIsland())
    },
    {
      label: t.dockLeft,
      type: 'radio',
      checked: side === 'left',
      click: () => (resetPosition('left'), showIsland())
    },
    {
      label: t.alwaysOnTop,
      type: 'checkbox',
      checked: s.alwaysOnTop,
      click: (item) => applySettingsUpdate({ alwaysOnTop: item.checked })
    },
    {
      label: app.isPackaged ? t.openAtLoginReady : t.openAtLoginPackagedOnly,
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: s.openAtLogin,
      click: (item) => applySettingsUpdate({ openAtLogin: item.checked })
    },
    {
      label: t.languageMenu,
      submenu: SUPPORTED_LOCALES.map((entry) => ({
        label: entry.label,
        type: 'radio',
        checked: loc === entry.id,
        click: () => applySettingsUpdate({ locale: entry.id })
      }))
    },
    { label: t.openDataDir, click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    {
      label: t.quit,
      click: () => {
        quitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
}

function createTray(): void {
  tray = new Tray(makeTrayIcon())
  tray.setToolTip(getMessages(currentLocale()).tray.tooltip)
  tray.on('click', toggleIsland)
  rebuildTrayMenu()
}

// ---------- IPC ----------

function isTrustedIpcEvent(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  const sender = e.sender
  if (!sender || sender.isDestroyed()) return false
  const isKnownWindow =
    (island && !island.isDestroyed() && sender === island.webContents) ||
    (panel && !panel.isDestroyed() && sender === panel.webContents)
  if (!isKnownWindow) return false
  if (!e.senderFrame || e.senderFrame !== sender.mainFrame) return false
  const url = e.senderFrame.url || ''
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl && url.startsWith(devUrl)) return true
  return url.startsWith('file://')
}

function registerIpc(): void {
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

  const handleTrusted = <A extends unknown[], R>(
    channel: string,
    fn: (e: Electron.IpcMainInvokeEvent, ...args: A) => R
  ): void => {
    ipcMain.handle(channel, (e, ...args) => {
      if (!isTrustedIpcEvent(e)) {
        throw new Error(`Untrusted IPC sender on ${channel}`)
      }
      return fn(e, ...(args as A))
    })
  }

  const onTrusted = <A extends unknown[]>(
    channel: string,
    fn: (e: Electron.IpcMainEvent, ...args: A) => void
  ): void => {
    ipcMain.on(channel, (e, ...args) => {
      if (!isTrustedIpcEvent(e)) return
      fn(e, ...(args as A))
    })
  }

  handleTrusted('dock:list', () => dock.listWithStatus())
  handleTrusted('island:getPose', () => currentPose())

  handleTrusted('dock:add', async (_e, paths: unknown): Promise<AddResult> => {
    const r = await dock.add(strArr(paths))
    broadcast('dock:changed')
    island?.webContents.send('island:received', r)
    if (panel?.isVisible()) panel.webContents.send('island:received', r)
    if (!hovering && !panel?.isVisible()) scheduleCollapse(1200)
    return r
  })

  handleTrusted('dock:pasteClipboard', async (): Promise<AddResult> => {
    const loc = currentLocale()
    const cm = getMessages(loc).clipboard
    const imgPng = await readClipboardImagePng()
    let r: AddResult
    if (imgPng) {
      const name = buildClipboardFilename('image', undefined, new Date(), loc)
      r = await dock.addBufferItem(name, imgPng, 'clipboard://image')
    } else {
      const text = await clipboard.readText().catch(() => '')
      if (text.trim()) {
        const name = buildClipboardFilename('text', text, new Date(), loc)
        r = await dock.addBufferItem(name, Buffer.from(text, 'utf8'), 'clipboard://text')
      } else {
        r = { added: 0, skipped: 0, errors: [cm.emptyClipboard] }
      }
    }
    if (r.added > 0) {
      broadcast('dock:changed')
      island?.webContents.send('island:received', r)
      if (panel?.isVisible()) panel.webContents.send('island:received', r)
      if (!hovering && !panel?.isVisible()) scheduleCollapse(1200)
    }
    return r
  })

  handleTrusted('dock:remove', async (_e, ids: unknown) => {
    const idList = strArr(ids)
    await dock.remove(idList)
    for (const id of idList) {
      for (const key of thumbCache.keys()) {
        if (key.startsWith(`${id}:`)) thumbCache.delete(key)
      }
    }
    broadcast('dock:changed')
  })

  handleTrusted('dock:clear', async () => {
    await dock.clear()
    thumbCache.clear()
    broadcast('dock:changed')
  })

  handleTrusted('dock:undoRemove', async (_e, token?: unknown) => {
    const res = await dock.undoRemove(typeof token === 'string' ? token : undefined)
    if (res.ok) broadcast('dock:changed')
    return res
  })

  handleTrusted('dock:dismissUndo', async (_e, token?: unknown) => {
    await dock.dismissUndo(typeof token === 'string' ? token : undefined)
  })

  handleTrusted('dock:setGroup', async (_e, ids: unknown, group: unknown) => {
    await dock.setGroup(strArr(ids), typeof group === 'string' ? group : undefined)
    broadcast('dock:changed')
  })

  handleTrusted('dock:open', async (_e, id: unknown) => {
    const mm = getMessages(currentLocale()).main
    const it = typeof id === 'string' ? dock.find(id) : undefined
    if (!it) return mm.itemNotFound
    if (!existsSync(it.path)) return mm.fileMissingOrMoved
    const ext = (it.ext || extname(it.path).slice(1)).toLowerCase()
    if (!it.isDir && EXECUTABLE_EXTS.has(ext)) {
      const owner = panel && !panel.isDestroyed() && panel.isVisible() ? panel : island
      const opts: Electron.MessageBoxOptions = {
        type: 'warning',
        title: mm.execTitle,
        message: mm.execMessage(it.name),
        detail: mm.execDetail,
        buttons: mm.execButtons,
        defaultId: 0,
        cancelId: 1,
        noLink: true
      }
      const res =
        owner && !owner.isDestroyed()
          ? await dialog.showMessageBox(owner, opts)
          : await dialog.showMessageBox(opts)
      if (res.response === 0) {
        shell.showItemInFolder(it.path)
        return ''
      }
      if (res.response !== 2) return ''
    }
    return shell.openPath(it.path)
  })

  handleTrusted('dock:reveal', (_e, id: unknown) => {
    const it = typeof id === 'string' ? dock.find(id) : undefined
    if (it) shell.showItemInFolder(it.path)
  })

  handleTrusted('dock:thumb', async (_e, id: unknown, size: unknown) => {
    const it = typeof id === 'string' ? dock.find(id) : undefined
    if (!it) return null
    const s = Math.min(Math.max(Number(size) || 64, 16), 1024)
    const key = `${it.id}:${it.mtimeMs}:${s}`
    if (thumbCache.has(key)) {
      const cached = thumbCache.get(key)!
      thumbCache.delete(key)
      thumbCache.set(key, cached)
      return cached
    }
    let url: string | null = null
    try {
      const img = await nativeImage.createThumbnailFromPath(it.path, { width: s, height: s })
      if (!img.isEmpty()) url = img.toDataURL()
    } catch {
      /* Fall back to OS file icon when thumbnail generation fails */
    }
    if (!url) {
      try {
        url = (await app.getFileIcon(it.path, { size: 'large' })).toDataURL()
      } catch {
        url = null
      }
    }
    if (thumbCache.has(key)) thumbCache.delete(key)
    while (thumbCache.size >= MAX_THUMB_CACHE) {
      const oldest = thumbCache.keys().next().value
      if (oldest === undefined) break
      thumbCache.delete(oldest)
    }
    thumbCache.set(key, url)
    return url
  })

  handleTrusted('dock:readTextPreview', async (_e, id: unknown) => {
    const mm = getMessages(currentLocale()).main
    const it = typeof id === 'string' ? dock.find(id) : undefined
    if (!it) return { ok: false, message: mm.itemNotFound }
    if (it.isDir || it.ext === 'dir' || !TEXT_EXTS.has(it.ext)) {
      return { ok: false, message: mm.textPreviewOnly }
    }
    try {
      const { content, truncated } = await readTextFilePreview(it.path, 64 * 1024)
      return { ok: true, content, truncated }
    } catch {
      return { ok: false, message: mm.readPreviewFailed }
    }
  })

  handleTrusted('dock:copyToClipboard', async (_e, id: unknown) => {
    const msg = getMessages(currentLocale())
    const it = typeof id === 'string' ? dock.find(id) : undefined
    if (!it) return { ok: false, message: msg.main.itemNotFound }
    if (!it.isDir && IMAGE_EXTS.has(it.ext)) {
      try {
        const img = nativeImage.createFromPath(it.path)
        if (!img.isEmpty()) {
          const png = img.toPNG()
          await clipboard.write([
            new ClipboardItem({
              'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' })
            })
          ])
          return { ok: true, message: msg.clipboard.copiedImage(it.name) }
        }
      } catch {
        /* Fall back to path copy when image read/write fails */
      }
    }
    if (!it.isDir && TEXT_EXTS.has(it.ext)) {
      try {
        const { content, truncated } = await readTextFilePreview(it.path, 256 * 1024)
        await clipboard.writeText(content)
        return {
          ok: true,
          message: truncated
            ? msg.clipboard.copiedTextTruncated(it.name)
            : msg.clipboard.copiedText(it.name)
        }
      } catch {
        /* Fall back to path copy when text read fails */
      }
    }
    try {
      await clipboard.writeText(it.path)
      return { ok: true, message: msg.clipboard.copiedPath(it.name) }
    } catch {
      return { ok: false, message: msg.clipboard.copyFailed(it.name) }
    }
  })

  handleTrusted('dock:copyUsage', () => ({ used: dock.copyUsage(), limit: dock.copyLimit() }))

  // ---------- Island Decorations & Persistent Memory ----------
  handleTrusted('decor:get', () => store.data.decorations)
  handleTrusted('decor:set', (_e, next: Partial<DecorationState>) => {
    let ambienceChanged = false
    store.update((d) => {
      if (next.ambience === 'day' || next.ambience === 'night' || next.ambience === 'rain') {
        ambienceChanged = d.decorations.ambience !== next.ambience
        d.decorations.ambience = next.ambience
        if (ambienceChanged) {
          d.islandMemory.lampLit = null
          d.islandMemory.cabinWarm = null
        }
      }
      if (next.enabled) {
        d.decorations.enabled = { ...d.decorations.enabled, ...next.enabled }
      }
    })
    broadcast('decor:changed', store.data.decorations)
    if (ambienceChanged) broadcast('island:memoryChanged', store.data.islandMemory)
    return store.data.decorations
  })

  handleTrusted('island:getMemory', () => store.data.islandMemory)
  handleTrusted('island:setMemory', (_e, patch: Partial<IslandMemory>) => {
    store.update((d) => {
      if (Array.isArray(patch?.sprouts)) {
        d.islandMemory.sprouts = patch.sprouts
          .filter(
            (s) =>
              s &&
              typeof s.id === 'number' &&
              Number.isFinite(s.x) &&
              Number.isFinite(s.y) &&
              (s.kind === 0 || s.kind === 1 || s.kind === 2)
          )
          .slice(-8)
      }
      if (patch?.lampLit === null || typeof patch?.lampLit === 'boolean') {
        d.islandMemory.lampLit = patch.lampLit
      }
      if (patch?.cabinWarm === null || typeof patch?.cabinWarm === 'boolean') {
        d.islandMemory.cabinWarm = patch.cabinWarm
      }
    })
    broadcast('island:memoryChanged', store.data.islandMemory)
    return store.data.islandMemory
  })

  // ---------- Focus Timer ----------
  handleTrusted('focus:get', () => focusCtrl.state)
  handleTrusted(
    'focus:control',
    (
      _e,
      action: 'start_focus' | 'pause' | 'resume' | 'start_rest' | 'reset',
      durationMinutes?: number
    ) => focusCtrl.control(action, durationMinutes)
  )
  handleTrusted('focus:updatePlan', (_e, goal: unknown, steps: unknown) =>
    focusCtrl.updatePlan(
      typeof goal === 'string' ? goal : '',
      Array.isArray(steps) ? (steps as FocusStep[]) : []
    )
  )

  // ---------- Settings & AI Assistant ----------
  handleTrusted('settings:get', () => publicSettings())
  handleTrusted('settings:update', (_e, rawPatch: SettingsPatch): Settings => applySettingsUpdate(rawPatch))
  handleTrusted('app:getEnv', () => ({
    isPackaged: app.isPackaged,
    shortcut: SHORTCUT
  }))
  handleTrusted('app:openDataDir', async () => {
    await shell.openPath(app.getPath('userData'))
  })
  handleTrusted('ai:getKeyStatus', (_e, baseUrl: unknown) =>
    aiSecrets.getKeyStatus(typeof baseUrl === 'string' ? baseUrl : '')
  )
  handleTrusted('ai:saveConfig', (_e, rawCfg: AiConfigInput) => {
    const loc = currentLocale()
    const baseUrl = String(rawCfg?.baseUrl ?? '').trim() || DEFAULT_AI_BASE_URL
    const v = validateAiEndpointUrl(baseUrl, loc)
    if (!v.ok) {
      return { ok: false, message: v.message }
    }
    const model = String(rawCfg?.model ?? '').trim() || DEFAULT_AI_MODEL
    store.update((d) => {
      d.settings.ai = {
        baseUrl,
        model,
        enableVision: !!rawCfg?.enableVision
      }
    })
    let persisted = true
    if (rawCfg?.clearApiKey) {
      aiSecrets.clearKey(baseUrl)
    } else if (typeof rawCfg?.apiKey === 'string' && rawCfg.apiKey.trim()) {
      persisted = aiSecrets.setKey(baseUrl, rawCfg.apiKey.trim()).persisted
    }
    broadcast('settings:changed', publicSettings())
    return persisted
      ? { ok: true }
      : { ok: true, message: getMessages(loc).main.saveMemoryOnly }
  })
  handleTrusted('ai:test', (_e, rawCfg: AiConfigInput) => {
    const loc = currentLocale()
    const resolved = aiSecrets.resolveForInput(rawCfg ?? { baseUrl: '', model: '' })
    if (!resolved.ok) return { ok: false, message: resolved.message }
    return testConnection(resolved.cfg, loc)
  })

  const beginAiSignal = (): AbortController => {
    activeAiAbort?.abort()
    const ctrl = new AbortController()
    activeAiAbort = ctrl
    return ctrl
  }

  const endAiSignal = (ctrl: AbortController): void => {
    if (activeAiAbort === ctrl) activeAiAbort = null
  }

  const visionEncoder = async (filePath: string): Promise<string | undefined> => {
    if (!store.data.settings.ai.enableVision) return undefined
    try {
      const img = nativeImage.createFromPath(filePath)
      if (img.isEmpty()) return undefined
      const { width, height } = img.getSize()
      const maxEdge = 768
      const scaled =
        width > maxEdge || height > maxEdge
          ? width >= height
            ? img.resize({ width: maxEdge })
            : img.resize({ height: maxEdge })
          : img
      const jpeg = scaled.toJPEG(78)
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`
    } catch {
      return undefined
    }
  }

  const emitAiProgress = (taskId: unknown, kind: AiTaskKind, stage: string): void => {
    if (typeof taskId === 'string' && taskId) {
      broadcast('ai:progress', { taskId, kind, stage })
    }
  }

  onTrusted('ai:cancel', () => {
    if (activeAiAbort) {
      activeAiAbort.abort()
      activeAiAbort = null
      emitOtterReaction({
        action: 'idle',
        bubble: getMessages(currentLocale()).ai.progress.cancelBubble,
        durationMs: 1600
      })
    }
  })

  handleTrusted(
    'ai:organize',
    async (_e, ids?: string[], taskId?: unknown): Promise<AiOrganizeResult> => {
      const loc = currentLocale()
      const p = getMessages(loc).ai.progress
      const ctrl = beginAiSignal()
      try {
        const resolved = aiSecrets.resolveForSavedSettings()
        if (!resolved.ok) {
          return { ok: false, message: resolved.message, needsSetup: resolved.needsSetup }
        }
        const targetIds = Array.isArray(ids) ? new Set(strArr(ids)) : null
        const targets = targetIds ? dock.items.filter((i) => targetIds.has(i.id)) : dock.items
        if (!targets.length) return { ok: false, message: p.emptyOrganize }

        emitOtterReaction({ action: 'read', bubble: p.readOrganizeBubble, durationMs: 6000 })
        const extracted = await extractFilesBatch(targets, {
          maxChars: 2400,
          concurrency: 2,
          enableVision: resolved.cfg.enableVision,
          locale: loc,
          encodeImage: visionEncoder,
          extractTextItem: extractTextInWorker,
          signal: ctrl.signal,
          onProgress: (done, total, currentName) =>
            emitAiProgress(
              taskId,
              'organize',
              p.parsingItem(Math.min(done + 1, total), total, currentName)
            )
        })
        if (ctrl.signal.aborted) {
          return { ok: false, cancelled: true, message: p.cancelledOrganize }
        }
        emitAiProgress(taskId, 'organize', p.organizingStage)
        const { result, updates } = await organizeAndSummarize(
          resolved.cfg,
          extracted,
          ctrl.signal,
          loc
        )
        if (ctrl.signal.aborted) {
          return { ok: false, cancelled: true, message: p.cancelledOrganize }
        }
        if (result.ok) {
          await dock.applyAiUpdates(updates)
          broadcast('dock:changed')
          emitOtterReaction({
            action: 'wave',
            bubble: result.otterBubble || p.organizeDoneBubble,
            durationMs: 3600
          })
        } else {
          emitOtterReaction({ action: 'idle' })
        }
        return result
      } catch (err) {
        if (ctrl.signal.aborted || isAbortError(err)) {
          return { ok: false, cancelled: true, message: p.cancelledOrganize }
        }
        emitOtterReaction({ action: 'idle' })
        const needsSetup = !!(err as { needsSetup?: boolean })?.needsSetup
        return {
          ok: false,
          ...(needsSetup ? { needsSetup: true } : {}),
          message: (err as Error).message || p.failedOrganize
        }
      } finally {
        endAiSignal(ctrl)
      }
    }
  )

  handleTrusted(
    'ai:jointSummary',
    async (
      _e,
      ids: unknown,
      focusPrompt?: unknown,
      taskId?: unknown
    ): Promise<AiJointSummaryResult> => {
      const loc = currentLocale()
      const p = getMessages(loc).ai.progress
      const ctrl = beginAiSignal()
      try {
        const resolved = aiSecrets.resolveForSavedSettings()
        if (!resolved.ok) {
          return { ok: false, message: resolved.message, needsSetup: resolved.needsSetup }
        }
        const idList = strArr(ids).slice(0, 6)
        const targets = dock.items.filter((i) => idList.includes(i.id))
        if (targets.length < 2) {
          return { ok: false, message: p.needTwoJoint }
        }
        emitOtterReaction({ action: 'read', bubble: p.readJointBubble, durationMs: 6500 })
        const extracted = await extractFilesBatch(targets, {
          maxChars: 1600,
          concurrency: 2,
          enableVision: resolved.cfg.enableVision,
          locale: loc,
          encodeImage: visionEncoder,
          extractTextItem: extractTextInWorker,
          signal: ctrl.signal,
          onProgress: (done, total, currentName) =>
            emitAiProgress(
              taskId,
              'joint',
              p.readingItem(Math.min(done + 1, total), total, currentName)
            )
        })
        if (ctrl.signal.aborted) {
          return { ok: false, cancelled: true, message: p.cancelledJoint }
        }
        emitAiProgress(taskId, 'joint', p.jointStage)
        const res = await summarizeDocumentsTogether(
          resolved.cfg,
          extracted,
          typeof focusPrompt === 'string' ? focusPrompt : undefined,
          ctrl.signal,
          loc
        )
        if (ctrl.signal.aborted) {
          return { ok: false, cancelled: true, message: p.cancelledJoint }
        }
        if (res.ok) {
          emitOtterReaction({
            action: 'wave',
            bubble: res.otterBubble || p.jointDoneBubble,
            durationMs: 3600
          })
        } else {
          emitOtterReaction({ action: 'idle' })
        }
        return res
      } catch (err) {
        if (ctrl.signal.aborted || isAbortError(err)) {
          return { ok: false, cancelled: true, message: p.cancelledJoint }
        }
        emitOtterReaction({ action: 'idle' })
        const needsSetup = !!(err as { needsSetup?: boolean })?.needsSetup
        return {
          ok: false,
          ...(needsSetup ? { needsSetup: true } : {}),
          message: (err as Error).message || p.failedJoint
        }
      } finally {
        endAiSignal(ctrl)
      }
    }
  )

  handleTrusted(
    'ai:breakdown',
    async (
      _e,
      goal: string,
      docIds: string[],
      durationMinutes?: number,
      taskId?: unknown
    ): Promise<AiBreakdownResult> => {
      const loc = currentLocale()
      const p = getMessages(loc).ai.progress
      const ctrl = beginAiSignal()
      try {
        const resolved = aiSecrets.resolveForSavedSettings()
        if (!resolved.ok) {
          return { ok: false, message: resolved.message, needsSetup: resolved.needsSetup }
        }
        const idSet = new Set(Array.isArray(docIds) ? docIds : [])
        const docs = dock.items.filter((i) => idSet.has(i.id))
        emitOtterReaction({ action: 'read', bubble: p.breakdownBubble, durationMs: 5000 })
        const extracted = await extractFilesBatch(docs, {
          maxChars: 1000,
          concurrency: 2,
          enableVision: false,
          locale: loc,
          extractTextItem: extractTextInWorker,
          signal: ctrl.signal,
          onProgress: (done, total, currentName) =>
            emitAiProgress(
              taskId,
              'breakdown',
              p.readingDocItem(Math.min(done + 1, total), total, currentName)
            )
        })
        if (ctrl.signal.aborted) {
          return { ok: false, cancelled: true, message: p.cancelledBreakdown }
        }
        const mins =
          typeof durationMinutes === 'number'
            ? durationMinutes
            : (store.data.settings.focusMinutes ?? 25)
        emitAiProgress(taskId, 'breakdown', p.breakdownStage(mins))
        const res = await breakdownFocusGoal(
          resolved.cfg,
          String(goal || ''),
          extracted,
          ctrl.signal,
          mins,
          loc
        )
        if (ctrl.signal.aborted) {
          return { ok: false, cancelled: true, message: p.cancelledBreakdown }
        }
        emitOtterReaction({
          action: 'wave',
          bubble: res.otterBubble || p.breakdownDoneBubble,
          durationMs: 3500
        })
        return res
      } catch (err) {
        if (ctrl.signal.aborted || isAbortError(err)) {
          return { ok: false, cancelled: true, message: p.cancelledBreakdown }
        }
        emitOtterReaction({ action: 'idle' })
        const needsSetup = !!(err as { needsSetup?: boolean })?.needsSetup
        return {
          ok: false,
          ...(needsSetup ? { needsSetup: true } : {}),
          message: (err as Error).message || p.failedBreakdown
        }
      } finally {
        endAiSignal(ctrl)
      }
    }
  )

  handleTrusted('ai:recommendDecor', async (_e, moodPrompt?: string, taskId?: unknown) => {
    const loc = currentLocale()
    const p = getMessages(loc).ai.progress
    const ctrl = beginAiSignal()
    try {
      const resolved = aiSecrets.resolveForSavedSettings()
      if (!resolved.ok) {
        return { ok: false, message: resolved.message, needsSetup: resolved.needsSetup }
      }
      emitAiProgress(taskId, 'decor', p.decorStage)
      const rec = await recommendDecoration(
        resolved.cfg,
        String(moodPrompt || ''),
        ctrl.signal,
        loc
      )
      if (ctrl.signal.aborted) {
        return { ok: false, cancelled: true, message: p.cancelledDecor }
      }
      store.update((d) => {
        d.decorations = rec.state
        d.islandMemory.lampLit = null
        d.islandMemory.cabinWarm = null
      })
      broadcast('decor:changed', store.data.decorations)
      broadcast('island:memoryChanged', store.data.islandMemory)
      emitOtterReaction({ action: 'wave', bubble: rec.otterBubble, durationMs: 3600 })
      return { ok: true, message: rec.reason }
    } catch (err) {
      if (ctrl.signal.aborted || isAbortError(err)) {
        return { ok: false, cancelled: true, message: p.cancelledDecor }
      }
      emitOtterReaction({ action: 'idle' })
      const needsSetup = !!(err as { needsSetup?: boolean })?.needsSetup
      return {
        ok: false,
        ...(needsSetup ? { needsSetup: true } : {}),
        message: (err as Error).message || p.failedDecor
      }
    } finally {
      endAiSignal(ctrl)
    }
  })

  onTrusted('island:setExpandMode', (_e, m: unknown) => {
    if (m === 'docked' || m === 'peek' || m === 'full') setMode(m)
  })

  onTrusted('island:holdExpand', (_e, rawMs: unknown) => {
    const ms = Math.min(Math.max(Number(rawMs) || 0, 0), 8000)
    if (ms <= 0) return
    holdExpandUntil = Math.max(holdExpandUntil, Date.now() + ms)
    if (collapseTimer && !hovering && !panel?.isVisible() && expandMode !== 'docked') {
      scheduleCollapse(1500)
    }
  })

  onTrusted('dock:syncDragPassThrough', () => {
    if (!dragOutActive || !island || island.isDestroyed()) return
    syncIslandMouseIgnore(false, false)
  })

  onTrusted('dock:startDrag', (e, ids: unknown, rawKind?: unknown) => {
    const files = dock.pathsFor(strArr(ids))
    if (!files.length) {
      e.sender.send('dock:dragEnded')
      return
    }
    const kind: ParcelKind =
      rawKind === 'box' || rawKind === 'scroll' || rawKind === 'envelope' ? rawKind : 'envelope'
    const fromIsland = !!(island && !island.isDestroyed() && e.sender === island.webContents)
    const icon = makeDragIcon(kind)
    const hadFocus = fromIsland && island ? island.isFocused() : (panel?.isFocused() ?? false)
    dragOutActive = true
    cancelCollapse()
    let dragPollTimer: NodeJS.Timeout | null = null
    if (fromIsland && island && !island.isDestroyed()) {
      if (!hadFocus) island.focus()
      if (store.data.settings.alwaysOnTop) {
        island.setAlwaysOnTop(true, 'floating')
      }
      // Disable forward mouse hook before outbound OS drag and toggle pure WS_EX_TRANSPARENT pass-through:
      // stays clickable over island/pier for in-place cancel, switches transparent outside so external apps receive drops
      syncIslandMouseIgnore(true, false)
      dragPollTimer = setInterval(() => {
        if (!dragOutActive || !island || island.isDestroyed()) return
        syncIslandMouseIgnore(false, false)
      }, 10)
    }
    try {
      e.sender.startDrag({ file: files[0], files, icon })
    } finally {
      if (dragPollTimer) clearInterval(dragPollTimer)
      dragOutActive = false
      dragGraceUntil = Date.now() + 600
      if (fromIsland && island && !island.isDestroyed()) {
        if (store.data.settings.alwaysOnTop) {
          island.setAlwaysOnTop(true, 'screen-saver')
        }
        hovering = syncIslandMouseIgnore(true)
        pushPose()
      }
      if (!e.sender.isDestroyed()) e.sender.send('dock:dragEnded')
      setTimeout(() => {
        if (!dragOutActive && !hovering && !panel?.isVisible()) scheduleCollapse(1200)
      }, 650)
    }
  })

  onTrusted('island:beginMove', () => {
    if (!island || island.isDestroyed()) return
    movingIsland = true
    cancelCollapse()
    if (ignoringMouse) {
      ignoringMouse = false
      island.setIgnoreMouseEvents(false)
    }
    const side = currentSide()
    const prevMode: ExpandMode = side === 'free' ? 'full' : expandMode
    const prevOffsetX = getStageOffsetX(side, prevMode)
    const cur = screen.getCursorScreenPoint()
    const b = island.getBounds()
    const compensatedWinX = Math.round(b.x + prevOffsetX)
    const wa = screen.getDisplayMatching({
      x: compensatedWinX,
      y: b.y,
      width: STAGE.w,
      height: STAGE.h
    }).workArea
    dragOrigin = {
      curX: cur.x,
      curY: cur.y,
      winX: compensatedWinX,
      winY: b.y,
      lastX: compensatedWinX,
      lastY: b.y,
      startSide: side,
      wa
    }
    if (prevOffsetX !== 0) {
      island.setPosition(compensatedWinX, b.y)
    }
    if (expandMode !== 'full') {
      expandMode = 'full'
      pushPose()
    }
  })

  onTrusted('island:stepMove', () => {
    if (!island || island.isDestroyed() || !dragOrigin || !movingIsland) return
    const now = screen.getCursorScreenPoint()
    const nx = Math.round(dragOrigin.winX + (now.x - dragOrigin.curX))
    const ny = Math.round(dragOrigin.winY + (now.y - dragOrigin.curY))
    if (nx === dragOrigin.lastX && ny === dragOrigin.lastY) return
    dragOrigin.lastX = nx
    dragOrigin.lastY = ny
    island.setPosition(nx, ny)
    if (panel?.isVisible() && !panelCustomMoved) positionPanelAt(nx, ny, dragOrigin)
  })

  onTrusted('island:endMove', () => {
    const prevOrigin = dragOrigin
    dragOrigin = null
    if (!movingIsland) return
    movingIsland = false
    snapAfterMove(prevOrigin)
  })

  handleTrusted('panel:getPinned', () => panelPinned)
  handleTrusted('panel:setPinned', (_e, next: unknown) => {
    panelPinned = !!next
    broadcast('panel:pinnedChanged', panelPinned)
    return panelPinned
  })

  onTrusted('panel:toggle', togglePanel)
  onTrusted('panel:hide', hidePanel)
  onTrusted('island:hide', hideIsland)
  onTrusted('island:resetPos', (_e, side: unknown) => {
    if (side === 'left' || side === 'right') {
      resetPosition(side)
      showIsland()
    }
  })
}

// ---------- App Lifecycle ----------

app.on('second-instance', (_event, commandLine) => {
  if (commandLine.includes('--quit')) {
    quitting = true
    app.quit()
    return
  }
  showIsland()
})

app.whenReady().then(() => {
  if (exitEarly || !app.hasSingleInstanceLock()) return
  app.setAppUserModelId('local.pocket-isle')
  const userData = app.getPath('userData')
  store = new Store(userData, {
    onSaveError: (msg) => {
      if (panel && !panel.isDestroyed() && panel.isVisible()) {
        emitOtterReaction({ action: 'idle', bubble: msg, durationMs: 4000 }, true)
      }
    },
    getLocale: currentLocale
  })
  const safeCodec: SecretCodec = {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain: string) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (cipher: string) => safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  }
  aiSecrets = new AiCredentialStore(store, safeCodec, currentLocale)
  aiSecrets.migrateLegacyKey()
  dock = new Dock(
    store,
    join(userData, 'dock-copies'),
    [tmpdir(), app.getPath('temp')],
    join(userData, 'drop-log.txt'),
    {
      enableDropLog: process.env.POCKET_ISLE_DROP_LOG === '1',
      onUndoChanged: (u) => broadcast('dock:undoChanged', u),
      getLocale: currentLocale
    }
  )
  void dock.reconcileCopies()
  focusCtrl = new FocusController(
    store,
    (f) => broadcast('focus:changed', f),
    (r) => emitOtterReaction(r, true),
    (finishedPhase) => {
      broadcast('focus:finished', finishedPhase)
      if (store.data.settings.focusNotify !== false && Notification.isSupported()) {
        const nm = getMessages(currentLocale()).notifications
        new Notification({
          title: finishedPhase === 'focus' ? nm.focusDoneTitle : nm.restDoneTitle,
          body: finishedPhase === 'focus' ? nm.focusDoneBody : nm.restDoneBody,
          silent: true
        }).show()
      }
    },
    currentLocale
  )

  registerIpc()
  createIsland()
  createPanel()
  createTray()
  startPointerPoll()

  powerMonitor.on('lock-screen', () => {
    focusCtrl.pauseForSystemSuspend()
    stopPointerPoll()
  })
  powerMonitor.on('suspend', () => {
    focusCtrl.pauseForSystemSuspend()
    stopPointerPoll()
  })
  powerMonitor.on('unlock-screen', () => {
    if (island && !island.isDestroyed() && island.isVisible()) startPointerPoll()
  })
  powerMonitor.on('resume', () => {
    if (island && !island.isDestroyed() && island.isVisible()) startPointerPoll()
  })

  if (!globalShortcut.register(SHORTCUT, toggleIsland)) {
    console.warn(`[shortcut] ${SHORTCUT} is already registered; use the system tray menu instead`)
  }

  const fixPos = (): void => {
    if (!island || island.isDestroyed()) return
    const allWorkAreas = screen.getAllDisplays().map((d) => d.workArea)
    const primaryWorkArea = screen.getPrimaryDisplay().workArea
    const side = currentSide()
    const curBounds = island.getBounds()
    const nextPos = reconcileIslandPosOnDisplayChange({
      currentPos: store.data.islandPos ?? { x: curBounds.x, y: curBounds.y },
      side,
      allWorkAreas,
      primaryWorkArea
    })
    store.update((d) => {
      d.islandPos = nextPos
    })
    island.setPosition(Math.round(nextPos.x), Math.round(nextPos.y))
    pushPose()

    if (panel && !panel.isDestroyed() && panel.isVisible()) {
      if (!panelCustomMoved) {
        positionPanelAt(nextPos.x, nextPos.y)
      } else {
        const pb = panel.getBounds()
        const clamped = clampPanelBoundsToWorkArea(pb, allWorkAreas, primaryWorkArea)
        positioningPanel = true
        ignorePanelMoveUntil = Date.now() + 140
        try {
          if (clamped.width === pb.width && clamped.height === pb.height) {
            panel.setPosition(clamped.x, clamped.y)
          } else {
            panel.setBounds(clamped)
            lastPanelSize = { w: clamped.width, h: clamped.height }
          }
        } finally {
          positioningPanel = false
          ignorePanelMoveUntil = Date.now() + 140
        }
      }
    }
  }
  screen.on('display-removed', fixPos)
  screen.on('display-metrics-changed', fixPos)
})

app.on('window-all-closed', () => {
  /* Tray app stays alive when all windows close */
})

app.on('before-quit', () => {
  quitting = true
  if (pollTimer) clearInterval(pollTimer)
  dragOrigin = null
  focusCtrl?.dispose()
  cancelCollapse()
  disposeExtractWorker()
  globalShortcut.unregisterAll()
  dock?.flushPendingDeletesSync()
  store?.dispose()
})
