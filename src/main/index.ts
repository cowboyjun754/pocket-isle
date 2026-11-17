import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  shell,
  Tray,
  type WebContents
} from 'electron'
import { writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  PANEL,
  STAGE,
  getStageOffsetX,
  isInsideIsland,
  resolveSnapSide,
  type DockSide,
  type ExpandMode
} from '../shared/shape'
import type {
  AddResult,
  AiBreakdownResult,
  AiConfig,
  AiJointSummaryResult,
  AiOrganizeResult,
  DecorationState,
  FocusStep,
  IslandMemory,
  IslandPose,
  OtterReactionPayload,
  ParcelKind,
  Settings,
  SettingsPatch
} from '../shared/types'
import {
  breakdownFocusGoal,
  extractFileSnippet,
  isAbortError,
  organizeAndSummarize,
  recommendDecoration,
  summarizeDocumentsTogether,
  testConnection
} from './aiService'
import { buildClipboardFilename } from './clipboardRules'
import { Dock } from './dock'
import { FocusController } from './focusTimer'
import { makeDragIcon, makeTrayIcon } from './icons'
import { applySettingsPatch } from './settingsRules'
import { Store } from './store'

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let island: BrowserWindow | null = null
let panel: BrowserWindow | null = null
let tray: Tray | null = null
let store: Store
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
const thumbCache = new Map<string, string | null>()
const SHORTCUT = 'Control+Alt+Space'

// ---------- 通用 ----------

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

function loadView(win: BrowserWindow, view: 'island' | 'panel'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) win.loadURL(`${devUrl}#${view}`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash: view })
}

function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of [island, panel]) if (w && !w.isDestroyed()) w.webContents.send(channel, ...args)
}

/**
 * 触发水獭情境回应（遵守 v3 约束）：
 * 1. 贴边收起（docked）时不因 AI 回复强行自动展开；
 * 2. 专注正在进行中（phase==='focus' && running）时保持安静，不冒打扰气泡。
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

// ---------- 小岛窗口与左右贴边计算 ----------

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
    title: '停靠岛',
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

function syncIslandMouseIgnore(forceApply = false): boolean {
  if (!island || island.isDestroyed()) return false
  const p = screen.getCursorScreenPoint()
  const b = island.getBounds()
  const side = currentSide()
  const mode: ExpandMode = side === 'free' ? 'full' : expandMode
  const inside = isInsideIsland(p.x - b.x, p.y - b.y, side, mode, dock.items.length > 0)

  if (!inside && justSnapped) {
    justSnapped = false
  }

  if (forceApply || inside === ignoringMouse) {
    ignoringMouse = !inside
    island.setIgnoreMouseEvents(ignoringMouse, { forward: true })
  }
  return inside
}

function startPointerPoll(): void {
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

function showIsland(): void {
  if (!island) return
  if (!isPosVisible(store.data.islandPos)) resetPosition('right')
  island.show()
  island.setAlwaysOnTop(store.data.settings.alwaysOnTop, 'screen-saver')
  pushPose()
  rebuildTrayMenu()
}

function hideIsland(): void {
  hidePanel()
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

// ---------- 操作面板 ----------

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
    title: '停靠岛',
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
    // 拖拽等高频位移期间只调用 setPosition，避免重复 setBounds 触发透明窗口尺寸重算与 DWM 重绘卡顿
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

// ---------- 托盘 ----------

function rebuildTrayMenu(): void {
  if (!tray) return
  const s = store.data.settings
  const side = currentSide()
  const menu = Menu.buildFromTemplate([
    { label: island?.isVisible() ? '隐藏小岛' : '显示小岛', click: toggleIsland },
    { label: '打开操作面板', click: () => (island?.isVisible() || showIsland(), showPanel()) },
    { type: 'separator' },
    {
      label: '停靠在右边缘',
      type: 'radio',
      checked: side === 'right',
      click: () => (resetPosition('right'), showIsland())
    },
    {
      label: '停靠在左边缘',
      type: 'radio',
      checked: side === 'left',
      click: () => (resetPosition('left'), showIsland())
    },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: s.alwaysOnTop,
      click: (item) => {
        store.update((d) => (d.settings.alwaysOnTop = item.checked))
        island?.setAlwaysOnTop(item.checked, 'screen-saver')
        broadcast('settings:changed', store.data.settings)
      }
    },
    {
      label: app.isPackaged ? '开机自启' : '开机自启（打包后可用）',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: s.openAtLogin,
      click: (item) => {
        store.update((d) => (d.settings.openAtLogin = item.checked))
        app.setLoginItemSettings({ openAtLogin: item.checked })
        broadcast('settings:changed', store.data.settings)
      }
    },
    { label: '打开数据目录', click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    {
      label: '退出',
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
  tray.setToolTip('停靠岛')
  tray.on('click', toggleIsland)
  rebuildTrayMenu()
}

// ---------- IPC ----------

function registerIpc(): void {
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

  ipcMain.handle('dock:list', () => dock.listWithStatus())
  ipcMain.handle('island:getPose', () => currentPose())

  ipcMain.handle('dock:add', async (_e, paths: unknown): Promise<AddResult> => {
    const r = await dock.add(strArr(paths))
    broadcast('dock:changed')
    island?.webContents.send('island:received', r)
    if (panel?.isVisible()) panel.webContents.send('island:received', r)
    if (!hovering && !panel?.isVisible()) scheduleCollapse(1200)
    return r
  })

  ipcMain.handle('dock:pasteClipboard', async (): Promise<AddResult> => {
    const img = clipboard.readImage()
    let r: AddResult
    if (!img.isEmpty()) {
      const name = buildClipboardFilename('image')
      r = await dock.addBufferItem(name, img.toPNG(), 'clipboard://image')
    } else {
      const text = clipboard.readText()
      if (text.trim()) {
        const name = buildClipboardFilename('text', text)
        r = await dock.addBufferItem(name, Buffer.from(text, 'utf8'), 'clipboard://text')
      } else {
        r = { added: 0, skipped: 0, errors: ['剪贴板里没有可暂存的截图或文本'] }
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

  ipcMain.handle('dock:remove', async (_e, ids: unknown) => {
    const idList = strArr(ids)
    await dock.remove(idList)
    for (const id of idList) {
      for (const key of thumbCache.keys()) {
        if (key.startsWith(`${id}:`)) thumbCache.delete(key)
      }
    }
    broadcast('dock:changed')
  })

  ipcMain.handle('dock:clear', async () => {
    await dock.clear()
    thumbCache.clear()
    broadcast('dock:changed')
  })

  ipcMain.handle('dock:setGroup', (_e, ids: unknown, group: unknown) => {
    dock.setGroup(strArr(ids), typeof group === 'string' ? group : undefined)
    broadcast('dock:changed')
  })

  ipcMain.handle('dock:open', async (_e, id: unknown) => {
    const it = typeof id === 'string' ? dock.find(id) : undefined
    if (!it) return '条目不存在'
    return shell.openPath(it.path)
  })

  ipcMain.handle('dock:reveal', (_e, id: unknown) => {
    const it = typeof id === 'string' ? dock.find(id) : undefined
    if (it) shell.showItemInFolder(it.path)
  })

  ipcMain.handle('dock:thumb', async (_e, id: unknown, size: unknown) => {
    const it = typeof id === 'string' ? dock.find(id) : undefined
    if (!it) return null
    const s = Math.min(Math.max(Number(size) || 64, 16), 1024)
    const key = `${it.id}:${s}`
    if (thumbCache.has(key)) return thumbCache.get(key)!
    let url: string | null = null
    try {
      const img = await nativeImage.createThumbnailFromPath(it.path, { width: s, height: s })
      if (!img.isEmpty()) url = img.toDataURL()
    } catch {
      /* 没有缩略图时用系统图标 */
    }
    if (!url) {
      try {
        url = (await app.getFileIcon(it.path, { size: 'large' })).toDataURL()
      } catch {
        url = null
      }
    }
    thumbCache.set(key, url)
    return url
  })

  ipcMain.handle('dock:copyUsage', () => ({ used: dock.copyUsage(), limit: dock.copyLimit() }))

  // ---------- 自由桌搭与小岛记忆 ----------
  ipcMain.handle('decor:get', () => store.data.decorations)
  ipcMain.handle('decor:set', (_e, next: Partial<DecorationState>) => {
    let ambienceChanged = false
    store.update((d) => {
      if (next.ambience === 'day' || next.ambience === 'night') {
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

  ipcMain.handle('island:getMemory', () => store.data.islandMemory)
  ipcMain.handle('island:setMemory', (_e, patch: Partial<IslandMemory>) => {
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

  // ---------- 专注计时 ----------
  ipcMain.handle('focus:get', () => focusCtrl.state)
  ipcMain.handle(
    'focus:control',
    (
      _e,
      action: 'start_focus' | 'pause' | 'resume' | 'start_rest' | 'reset',
      durationMinutes?: number
    ) => focusCtrl.control(action, durationMinutes)
  )
  ipcMain.handle('focus:updatePlan', (_e, goal: unknown, steps: unknown) =>
    focusCtrl.updatePlan(
      typeof goal === 'string' ? goal : '',
      Array.isArray(steps) ? (steps as FocusStep[]) : []
    )
  )

  // ---------- 设置与 AI 水獭搭档 ----------
  ipcMain.handle('settings:get', () => store.data.settings)
  ipcMain.handle('settings:update', (_e, rawPatch: SettingsPatch): Settings => {
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
    rebuildTrayMenu()
    broadcast('settings:changed', store.data.settings)
    return store.data.settings
  })
  ipcMain.handle('app:getEnv', () => ({
    isPackaged: app.isPackaged,
    shortcut: SHORTCUT
  }))
  ipcMain.handle('app:openDataDir', async () => {
    await shell.openPath(app.getPath('userData'))
  })
  ipcMain.handle('ai:saveConfig', (_e, cfg: AiConfig) => {
    store.update((d) => {
      d.settings.ai = {
        baseUrl: String(cfg?.baseUrl ?? '').trim(),
        apiKey: String(cfg?.apiKey ?? '').trim(),
        model: String(cfg?.model ?? '').trim(),
        enableVision: !!cfg?.enableVision
      }
    })
    broadcast('settings:changed', store.data.settings)
  })
  ipcMain.handle('ai:test', (_e, cfg: AiConfig) => testConnection(cfg))

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

  ipcMain.on('ai:cancel', () => {
    if (activeAiAbort) {
      activeAiAbort.abort()
      activeAiAbort = null
      emitOtterReaction({ action: 'idle', bubble: '好哒，先停下休息会儿~', durationMs: 1600 })
    }
  })

  ipcMain.handle('ai:organize', async (_e, ids?: string[]): Promise<AiOrganizeResult> => {
    const ctrl = beginAiSignal()
    try {
      const targetIds = Array.isArray(ids) && ids.length ? new Set(ids) : null
      const targets = dock.items.filter((i) => !targetIds || targetIds.has(i.id))
      if (!targets.length) return { ok: false, message: '没有可整理的文件' }

      emitOtterReaction({ action: 'read', bubble: '正在读资料整理中...', durationMs: 6000 })
      const extracted = await Promise.all(
        targets.map((it) => extractFileSnippet(it, 2400, { encodeImage: visionEncoder }))
      )
      const { result, updates } = await organizeAndSummarize(
        store.data.settings.ai,
        extracted,
        ctrl.signal
      )
      if (result.ok) {
        dock.applyAiUpdates(updates)
        broadcast('dock:changed')
        emitOtterReaction({
          action: 'wave',
          bubble: result.otterBubble || '整理好啦~',
          durationMs: 3600
        })
      } else {
        emitOtterReaction({ action: 'idle' })
      }
      return result
    } catch (err) {
      if (ctrl.signal.aborted || isAbortError(err)) {
        return { ok: false, cancelled: true, message: '已取消本次 AI 整理' }
      }
      emitOtterReaction({ action: 'idle' })
      return { ok: false, message: (err as Error).message || 'AI 整理失败' }
    } finally {
      endAiSignal(ctrl)
    }
  })

  ipcMain.handle(
    'ai:jointSummary',
    async (_e, ids: unknown, focusPrompt?: unknown): Promise<AiJointSummaryResult> => {
      const ctrl = beginAiSignal()
      try {
        const idList = strArr(ids).slice(0, 6)
        const targets = dock.items.filter((i) => idList.includes(i.id))
        if (targets.length < 2) {
          return { ok: false, message: '请选中 2～6 个文件进行联合速览' }
        }
        emitOtterReaction({ action: 'read', bubble: '正在帮你串读几份资料...', durationMs: 6500 })
        const extracted = await Promise.all(
          targets.map((it) => extractFileSnippet(it, 1600, { encodeImage: visionEncoder }))
        )
        const res = await summarizeDocumentsTogether(
          store.data.settings.ai,
          extracted,
          typeof focusPrompt === 'string' ? focusPrompt : undefined,
          ctrl.signal
        )
        if (res.ok) {
          emitOtterReaction({
            action: 'wave',
            bubble: res.otterBubble || '联合速览生成好啦~',
            durationMs: 3600
          })
        } else {
          emitOtterReaction({ action: 'idle' })
        }
        return res
      } catch (err) {
        if (ctrl.signal.aborted || isAbortError(err)) {
          return { ok: false, cancelled: true, message: '已取消本次联合速览' }
        }
        emitOtterReaction({ action: 'idle' })
        return { ok: false, message: (err as Error).message || 'AI 联合速览失败' }
      } finally {
        endAiSignal(ctrl)
      }
    }
  )

  ipcMain.handle(
    'ai:breakdown',
    async (_e, goal: string, docIds: string[]): Promise<AiBreakdownResult> => {
      const ctrl = beginAiSignal()
      try {
        const idSet = new Set(Array.isArray(docIds) ? docIds : [])
        const docs = dock.items.filter((i) => idSet.has(i.id))
        emitOtterReaction({ action: 'read', bubble: '帮你想想这轮怎么做...', durationMs: 5000 })
        const extracted = await Promise.all(docs.map((it) => extractFileSnippet(it, 1000)))
        const res = await breakdownFocusGoal(
          store.data.settings.ai,
          String(goal || ''),
          extracted,
          ctrl.signal
        )
        emitOtterReaction({
          action: 'wave',
          bubble: res.otterBubble || '步骤拆好啦！',
          durationMs: 3500
        })
        return res
      } catch (err) {
        if (ctrl.signal.aborted || isAbortError(err)) {
          return { ok: false, cancelled: true, message: '已取消本次 AI 拆解' }
        }
        emitOtterReaction({ action: 'idle' })
        return { ok: false, message: (err as Error).message || 'AI 拆解失败' }
      } finally {
        endAiSignal(ctrl)
      }
    }
  )

  ipcMain.handle('ai:recommendDecor', async (_e, moodPrompt?: string) => {
    const ctrl = beginAiSignal()
    try {
      const rec = await recommendDecoration(
        store.data.settings.ai,
        String(moodPrompt || ''),
        ctrl.signal
      )
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
        return { ok: false, cancelled: true, message: '已取消本次搭配推荐' }
      }
      return { ok: false, message: (err as Error).message || '推荐布置失败' }
    } finally {
      endAiSignal(ctrl)
    }
  })

  ipcMain.on('island:setExpandMode', (_e, m: unknown) => {
    if (m === 'docked' || m === 'peek' || m === 'full') setMode(m)
  })

  ipcMain.on('island:holdExpand', (_e, rawMs: unknown) => {
    const ms = Math.min(Math.max(Number(rawMs) || 0, 0), 8000)
    if (ms <= 0) return
    holdExpandUntil = Math.max(holdExpandUntil, Date.now() + ms)
    if (collapseTimer && !hovering && !panel?.isVisible() && expandMode !== 'docked') {
      scheduleCollapse(1500)
    }
  })

  ipcMain.on('dock:startDrag', (e, ids: unknown, rawKind?: unknown) => {
    const files = dock.pathsFor(strArr(ids))
    if (!files.length) {
      e.sender.send('dock:dragEnded')
      return
    }
    const kind: ParcelKind =
      rawKind === 'box' || rawKind === 'scroll' || rawKind === 'envelope' ? rawKind : 'envelope'
    const fromIsland = !!(island && !island.isDestroyed() && e.sender === island.webContents)
    const icon = makeDragIcon(kind)
    const t0 = Date.now()
    const hadFocus = fromIsland && island ? island.isFocused() : (panel?.isFocused() ?? false)
    dragOutActive = true
    cancelCollapse()
    let dragPollTimer: NodeJS.Timeout | null = null
    let sawOutside = false
    let pollTicks = 0
    let returnedInside = false
    if (fromIsland && island && !island.isDestroyed()) {
      if (!hadFocus) island.focus()
      if (store.data.settings.alwaysOnTop) {
        island.setAlwaysOnTop(true, 'floating')
      }
      // 拖出前关闭 forward 鼠标钩子并开启纯 WS_EX_TRANSPARENT 穿透，防止透明区或钩子拦住外部投放目标；
      // 拖到外部后若重新拖回岛/栈桥上方，则临时取消穿透以便在岛上安全取消放回而不误掉到背后桌面
      ignoringMouse = true
      island.setIgnoreMouseEvents(true)
      dragPollTimer = setInterval(() => {
        pollTicks++
        if (!dragOutActive || !island || island.isDestroyed()) return
        const p = screen.getCursorScreenPoint()
        const b = island.getBounds()
        const side = currentSide()
        const mode: ExpandMode = side === 'free' ? 'full' : expandMode
        const inside = isInsideIsland(p.x - b.x, p.y - b.y, side, mode, dock.items.length > 0)
        if (!sawOutside) {
          if (!inside) sawOutside = true
          return
        }
        if (inside === ignoringMouse) {
          ignoringMouse = !inside
          if (inside) returnedInside = true
          island.setIgnoreMouseEvents(ignoringMouse)
        }
      }, 16)
    }
    try {
      e.sender.startDrag({ file: files[0], files, icon })
    } finally {
      if (dragPollTimer) clearInterval(dragPollTimer)
      const elapsedMs = Date.now() - t0
      dragOutActive = false
      dragGraceUntil = Date.now() + 600
      let insideNow = false
      if (fromIsland && island && !island.isDestroyed()) {
        if (store.data.settings.alwaysOnTop) {
          island.setAlwaysOnTop(true, 'screen-saver')
        }
        insideNow = syncIslandMouseIgnore(true)
        hovering = insideNow
        pushPose()
      }
      try {
        writeFileSync(
          join(app.getPath('userData'), 'drag-diag.log'),
          JSON.stringify({
            at: new Date().toISOString(),
            from: fromIsland ? 'island' : 'panel',
            hadFocus,
            elapsedMs,
            pollTicks,
            sawOutside,
            returnedInside,
            insideNow,
            fileCount: files.length,
            iconEmpty: icon.isEmpty()
          }) + '\n'
        )
      } catch {
        /* ignore */
      }
      if (!e.sender.isDestroyed()) e.sender.send('dock:dragEnded')
      setTimeout(() => {
        if (!dragOutActive && !hovering && !panel?.isVisible()) scheduleCollapse(1200)
      }, 650)
    }
  })

  ipcMain.on('island:beginMove', () => {
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

  ipcMain.on('island:stepMove', () => {
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

  ipcMain.on('island:endMove', () => {
    const prevOrigin = dragOrigin
    dragOrigin = null
    if (!movingIsland) return
    movingIsland = false
    snapAfterMove(prevOrigin)
  })

  ipcMain.handle('panel:getPinned', () => panelPinned)
  ipcMain.handle('panel:setPinned', (_e, next: unknown) => {
    panelPinned = !!next
    broadcast('panel:pinnedChanged', panelPinned)
    return panelPinned
  })

  ipcMain.on('panel:toggle', togglePanel)
  ipcMain.on('panel:hide', hidePanel)
  ipcMain.on('island:hide', hideIsland)
  ipcMain.on('island:resetPos', (_e, side: unknown) => {
    if (side === 'left' || side === 'right') {
      resetPosition(side)
      showIsland()
    }
  })
}

// ---------- 生命周期 ----------

app.on('second-instance', () => showIsland())

app.whenReady().then(() => {
  app.setAppUserModelId('local.pocket-isle')
  const userData = app.getPath('userData')
  store = new Store(userData)
  dock = new Dock(
    store,
    join(userData, 'dock-copies'),
    [tmpdir(), app.getPath('temp')],
    join(userData, 'drop-log.txt')
  )
  focusCtrl = new FocusController(
    store,
    (f) => broadcast('focus:changed', f),
    (r) => emitOtterReaction(r, true)
  )

  registerIpc()
  createIsland()
  createPanel()
  createTray()
  startPointerPoll()

  powerMonitor.on('lock-screen', () => focusCtrl.pauseForSystemSuspend())
  powerMonitor.on('suspend', () => focusCtrl.pauseForSystemSuspend())

  if (!globalShortcut.register(SHORTCUT, toggleIsland)) {
    console.warn(`[shortcut] ${SHORTCUT} 被占用，请使用托盘菜单`)
  }

  const fixPos = (): void => {
    if (island && !isPosVisible(store.data.islandPos)) resetPosition(currentSide())
  }
  screen.on('display-removed', fixPos)
  screen.on('display-metrics-changed', fixPos)
})

app.on('window-all-closed', () => {
  /* 托盘应用：不随窗口关闭退出 */
})

app.on('before-quit', () => {
  quitting = true
  if (pollTimer) clearInterval(pollTimer)
  dragOrigin = null
  focusCtrl?.dispose()
  cancelCollapse()
  globalShortcut.unregisterAll()
  store?.saveNow()
})
