import { describe, expect, it } from 'vitest'
import { STAGE, getStageOffsetX } from '../../../shared/shape'
import { clampParcelStageAnchor, formatMmSs, toStageCoordsWith } from './islandMath'

describe('islandMath stage coordinate & anchor helpers', () => {
  it('toStageCoordsWith translates docked/full coordinates for right and mirrored left sides', () => {
    const rightDocked = toStageCoordsWith(100, 80, { side: 'right', mode: 'docked', hover: false }, false)
    expect(rightDocked).toEqual({
      x: 100 - getStageOffsetX('right', 'docked'),
      y: 80
    })

    const leftFull = toStageCoordsWith(120, 95, { side: 'left', mode: 'full', hover: true }, false)
    expect(leftFull).toEqual({
      x: STAGE.w - (120 - getStageOffsetX('left', 'full')),
      y: 95
    })

    // isDragWin=true forces full offset even while pose.mode is still docked
    const draggingRight = toStageCoordsWith(
      140,
      70,
      { side: 'right', mode: 'docked', hover: false },
      true
    )
    expect(draggingRight).toEqual({
      x: 140 - getStageOffsetX('right', 'full'),
      y: 70
    })
  })

  it('clampParcelStageAnchor keeps parcel center within stage interactive bounds', () => {
    expect(clampParcelStageAnchor(-10, 5)).toEqual({ x: 18, y: 32 })
    expect(clampParcelStageAnchor(STAGE.w + 40, STAGE.h + 20)).toEqual({
      x: STAGE.w - 18,
      y: STAGE.h - 10
    })
    expect(clampParcelStageAnchor(120, 110)).toEqual({ x: 120, y: 110 })
  })

  it('formatMmSs rounds partial seconds up and clamps negatives to 00:00', () => {
    expect(formatMmSs(-500)).toBe('00:00')
    expect(formatMmSs(0)).toBe('00:00')
    expect(formatMmSs(1)).toBe('00:01')
    expect(formatMmSs(61_001)).toBe('01:02')
    expect(formatMmSs(25 * 60 * 1000)).toBe('25:00')
  })
})
