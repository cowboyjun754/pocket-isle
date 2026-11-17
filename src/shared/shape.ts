/**
 * 舞台坐标与三段式停靠几何（恢复昨日深受好评的水平左伸栈桥构图）：
 * 标准坐标系（dockSide === 'right'，即停靠在屏幕右边缘、水平木码头朝左伸向屏幕内）：
 * - x: 0..46    水平木栈桥最前端 + 系船桩 + 探头水獭 + 角标（停靠态 Docked 露出的 46px）
 * - x: 0..148   完整水平木栈桥 + 3 个包裹 + 岸边水獭（迎宾半开态 Peek 露出的 148px）
 * - x: 0..320   右侧整座小岛 + 6 件装饰 + 纸船与外圈海面（全展开态 Full 320px）
 */

export type Pt = { x: number; y: number }
export type DockSide = 'right' | 'left' | 'free'
export type ExpandMode = 'docked' | 'peek' | 'full'

export const STAGE = { w: 320, h: 240 }
export const PANEL = { w: 430, h: 580 }

/** 各档位在屏幕内露出的宽度（px） */
export const VISIBLE_WIDTH: Record<ExpandMode, number> = {
  docked: 56,
  peek: 148,
  full: STAGE.w
}

/** 吸附到左右边缘的阈值（px） */
export const SNAP_THRESHOLD = 64

/** 标准朝向（停在右边缘、码头朝左）下的岛体椭圆（偏右 x: 70..314，给左侧水平码头让出空间） */
export const ISLAND_ELLIPSE = { cx: 192, cy: 132, rx: 122, ry: 88 }

/** 岛上山坡景物上沿椭圆（覆盖小树冠、路灯顶、木屋顶与风车扇叶上半部） */
export const SKYLINE_ELLIPSE = { cx: 194, cy: 56, rx: 94, ry: 44 }

/** 全展开态右上角悬停按钮热区（连通山坡与岛体，同时保留四角点击穿透） */
export const HOVER_CTRL_RECT = { x0: 246, y0: 10, x1: 312, y1: 88 }

/** 草地内圈椭圆（贴合 island-horiz.png 绿草坪范围，区分“草地”与“沙滩/外圈海水”） */
export const GRASS_ELLIPSE = { cx: 194, cy: 106, rx: 95, ry: 52 }

/** 水平左伸木码头多边形（x: 4..116，覆盖角标、栈桥包裹与底部专注胶囊） */
export const DOCK_POLY: Pt[] = [
  { x: 4, y: 70 },
  { x: 112, y: 82 },
  { x: 116, y: 162 },
  { x: 4, y: 160 }
]

/** 包裹落点（底部中心，精准落在手绘木栈桥板面上） */
export const DOCK_SLOTS: Pt[] = [
  { x: 42, y: 118 },
  { x: 68, y: 120 },
  { x: 94, y: 122 }
]

/** 数字角标圆心（位于栈桥最前端系船桩上方，停靠态 56px 内完整露出） */
export const DOCK_BADGE: Pt = { x: 20, y: 84 }

/** 水獭默认落脚点（栈桥根部草地上） */
export const OTTER_HOME: Pt = { x: 156, y: 148 }

/** 停靠态下水獭稳稳坐在栈桥第 2-3 块木板正中央的位置 */
export const OTTER_PEEK: Pt = { x: 38, y: 117 }

/** 计算某个停靠方向 + 展开档位下，画布相对于窗口的水平位移 translateX（px） */
export function getStageOffsetX(side: DockSide, mode: ExpandMode): number {
  if (side === 'free' || mode === 'full') return 0
  const vis = VISIBLE_WIDTH[mode]
  const shift = STAGE.w - vis
  return side === 'right' ? shift : -shift
}

export function inEllipse(x: number, y: number, e = ISLAND_ELLIPSE): boolean {
  const dx = (x - e.cx) / e.rx
  const dy = (y - e.cy) / e.ry
  return dx * dx + dy * dy <= 1
}

export function inPolygon(x: number, y: number, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    const cross = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    if (cross) inside = !inside
  }
  return inside
}

/** 栈桥包裹悬停名牌与「扔海里」按钮热区（有包裹且非 docked 时防止名牌区鼠标穿透） */
export const DOCK_NAMEPLATE_RECT = { x0: 6, y0: 18, x1: 156, y1: 102 }

/** 栈桥前缘到近海水面的右手拖抛过渡区（有包裹且非 docked 时防止跨水缘穿透） */
export const DOCK_SEA_TRANSITION_RECT = { x0: 36, y0: 150, x1: 132, y1: 188 }

/** 判断舞台局部坐标是否落在外圈海面（点击可触发水波涟漪） */
export function isOnWater(localX: number, localY: number): boolean {
  return (
    inEllipse(localX, localY, ISLAND_ELLIPSE) &&
    !inEllipse(localX, localY, GRASS_ELLIPSE) &&
    !inPolygon(localX, localY, DOCK_POLY)
  )
}

/**
 * 判断窗口内坐标 (winX, winY) 是否落在当前可见的小岛交互区域内。
 */
export function isInsideIsland(
  winX: number,
  winY: number,
  side: DockSide = 'right',
  mode: ExpandMode = 'full',
  hasParcels = false
): boolean {
  if (winX < 0 || winY < 0 || winX > STAGE.w || winY > STAGE.h) return false
  const offsetX = getStageOffsetX(side, mode)
  const shiftedX = winX - offsetX
  if (shiftedX < 0 || shiftedX > STAGE.w) return false
  const localX = side === 'left' ? STAGE.w - shiftedX : shiftedX
  const localY = winY

  if (mode === 'docked') {
    return localX >= 0 && localX <= VISIBLE_WIDTH.docked + 6 && localY >= 64 && localY <= 164
  }
  if (
    hasParcels &&
    ((localX >= DOCK_NAMEPLATE_RECT.x0 &&
      localX <= DOCK_NAMEPLATE_RECT.x1 &&
      localY >= DOCK_NAMEPLATE_RECT.y0 &&
      localY <= DOCK_NAMEPLATE_RECT.y1) ||
      (localX >= DOCK_SEA_TRANSITION_RECT.x0 &&
        localX <= DOCK_SEA_TRANSITION_RECT.x1 &&
        localY >= DOCK_SEA_TRANSITION_RECT.y0 &&
        localY <= DOCK_SEA_TRANSITION_RECT.y1))
  ) {
    return true
  }
  if (
    mode === 'full' &&
    (inEllipse(localX, localY, SKYLINE_ELLIPSE) ||
      (localX >= HOVER_CTRL_RECT.x0 &&
        localX <= HOVER_CTRL_RECT.x1 &&
        localY >= HOVER_CTRL_RECT.y0 &&
        localY <= HOVER_CTRL_RECT.y1))
  ) {
    return true
  }
  return inEllipse(localX, localY) || inPolygon(localX, localY, DOCK_POLY)
}

/**
 * 判断拖拽栈桥包裹时，指针是否仍处于“岛内手抓拖放区”（含栈桥到前方海面的过渡区）：
 * - 在区内保持纯前端手抓交互，不启动系统 OLE 拖拽（无路径文字、无箭头粘贴图标）；
 * - 拖出该区域（如往左拖离栈桥或拖离岛体边缘）则立即交由系统 startDrag 传出文件。
 */
export function isWithinParcelDragZone(
  winX: number,
  winY: number,
  side: DockSide = 'right',
  mode: ExpandMode = 'full'
): boolean {
  if (winX < 2 || winY < 2 || winX > STAGE.w - 2 || winY > STAGE.h - 2) return false
  const offsetX = getStageOffsetX(side, mode)
  const shiftedX = winX - offsetX
  if (shiftedX < 0 || shiftedX > STAGE.w) return false
  const localX = side === 'left' ? STAGE.w - shiftedX : shiftedX
  const localY = winY

  if (mode === 'peek') {
    if (localX < 4 || localX > VISIBLE_WIDTH.peek + 8) return false
    return localY >= 56 && localY <= 216
  }

  if (isInsideIsland(winX, winY, side, mode)) return true
  return localX >= 28 && localX <= 130 && localY >= 140 && localY <= 188
}

/**
 * 根据拖拽起止位置与屏幕工作区边界，计算松手后的停靠方向：
 * - 从贴边态（right/left）向屏幕内拉出超过 SNAP_THRESHOLD 且光标远离边缘时，顺滑脱离为 free；
 * - 从自由态（free）拖近左右边缘（光标 ≤ SNAP_THRESHOLD 或窗口距边缘 ≤ 24px）时，吸附停靠。
 */
export function resolveSnapSide(params: {
  winX: number
  curX: number
  workAreaX: number
  workAreaWidth: number
  startSide: DockSide
  startWinX: number
}): DockSide {
  const { winX, curX, workAreaX, workAreaWidth, startSide, startWinX } = params
  const leftEdge = workAreaX
  const rightEdge = workAreaX + workAreaWidth
  const curDistLeft = Math.abs(curX - leftEdge)
  const curDistRight = Math.abs(rightEdge - curX)

  if (startSide === 'right') {
    if (curDistLeft <= SNAP_THRESHOLD || winX <= leftEdge + 24) return 'left'
    const pulledLeft = startWinX - winX
    if (pulledLeft > SNAP_THRESHOLD && curDistRight > SNAP_THRESHOLD) return 'free'
    return 'right'
  }

  if (startSide === 'left') {
    if (curDistRight <= SNAP_THRESHOLD || winX + STAGE.w >= rightEdge - 24) return 'right'
    const pulledRight = winX - startWinX
    if (pulledRight > SNAP_THRESHOLD && curDistLeft > SNAP_THRESHOLD) return 'free'
    return 'left'
  }

  if (curDistRight <= SNAP_THRESHOLD || winX + STAGE.w >= rightEdge - 24) return 'right'
  if (curDistLeft <= SNAP_THRESHOLD || winX <= leftEdge + 24) return 'left'
  return 'free'
}

export const polyPoints = (pts: Pt[]): string => pts.map((p) => `${p.x},${p.y}`).join(' ')
