/**
 * Stage coordinates and three-stage edge docking geometry (horizontal left-extending pier composition):
 * Standard coordinate frame (dockSide === 'right', docked on right screen edge with pier extending left):
 * - x: 0..46    pier front tip, mooring bollard, peeking otter & count badge (docked state exposes 56px)
 * - x: 0..148   full horizontal pier, 3 parcels & shoreline otter (peek state exposes 148px)
 * - x: 0..320   complete right island, 6 decorations, paper boat & sea ring (full state exposes 320px)
 */

export type Pt = { x: number; y: number }
export type DockSide = 'right' | 'left' | 'free'
export type ExpandMode = 'docked' | 'peek' | 'full'

export interface WorkAreaRect {
  x: number
  y: number
  width: number
  height: number
}

export const STAGE = { w: 320, h: 240 }
export const PANEL = { w: 430, h: 580 }

/** Exposed screen width (px) for each expand mode. */
export const VISIBLE_WIDTH: Record<ExpandMode, number> = {
  docked: 56,
  peek: 148,
  full: STAGE.w
}

/** Distance threshold (px) for snapping to left/right screen edges. */
export const SNAP_THRESHOLD = 64

/** Island ellipse in standard orientation (docked right, pier extending left). */
export const ISLAND_ELLIPSE = { cx: 192, cy: 132, rx: 122, ry: 88 }

/** Upper hill skyline ellipse (covers tree canopy, lamp top, cabin roof, and upper windmill blades). */
export const SKYLINE_ELLIPSE = { cx: 194, cy: 56, rx: 94, ry: 44 }

/** Top-right hover control hit region when expanded (bridges hill & island while leaving corners click-through). */
export const HOVER_CTRL_RECT = { x0: 246, y0: 10, x1: 312, y1: 88 }

/** Inner turf ellipse matching island-horiz.png grass boundary (distinguishes turf vs beach/sea). */
export const GRASS_ELLIPSE = { cx: 194, cy: 106, rx: 95, ry: 52 }

/** Horizontal left-extending wooden pier polygon (x: 4..116, covers badge, parcels, and focus pill). */
export const DOCK_POLY: Pt[] = [
  { x: 4, y: 70 },
  { x: 112, y: 82 },
  { x: 116, y: 162 },
  { x: 4, y: 160 }
]

/** Parcel bottom-center anchor slots positioned on pier planks clear of the rope bollard. */
export const DOCK_SLOTS: Pt[] = [
  { x: 47, y: 117 },
  { x: 70, y: 120 },
  { x: 93, y: 123 }
]

/** Count badge center near pier front bollard (remains fully visible inside 56px docked strip). */
export const DOCK_BADGE: Pt = { x: 17, y: 74 }

/** Default otter anchor on grass at the pier base. */
export const OTTER_HOME: Pt = { x: 156, y: 148 }

/** Docked-mode otter anchor resting centered on planks 2-3 inside the 56px viewport strip. */
export const OTTER_PEEK: Pt = { x: 35, y: 118 }

/** Computes horizontal canvas offset translateX (px) relative to the window for a given side and mode. */
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

/** Parcel nameplate & sea-drop button hit region (prevents click-through while parcels exist outside docked mode). */
export const DOCK_NAMEPLATE_RECT = { x0: 6, y0: 18, x1: 156, y1: 102 }

/** Right-side pier-to-sea transition bridge for dragging parcels into water without premature pass-through. */
export const DOCK_SEA_TRANSITION_RECT = { x0: 36, y0: 150, x1: 132, y1: 188 }

/** Bottom undo pill hit region in peek/full modes (prevents click-through while undo pill is active). */
export const ISLAND_UNDO_PEEK_RECT = { x0: 6, y0: 174, x1: 146, y1: 218 }
export const ISLAND_UNDO_FULL_RECT = { x0: 40, y0: 190, x1: 280, y1: 232 }

/** Returns true when stage coordinates fall on surrounding sea water (triggers water ripples). */
export function isOnWater(localX: number, localY: number): boolean {
  return (
    inEllipse(localX, localY, ISLAND_ELLIPSE) &&
    !inEllipse(localX, localY, GRASS_ELLIPSE) &&
    !inPolygon(localX, localY, DOCK_POLY)
  )
}

/**
 * Checks whether window coordinates (winX, winY) lie inside the visible interactive island region.
 */
export function isInsideIsland(
  winX: number,
  winY: number,
  side: DockSide = 'right',
  mode: ExpandMode = 'full',
  hasParcels = false,
  hasUndo = false
): boolean {
  if (winX < 0 || winY < 0 || winX > STAGE.w || winY > STAGE.h) return false
  const offsetX = getStageOffsetX(side, mode)
  const shiftedX = winX - offsetX
  if (shiftedX < 0 || shiftedX > STAGE.w) return false
  const localX = side === 'left' ? STAGE.w - shiftedX : shiftedX
  const localY = winY

  if (mode === 'docked') {
    return localX >= 0 && localX <= VISIBLE_WIDTH.docked + 10 && localY >= 64 && localY <= 164
  }
  if (
    hasUndo &&
    ((mode === 'peek' &&
      localX >= ISLAND_UNDO_PEEK_RECT.x0 &&
      localX <= ISLAND_UNDO_PEEK_RECT.x1 &&
      localY >= ISLAND_UNDO_PEEK_RECT.y0 &&
      localY <= ISLAND_UNDO_PEEK_RECT.y1) ||
      (mode === 'full' &&
        localX >= ISLAND_UNDO_FULL_RECT.x0 &&
        localX <= ISLAND_UNDO_FULL_RECT.x1 &&
        localY >= ISLAND_UNDO_FULL_RECT.y0 &&
        localY <= ISLAND_UNDO_FULL_RECT.y1))
  ) {
    return true
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
 * Determines whether parcel dragging stays inside the in-island grab zone (pier + sea transition bridge):
 * - Inside: renders frontend grab animation without initiating native OS drag;
 * - Outside (dragged past pier tip or island bounds): engages native OS startDrag immediately.
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
 * Resolves edge-snap side after window drag release using drag start/end coordinates and workArea bounds:
 * - Pulling inward from docked edge past SNAP_THRESHOLD transitions smoothly to free-floating mode;
 * - Moving within SNAP_THRESHOLD (or 24px window gap) of left/right edges snaps cleanly back.
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

export function clampIslandToWorkArea(
  pos: { x: number; y: number },
  side: DockSide,
  wa: WorkAreaRect
): { x: number; y: number } {
  const y = Math.min(Math.max(pos.y, wa.y), Math.max(wa.y, wa.y + wa.height - STAGE.h))
  if (side === 'right') return { x: wa.x + wa.width - STAGE.w, y }
  if (side === 'left') return { x: wa.x, y }
  const x = Math.min(Math.max(pos.x, wa.x), Math.max(wa.x, wa.x + wa.width - STAGE.w))
  return { x, y }
}

/**
 * Recomputes valid island coordinates after display resolution, DPI scaling, or monitor changes:
 * - Left/right docked islands re-snap to the edge even if the old center remains on screen;
 * - If the previous display was disconnected, falls back to the primary display workArea.
 */
export function reconcileIslandPosOnDisplayChange(params: {
  currentPos?: { x: number; y: number }
  side: DockSide
  allWorkAreas: WorkAreaRect[]
  primaryWorkArea: WorkAreaRect
}): { x: number; y: number } {
  const { currentPos, side, allWorkAreas, primaryWorkArea } = params
  const makeDefaultFor = (wa: WorkAreaRect): { x: number; y: number } => ({
    x:
      side === 'left'
        ? wa.x
        : side === 'right'
          ? wa.x + wa.width - STAGE.w
          : Math.round(wa.x + (wa.width - STAGE.w) / 2),
    y: Math.round(wa.y + wa.height * 0.62)
  })

  if (!currentPos) {
    return clampIslandToWorkArea(makeDefaultFor(primaryWorkArea), side, primaryWorkArea)
  }

  const cx = currentPos.x + STAGE.w / 2
  const cy = currentPos.y + STAGE.h / 2
  const matched = allWorkAreas.find(
    (a) => cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height
  )
  if (!matched) {
    return clampIslandToWorkArea(makeDefaultFor(primaryWorkArea), side, primaryWorkArea)
  }
  return clampIslandToWorkArea(currentPos, side, matched)
}

export function clampPanelBoundsToWorkArea(
  bounds: { x: number; y: number; width: number; height: number },
  allWorkAreas: WorkAreaRect[],
  primaryWorkArea: WorkAreaRect
): { x: number; y: number; width: number; height: number } {
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  const wa =
    allWorkAreas.find(
      (a) => cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height
    ) ?? primaryWorkArea
  const gap = 8
  const w = Math.min(bounds.width, Math.max(240, wa.width - gap * 2))
  const h = Math.min(bounds.height, Math.max(240, wa.height - gap * 2))
  const x = Math.min(
    Math.max(bounds.x, wa.x + gap),
    Math.max(wa.x + gap, wa.x + wa.width - w - gap)
  )
  const y = Math.min(
    Math.max(bounds.y, wa.y + gap),
    Math.max(wa.y + gap, wa.y + wa.height - h - gap)
  )
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }
}

export const polyPoints = (pts: Pt[]): string => pts.map((p) => `${p.x},${p.y}`).join(' ')
