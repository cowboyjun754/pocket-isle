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
  it('全展开时岛中心和左侧水平木栈桥都在区域内', () => {
    expect(isInsideIsland(192, 132, 'right', 'full')).toBe(true)
    expect(isInsideIsland(20, 125, 'right', 'full')).toBe(true)
  })

  it('全展开时右上角控制按钮、山坡高处景物与专注胶囊都在可交互区内', () => {
    // 右上角日夜/隐藏按钮 (282, 26)
    expect(isInsideIsland(282, 26, 'right', 'full')).toBe(true)
    // 圆冠树树冠顶部 (198, 20)、小路灯顶部 (173, 22)、小风车顶部 (258, 36)
    expect(isInsideIsland(198, 20, 'right', 'full')).toBe(true)
    expect(isInsideIsland(173, 22, 'right', 'full')).toBe(true)
    expect(isInsideIsland(258, 36, 'right', 'full')).toBe(true)
    // 专注胶囊在 full / peek / docked 三态下均在可点击热区内
    expect(isInsideIsland(62, 150, 'right', 'full')).toBe(true)
    expect(isInsideIsland(172 + 62, 150, 'right', 'peek')).toBe(true)
    expect(isInsideIsland(264 + 28, 148, 'right', 'docked')).toBe(true)
    // 栈桥有包裹时名牌及「扔海里」按钮区域与下海过渡区保持可交互，无包裹时仍穿透
    expect(isInsideIsland(74, 48, 'right', 'full', false)).toBe(false)
    expect(isInsideIsland(74, 48, 'right', 'full', true)).toBe(true)
    expect(isInsideIsland(172 + 74, 48, 'right', 'peek', true)).toBe(true)
    expect(isInsideIsland(75, 165, 'right', 'full', true)).toBe(true)
    // 无包裹但存在可点击的撤销浮条时，底部浮条热区在 peek 与 full 下保持可点击
    expect(isInsideIsland(172 + 80, 195, 'right', 'peek', false, false)).toBe(false)
    expect(isInsideIsland(172 + 80, 195, 'right', 'peek', false, true)).toBe(true)
    expect(isInsideIsland(160, 226, 'right', 'full', false, true)).toBe(true)
  })

  it('全展开时四角透明区域应穿透', () => {
    expect(isInsideIsland(2, 2, 'right', 'full')).toBe(false)
    expect(isInsideIsland(318, 2, 'right', 'full')).toBe(false)
    expect(isInsideIsland(2, 238, 'right', 'full')).toBe(false)
    expect(isInsideIsland(318, 238, 'right', 'full')).toBe(false)
  })

  it('右侧停靠态只在右侧 56px 栈桥头响应鼠标，左侧透明区穿透', () => {
    const off = getStageOffsetX('right', 'docked')
    expect(off).toBe(STAGE.w - VISIBLE_WIDTH.docked)
    expect(isInsideIsland(100, 125, 'right', 'docked')).toBe(false)
    expect(isInsideIsland(300, 125, 'right', 'docked')).toBe(true)
  })

  it('左侧停靠态只在左侧 56px 栈桥头响应鼠标', () => {
    expect(isInsideIsland(20, 125, 'left', 'docked')).toBe(true)
    expect(isInsideIsland(200, 125, 'left', 'docked')).toBe(false)
  })

  it('角标、包裹、水獭在全展开下都在可交互区域内', () => {
    for (const p of [DOCK_BADGE, OTTER_HOME, ...DOCK_SLOTS]) {
      expect(isInsideIsland(p.x, p.y, 'right', 'full')).toBe(true)
    }
  })

  it('水面判定能区分外圈海水与草地/栈桥', () => {
    expect(isOnWater(220, 204)).toBe(true)
    expect(isOnWater(180, 175)).toBe(true)
    expect(isOnWater(120, 175)).toBe(true)
    expect(isOnWater(290, 145)).toBe(true)
    expect(isOnWater(194, 118)).toBe(false)
    expect(isOnWater(232, 142)).toBe(false)
    expect(isOnWater(50, 120)).toBe(false)
  })

  it('包裹拖拽区能区分岛内扔海与拖出岛外传文件', () => {
    // 全展开从栈桥往海面斜拖经过过渡区仍在岛内
    expect(isWithinParcelDragZone(55, 165, 'right', 'full')).toBe(true)
    expect(isWithinParcelDragZone(180, 175, 'right', 'full')).toBe(true)
    // 往左拖离栈桥、拖出左下透明边角或拖出顶部均判定为离开岛屿
    expect(isWithinParcelDragZone(1, 118, 'right', 'full')).toBe(false)
    expect(isWithinParcelDragZone(16, 196, 'right', 'full')).toBe(false)
    expect(isWithinParcelDragZone(42, 50, 'right', 'full')).toBe(false)
    // 半开 peek 态往左拖离栈桥前端即触发系统拖出
    expect(isWithinParcelDragZone(174, 118, 'right', 'peek')).toBe(false)
    expect(isWithinParcelDragZone(272, 175, 'right', 'peek')).toBe(true)
  })
})

describe('resolveSnapSide (edge snap & detach behavior)', () => {
  it('从右边缘半开态往左拉出超过阈值时应顺滑脱离为 free，不再强制吸回', () => {
    // 屏幕宽 1920，peek 态起始补偿后 startWinX = 1920 - 148 = 1772，用户往左拉了 120px 到 winX = 1652
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

  it('在右边缘上下拖动微调高度时保持 right 停靠', () => {
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

  it('从左边缘往右拉出超过阈值时脱离为 free，拖到右边缘时吸附到 right', () => {
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
  it('分辨率变宽后即使旧中心仍在屏内，right 停靠小岛仍重新贴齐新右边缘', () => {
    const pos = reconcileIslandPosOnDisplayChange({
      currentPos: { x: 1600, y: 600 },
      side: 'right',
      allWorkAreas: [{ x: 0, y: 0, width: 2560, height: 1400 }],
      primaryWorkArea: { x: 0, y: 0, width: 2560, height: 1400 }
    })
    expect(pos).toEqual({ x: 2560 - STAGE.w, y: 600 })
  })

  it('拔掉副屏后，原本在副屏上的小岛与自定义位置面板都回到主屏可见工作区', () => {
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
