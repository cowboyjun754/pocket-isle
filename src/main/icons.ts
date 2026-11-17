import { nativeImage, type NativeImage } from 'electron'
import type { ParcelKind } from '../shared/types'
import parcelBoxAsset from '../renderer/src/assets/parcel-box.png?asset'
import parcelEnvelopeAsset from '../renderer/src/assets/parcel-envelope.png?asset'
import parcelScrollAsset from '../renderer/src/assets/parcel-scroll.png?asset'

type RGB = [number, number, number]

/** 生成一个带描边的圆形位图（BGRA，预乘 alpha），用于系统托盘图标 */
function circleBitmap(size: number, fill: RGB, ring: RGB, ringRatio = 0.14): Buffer {
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  const R = size / 2 - 0.5
  const ringW = Math.max(1, size * ringRatio)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const a = Math.min(1, Math.max(0, R - d + 0.5))
      const col = d > R - ringW ? ring : fill
      const i = (y * size + x) * 4
      buf[i] = Math.round(col[2] * a)
      buf[i + 1] = Math.round(col[1] * a)
      buf[i + 2] = Math.round(col[0] * a)
      buf[i + 3] = Math.round(255 * a)
    }
  }
  return buf
}

export function makeTrayIcon(): NativeImage {
  return nativeImage.createFromBitmap(circleBitmap(32, [168, 196, 154], [120, 160, 190]), {
    width: 32,
    height: 32,
    scaleFactor: 2
  })
}

const PARCEL_ICON_SPECS: Record<ParcelKind, { path: string; width: number; height: number }> = {
  envelope: { path: parcelEnvelopeAsset, width: 42, height: 27 },
  box: { path: parcelBoxAsset, width: 36, height: 35 },
  scroll: { path: parcelScrollAsset, width: 35, height: 36 }
}

const parcelDragIconCache = new Map<ParcelKind, NativeImage>()

/** 返回手绘水彩包裹图标用于原生拖拽，避免弹出多余的占位圆圈 */
export function makeDragIcon(kind: ParcelKind = 'envelope'): NativeImage {
  const cached = parcelDragIconCache.get(kind)
  if (cached) return cached

  const spec = PARCEL_ICON_SPECS[kind] ?? PARCEL_ICON_SPECS.envelope
  const loaded = nativeImage.createFromPath(spec.path)
  if (!loaded.isEmpty()) {
    const resized = loaded.resize({ width: spec.width, height: spec.height, quality: 'best' })
    parcelDragIconCache.set(kind, resized)
    return resized
  }
  return nativeImage.createFromBitmap(circleBitmap(32, [236, 217, 176], [169, 132, 90], 0.1), {
    width: 32,
    height: 32,
    scaleFactor: 1
  })
}
