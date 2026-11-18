import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { deflateSync } from 'zlib'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodeRgbaPng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** Encodes a Windows 32bpp BITMAPINFOHEADER DIB (used for 16/32/48/64 sizes for broad compatibility). */
function encodeBmpDib(size, rgba) {
  const hdr = Buffer.alloc(40)
  hdr.writeUInt32LE(40, 0) // biSize
  hdr.writeInt32LE(size, 4) // biWidth
  hdr.writeInt32LE(size * 2, 8) // biHeight (color + AND mask)
  hdr.writeUInt16LE(1, 12) // biPlanes
  hdr.writeUInt16LE(32, 14) // biBitCount
  hdr.writeUInt32LE(0, 16) // BI_RGB
  hdr.writeUInt32LE(size * size * 4, 20)

  const pixels = Buffer.alloc(size * size * 4)
  const andStride = Math.ceil(size / 32) * 4
  const andMask = Buffer.alloc(andStride * size)

  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y // BMP DIB rows are stored bottom-up
    for (let x = 0; x < size; x++) {
      const si = (srcY * size + x) * 4
      const di = (y * size + x) * 4
      const a = rgba[si + 3]
      pixels[di] = rgba[si + 2] // B
      pixels[di + 1] = rgba[si + 1] // G
      pixels[di + 2] = rgba[si] // R
      pixels[di + 3] = a // A
      if (a < 16) {
        andMask[y * andStride + (x >> 3)] |= 0x80 >> (x & 7)
      }
    }
  }
  return Buffer.concat([hdr, pixels, andMask])
}

function blendRgba(buf, size, x, y, rgb, alpha) {
  if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return
  const a = Math.min(1, Math.max(0, alpha))
  const i = (y * size + x) * 4
  const inv = 1 - a
  buf[i] = Math.round(buf[i] * inv + rgb[0] * a)
  buf[i + 1] = Math.round(buf[i + 1] * inv + rgb[1] * a)
  buf[i + 2] = Math.round(buf[i + 2] * inv + rgb[2] * a)
  buf[i + 3] = Math.min(255, Math.round(buf[i + 3] * inv + 255 * a))
}

/** Renders a proportional watercolor-style floating island RGBA bitmap. */
export function renderIslandIconRgba(size = 64) {
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  const r = size / 2 - size * 0.03
  const s = size / 32

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const edge = Math.min(1, Math.max(0, r - d + 0.65 * s))
      if (edge <= 0) continue

      let col = [148, 194, 219] // ocean blue
      if (d > r - 1.5 * s) col = [96, 74, 52] // warm brown outline
      else if (d > r - 3.2 * s) col = [251, 242, 220] // cream foam ring

      const sandD = ((x - c) / (size * 0.33)) ** 2 + ((y - (c + 1.5 * s)) / (size * 0.27)) ** 2
      if (sandD <= 1 && d <= r - 3.1 * s) col = [238, 212, 170]

      const grassD = ((x - c) / (size * 0.29)) ** 2 + ((y - (c - 0.8 * s)) / (size * 0.21)) ** 2
      if (grassD <= 1 && d <= r - 3.1 * s) col = y < c - 0.8 * s ? [168, 200, 142] : [148, 184, 122]

      blendRgba(buf, size, x, y, col, edge)

      const nx = x / s
      const ny = y / s
      if (nx >= 4.5 && nx <= 12.2 && ny >= 16.8 && ny <= 20.4) {
        const isRim = ny < 17.7 || ny > 19.5 || nx < 5.5
        blendRgba(buf, size, x, y, isRim ? [104, 78, 52] : [220, 189, 144], 0.96)
      }

      if (nx >= 16.8 && nx <= 22.4 && ny >= 9.6 && ny <= 14.8) {
        const roof = ny <= 12.2 && Math.abs(nx - 19.5) <= ny - 9.2
        if (roof) blendRgba(buf, size, x, y, [212, 126, 88], 0.98)
        else if (ny > 12.2 && nx >= 17.8 && nx <= 21.2) {
          blendRgba(buf, size, x, y, [238, 216, 178], 0.98)
        }
      }

      const otterDist = Math.hypot((nx - 14.5) / 2.2, (ny - 17.4) / 2.4)
      if (otterDist <= 1) {
        blendRgba(buf, size, x, y, otterDist > 0.72 ? [104, 78, 52] : [168, 132, 98], 0.95)
      }
    }
  }
  return buf
}

export function buildPocketIsleIco(outPath) {
  const images = [16, 32, 48, 64, 256].map((sz) => {
    const rgba = renderIslandIconRgba(sz)
    return {
      size: sz,
      data: sz >= 256 ? encodeRgbaPng(sz, rgba) : encodeBmpDib(sz, rgba)
    }
  })
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  const dirSize = images.length * 16
  let offset = 6 + dirSize
  const entries = images.map((p) => {
    const e = Buffer.alloc(16)
    e[0] = p.size >= 256 ? 0 : p.size
    e[1] = p.size >= 256 ? 0 : p.size
    e[2] = 0
    e[3] = 0
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(p.data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += p.data.length
    return e
  })

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, Buffer.concat([header, ...entries, ...images.map((p) => p.data)]))
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const target = process.argv[2] || 'build/icon.ico'
  buildPocketIsleIco(target)
  console.log(`Generated ${target}`)
}
