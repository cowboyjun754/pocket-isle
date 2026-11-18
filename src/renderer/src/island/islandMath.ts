import { STAGE, getStageOffsetX } from '../../../shared/shape'
import type { DecorationId, IslandPose, OtterAction, ParcelKind } from '../../../shared/types'
export { formatDurationMmSs as formatMmSs } from '../util'

export interface WaterRipple {
  id: number
  x: number
  y: number
}

export interface FloatingParticle {
  id: number
  x: number
  y: number
  kind: 'leaf' | 'butterfly' | 'smoke' | 'dandelion' | 'heart' | 'note' | 'splash'
}

export interface DraggingParcel {
  id: string
  name: string
  kind: ParcelKind
  src: string
  w: number
  h: number
  available: boolean
}

export interface SinkingParcel {
  uid: number
  src: string
  w: number
  h: number
  x: number
  y: number
}

export interface ReleasingHand {
  uid: number
  x: number
  y: number
}

export const DECO_Z_ORDER: Record<DecorationId, number> = {
  bench: 166,
  lamp: 168,
  tree: 168,
  flowers: 176,
  cabin: 176,
  windmill: 184
}

export const RAIN_STREAKS: Array<{ x: number; y: number; len: number; delay: string; dur: string }> =
  [
    { x: 96, y: 34, len: 10, delay: '0s', dur: '0.95s' },
    { x: 118, y: 18, len: 12, delay: '0.32s', dur: '1.05s' },
    { x: 142, y: 26, len: 9, delay: '0.64s', dur: '0.9s' },
    { x: 168, y: 14, len: 11, delay: '0.15s', dur: '1.1s' },
    { x: 194, y: 22, len: 10, delay: '0.48s', dur: '0.96s' },
    { x: 220, y: 16, len: 12, delay: '0.78s', dur: '1.02s' },
    { x: 246, y: 28, len: 10, delay: '0.24s', dur: '0.92s' },
    { x: 270, y: 40, len: 11, delay: '0.56s', dur: '1.08s' },
    { x: 106, y: 78, len: 11, delay: '0.42s', dur: '1.0s' },
    { x: 152, y: 66, len: 9, delay: '0.84s', dur: '0.94s' },
    { x: 204, y: 74, len: 12, delay: '0.08s', dur: '1.04s' },
    { x: 256, y: 82, len: 10, delay: '0.52s', dur: '0.98s' }
  ]

export const AMBIENCE_NEXT = {
  day: 'night',
  night: 'rain',
  rain: 'day'
} as const

export const PAT_REACTIONS: Array<{ action: OtterAction; anim: string; bubble: string }> = [
  { action: 'wave', anim: 'react-wave', bubble: '嗨~ 摸摸头 ♪' },
  { action: 'idle', anim: 'react-nod', bubble: '嗯嗯，我在呢!' },
  { action: 'read', anim: 'react-hop', bubble: '看我发现了什么~' },
  { action: 'wave', anim: 'react-wave', bubble: '点草地或建筑我都会过去玩哦~' }
]

/** Maps viewport pointer coordinates to internal 320x240 logical stage coordinates (compensating left-edge flip). */
export function toStageCoordsWith(
  clientX: number,
  clientY: number,
  pose: IslandPose,
  isDragWin: boolean
): { x: number; y: number } {
  const effectiveMode = isDragWin ? 'full' : pose.mode
  const offX = getStageOffsetX(pose.side, effectiveMode)
  const shiftedX = clientX - offX
  const localX = pose.side === 'left' ? STAGE.w - shiftedX : shiftedX
  return { x: localX, y: clientY }
}

/** Clamps dragged parcel anchors within interactive stage bounds so parcels cannot be lost off-edge. */
export function clampParcelStageAnchor(rawX: number, rawY: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(rawX, 18), STAGE.w - 18),
    y: Math.min(Math.max(rawY, 32), STAGE.h - 10)
  }
}
