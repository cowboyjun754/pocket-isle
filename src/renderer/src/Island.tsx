import { useEffect, useRef, useState } from 'react'
import { chooseDropEffect, extractPathsFromDataTransfer } from '../../shared/dropPaths'
import { getParcelKindForExt } from '../../shared/parcelKind'
import {
  DOCK_BADGE,
  DOCK_POLY,
  DOCK_SLOTS,
  GRASS_ELLIPSE,
  OTTER_HOME,
  OTTER_PEEK,
  STAGE,
  getStageOffsetX,
  inEllipse,
  isOnWater,
  polyPoints
} from '../../shared/shape'
import type {
  DecorationId,
  DecorationState,
  DockItem,
  FocusState,
  IslandMemory,
  IslandPose,
  IslandSprout,
  OtterAction,
  ParcelKind
} from '../../shared/types'
import decoBenchUrl from './assets/deco-bench.png'
import decoCabinUrl from './assets/deco-cabin.png'
import decoFlowersUrl from './assets/deco-flowers.png'
import decoLampUrl from './assets/deco-lamp.png'
import decoTreeUrl from './assets/deco-tree.png'
import decoWindmillUrl from './assets/deco-windmill.png'
import islandHorizUrl from './assets/island-horiz.png'
import otterIdleUrl from './assets/otter-idle.png'
import otterReadUrl from './assets/otter-read.png'
import otterReceiveUrl from './assets/otter-receive.png'
import otterRestUrl from './assets/otter-rest.png'
import otterWaveUrl from './assets/otter-wave.png'
import paperBoatUrl from './assets/paper-boat.png'
import parcelBoxUrl from './assets/parcel-box.png'
import parcelEnvelopeUrl from './assets/parcel-envelope.png'
import parcelScrollUrl from './assets/parcel-scroll.png'
import './island.css'
import { describeResult } from './util'

const PARCEL_SPRITES: Record<'envelope' | 'box' | 'scroll', { src: string; w: number; h: number }> =
  {
    envelope: { src: parcelEnvelopeUrl, w: 34, h: 22 },
    box: { src: parcelBoxUrl, w: 30, h: 28 },
    scroll: { src: parcelScrollUrl, w: 30, h: 26 }
  }

const OTTER_SPRITES: Record<OtterAction, string> = {
  idle: otterIdleUrl,
  receive: otterReceiveUrl,
  read: otterReadUrl,
  wave: otterWaveUrl,
  rest: otterRestUrl
}

const DECO_LAYERS: Array<{ id: DecorationId; src: string; className: string }> = [
  { id: 'flowers', src: decoFlowersUrl, className: 'deco-layer deco-flowers' },
  { id: 'bench', src: decoBenchUrl, className: 'deco-layer deco-bench' },
  { id: 'lamp', src: decoLampUrl, className: 'deco-layer deco-lamp' },
  { id: 'tree', src: decoTreeUrl, className: 'deco-layer deco-tree' },
  { id: 'cabin', src: decoCabinUrl, className: 'deco-layer deco-cabin' },
  { id: 'windmill', src: decoWindmillUrl, className: 'deco-layer deco-windmill' }
]

const PAT_REACTIONS: Array<{ action: OtterAction; anim: string; bubble: string }> = [
  { action: 'wave', anim: 'react-wave', bubble: '嗨~ 摸摸头 ♪' },
  { action: 'idle', anim: 'react-nod', bubble: '嗯嗯，我在呢!' },
  { action: 'read', anim: 'react-hop', bubble: '看我发现了什么~' },
  { action: 'wave', anim: 'react-wave', bubble: '点草地或建筑我都会过去玩哦~' }
]

interface WaterRipple {
  id: number
  x: number
  y: number
}

interface FloatingParticle {
  id: number
  x: number
  y: number
  kind: 'leaf' | 'butterfly' | 'smoke' | 'dandelion' | 'heart' | 'note' | 'splash'
}

interface DraggingParcel {
  id: string
  name: string
  kind: ParcelKind
  src: string
  w: number
  h: number
  available: boolean
}

interface SinkingParcel {
  uid: number
  src: string
  w: number
  h: number
  x: number
  y: number
}

interface ReleasingHand {
  uid: number
  x: number
  y: number
}

export function Island(): JSX.Element {
  const [items, setItems] = useState<DockItem[]>([])
  const [pose, setPose] = useState<IslandPose>({ side: 'right', mode: 'docked', hover: false })
  const [decor, setDecor] = useState<DecorationState>({
    ambience: 'day',
    enabled: {
      flowers: true,
      bench: true,
      lamp: true,
      tree: true,
      cabin: true,
      windmill: true
    }
  })
  const [focus, setFocus] = useState<FocusState | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [tempAction, setTempAction] = useState<OtterAction | null>(null)
  const [reactAnim, setReactAnim] = useState<string>('')
  const [throwingParcel, setThrowingParcel] = useState<{
    id: string
    x: number
    y: number
  } | null>(null)
  const throwTimersRef = useRef<number[]>([])
  const moveRafRef = useRef<number | null>(null)

  useEffect(() => {
    const onWindowBlur = (): void => {
      if (moveRafRef.current !== null) {
        window.cancelAnimationFrame(moveRafRef.current)
        moveRafRef.current = null
      }
      if (dragMove.current?.moved) {
        dragMove.current = null
        setDraggingWin(false)
        window.isle.endMoveIsland()
      }
    }
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('blur', onWindowBlur)
      for (const id of throwTimersRef.current) window.clearTimeout(id)
      throwTimersRef.current = []
      if (moveRafRef.current !== null) {
        window.cancelAnimationFrame(moveRafRef.current)
        moveRafRef.current = null
      }
    }
  }, [])
  const [bubble, setBubble] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [draggingWin, setDraggingWin] = useState(false)

  // 水獭在全展开岛上的漫游坐标（点哪里就蹦蹦跳跳走去哪里！）
  const [roamSpot, setRoamSpot] = useState<{ x: number; y: number } | null>(null)

  // 丰富的岛上互动状态
  const [ripples, setRipples] = useState<WaterRipple[]>([])
  const [sprouts, setSprouts] = useState<IslandSprout[]>([
    { id: 1, x: 184, y: 142, kind: 0 },
    { id: 2, x: 256, y: 122, kind: 1 },
    { id: 3, x: 148, y: 120, kind: 2 }
  ])
  const [particles, setParticles] = useState<FloatingParticle[]>([])
  const [lampOverride, setLampOverride] = useState<boolean | null>(null)
  const [cabinOverride, setCabinOverride] = useState<boolean | null>(null)
  const [picnicSteaming, setPicnicSteaming] = useState(true)
  const [starfishHop, setStarfishHop] = useState(false)
  const [boatPos, setBoatPos] = useState<{ x: number; y: number }>({ x: 224, y: 196 })
  const [boatSailing, setBoatSailing] = useState(false)
  const [draggingBoat, setDraggingBoat] = useState(false)
  const [draggingParcel, setDraggingParcel] = useState<DraggingParcel | null>(null)
  const [hoveredParcelId, setHoveredParcelId] = useState<string | null>(null)
  const [pointerDragPos, setPointerDragPos] = useState<{ x: number; y: number } | null>(null)
  const [sinkingIds, setSinkingIds] = useState<Set<string>>(new Set())
  const [sinkingParcels, setSinkingParcels] = useState<SinkingParcel[]>([])
  const [releasingHands, setReleasingHands] = useState<ReleasingHand[]>([])

  const patIdx = useRef(0)
  const prevHoverRef = useRef(false)
  const lastWinDragAt = useRef(0)
  const poseRef = useRef(pose)
  poseRef.current = pose
  const sproutsRef = useRef(sprouts)
  sproutsRef.current = sprouts
  const draggingWinRef = useRef(draggingWin)
  draggingWinRef.current = draggingWin
  const focusRef = useRef(focus)
  focusRef.current = focus
  const draggingParcelRef = useRef<DraggingParcel | null>(null)
  const dragActiveIdRef = useRef<string | null>(null)
  const parcelCleanupRef = useRef<(() => void) | null>(null)
  const parcelSessionRef = useRef<{
    parcel: DraggingParcel
    slotX: number
    slotY: number
    startClientX: number
    startClientY: number
    startStageX: number
    startStageY: number
    button: number
    moved: boolean
  } | null>(null)
  const suppressContextMenuUntilRef = useRef(0)
  const boatPosRef = useRef<{ x: number; y: number }>({ x: 224, y: 196 })
  const actionTimer = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)
  const boatTimer = useRef<number | null>(null)
  const boatDragRef = useRef<{ pointerId: number; moved: boolean } | null>(null)
  const dragMove = useRef<{
    pointerId: number
    startX: number
    startY: number
    localX: number
    localY: number
    moved: boolean
  } | null>(null)

  const triggerOtter = (
    action: OtterAction,
    text?: string,
    ms = 2400,
    anim = 'react-hop',
    walkTo?: { x: number; y: number },
    hold = true
  ): void => {
    if (actionTimer.current) window.clearTimeout(actionTimer.current)
    if (walkTo) setRoamSpot(walkTo)
    setTempAction(action)
    setReactAnim(anim)
    if (text) setBubble(text)
    if (hold && poseRef.current.mode === 'full') {
      window.isle.holdExpand(ms + 700)
    }
    actionTimer.current = window.setTimeout(() => {
      setTempAction(null)
      setReactAnim('')
      setBubble(null)
    }, ms)
  }

  const spawnParticles = (
    x: number,
    y: number,
    kind: FloatingParticle['kind'],
    count = 3
  ): void => {
    const created: FloatingParticle[] = Array.from({ length: count }, (_, i) => ({
      id: Date.now() + Math.random() + i,
      x: x + (i - 1) * 12,
      y: y - i * 4,
      kind
    }))
    setParticles((prev) => [...prev.slice(-10), ...created])
    window.setTimeout(() => {
      const ids = new Set(created.map((c) => c.id))
      setParticles((prev) => prev.filter((p) => !ids.has(p.id)))
    }, 2400)
  }

  const showToast = (msg: string | null): void => {
    if (!msg) return
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = window.setTimeout(() => setToast(null), 2500)
  }

  useEffect(() => {
    for (const url of [
      islandHorizUrl,
      paperBoatUrl,
      parcelEnvelopeUrl,
      parcelBoxUrl,
      parcelScrollUrl,
      ...Object.values(OTTER_SPRITES),
      ...DECO_LAYERS.map((d) => d.src)
    ]) {
      const img = new Image()
      img.src = url
    }

    const applyMemory = (m: IslandMemory): void => {
      if (Array.isArray(m.sprouts)) setSprouts(m.sprouts)
      setLampOverride(m.lampLit)
      setCabinOverride(m.cabinWarm)
    }

    const refresh = (): void => {
      window.isle.listDock().then(setItems)
    }
    refresh()
    window.isle.getPose().then(setPose)
    window.isle.getDecorations().then(setDecor)
    window.isle.getIslandMemory().then(applyMemory)
    window.isle.getFocus().then(setFocus)

    const off1 = window.isle.onDockChanged(refresh)
    const off2 = window.isle.onPose((p) => {
      setPose(p)
      if (p.mode !== 'full') setRoamSpot(null)
    })
    const off3 = window.isle.onReceived((r) => {
      if (r.added > 0) {
        setRoamSpot(null)
        triggerOtter('receive', '收到文件啦!', 1600, 'react-hop')
      }
      showToast(describeResult(r))
    })
    const off4 = window.isle.onDecorChanged((nextDecor) => {
      setDecor((prev) => {
        if (prev.ambience !== nextDecor.ambience) {
          setLampOverride(null)
          setCabinOverride(null)
        }
        return nextDecor
      })
    })
    const offMem = window.isle.onIslandMemoryChanged(applyMemory)
    const off5 = window.isle.onFocusChanged(setFocus)
    const off6 = window.isle.onOtterReact((r) => {
      triggerOtter(r.action, r.bubble, r.durationMs ?? 3000, 'react-wave', undefined, false)
    })
    const off7 = window.isle.onDragEnded(() => {
      dragActiveIdRef.current = null
      draggingParcelRef.current = null
      parcelSessionRef.current = null
      setDraggingParcel(null)
      setPointerDragPos(null)
    })

    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        window.isle.pasteFromClipboard().then((res) => {
          const msg = describeResult(res)
          if (msg) showToast(msg)
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      off1()
      off2()
      off3()
      off4()
      offMem()
      off5()
      off6()
      off7()
      window.removeEventListener('keydown', onKeyDown)
      parcelCleanupRef.current?.()
      if (actionTimer.current) window.clearTimeout(actionTimer.current)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      if (boatTimer.current) window.clearTimeout(boatTimer.current)
    }
  }, [])

  // 全展开空闲时，水獭偶尔自己在已启用的景点间散步换个位置
  useEffect(() => {
    if (
      pose.mode !== 'full' ||
      dragOver ||
      draggingParcel ||
      draggingWin ||
      tempAction ||
      (focus && (focus.phase === 'focus' || focus.phase === 'rest') && focus.running)
    ) {
      return
    }
    const timer = window.setTimeout(
      () => {
        const spots: Array<{ x: number; y: number }> = [OTTER_HOME, { x: 214, y: 148 }]
        if (decor.enabled.flowers) spots.push({ x: 132, y: 112 })
        if (decor.enabled.bench) spots.push({ x: 154, y: 96 })
        if (decor.enabled.tree) spots.push({ x: 196, y: 98 })
        if (decor.enabled.cabin) spots.push({ x: 218, y: 108 })
        if (decor.enabled.windmill) spots.push({ x: 248, y: 118 })
        const candidates = spots.filter(
          (s) => !roamSpot || Math.hypot(s.x - roamSpot.x, s.y - roamSpot.y) > 8
        )
        const pick = candidates[Math.floor(Math.random() * candidates.length)] ?? OTTER_HOME
        setRoamSpot(pick)
        setReactAnim('react-hop')
        window.setTimeout(() => setReactAnim(''), 500)
      },
      13000 + Math.random() * 7000
    )
    return () => window.clearTimeout(timer)
  }, [pose.mode, dragOver, draggingParcel, draggingWin, tempAction, focus, decor.enabled, roamSpot])

  useEffect(() => {
    if (prevHoverRef.current && !pose.hover) {
      setDragOver(false)
    }
    prevHoverRef.current = pose.hover
  }, [pose.hover])

  const toStageCoordsWith = (
    clientX: number,
    clientY: number,
    p: IslandPose,
    isDragWin: boolean
  ): { x: number; y: number } => {
    const effectiveMode = isDragWin ? 'full' : p.mode
    const offX = getStageOffsetX(p.side, effectiveMode)
    const shiftedX = clientX - offX
    const localX = p.side === 'left' ? STAGE.w - shiftedX : shiftedX
    return { x: localX, y: clientY }
  }

  const sinkParcelIntoSea = (parcel: DraggingParcel, x: number, y: number): void => {
    const uid = Date.now() + Math.random()
    setSinkingIds((prev) => new Set(prev).add(parcel.id))
    // 放手点与握持时手的位置严格一致：(x, y - parcel.h - 12)
    setReleasingHands((prev) => [...prev.slice(-3), { uid, x, y: y - parcel.h - 12 }])
    setSinkingParcels((prev) => [
      ...prev.slice(-4),
      { uid, src: parcel.src, w: parcel.w, h: parcel.h, x, y }
    ])
    window.setTimeout(() => {
      spawnRipple(x, y)
      spawnParticles(x, y - 2, 'splash', 4)
    }, 180)
    window.setTimeout(() => spawnRipple(x + 2, y + 1), 340)
    const curFocus = focusRef.current
    if (!(curFocus?.phase === 'focus' && curFocus.running)) {
      triggerOtter('wave', '扑通！已移出码头~', 2000, 'react-hop')
    }
    window.isle.remove([parcel.id])
    window.setTimeout(() => {
      setReleasingHands((prev) => prev.filter((h) => h.uid !== uid))
    }, 320)
    window.setTimeout(() => {
      setSinkingParcels((prev) => prev.filter((s) => s.uid !== uid))
      setSinkingIds((prev) => {
        const next = new Set(prev)
        next.delete(parcel.id)
        return next
      })
    }, 1220)
  }

  const clearThrowTimers = (): void => {
    for (const id of throwTimersRef.current) window.clearTimeout(id)
    throwTimersRef.current = []
  }

  const throwParcelWithHand = (
    parcel: DraggingParcel,
    slot: { x: number; y: number },
    idx: number
  ): void => {
    if (throwingParcel) return
    clearThrowTimers()
    parcelCleanupRef.current?.()
    parcelSessionRef.current = null
    setHoveredParcelId(null)
    setDraggingParcel(null)
    setPointerDragPos(null)
    // 先在栈桥原位伸手抓起（平滑抬起过渡），再连同小手带到近海松手入水沉没
    setThrowingParcel({ id: parcel.id, x: slot.x, y: slot.y })
    const targetX = 104 + idx * 11
    const targetY = 178
    const moveTimer = window.setTimeout(() => {
      setThrowingParcel((cur) =>
        cur && cur.id === parcel.id ? { id: parcel.id, x: targetX, y: targetY } : cur
      )
    }, 110)
    const dropTimer = window.setTimeout(() => {
      setThrowingParcel((cur) => (cur && cur.id === parcel.id ? null : cur))
      sinkParcelIntoSea(parcel, targetX, targetY)
    }, 480)
    throwTimersRef.current.push(moveTimer, dropTimer)
  }

  const startParcelPointerDrag = (
    parcel: DraggingParcel,
    slot: { x: number; y: number },
    e: React.PointerEvent<HTMLElement>
  ): void => {
    const isRight = e.button === 2
    const isUnavailableLeft = e.button === 0 && !parcel.available
    if (!isRight && !isUnavailableLeft) return
    e.stopPropagation()
    parcelCleanupRef.current?.()

    const targetEl = e.currentTarget
    const pointerId = e.pointerId
    const startPt = toStageCoordsWith(e.clientX, e.clientY, poseRef.current, draggingWinRef.current)
    const session = {
      parcel,
      slotX: slot.x,
      slotY: slot.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startStageX: startPt.x,
      startStageY: startPt.y,
      button: e.button,
      moved: false
    }
    parcelSessionRef.current = session

    if (isUnavailableLeft) {
      setHoveredParcelId(null)
      setDraggingParcel(parcel)
      setPointerDragPos({ x: slot.x, y: slot.y })
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('blur', onCancel)
      if (targetEl.hasPointerCapture?.(pointerId)) {
        try {
          targetEl.releasePointerCapture(pointerId)
        } catch {
          /* ignore */
        }
      }
      if (parcelCleanupRef.current === cleanup) parcelCleanupRef.current = null
    }

    const computeParcelAnchor = (ev: PointerEvent): { x: number; y: number } => {
      const curPt = toStageCoordsWith(
        ev.clientX,
        ev.clientY,
        poseRef.current,
        draggingWinRef.current
      )
      const rawX = session.slotX + (curPt.x - session.startStageX)
      const rawY = session.slotY + (curPt.y - session.startStageY)
      return {
        x: Math.min(Math.max(rawX, 18), STAGE.w - 18),
        y: Math.min(Math.max(rawY, 32), STAGE.h - 10)
      }
    }

    const onMove = (ev: PointerEvent): void => {
      if (!session.moved) {
        if (Math.hypot(ev.clientX - session.startClientX, ev.clientY - session.startClientY) < 3) {
          return
        }
        session.moved = true
        if (session.button === 2) {
          suppressContextMenuUntilRef.current = Date.now() + 500
        }
        try {
          targetEl.setPointerCapture(pointerId)
        } catch {
          /* ignore */
        }
        setHoveredParcelId(null)
        setDraggingParcel(parcel)
      }
      setPointerDragPos(computeParcelAnchor(ev))
    }

    const onUp = (ev: PointerEvent): void => {
      cleanup()
      parcelSessionRef.current = null
      const wasMoved = session.moved
      setDraggingParcel(null)
      setPointerDragPos(null)
      if (!wasMoved) return
      if (session.button === 2) {
        suppressContextMenuUntilRef.current = Date.now() + 260
        const swallowCtx = (ce: MouseEvent): void => {
          ce.preventDefault()
          ce.stopPropagation()
          window.removeEventListener('contextmenu', swallowCtx, true)
        }
        window.addEventListener('contextmenu', swallowCtx, true)
        window.setTimeout(() => window.removeEventListener('contextmenu', swallowCtx, true), 260)
      }
      const anchor = computeParcelAnchor(ev)
      const rawPt = toStageCoordsWith(
        ev.clientX,
        ev.clientY,
        poseRef.current,
        draggingWinRef.current
      )
      if (isOnWater(anchor.x, anchor.y) || isOnWater(rawPt.x, rawPt.y)) {
        const dropX = isOnWater(anchor.x, anchor.y) ? anchor.x : rawPt.x
        const dropY = isOnWater(anchor.x, anchor.y) ? anchor.y : rawPt.y
        sinkParcelIntoSea(session.parcel, dropX, dropY)
      }
    }

    const onCancel = (): void => {
      cleanup()
      parcelSessionRef.current = null
      setDraggingParcel(null)
      setPointerDragPos(null)
    }

    parcelCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('blur', onCancel)
  }

  const onDragEnter = (e: React.DragEvent): void => {
    if (draggingParcelRef.current) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    setDragOver(true)
    if (pose.mode === 'docked') window.isle.setExpandMode('peek')
  }

  const onDragOver = (e: React.DragEvent): void => {
    if (draggingParcelRef.current) {
      e.preventDefault()
      e.dataTransfer.dropEffect = chooseDropEffect(e.dataTransfer.effectAllowed)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = chooseDropEffect(e.dataTransfer.effectAllowed)
    if (!dragOver) setDragOver(true)
  }

  const onDragLeave = (e: React.DragEvent): void => {
    e.preventDefault()
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragOver(false)
    }
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    const activeDrag = draggingParcelRef.current
    if (activeDrag) {
      dragActiveIdRef.current = null
      draggingParcelRef.current = null
      setDraggingParcel(null)
      setPointerDragPos(null)
      return
    }
    const paths = extractPathsFromDataTransfer(e.dataTransfer, (f) => window.isle.getPathForFile(f))
    if (!paths.length) {
      showToast('未识别到本地文件路径，请从文件列表或资源管理器拖入')
      return
    }
    await window.isle.addPaths(paths)
  }

  const justDraggedWin = (): boolean => Date.now() - lastWinDragAt.current < 260

  const toStageCoords = (clientX: number, clientY: number): { x: number; y: number } => {
    const effectiveMode = draggingWin ? 'full' : pose.mode
    const offX = getStageOffsetX(pose.side, effectiveMode)
    const shiftedX = clientX - offX
    const localX = pose.side === 'left' ? STAGE.w - shiftedX : shiftedX
    return { x: localX, y: clientY }
  }

  const spawnRipple = (x: number, y: number): void => {
    const id = Date.now() + Math.random()
    setRipples((prev) => [...prev.slice(-5), { id, x, y }])
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id))
    }, 1150)
  }

  const launchBoatDrift = (startX: number, startY: number): void => {
    if (boatTimer.current) window.clearTimeout(boatTimer.current)
    const start = { x: startX, y: startY }
    boatPosRef.current = start
    setBoatPos(start)
    setBoatSailing(true)
    spawnRipple(startX, startY)
    boatTimer.current = window.setTimeout(() => {
      const home = { x: 224, y: 196 }
      boatPosRef.current = home
      setBoatSailing(false)
      setBoatPos(home)
    }, 4600)
  }

  const onStagePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const target = e.target as Element | null
    if (
      target?.closest('.parcel, .dock-more-pill, .hide-btn, .ambience-btn, .paper-boat, .focus-mini-pill')
    )
      return
    const pt = toStageCoords(e.clientX, e.clientY)
    dragMove.current = {
      pointerId: e.pointerId,
      startX: e.screenX,
      startY: e.screenY,
      localX: pt.x,
      localY: pt.y,
      moved: false
    }
  }

  const stopMoveLoop = (): void => {
    if (moveRafRef.current !== null) {
      window.cancelAnimationFrame(moveRafRef.current)
      moveRafRef.current = null
    }
  }

  const startMoveLoop = (): void => {
    stopMoveLoop()
    const tick = (): void => {
      if (!dragMove.current?.moved) {
        moveRafRef.current = null
        return
      }
      window.isle.stepMoveIsland()
      moveRafRef.current = window.requestAnimationFrame(tick)
    }
    moveRafRef.current = window.requestAnimationFrame(tick)
  }

  const onStagePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const st = dragMove.current
    if (!st || st.moved) return
    const dx = e.screenX - st.startX
    const dy = e.screenY - st.startY
    if (Math.hypot(dx, dy) < 4) return
    st.moved = true
    setDraggingWin(true)
    e.currentTarget.setPointerCapture(st.pointerId)
    window.isle.beginMoveIsland()
    startMoveLoop()
  }

  const onStagePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const st = dragMove.current
    dragMove.current = null
    if (!st) return
    if (st.moved) {
      stopMoveLoop()
      lastWinDragAt.current = Date.now()
      setDraggingWin(false)
      if (e.currentTarget.hasPointerCapture(st.pointerId)) {
        e.currentTarget.releasePointerCapture(st.pointerId)
      }
      window.isle.stepMoveIsland()
      window.isle.endMoveIsland()
      return
    }
    if (justDraggedWin()) return
    const target = e.target as Element | null
    if (
      pose.mode === 'full' &&
      !target?.closest(
        '.hit-dock, .hit-otter, .hit-spot, .parcel, .dock-more-pill, .hide-btn, .ambience-btn, .paper-boat, .focus-mini-pill'
      )
    ) {
      if (isOnWater(st.localX, st.localY)) {
        spawnRipple(st.localX, st.localY)
      } else if (inEllipse(st.localX, st.localY, GRASS_ELLIPSE)) {
        // 点击草地任意空白处：种下一簇小花苗（持久记忆）+ 水獭蹦蹦跳跳跑过来！
        const kind = (Math.floor(Math.random() * 3) as 0 | 1 | 2)
        const nextSprouts: IslandSprout[] = [
          ...sproutsRef.current.slice(-6),
          { id: Date.now() + Math.random(), x: Math.round(st.localX), y: Math.round(st.localY), kind }
        ]
        sproutsRef.current = nextSprouts
        setSprouts(nextSprouts)
        window.isle.setIslandMemory({ sprouts: nextSprouts })
        const walkX = Math.min(Math.max(st.localX, 128), 268)
        const walkY = Math.min(Math.max(st.localY + 6, 98), 160)
        triggerOtter('wave', '种下一朵小花 ♪', 2000, 'react-hop', { x: walkX, y: walkY })
      }
    }
  }

  const onDockClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (dragMove.current?.moved || draggingWin || justDraggedWin()) return
    if (pose.mode !== 'full') {
      window.isle.setExpandMode('full')
    } else {
      window.isle.togglePanel()
    }
  }

  const onDockOpenPanel = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (Date.now() < suppressContextMenuUntilRef.current) return
    window.isle.setExpandMode('full')
    window.isle.togglePanel()
  }

  const onOtterClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (dragMove.current?.moved || draggingWin || justDraggedWin()) return
    const pick = PAT_REACTIONS[patIdx.current % PAT_REACTIONS.length]
    patIdx.current++
    triggerOtter(pick.action, pick.bubble, 1800, pick.anim)
  }

  const onBoatPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation()
    if (e.button !== 0) return
    if (boatTimer.current) window.clearTimeout(boatTimer.current)
    setBoatSailing(false)
    setDraggingBoat(true)
    boatDragRef.current = { pointerId: e.pointerId, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onBoatPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!boatDragRef.current) return
    e.stopPropagation()
    const pt = toStageCoords(e.clientX, e.clientY)
    boatDragRef.current.moved = true
    const next = {
      x: Math.min(Math.max(pt.x, 90), STAGE.w - 24),
      y: Math.min(Math.max(pt.y, 60), STAGE.h - 18)
    }
    boatPosRef.current = next
    setBoatPos(next)
  }

  const onBoatPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!boatDragRef.current) return
    e.stopPropagation()
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    boatDragRef.current = null
    setDraggingBoat(false)
    const pt = boatPosRef.current
    launchBoatDrift(pt.x, pt.y)
  }

  const visibleParcels = items.slice(-3)
  const effectiveMode = draggingWin ? 'full' : pose.mode
  const offsetX = getStageOffsetX(pose.side, effectiveMode)
  const flipped = pose.side === 'left'

  const activeAction: OtterAction = (() => {
    if (dragOver) return 'receive'
    if (tempAction) return tempAction
    if (focus?.phase === 'focus' && focus.running) return 'read'
    if (focus?.phase === 'rest' && focus.running) return 'rest'
    return 'idle'
  })()

  const otterPos =
    effectiveMode === 'docked'
      ? OTTER_PEEK
      : effectiveMode === 'peek'
        ? { x: 122, y: 132 }
        : roamSpot ?? OTTER_HOME

  const showNightGlow = lampOverride ?? (decor.ambience === 'night')
  const showCabinWarm = cabinOverride ?? (decor.ambience === 'night')

  return (
    <div
      className={`island-viewport side-${pose.side} mode-${effectiveMode} ambience-${decor.ambience} ${
        dragOver ? 'is-dragover' : ''
      } ${draggingWin ? 'is-dragging-win' : ''} ${
        draggingParcel && pointerDragPos ? 'is-grabbing-parcel' : ''
      }`}
      style={{ width: STAGE.w, height: STAGE.h }}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={onStagePointerUp}
      onPointerCancel={onStagePointerUp}
      onLostPointerCapture={onStagePointerUp}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className="island-stage"
        style={{
          transform: `translate3d(${offsetX}px, 0, 0) scaleX(${flipped ? -1 : 1})`
        }}
      >
        {/* 0 底托投影 */}
        <div className="layer-shadow" />

        {/* 1 全手绘水彩小岛底图 + 水平左伸手绘木栈桥 */}
        <img
          className="island-horiz-img"
          src={islandHorizUrl}
          alt=""
          draggable={false}
        />

        {/* 2 自由桌搭：6 件手绘装饰叠层 */}
        <div className="layer-decorations">
          {DECO_LAYERS.map((d) =>
            decor.enabled[d.id] ? (
              <img
                key={d.id}
                src={d.src}
                alt=""
                draggable={false}
                className={d.className}
              />
            ) : null
          )}
          {showNightGlow && decor.enabled.lamp && (
            <div className="night-glow night-glow-lamp" />
          )}
          {showCabinWarm && decor.enabled.cabin && (
            <div className="night-glow night-glow-cabin" />
          )}
        </div>

        {/* 2.5 岸上前景丰富物件：草坪野餐茶席、手绘小花苗、岸边海星与贝壳（填满前排草地与沙滩，点击均可互动） */}
        {effectiveMode === 'full' && (
          <svg className="layer-foreground-svg" viewBox={`0 0 ${STAGE.w} ${STAGE.h}`} aria-hidden>
            {/* 用户点击草地种下的摇摆小花苗 */}
            {sprouts.map((sp) => (
              <g key={sp.id} className="grass-sprout" transform={`translate(${sp.x}, ${sp.y})`}>
                <path d="M0,0 Q-3,-7 -6,-9 M0,0 Q3,-8 6,-9" stroke="#5b7a48" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                {sp.kind === 0 && (
                  <>
                    <circle cx="-6" cy="-10" r="3" fill="#fff8e7" stroke="#6b5640" strokeWidth="1" />
                    <circle cx="-6" cy="-10" r="1.2" fill="#f3b64c" />
                  </>
                )}
                {sp.kind === 1 && (
                  <>
                    <circle cx="6" cy="-10" r="3" fill="#f7b299" stroke="#6b5640" strokeWidth="1" />
                    <circle cx="6" cy="-10" r="1.1" fill="#fff6e0" />
                  </>
                )}
                {sp.kind === 2 && (
                  <circle cx="0" cy="-9" r="2.8" fill="#ffe07d" stroke="#6b5640" strokeWidth="1" />
                )}
              </g>
            ))}

            {/* 右前方草地上的手绘野餐小茶席（暖白方巾 + 热茶杯 + 草莓小盘） */}
            <g className="picnic-mat-group" transform="translate(232, 142)">
              {/* 野餐垫 */}
              <polygon
                points="-22,4 6,-6 26,6 -2,16"
                fill="#f8e8c8"
                stroke="#6b5238"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <polygon
                points="-17,4 5,-4 21,5 -1,13"
                fill="none"
                stroke="#d98a6c"
                strokeWidth="1"
                strokeDasharray="3 2"
              />
              {/* 小木盘与红果子 */}
              <ellipse cx="-5" cy="5" rx="7" ry="4" fill="#e5c494" stroke="#5e452b" strokeWidth="1.3" />
              <circle cx="-6" cy="4" r="2.3" fill="#d9654c" stroke="#5e452b" strokeWidth="0.9" />
              <circle cx="-2.5" cy="5" r="2" fill="#e67e5f" stroke="#5e452b" strokeWidth="0.9" />
              {/* 奶油白茶杯 */}
              <ellipse cx="9" cy="2" rx="4.5" ry="2.6" fill="#fffaf0" stroke="#5e452b" strokeWidth="1.2" />
              <path d="M5,2 L5.8,6.5 C6,8 12,8 12.2,6.5 L13,2" fill="#fdf4e0" stroke="#5e452b" strokeWidth="1.2" />
              <ellipse cx="9" cy="2.2" rx="3.2" ry="1.4" fill="#8b9e6b" />
              {picnicSteaming && (
                <path
                  className="tea-steam"
                  d="M8,-1 Q6,-6 9,-9 M11,0 Q13,-5 10,-8"
                  fill="none"
                  stroke="#fffdf6"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
              )}
            </g>

            {/* 前侧沙滩上的手绘小海星与贝壳 */}
            <g
              className={`shore-starfish ${starfishHop ? 'is-hopping' : ''}`}
              transform="translate(184, 168)"
            >
              <polygon
                points="0,-6 1.8,-2 6,-1.5 2.6,1.4 3.6,5.5 0,3.2 -3.6,5.5 -2.6,1.4 -6,-1.5 -1.8,-2"
                fill="#f09372"
                stroke="#6b4432"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              <circle cx="0" cy="0" r="1" fill="#fff3e0" />
            </g>
            <g className="shore-shell" transform="translate(264, 158)">
              <path
                d="M-5,2 C-5,-4 5,-4 5,2 L2,4 L-2,4 Z"
                fill="#f9e3d8"
                stroke="#6b5238"
                strokeWidth="1.2"
              />
              <line x1="-2" y1="-1" x2="-1" y2="3.5" stroke="#8a6c50" strokeWidth="0.9" />
              <line x1="2" y1="-1" x2="1" y2="3.5" stroke="#8a6c50" strokeWidth="0.9" />
            </g>
          </svg>
        )}

        {/* 3 码头拖放暖黄发光、水面涟漪与互动粒子层 */}
        <svg className="layer-fx-svg" viewBox={`0 0 ${STAGE.w} ${STAGE.h}`} aria-hidden>
          <defs>
            <radialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffe27a" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#ffe27a" stopOpacity="0" />
            </radialGradient>
          </defs>

          <ellipse
            className={`dock-glow ${dragOver ? 'active' : ''}`}
            cx={62}
            cy={132}
            rx={64}
            ry={38}
            fill="url(#glowGrad)"
          />

          {/* 海面周期性微光（白天淡银水波 / 夜晚月亮柔光闪烁） */}
          <g className={`water-shimmers ${decor.ambience === 'night' ? 'is-night' : ''}`}>
            <ellipse className="water-glint glint-1" cx={112} cy={182} rx={9} ry={1.7} />
            <ellipse className="water-glint glint-2" cx={170} cy={192} rx={12} ry={2} />
            <ellipse className="water-glint glint-3" cx={242} cy={176} rx={8} ry={1.6} />
          </g>

          {/* 小木屋烟囱偶尔飘起的轻烟 */}
          {effectiveMode === 'full' && decor.enabled.cabin && (
            <g className="cabin-ambient-smoke" transform="translate(229, 34)">
              <circle className="smoke-puff puff-1" cx={0} cy={0} r={2.3} />
              <circle className="smoke-puff puff-2" cx={2} cy={-4} r={3} />
            </g>
          )}

          {/* 夜晚模式：草地与灯影间的萤火虫 */}
          {effectiveMode === 'full' && decor.ambience === 'night' && (
            <g className="night-fireflies">
              <circle className="firefly ff-1" cx={126} cy={74} r={2.1} />
              <circle className="firefly ff-2" cx={164} cy={56} r={1.8} />
              <circle className="firefly ff-3" cx={208} cy={82} r={2} />
              <circle className="firefly ff-4" cx={248} cy={68} r={1.7} />
            </g>
          )}

          {ripples.map((r) => (
            <g key={r.id} transform={`translate(${r.x}, ${r.y})`}>
              <ellipse className="water-ripple-ring ring-1" cx={0} cy={0} rx={4} ry={2.2} />
              <ellipse className="water-ripple-ring ring-2" cx={0} cy={0} rx={2} ry={1.2} />
            </g>
          ))}

          {/* 景物互动飘出的绿叶、蝴蝶、木屋炊烟、蒲公英与爱心 */}
          {particles.map((p) => (
            <g key={p.id} transform={`translate(${p.x}, ${p.y})`}>
              <g className={`fx-particle fx-${p.kind}`}>
                {p.kind === 'leaf' && (
                  <path
                    d="M0,0 C4,-4 9,-2 7,3 C4,6 0,4 0,0 Z"
                    fill="#8ab068"
                    stroke="#4e6836"
                    strokeWidth="1"
                  />
                )}
                {p.kind === 'butterfly' && (
                  <g>
                    <ellipse cx="-3" cy="-1" rx="3.2" ry="2.2" fill="#ffd972" stroke="#6b4f2c" strokeWidth="0.9" />
                    <ellipse cx="3" cy="-1" rx="3.2" ry="2.2" fill="#ffd972" stroke="#6b4f2c" strokeWidth="0.9" />
                  </g>
                )}
                {p.kind === 'smoke' && (
                  <circle cx="0" cy="0" r="5" fill="rgba(255, 252, 245, 0.82)" stroke="rgba(140,120,100,0.35)" strokeWidth="1" />
                )}
                {p.kind === 'dandelion' && (
                  <g>
                    <circle cx="0" cy="0" r="2.2" fill="#fffdf6" />
                    <line x1="-3" y1="-3" x2="3" y2="3" stroke="#fffdf6" strokeWidth="1" />
                    <line x1="3" y1="-3" x2="-3" y2="3" stroke="#fffdf6" strokeWidth="1" />
                  </g>
                )}
                {p.kind === 'heart' && (
                  <path
                    d="M0,2 C-2,0 -5,0 -5,-3 C-5,-5 -2,-6 0,-3.5 C2,-6 5,-5 5,-3 C5,0 2,0 0,2 Z"
                    fill="#e57368"
                  />
                )}
                {p.kind === 'note' && (
                  <circle cx="0" cy="0" r="3" fill="#ffcf6b" stroke="#6b4f2c" strokeWidth="1" />
                )}
                {p.kind === 'splash' && (
                  <path
                    d="M0,-4 C2.5,-1 3,2 0,3.5 C-3,2 -2.5,-1 0,-4 Z"
                    fill="#d8eef8"
                    stroke="#6f9fbd"
                    strokeWidth="1"
                  />
                )}
              </g>
            </g>
          ))}
        </svg>

        {/* 3.5 减压互动：手绘水彩折纸小船 */}
        {effectiveMode === 'full' && (
          <div
            className={`paper-boat ${boatSailing ? 'is-sailing' : ''} ${
              draggingBoat ? 'is-dragging' : ''
            }`}
            style={{ left: boatPos.x, top: boatPos.y }}
            onPointerDown={onBoatPointerDown}
            onPointerMove={onBoatPointerMove}
            onPointerUp={onBoatPointerUp}
            onPointerCancel={onBoatPointerUp}
            title="减压小纸船：点击或拖到水面任意处松手，看它顺水漂走~"
          >
            <img src={paperBoatUrl} alt="" width={34} height={22} draggable={false} />
          </div>
        )}

        {/* 4 手绘水獭角色（支持在岛上各景点之间蹦跳移动） */}
        <div
          className={`otter-root action-${activeAction} ${reactAnim} otter-in-${effectiveMode}`}
          style={{ left: otterPos.x, top: otterPos.y }}
        >
          <div className="otter-breath">
            <img
              className="otter-sprite"
              src={OTTER_SPRITES[activeAction]}
              alt=""
              draggable={false}
            />
            {bubble && <div className="otter-bubble counter-flip">{bubble}</div>}
          </div>
        </div>

        {/* 5 水平栈桥上的手绘水彩包裹层（按文件类型映射包裹样式 + 悬停名牌与扔海里 + 原生拖出） */}
        {effectiveMode !== 'docked' && (
          <div className="layer-parcels">
            {visibleParcels.map((it, idx) => {
              const slot = DOCK_SLOTS[idx]
              const kind = getParcelKindForExt(it.ext)
              const sp = PARCEL_SPRITES[kind]
              const unavailable = it.available === false
              const isDraggingThis = draggingParcel?.id === it.id
              const isGrabbedInStage = isDraggingThis && pointerDragPos !== null
              const isDraggingOut = isDraggingThis && pointerDragPos === null
              const isThrowingThis = throwingParcel?.id === it.id
              const isSinkingThis = sinkingIds.has(it.id)
              const curPos =
                isThrowingThis && throwingParcel
                  ? { x: throwingParcel.x, y: throwingParcel.y }
                  : isGrabbedInStage && pointerDragPos
                    ? pointerDragPos
                    : slot
              const overWater = isGrabbedInStage && isOnWater(curPos.x, curPos.y)
              const showNameplate =
                hoveredParcelId === it.id && !draggingParcel && !throwingParcel && !isSinkingThis
              const minPlateX = effectiveMode === 'peek' ? 74 : 78
              const plateXOffset =
                curPos.x < minPlateX
                  ? minPlateX - curPos.x
                  : curPos.x > STAGE.w - 78
                    ? STAGE.w - 78 - curPos.x
                    : 0
              const parcelInfo: DraggingParcel = {
                id: it.id,
                name: it.name,
                kind,
                src: sp.src,
                w: sp.w,
                h: sp.h,
                available: !unavailable
              }
              return (
                <div
                  key={it.id}
                  className={`parcel parcel-${kind} ${unavailable ? 'is-unavailable' : ''} ${
                    isGrabbedInStage ? 'is-grabbed-in-stage' : ''
                  } ${isThrowingThis ? 'is-hand-throwing' : ''} ${
                    isDraggingOut ? 'is-dragging-out' : ''
                  } ${isSinkingThis ? 'is-sinking' : ''}`}
                  style={{ left: curPos.x, top: curPos.y }}
                  draggable={!unavailable && !isThrowingThis}
                  onPointerEnter={() => {
                    if (!draggingParcel && !throwingParcel && !isSinkingThis) {
                      setHoveredParcelId(it.id)
                    }
                  }}
                  onPointerLeave={() => {
                    setHoveredParcelId((cur) => (cur === it.id ? null : cur))
                  }}
                  onPointerDown={(e) => {
                    if (e.button === 2 || (e.button === 0 && unavailable)) {
                      startParcelPointerDrag(parcelInfo, slot, e)
                    }
                  }}
                  onDragStart={(e) => {
                    if (unavailable || isThrowingThis) {
                      e.preventDefault()
                      return
                    }
                    e.preventDefault()
                    draggingParcelRef.current = parcelInfo
                    dragActiveIdRef.current = it.id
                    window.isle.startDrag([it.id], kind)
                    window.requestAnimationFrame(() => {
                      if (dragActiveIdRef.current === it.id) {
                        setHoveredParcelId(null)
                        setDraggingParcel(parcelInfo)
                      }
                    })
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    window.isle.open(it.id)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (Date.now() < suppressContextMenuUntilRef.current) return
                    onDockOpenPanel(e)
                  }}
                >
                  <img
                    className="parcel-sprite-img"
                    src={sp.src}
                    alt=""
                    width={sp.w}
                    height={sp.h}
                    draggable={false}
                  />
                  {showNameplate && (
                    <div
                      className="parcel-nameplate counter-flip"
                      style={{ left: `calc(50% + ${plateXOffset}px)` }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onDragStart={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                    >
                      <div className="parcel-nameplate-title">
                        {unavailable ? `${it.name}（不可用）` : it.name}
                      </div>
                      {it.summary?.brief && (
                        <div className="parcel-nameplate-brief">{it.summary.brief}</div>
                      )}
                      <button
                        type="button"
                        className="parcel-throw-btn"
                        draggable={false}
                        title="点击由小手抓起扔海里；也可直接右键按住包裹拖入海里"
                        onPointerDown={(e) => e.stopPropagation()}
                        onDragStart={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          throwParcelWithHand(parcelInfo, slot, idx)
                        }}
                      >
                        🌊 扔海里
                      </button>
                      <div className="parcel-nameplate-hint">左键拖出 · 右键拖海</div>
                    </div>
                  )}
                  {(isGrabbedInStage || isThrowingThis) && (
                    <GrabHandSvg open={false} className="grab-hand-svg" />
                  )}
                  {overWater && (
                    <div
                      className="sea-drop-tip counter-flip"
                      style={{
                        left: `calc(50% + ${
                          curPos.x > STAGE.w - 64
                            ? STAGE.w - 64 - curPos.x
                            : curPos.x < 64
                              ? 64 - curPos.x
                              : 0
                        }px)`
                      }}
                    >
                      松手沉入海里移除
                    </div>
                  )}
                </div>
              )
            })}

            {items.length > 3 && (
              <button
                className="dock-more-pill counter-flip"
                style={{ left: 52, top: 84 }}
                onClick={onDockOpenPanel}
                title={`还有 ${items.length - 3} 个暂存文件，点击查看全部`}
              >
                +{items.length - 3}
              </button>
            )}
          </div>
        )}

        {/* 5.5 放手张开与入水沉没层（与包裹脱手瞬间同锚点同姿态无缝衔接） */}
        {releasingHands.map((rh) => (
          <div key={rh.uid} className="releasing-hand" style={{ left: rh.x, top: rh.y }}>
            <GrabHandSvg open className="release-hand-svg" />
          </div>
        ))}

        {sinkingParcels.map((sp) => (
          <div key={sp.uid} className="sinking-parcel" style={{ left: sp.x, top: sp.y }}>
            <div className="sink-waterline-ring" />
            <img
              className="sink-parcel-img"
              src={sp.src}
              alt=""
              width={sp.w}
              height={sp.h}
              draggable={false}
            />
          </div>
        ))}

        {/* 6 文件总数数字角标 */}
        {items.length > 0 && (
          <div
            className="dock-badge counter-flip"
            style={{ left: DOCK_BADGE.x, top: DOCK_BADGE.y }}
            key={items.length}
          >
            {items.length}
          </div>
        )}

        {/* 6.5 专注倒计时胶囊（位于栈桥前缘可交互区内，不遮挡右上角按钮） */}
        {focus && focus.phase !== 'idle' && (
          <div
            className={`focus-mini-pill counter-flip pill-mode-${effectiveMode}`}
            style={{
              left: effectiveMode === 'docked' ? 28 : 62,
              top: effectiveMode === 'docked' ? 148 : 150
            }}
            onClick={(e) => {
              e.stopPropagation()
              window.isle.setExpandMode('full')
              window.isle.togglePanel()
            }}
            title="点击打开专注面板"
          >
            <span className="pill-dot" />
            <span>
              {effectiveMode === 'docked'
                ? formatMmSs(focus.remainingMs)
                : `${
                    focus.phase === 'focus'
                      ? '专注'
                      : focus.phase === 'rest'
                        ? '休息'
                        : '完成'
                  } ${formatMmSs(focus.remainingMs)}`}
            </span>
          </div>
        )}

        {/* 8 全展开时的右上角迷你按钮（去掉多余文字条，不遮挡小岛景物） */}
        <div
          className={`hover-controls counter-flip ${
            pose.hover && effectiveMode === 'full' ? 'visible' : ''
          }`}
        >
          <button
            className="ambience-btn"
            onClick={(e) => {
              e.stopPropagation()
              window.isle.setDecorations({
                ambience: decor.ambience === 'day' ? 'night' : 'day'
              })
            }}
          >
            {decor.ambience === 'day' ? '☀' : '🌙'}
          </button>
          <button
            className="hide-btn"
            onClick={(e) => {
              e.stopPropagation()
              window.isle.hideIsland()
            }}
          >
            —
          </button>
        </div>

        {/* 9 交互点击热区（含栈桥、水獭、以及岛上 7 处可互动景点！） */}
        <svg className="layer-hits" viewBox={`0 0 ${STAGE.w} ${STAGE.h}`}>
          <polygon
            className="hit-dock"
            points={polyPoints(DOCK_POLY)}
            onClick={onDockClick}
            onDoubleClick={onDockOpenPanel}
            onContextMenu={onDockOpenPanel}
          />

          {effectiveMode === 'full' && (
            <>
              {/* 景点 1：野花丛 → 飞出蝴蝶 + 水獭跑来看花 */}
              {decor.enabled.flowers && (
                <ellipse
                  className="hit-spot"
                  cx={120}
                  cy={62}
                  rx={24}
                  ry={20}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (dragMove.current?.moved || justDraggedWin()) return
                    spawnParticles(120, 54, 'butterfly', 2)
                    triggerOtter('wave', '花丛里有小蝴蝶~', 2400, 'react-hop', { x: 132, y: 112 })
                  }}
                />
              )}

              {/* 景点 2：木长椅 → 水獭跑去长椅坐下打盹休息 */}
              {decor.enabled.bench && (
                <ellipse
                  className="hit-spot"
                  cx={153}
                  cy={54}
                  rx={16}
                  ry={15}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (dragMove.current?.moved || justDraggedWin()) return
                    triggerOtter('rest', '坐长椅吹吹海风~', 3200, 'react-nod', { x: 154, y: 96 })
                  }}
                />
              )}

              {/* 景点 3：小路灯 → 点亮/关闭暖黄路灯与萤火虫 */}
              {decor.enabled.lamp && (
                <ellipse
                  className="hit-spot"
                  cx={173}
                  cy={42}
                  rx={12}
                  ry={26}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (dragMove.current?.moved || justDraggedWin()) return
                    const next = !showNightGlow
                    setLampOverride(next)
                    window.isle.setIslandMemory({ lampLit: next })
                    spawnParticles(173, 28, 'note', 2)
                    triggerOtter(
                      'wave',
                      next ? '啪嗒，点亮小路灯 ✨' : '路灯关上啦~',
                      2000,
                      'react-hop'
                    )
                  }}
                />
              )}

              {/* 景点 4：圆冠树 → 摇落绿叶 + 水獭跑去树下看书 */}
              {decor.enabled.tree && (
                <ellipse
                  className="hit-spot"
                  cx={198}
                  cy={40}
                  rx={20}
                  ry={26}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (dragMove.current?.moved || justDraggedWin()) return
                    spawnParticles(198, 38, 'leaf', 3)
                    triggerOtter('read', '树荫下看书最舒服啦~', 2800, 'react-nod', { x: 196, y: 98 })
                  }}
                />
              )}

              {/* 景点 5：小木屋 → 烟囱冒炊烟 + 亮暖窗 + 水獭回家门口 */}
              {decor.enabled.cabin && (
                <ellipse
                  className="hit-spot"
                  cx={224}
                  cy={54}
                  rx={22}
                  ry={22}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (dragMove.current?.moved || justDraggedWin()) return
                    const nextCabin = !showCabinWarm
                    setCabinOverride(nextCabin)
                    window.isle.setIslandMemory({ cabinWarm: nextCabin })
                    spawnParticles(228, 34, 'smoke', 3)
                    triggerOtter('wave', '欢迎来我的小木屋!', 2600, 'react-wave', { x: 218, y: 108 })
                  }}
                />
              )}

              {/* 景点 6：小风车 → 吹起蒲公英绒毛 */}
              {decor.enabled.windmill && (
                <ellipse
                  className="hit-spot"
                  cx={258}
                  cy={59}
                  rx={20}
                  ry={27}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (dragMove.current?.moved || justDraggedWin()) return
                    spawnParticles(258, 50, 'dandelion', 3)
                    triggerOtter('wave', '风车转起来咯~', 2200, 'react-hop', { x: 248, y: 118 })
                  }}
                />
              )}

              {/* 景点 7：草坪野餐茶席 → 水獭跑过来喝热茶吃点心 */}
              <ellipse
                className="hit-spot"
                cx={232}
                cy={144}
                rx={24}
                ry={14}
                onClick={(e) => {
                  e.stopPropagation()
                  if (dragMove.current?.moved || justDraggedWin()) return
                  setPicnicSteaming(true)
                  spawnParticles(232, 132, 'heart', 2)
                  triggerOtter('receive', '喝口热茶，吃颗草莓 ♥', 2800, 'react-hop', {
                    x: 214,
                    y: 148
                  })
                }}
              />

              {/* 景点 8：岸边小海星 → 蹦跳冒音符 */}
              <circle
                className="hit-spot"
                cx={184}
                cy={168}
                r={12}
                onClick={(e) => {
                  e.stopPropagation()
                  if (dragMove.current?.moved || justDraggedWin()) return
                  setStarfishHop(true)
                  spawnParticles(184, 160, 'note', 2)
                  window.setTimeout(() => setStarfishHop(false), 600)
                }}
              />
            </>
          )}

          <ellipse
            className="hit-otter"
            cx={otterPos.x}
            cy={otterPos.y - 32}
            rx={28}
            ry={34}
            onClick={onOtterClick}
            onContextMenu={onDockOpenPanel}
          />
        </svg>
      </div>

      {/* 7 轻提示 */}
      {toast && (
        <div className={`island-toast toast-${effectiveMode} toast-side-${pose.side}`}>
          {toast}
        </div>
      )}
    </div>
  )
}

function formatMmSs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function GrabHandSvg({ open, className }: { open: boolean; className?: string }): JSX.Element {
  return (
    <svg className={className} width="26" height="26" viewBox="0 0 28 28" fill="none" aria-hidden>
      {open ? (
        <g stroke="#463728" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M8.5 14 V6.5 a1.6 1.6 0 0 1 3.2 0 V12 M11.7 12 V5.2 a1.6 1.6 0 0 1 3.2 0 V12 M14.9 12 V6 a1.6 1.6 0 0 1 3.2 0 V13 M18.1 13 V8.2 a1.5 1.5 0 0 1 3 0 V16.5 c0 4.2-2.8 7-6.8 7 c-3.2 0-5.4-1.7-6.9-4.6 L5.2 15 a1.6 1.6 0 0 1 2.7-1.6 L9 14.8"
            fill="#fce2c8"
          />
        </g>
      ) : (
        <g stroke="#463728" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path
            d="M7.5 11.5 C7.5 8 10 6.5 14.5 6.5 C19 6.5 21.5 8.5 21.5 12.2 V16.2 C21.5 19.6 18.8 21.5 14.8 21.5 C10.8 21.5 8.2 19.8 7.5 16.5 Z"
            fill="#fce2c8"
          />
          <path
            d="M9 12.5 C9 15.2 11.2 15.5 11.5 12.5 M12 12 C12 15.6 14.8 15.6 15 12 M15.2 12.2 C15.2 15.6 18 15.6 18.2 12.4 M18.2 12.8 C18.2 15.4 20.6 15.2 20.6 12.8"
            fill="#f7d3b0"
          />
          <path d="M8.4 13.5 C6.2 13.2 5.8 15.8 7.8 16.8 L10.2 17.5" fill="#fce2c8" />
        </g>
      )}
    </svg>
  )
}
