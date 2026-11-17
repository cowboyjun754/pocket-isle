import { nativeImage, type NativeImage } from 'electron'
import type { ParcelKind } from '../shared/types'
import parcelBoxAsset from '../renderer/src/assets/parcel-box.png?asset'
import parcelEnvelopeAsset from '../renderer/src/assets/parcel-envelope.png?asset'
import parcelScrollAsset from '../renderer/src/assets/parcel-scroll.png?asset'

type RGB = [number, number, number]

/** 生成微型水彩停靠岛托盘图标（BGRA，预乘 alpha），在 16x16 托盘栏中辨识度高 */
function blendPixel(buf: Buffer, size: number, x: number, y: number, col: RGB, alpha: number): void {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return
  const a = Math.min(1, Math.max(0, alpha))
  const i = (y * size + x) * 4
  const inv = 1 - a
  buf[i] = Math.round(buf[i] * inv + col[2] * a)
  buf[i + 1] = Math.round(buf[i + 1] * inv + col[1] * a)
  buf[i + 2] = Math.round(buf[i + 2] * inv + col[0] * a)
  buf[i + 3] = Math.min(255, Math.round(buf[i + 3] * inv + 255 * a))
}

function islandTrayBitmap(size = 32): Buffer {
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  const R = size / 2 - 0.8
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const edge = Math.min(1, Math.max(0, R - d + 0.6))
      if (edge <= 0) continue

      let col: RGB = [148, 194, 219] // 海洋蓝
      if (d > R - 1.5) col = [96, 74, 52] // 暖棕轮廓
      else if (d > R - 3.3) col = [251, 242, 220] // 奶油白浪花

      // 暖沙岸底弧
      const sandD = ((x - c) / (size * 0.32)) ** 2 + ((y - (c + 1.5)) / (size * 0.26)) ** 2
      if (sandD <= 1 && d <= R - 3.2) col = [238, 212, 170]

      // 嫩绿草地小山坡
      const grassD = ((x - c) / (size * 0.29)) ** 2 + ((y - (c - 0.8)) / (size * 0.21)) ** 2
      if (grassD <= 1 && d <= R - 3.2) col = y < c - 1 ? [168, 200, 142] : [148, 184, 122]

      blendPixel(buf, size, x, y, col, edge)

      // 左侧小小木栈桥
      if (x >= 5 && x <= 12 && y >= 17 && y <= 20) {
        const isRim = y === 17 || y === 20 || x === 5
        blendPixel(buf, size, x, y, isRim ? [104, 78, 52] : [220, 189, 144], 0.95)
      }

      // 山坡右上小红屋顶
      if (x >= 17 && x <= 22 && y >= 10 && y <= 14) {
        const roof = y <= 12 && Math.abs(x - 19.5) <= y - 9.2
        if (roof) blendPixel(buf, size, x, y, [212, 126, 88], 0.98)
        else if (y > 12 && x >= 18 && x <= 21) blendPixel(buf, size, x, y, [238, 216, 178], 0.98)
      }
    }
  }
  return buf
}

export function makeTrayIcon(): NativeImage {
  return nativeImage.createFromBitmap(islandTrayBitmap(32), {
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
  return nativeImage.createFromBitmap(islandTrayBitmap(32), {
    width: 32,
    height: 32,
    scaleFactor: 1
  })
}
