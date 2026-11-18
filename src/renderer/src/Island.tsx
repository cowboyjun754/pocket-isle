import { useCallback, useEffect, useRef, useState } from 'react'
import { chooseDropEffect, extractPathsFromDataTransfer } from '../../shared/dropPaths'
import { DEFAULT_LOCALE, getMessages, resolveLocale } from '../../shared/i18n'
import {
  DOCK_BADGE,
  GRASS_ELLIPSE,
  OTTER_HOME,
  OTTER_PEEK,
  STAGE,
  getStageOffsetX,
  inEllipse,
  isOnWater
} from '../../shared/shape'
import type {
  AppLocale,
  DecorationState,
  DockItem,
  DockUndoState,
  FocusState,
  IslandMemory,
  IslandPose,
  IslandSprout,
  OtterAction
} from '../../shared/types'
import { HitRegionsSvg, type IslandSpotId } from './island/HitRegionsSvg'
import {
  DECO_LAYERS,
  DECO_WINDMILL_BLADES_URL,
  ISLAND_HORIZ_URL,
  OTTER_SPRITES,
  PAPER_BOAT_URL,
  PRELOAD_ASSET_URLS
} from './island/islandAssets'
import { ForegroundDecorSvg, StageFxSvg } from './island/IslandDecorSvg'
import {
  AMBIENCE_NEXT,
  DECO_Z_ORDER,
  formatMmSs,
  getPatReactions,
  toStageCoordsWith,
  type FloatingParticle,
  type WaterRipple
} from './island/islandMath'
import { ParcelLayer, ParcelReleaseEffects } from './island/ParcelLayer'
import { useParcelGestures } from './island/useParcelGestures'
import './island.css'
import { describeResult } from './util'

/** Desktop floating island stage coordinating window drag, interactive toys, and pier parcel layers. */
export function Island(): JSX.Element {
  const [locale, setLocale] = useState<AppLocale>(DEFAULT_LOCALE)
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
  const [bubble, setBubble] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [undoState, setUndoState] = useState<DockUndoState | null>(null)
  const [draggingWin, setDraggingWin] = useState(false)

  // Otter roaming destination on the expanded island (hops over on user clicks)
  const [roamSpot, setRoamSpot] = useState<{ x: number; y: number } | null>(null)

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

  const moveRafRef = useRef<number | null>(null)
  const patIdx = useRef(0)
  const prevHoverRef = useRef(false)
  const lastWinDragAt = useRef(0)
  const localeRef = useRef<AppLocale>(locale)
  localeRef.current = locale
  const poseRef = useRef(pose)
  poseRef.current = pose
  const sproutsRef = useRef(sprouts)
  sproutsRef.current = sprouts
  const draggingWinRef = useRef(draggingWin)
  draggingWinRef.current = draggingWin
  const focusRef = useRef(focus)
  focusRef.current = focus
  const itemsRef = useRef(items)
  itemsRef.current = items
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

  const triggerOtter = useCallback(
    (
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
    },
    []
  )

  const spawnParticles = useCallback(
    (x: number, y: number, kind: FloatingParticle['kind'], count = 3): void => {
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
    },
    []
  )

  const spawnRipple = useCallback((x: number, y: number): void => {
    const id = Date.now() + Math.random()
    setRipples((prev) => [...prev.slice(-5), { id, x, y }])
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== id))
    }, 1150)
  }, [])

  const showToast = useCallback((msg: string | null): void => {
    if (!msg) return
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToast(msg)
    toastTimer.current = window.setTimeout(() => setToast(null), 2500)
  }, [])

  const gestures = useParcelGestures({
    locale,
    poseRef,
    draggingWinRef,
    focusRef,
    itemsRef,
    spawnRipple,
    spawnParticles,
    triggerOtter
  })

  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
    document.title = getMessages(locale).appName
  }, [locale])

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
      gestures.cleanupGestures()
      if (moveRafRef.current !== null) {
        window.cancelAnimationFrame(moveRafRef.current)
        moveRafRef.current = null
      }
    }
  }, [gestures.cleanupGestures])

  useEffect(() => {
    for (const url of PRELOAD_ASSET_URLS) {
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
    window.isle.getSettings().then((s) => setLocale(resolveLocale(s.locale)))

    const off1 = window.isle.onDockChanged(refresh)
    const off2 = window.isle.onPose((p) => {
      setPose(p)
      if (p.mode !== 'full') setRoamSpot(null)
    })
    const off3 = window.isle.onReceived((r) => {
      const loc = localeRef.current
      if (r.added > 0) {
        setRoamSpot(null)
        triggerOtter('receive', getMessages(loc).island.receivedBubble, 1600, 'react-hop')
      }
      showToast(describeResult(r, loc))
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
    const off7 = window.isle.onDragEnded(() => gestures.clearEndedDragState())
    const off8 = window.isle.onDockUndoChanged((u) => setUndoState(u))
    const offSettings = window.isle.onSettingsChanged((s) => setLocale(resolveLocale(s.locale)))

    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        window.isle.pasteFromClipboard().then((res) => {
          const msg = describeResult(res, localeRef.current)
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
      off8()
      offSettings()
      window.removeEventListener('keydown', onKeyDown)
      if (actionTimer.current) window.clearTimeout(actionTimer.current)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
      if (boatTimer.current) window.clearTimeout(boatTimer.current)
    }
  }, [gestures.clearEndedDragState, showToast, triggerOtter])

  // Periodically stroll between enabled island landmarks while idle in full mode
  useEffect(() => {
    if (
      pose.mode !== 'full' ||
      dragOver ||
      gestures.draggingParcel ||
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
  }, [
    pose.mode,
    dragOver,
    gestures.draggingParcel,
    draggingWin,
    tempAction,
    focus,
    decor.enabled,
    roamSpot
  ])

  useEffect(() => {
    if (prevHoverRef.current && !pose.hover) {
      setDragOver(false)
    }
    prevHoverRef.current = pose.hover
  }, [pose.hover])

  const onDragEnter = (e: React.DragEvent): void => {
    if (gestures.handleOutboundDragPosition(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = chooseDropEffect(e.dataTransfer.effectAllowed)
    setDragOver(true)
    if (pose.mode === 'docked') window.isle.setExpandMode('peek')
  }

  const onDragOver = (e: React.DragEvent): void => {
    if (gestures.handleOutboundDragPosition(e)) return
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

  const im = getMessages(locale).island

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    if (gestures.consumeDroppedParcel()) return
    const paths = extractPathsFromDataTransfer(e.dataTransfer, (f) => window.isle.getPathForFile(f))
    if (!paths.length) {
      showToast(im.dropUnknown)
      return
    }
    await window.isle.addPaths(paths)
  }

  const justDraggedWin = (): boolean => Date.now() - lastWinDragAt.current < 260

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
      target?.closest(
        '.parcel, .dock-more-pill, .hide-btn, .ambience-btn, .paper-boat, .focus-mini-pill, .island-undo-pill'
      )
    ) {
      return
    }
    const pt = toStageCoordsWith(e.clientX, e.clientY, pose, draggingWin)
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
        '.hit-dock, .hit-otter, .hit-spot, .parcel, .dock-more-pill, .hide-btn, .ambience-btn, .paper-boat, .focus-mini-pill, .island-undo-pill'
      )
    ) {
      if (isOnWater(st.localX, st.localY)) {
        spawnRipple(st.localX, st.localY)
      } else if (inEllipse(st.localX, st.localY, GRASS_ELLIPSE)) {
        // Clicking open turf plants a persistent flower sprout and sends the otter over to celebrate
        const kind = Math.floor(Math.random() * 3) as 0 | 1 | 2
        const nextSprouts: IslandSprout[] = [
          ...sproutsRef.current.slice(-6),
          { id: Date.now() + Math.random(), x: Math.round(st.localX), y: Math.round(st.localY), kind }
        ]
        sproutsRef.current = nextSprouts
        setSprouts(nextSprouts)
        window.isle.setIslandMemory({ sprouts: nextSprouts })
        const walkX = Math.min(Math.max(st.localX, 128), 268)
        const walkY = Math.min(Math.max(st.localY + 6, 98), 160)
        triggerOtter('wave', im.plantFlower, 2000, 'react-hop', { x: walkX, y: walkY })
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
    if (Date.now() < gestures.suppressContextMenuUntilRef.current) return
    window.isle.setExpandMode('full')
    window.isle.togglePanel()
  }

  const onOtterClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (dragMove.current?.moved || draggingWin || justDraggedWin()) return
    const reactions = getPatReactions(locale)
    const pick = reactions[patIdx.current % reactions.length]
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
    const pt = toStageCoordsWith(e.clientX, e.clientY, pose, draggingWin)
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

  const effectiveMode = draggingWin ? 'full' : pose.mode
  const offsetX = getStageOffsetX(pose.side, effectiveMode)
  const flipped = pose.side === 'left'
  const isWarmAmbience = decor.ambience === 'night' || decor.ambience === 'rain'
  const showNightGlow = lampOverride ?? isWarmAmbience
  const showCabinWarm = cabinOverride ?? isWarmAmbience

  const handleSpotActivate = (spotId: IslandSpotId): void => {
    switch (spotId) {
      case 'flowers':
        spawnParticles(120, 54, 'butterfly', 2)
        triggerOtter('wave', im.flowersSpot, 2400, 'react-hop', { x: 132, y: 112 })
        break
      case 'bench':
        triggerOtter('rest', im.benchSpot, 3200, 'react-nod', { x: 154, y: 96 })
        break
      case 'lamp': {
        const next = !showNightGlow
        setLampOverride(next)
        window.isle.setIslandMemory({ lampLit: next })
        spawnParticles(173, 28, 'note', 2)
        triggerOtter('wave', next ? im.lampOn : im.lampOff, 2000, 'react-hop')
        break
      }
      case 'tree':
        spawnParticles(198, 38, 'leaf', 3)
        triggerOtter('read', im.treeSpot, 2800, 'react-nod', { x: 196, y: 98 })
        break
      case 'cabin': {
        const nextCabin = !showCabinWarm
        setCabinOverride(nextCabin)
        window.isle.setIslandMemory({ cabinWarm: nextCabin })
        spawnParticles(228, 34, 'smoke', 3)
        triggerOtter('wave', im.cabinSpot, 2600, 'react-wave', { x: 218, y: 108 })
        break
      }
      case 'windmill':
        spawnParticles(258, 50, 'dandelion', 3)
        triggerOtter('wave', im.windmillSpot, 2200, 'react-hop', { x: 248, y: 118 })
        break
      case 'picnic':
        setPicnicSteaming(true)
        spawnParticles(232, 132, 'heart', 2)
        triggerOtter('receive', im.picnicSpot, 2800, 'react-hop', { x: 214, y: 148 })
        break
      case 'starfish':
        setStarfishHop(true)
        spawnParticles(184, 160, 'note', 2)
        window.setTimeout(() => setStarfishHop(false), 600)
        break
    }
  }

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
        ? { x: 121, y: 138 }
        : roamSpot ?? OTTER_HOME

  return (
    <div
      className={`island-viewport side-${pose.side} mode-${effectiveMode} ambience-${decor.ambience} ${
        effectiveMode === 'docked' ? 'is-sleeping-fx' : ''
      } ${dragOver ? 'is-dragover' : ''} ${draggingWin ? 'is-dragging-win' : ''} ${
        gestures.draggingParcel && gestures.pointerDragPos ? 'is-grabbing-parcel' : ''
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
        <div className="layer-shadow" />

        <img
          className="island-horiz-img"
          src={ISLAND_HORIZ_URL}
          alt=""
          draggable={false}
        />

        <div className="layer-decorations">
          {DECO_LAYERS.map((d) =>
            decor.enabled[d.id] ? (
              <img
                key={d.id}
                src={d.src}
                alt=""
                draggable={false}
                className={d.className}
                style={{ zIndex: DECO_Z_ORDER[d.id] }}
              />
            ) : null
          )}
          {decor.enabled.windmill && (
            <img
              src={DECO_WINDMILL_BLADES_URL}
              alt=""
              draggable={false}
              className="deco-layer deco-windmill-blades"
              style={{ zIndex: DECO_Z_ORDER.windmill + 1 }}
            />
          )}
          {showNightGlow && decor.enabled.lamp && (
            <>
              <div className="night-glow night-glow-lamp" />
              <div className="night-glow night-glow-lamp-ground" />
            </>
          )}
          {showCabinWarm && decor.enabled.cabin && (
            <div className="night-glow night-glow-cabin" />
          )}
        </div>

        {effectiveMode === 'full' && (
          <ForegroundDecorSvg
            sprouts={sprouts}
            picnicSteaming={picnicSteaming}
            starfishHop={starfishHop}
          />
        )}

        <StageFxSvg
          effectiveMode={effectiveMode}
          ambience={decor.ambience}
          cabinEnabled={decor.enabled.cabin}
          dragOver={dragOver}
          ripples={ripples}
          particles={particles}
        />

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
            title={im.boatTitle}
          >
            <img src={PAPER_BOAT_URL} alt="" width={34} height={22} draggable={false} />
          </div>
        )}

        <div
          className={`otter-root action-${activeAction} ${reactAnim} otter-in-${effectiveMode}`}
          style={{
            left: otterPos.x,
            top: otterPos.y,
            zIndex: effectiveMode === 'full' ? 100 + Math.round(otterPos.y) : 240
          }}
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

        {effectiveMode !== 'docked' && (
          <ParcelLayer
            locale={locale}
            items={items}
            effectiveMode={effectiveMode}
            draggingParcel={gestures.draggingParcel}
            throwingParcel={gestures.throwingParcel}
            pointerDragPos={gestures.pointerDragPos}
            sinkingIds={gestures.sinkingIds}
            hoveredParcelId={gestures.hoveredParcelId}
            setHoveredParcelId={gestures.setHoveredParcelId}
            suppressContextMenuUntilRef={gestures.suppressContextMenuUntilRef}
            onPointerDragStart={gestures.startParcelPointerDrag}
            onNativeDragStart={gestures.startNativeDrag}
            onThrowParcel={gestures.throwParcelWithHand}
            onDockOpenPanel={onDockOpenPanel}
          />
        )}

        <ParcelReleaseEffects
          releasingHands={gestures.releasingHands}
          sinkingParcels={gestures.sinkingParcels}
        />

        {items.length > 0 && (
          <div
            className="dock-badge counter-flip"
            style={{ left: DOCK_BADGE.x, top: DOCK_BADGE.y }}
            key={items.length}
          >
            {items.length}
          </div>
        )}

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
            title={im.focusPillTitle}
          >
            <span className="pill-dot" />
            <span>
              {effectiveMode === 'docked'
                ? formatMmSs(focus.remainingMs)
                : `${
                    focus.phase === 'focus'
                      ? im.focusPhaseFocus
                      : focus.phase === 'rest'
                        ? im.focusPhaseRest
                        : im.focusPhaseDone
                  } ${formatMmSs(focus.remainingMs)}`}
            </span>
          </div>
        )}

        <div
          className={`hover-controls counter-flip ${
            pose.hover && effectiveMode === 'full' ? 'visible' : ''
          }`}
        >
          <button
            className="ambience-btn"
            title={
              decor.ambience === 'day'
                ? im.ambienceDayTitle
                : decor.ambience === 'night'
                  ? im.ambienceNightTitle
                  : im.ambienceRainTitle
            }
            onClick={(e) => {
              e.stopPropagation()
              window.isle.setDecorations({
                ambience: AMBIENCE_NEXT[decor.ambience] ?? 'day'
              })
            }}
          >
            {decor.ambience === 'day' ? '☀' : decor.ambience === 'night' ? '🌙' : '🌧'}
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

        <HitRegionsSvg
          effectiveMode={effectiveMode}
          decorEnabled={decor.enabled}
          otterPos={otterPos}
          canActivateSpot={() => !(dragMove.current?.moved || justDraggedWin())}
          onDockClick={onDockClick}
          onDockOpenPanel={onDockOpenPanel}
          onOtterClick={onOtterClick}
          onSpotActivate={handleSpotActivate}
        />
      </div>

      {toast ? (
        <div className={`island-toast toast-${effectiveMode} toast-side-${pose.side}`}>
          {toast}
        </div>
      ) : (
        undoState &&
        effectiveMode !== 'docked' && (
          <div
            className={`island-toast island-undo-pill toast-${effectiveMode} toast-side-${pose.side}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="island-undo-label">{im.undoLabel(undoState.label)}</span>
            <button
              className="island-undo-btn"
              onClick={async (e) => {
                e.stopPropagation()
                const res = await window.isle.undoRemove(undoState.token)
                if (res.ok) {
                  triggerOtter('wave', im.undoRestoredBubble, 2000, 'react-hop')
                } else {
                  showToast(res.message)
                }
              }}
            >
              {im.undoBtn}
            </button>
          </div>
        )
      )}
    </div>
  )
}
