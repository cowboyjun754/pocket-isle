import { describe, expect, it } from 'vitest'
import {
  DOCK_BADGE,
  DOCK_SLOTS,
  OTTER_HOME,
  STAGE,
  VISIBLE_WIDTH,
  clampPanelBoundsToWorkArea,
  getStageOffsetX,
  isInsideIsland,
  isOnWater,
  isWithinParcelDragZone,
  reconcileIslandPosOnDisplayChange,
  resolveSnapSide
} from './shape'

describe('isInsideIsland (horizontal left pier + right island)', () => {
  it('covers island center and horizontal left pier when expanded', () => {
    expect(isInsideIsland(192, 132, 'right', 'full')).toBe(true)
    expect(isInsideIsland(20, 125, 'right', 'full')).toBe(true)
  })

  it('includes top-right controls, tall hill landmarks, focus pill, nameplates, and undo pill', () => {
    // Top-right ambience/hide buttons (282, 26)
    expect(isInsideIsland(282, 26, 'right', 'full')).toBe(true)
    // Tree canopy top (198, 20), lamp top (173, 22), windmill top (258, 36)
    expect(isInsideIsland(198, 20, 'right', 'full')).toBe(true)
    expect(isInsideIsland(173, 22, 'right', 'full')).toBe(true)
    expect(isInsideIsland(258, 36, 'right', 'full')).toBe(true)
    // Focus countdown pill across full / peek / docked modes
    expect(isInsideIsland(62, 150, 'right', 'full')).toBe(true)
    expect(isInsideIsland(172 + 62, 150, 'right', 'peek')).toBe(true)
    expect(isInsideIsland(264 + 28, 148, 'right', 'docked')).toBe(true)
    // Parcel nameplate & sea-drop bridge are interactive only when parcels are present
    expect(isInsideIsland(74, 48, 'right', 'full', false)).toBe(false)
    expect(isInsideIsland(74, 48, 'right', 'full', true)).toBe(true)
    expect(isInsideIsland(172 + 74, 48, 'right', 'peek', true)).toBe(true)
    expect(isInsideIsland(75, 165, 'right', 'full', true)).toBe(true)
    // Bottom undo pill hit region stays interactive in peek and full when hasUndo=true (including right-edge close button)
    expect(isInsideIsland(172 + 80, 195, 'right', 'peek', false, false)).toBe(false)
    expect(isInsideIsland(172 + 80, 195, 'right', 'peek', false, true)).toBe(true)
    expect(isInsideIsland(144, 195, 'left', 'peek', false, true)).toBe(true)
    expect(isInsideIsland(160, 226, 'right', 'full', false, true)).toBe(true)
    expect(isInsideIsland(305, 212, 'right', 'full', false, true)).toBe(true)
    expect(isInsideIsland(305, 212, 'left', 'full', false, true)).toBe(true)
  })

  it('lets transparent corners click through when expanded', () => {
    expect(isInsideIsland(2, 2, 'right', 'full')).toBe(false)
    expect(isInsideIsland(318, 2, 'right', 'full')).toBe(false)
    expect(isInsideIsland(2, 238, 'right', 'full')).toBe(false)
    expect(isInsideIsland(318, 238, 'right', 'full')).toBe(false)
  })

  it('captures mouse only within right 56px pier head when right-docked', () => {
    const off = getStageOffsetX('right', 'docked')
    expect(off).toBe(STAGE.w - VISIBLE_WIDTH.docked)
    expect(isInsideIsland(100, 125, 'right', 'docked')).toBe(false)
    expect(isInsideIsland(300, 125, 'right', 'docked')).toBe(true)
  })

  it('captures mouse only within left 56px pier head when left-docked', () => {
    expect(isInsideIsland(20, 125, 'left', 'docked')).toBe(true)
    expect(isInsideIsland(200, 125, 'left', 'docked')).toBe(false)
  })

  it('keeps dock badge, parcels, and otter inside interactive bounds when full', () => {
    for (const p of [DOCK_BADGE, OTTER_HOME, ...DOCK_SLOTS]) {
      expect(isInsideIsland(p.x, p.y, 'right', 'full')).toBe(true)
    }
  })

  it('distinguishes outer sea water from turf and pier', () => {
    expect(isOnWater(220, 204)).toBe(true)
    expect(isOnWater(180, 175)).toBe(true)
    expect(isOnWater(120, 175)).toBe(true)
    expect(isOnWater(290, 145)).toBe(true)
    expect(isOnWater(194, 118)).toBe(false)
    expect(isOnWater(232, 142)).toBe(false)
    expect(isOnWater(50, 120)).toBe(false)
  })

  it('distinguishes in-island sea drop vs outbound native drag zone', () => {
    // Diagonal drag from pier toward sea stays inside island zone when full
    expect(isWithinParcelDragZone(55, 165, 'right', 'full')).toBe(true)
    expect(isWithinParcelDragZone(180, 175, 'right', 'full')).toBe(true)
    // Dragging left past pier, off transparent corners, or out top edge triggers pass-through
    expect(isWithinParcelDragZone(1, 118, 'right', 'full')).toBe(false)
    expect(isWithinParcelDragZone(16, 196, 'right', 'full')).toBe(false)
    expect(isWithinParcelDragZone(42, 50, 'right', 'full')).toBe(false)
    // In peek mode, pulling left past pier front triggers native OS drag-out
    expect(isWithinParcelDragZone(174, 118, 'right', 'peek')).toBe(false)
    expect(isWithinParcelDragZone(272, 175, 'right', 'peek')).toBe(true)
  })
})

describe('resolveSnapSide (edge snap & detach behavior)', () => {
  it('detaches smoothly into free mode when pulled past threshold from right-peek', () => {
    // Width 1920, startWinX = 1920 - 148 = 1772, dragged 120px left to winX = 1652
    expect(
      resolveSnapSide({
        winX: 1652,
        curX: 1750,
        workAreaX: 0,
        workAreaWidth: 1920,
        startSide: 'right',
        startWinX: 1772
      })
    ).toBe('free')
  })

  it('stays docked right during small vertical adjustments along right edge', () => {
    expect(
      resolveSnapSide({
        winX: 1760,
        curX: 1890,
        workAreaX: 0,
        workAreaWidth: 1920,
        startSide: 'right',
        startWinX: 1772
      })
    ).toBe('right')
  })

  it('detaches from left edge past threshold and snaps right when dragged to right edge', () => {
    expect(
      resolveSnapSide({
        winX: -50,
        curX: 160,
        workAreaX: 0,
        workAreaWidth: 1920,
        startSide: 'left',
        startWinX: -172
      })
    ).toBe('free')

    expect(
      resolveSnapSide({
        winX: 1620,
        curX: 1880,
        workAreaX: 0,
        workAreaWidth: 1920,
        startSide: 'left',
        startWinX: -172
      })
    ).toBe('right')
  })
})

describe('reconcileIslandPosOnDisplayChange & clampPanelBoundsToWorkArea', () => {
  it('re-aligns right-docked island to the new right edge after resolution widens', () => {
    const pos = reconcileIslandPosOnDisplayChange({
      currentPos: { x: 1600, y: 600 },
      side: 'right',
      allWorkAreas: [{ x: 0, y: 0, width: 2560, height: 1400 }],
      primaryWorkArea: { x: 0, y: 0, width: 2560, height: 1400 }
    })
    expect(pos).toEqual({ x: 2560 - STAGE.w, y: 600 })
  })

  it('clamps both island and custom-moved panel back into primary workArea when secondary display disconnects', () => {
    const primary = { x: 0, y: 0, width: 1920, height: 1040 }
    const islandNext = reconcileIslandPosOnDisplayChange({
      currentPos: { x: 3520, y: 500 },
      side: 'right',
      allWorkAreas: [primary],
      primaryWorkArea: primary
    })
    expect(islandNext.x).toBe(1920 - STAGE.w)
    expect(islandNext.y).toBeGreaterThanOrEqual(0)
    expect(islandNext.y).toBeLessThanOrEqual(1040 - STAGE.h)

    const panelNext = clampPanelBoundsToWorkArea(
      { x: 3000, y: 200, width: 430, height: 580 },
      [primary],
      primary
    )
    expect(panelNext.x).toBe(1920 - 430 - 8)
    expect(panelNext.y).toBe(200)
  })
})
