import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AddResult,
  DecorationState,
  FocusState,
  IslandMemory,
  IslandPose,
  IsleApi,
  OtterReactionPayload,
  Settings
} from '../shared/types'

function listen<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: IsleApi = {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  listDock: () => ipcRenderer.invoke('dock:list'),
  addPaths: (paths) => ipcRenderer.invoke('dock:add', paths),
  pasteFromClipboard: () => ipcRenderer.invoke('dock:pasteClipboard'),
  remove: (ids) => ipcRenderer.invoke('dock:remove', ids),
  clear: () => ipcRenderer.invoke('dock:clear'),
  setItemGroup: (ids, group) => ipcRenderer.invoke('dock:setGroup', ids, group),
  open: (id) => ipcRenderer.invoke('dock:open', id),
  reveal: (id) => ipcRenderer.invoke('dock:reveal', id),
  thumb: (id, size) => ipcRenderer.invoke('dock:thumb', id, size),
  copyUsage: () => ipcRenderer.invoke('dock:copyUsage'),
  getPose: () => ipcRenderer.invoke('island:getPose'),
  setExpandMode: (mode) => ipcRenderer.send('island:setExpandMode', mode),
  holdExpand: (ms) => ipcRenderer.send('island:holdExpand', ms),
  startDrag: (ids, kind) => ipcRenderer.send('dock:startDrag', ids, kind),
  beginMoveIsland: () => ipcRenderer.send('island:beginMove'),
  stepMoveIsland: () => ipcRenderer.send('island:stepMove'),
  endMoveIsland: () => ipcRenderer.send('island:endMove'),
  togglePanel: () => ipcRenderer.send('panel:toggle'),
  hidePanel: () => ipcRenderer.send('panel:hide'),
  getPanelPinned: () => ipcRenderer.invoke('panel:getPinned'),
  setPanelPinned: (pinned) => ipcRenderer.invoke('panel:setPinned', pinned),
  hideIsland: () => ipcRenderer.send('island:hide'),

  // 自由桌搭与小岛记忆
  getDecorations: () => ipcRenderer.invoke('decor:get'),
  setDecorations: (next) => ipcRenderer.invoke('decor:set', next),
  getIslandMemory: () => ipcRenderer.invoke('island:getMemory'),
  setIslandMemory: (patch) => ipcRenderer.invoke('island:setMemory', patch),

  // 专注计时与目标拆解
  getFocus: () => ipcRenderer.invoke('focus:get'),
  focusControl: (action, durationMinutes) =>
    ipcRenderer.invoke('focus:control', action, durationMinutes),
  updateFocusPlan: (goal, steps) => ipcRenderer.invoke('focus:updatePlan', goal, steps),

  // AI 水獭搭档与设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  getAppEnv: () => ipcRenderer.invoke('app:getEnv'),
  resetPosition: (side) => ipcRenderer.send('island:resetPos', side),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  saveAiConfig: (cfg) => ipcRenderer.invoke('ai:saveConfig', cfg),
  testAiConnection: (cfg) => ipcRenderer.invoke('ai:test', cfg),
  aiOrganizeDock: (ids) => ipcRenderer.invoke('ai:organize', ids),
  aiJointSummary: (ids, focusPrompt) => ipcRenderer.invoke('ai:jointSummary', ids, focusPrompt),
  aiBreakdownGoal: (goal, docIds) => ipcRenderer.invoke('ai:breakdown', goal, docIds),
  aiRecommendDecor: (moodPrompt) => ipcRenderer.invoke('ai:recommendDecor', moodPrompt),
  cancelAi: () => ipcRenderer.send('ai:cancel'),

  // 事件订阅
  onDockChanged: (cb) => listen('dock:changed', cb),
  onPose: (cb) => listen<[IslandPose]>('island:pose', cb),
  onReceived: (cb) => listen<[AddResult]>('island:received', cb),
  onDecorChanged: (cb) => listen<[DecorationState]>('decor:changed', cb),
  onIslandMemoryChanged: (cb) => listen<[IslandMemory]>('island:memoryChanged', cb),
  onFocusChanged: (cb) => listen<[FocusState]>('focus:changed', cb),
  onOtterReact: (cb) => listen<[OtterReactionPayload]>('otter:react', cb),
  onSettingsChanged: (cb) => listen<[Settings]>('settings:changed', cb),
  onDragEnded: (cb) => listen('dock:dragEnded', cb),
  onPanelPinnedChanged: (cb) => listen<[boolean]>('panel:pinnedChanged', cb)
}

contextBridge.exposeInMainWorld('isle', api)
