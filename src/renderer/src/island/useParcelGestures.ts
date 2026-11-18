import { useCallback, useRef, useState } from 'react'
import { chooseDropEffect } from '../../../shared/dropPaths'
import { isInsideIsland, isOnWater } from '../../../shared/shape'
import type { DockItem, FocusState, IslandPose, OtterAction } from '../../../shared/types'
import {
  clampParcelStageAnchor,
  type DraggingParcel,
  type FloatingParticle,
  type ReleasingHand,
  type SinkingParcel,
  toStageCoordsWith
} from './islandMath'

interface ParcelGestureDeps {
  poseRef: React.MutableRefObject<IslandPose>
  draggingWinRef: React.MutableRefObject<boolean>
  focusRef: React.MutableRefObject<FocusState | null>
  itemsRef: React.MutableRefObject<DockItem[]>
  spawnRipple: (x: number, y: number) => void
  spawnParticles: (
    x: number,
    y: number,
    kind: FloatingParticle['kind'],
    count?: number
  ) => void
  triggerOtter: (action: OtterAction, text?: string, ms?: number, anim?: string) => void
}

/**
 * 管理栈桥包裹的三类手势交互：
 * 1) 左键原生文件拖出（`startNativeDrag` + `handleOutboundDragPosition`）
 * 2) 右键 / 不可用条目的舞台内指针抓拖入海（`startParcelPointerDrag`）
 * 3) 名牌「扔海里」小手自动抛投动画（`throwParcelWithHand`）与入水沉没特效。
 */
export function useParcelGestures({
  poseRef,
  draggingWinRef,
  focusRef,
  itemsRef,
  spawnRipple,
  spawnParticles,
  triggerOtter
}: ParcelGestureDeps) {
  const [throwingParcel, setThrowingParcel] = useState<{
    id: string
    x: number
    y: number
  } | null>(null)
  const [draggingParcel, setDraggingParcel] = useState<DraggingParcel | null>(null)
  const [hoveredParcelId, setHoveredParcelId] = useState<string | null>(null)
  const [pointerDragPos, setPointerDragPos] = useState<{ x: number; y: number } | null>(null)
  const [sinkingIds, setSinkingIds] = useState<Set<string>>(new Set())
  const [sinkingParcels, setSinkingParcels] = useState<SinkingParcel[]>([])
  const [releasingHands, setReleasingHands] = useState<ReleasingHand[]>([])

  const throwTimersRef = useRef<number[]>([])
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

  const clearThrowTimers = useCallback((): void => {
    for (const id of throwTimersRef.current) window.clearTimeout(id)
    throwTimersRef.current = []
  }, [])

  const cleanupGestures = useCallback((): void => {
    clearThrowTimers()
    parcelCleanupRef.current?.()
  }, [clearThrowTimers])

  const sinkParcelIntoSea = useCallback(
    (parcel: DraggingParcel, x: number, y: number): void => {
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
      if (poseRef.current.mode !== 'docked') {
        window.isle.holdExpand(5000)
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
    },
    [focusRef, poseRef, spawnParticles, spawnRipple, triggerOtter]
  )

  const throwParcelWithHand = useCallback(
    (parcel: DraggingParcel, slot: { x: number; y: number }, idx: number): void => {
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
    },
    [clearThrowTimers, sinkParcelIntoSea, throwingParcel]
  )

  const startParcelPointerDrag = useCallback(
    (
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
      const startPt = toStageCoordsWith(
        e.clientX,
        e.clientY,
        poseRef.current,
        draggingWinRef.current
      )
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
        return clampParcelStageAnchor(
          session.slotX + (curPt.x - session.startStageX),
          session.slotY + (curPt.y - session.startStageY)
        )
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
    },
    [draggingWinRef, poseRef, sinkParcelIntoSea]
  )

  const startNativeDrag = useCallback((parcelInfo: DraggingParcel): void => {
    draggingParcelRef.current = parcelInfo
    dragActiveIdRef.current = parcelInfo.id
    window.isle.startDrag([parcelInfo.id], parcelInfo.kind)
    window.requestAnimationFrame(() => {
      if (dragActiveIdRef.current === parcelInfo.id) {
        setHoveredParcelId(null)
        setDraggingParcel(parcelInfo)
      }
    })
  }, [])

  const clearEndedDragState = useCallback((): void => {
    dragActiveIdRef.current = null
    draggingParcelRef.current = null
    parcelSessionRef.current = null
    setDraggingParcel(null)
    setPointerDragPos(null)
  }, [])

  const handleOutboundDragPosition = useCallback(
    (e: React.DragEvent): boolean => {
      if (!draggingParcelRef.current) return false
      const p = poseRef.current
      const mode = p.side === 'free' ? 'full' : draggingWinRef.current ? 'full' : p.mode
      if (isInsideIsland(e.clientX, e.clientY, p.side, mode, itemsRef.current.length > 0)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = chooseDropEffect(e.dataTransfer.effectAllowed)
      } else {
        window.isle.syncDragPassThrough()
      }
      return true
    },
    [draggingWinRef, itemsRef, poseRef]
  )

  const consumeDroppedParcel = useCallback((): boolean => {
    if (!draggingParcelRef.current) return false
    dragActiveIdRef.current = null
    draggingParcelRef.current = null
    setDraggingParcel(null)
    setPointerDragPos(null)
    return true
  }, [])

  return {
    throwingParcel,
    draggingParcel,
    hoveredParcelId,
    setHoveredParcelId,
    pointerDragPos,
    sinkingIds,
    sinkingParcels,
    releasingHands,
    suppressContextMenuUntilRef,
    startParcelPointerDrag,
    startNativeDrag,
    throwParcelWithHand,
    handleOutboundDragPosition,
    clearEndedDragState,
    consumeDroppedParcel,
    cleanupGestures
  }
}
