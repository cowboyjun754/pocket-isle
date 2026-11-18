import type React from 'react'
import { getParcelKindForExt } from '../../../shared/parcelKind'
import { DOCK_SLOTS, STAGE, isOnWater } from '../../../shared/shape'
import type { DockItem, IslandPose } from '../../../shared/types'
import { PARCEL_SPRITES } from './islandAssets'
import type { DraggingParcel, ReleasingHand, SinkingParcel } from './islandMath'

/** 抓握或张开的小手矢量图标，用于将包裹拖入海里移出码头的视觉反馈。 */
export function GrabHandSvg({ open, className }: { open: boolean; className?: string }): JSX.Element {
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

interface ParcelLayerProps {
  items: DockItem[]
  effectiveMode: IslandPose['mode']
  draggingParcel: DraggingParcel | null
  throwingParcel: { id: string; x: number; y: number } | null
  pointerDragPos: { x: number; y: number } | null
  sinkingIds: Set<string>
  hoveredParcelId: string | null
  setHoveredParcelId: React.Dispatch<React.SetStateAction<string | null>>
  suppressContextMenuUntilRef: React.MutableRefObject<number>
  onPointerDragStart: (
    parcel: DraggingParcel,
    slot: { x: number; y: number },
    e: React.PointerEvent<HTMLElement>
  ) => void
  onNativeDragStart: (parcel: DraggingParcel) => void
  onThrowParcel: (parcel: DraggingParcel, slot: { x: number; y: number }, idx: number) => void
  onDockOpenPanel: (e: React.MouseEvent) => void
}

/** 渲染栈桥上的可见包裹层、悬停信息名牌、小手抛投动画与超出 3 项时的 `+N` 胶囊。 */
export function ParcelLayer({
  items,
  effectiveMode,
  draggingParcel,
  throwingParcel,
  pointerDragPos,
  sinkingIds,
  hoveredParcelId,
  setHoveredParcelId,
  suppressContextMenuUntilRef,
  onPointerDragStart,
  onNativeDragStart,
  onThrowParcel,
  onDockOpenPanel
}: ParcelLayerProps): JSX.Element {
  const visibleParcels = items.slice(-3)

  return (
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
                onPointerDragStart(parcelInfo, slot, e)
              }
            }}
            onDragStart={(e) => {
              if (unavailable || isThrowingThis) {
                e.preventDefault()
                return
              }
              e.preventDefault()
              onNativeDragStart(parcelInfo)
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
                    onThrowParcel(parcelInfo, slot, idx)
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
          style={{ left: 46, top: 82 }}
          onClick={onDockOpenPanel}
          title={`还有 ${items.length - 3} 个暂存条目：\n${items
            .slice(0, -3)
            .slice(-4)
            .map((it) => `• ${it.name}`)
            .join('\n')}${items.length - 3 > 4 ? '\n…点击打开面板查看全部' : ''}`}
        >
          +{items.length - 3}
        </button>
      )}
    </div>
  )
}

/** 渲染松手张开的小手与入水沉没包裹动画。 */
export function ParcelReleaseEffects({
  releasingHands,
  sinkingParcels
}: {
  releasingHands: ReleasingHand[]
  sinkingParcels: SinkingParcel[]
}): JSX.Element {
  return (
    <>
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
    </>
  )
}
