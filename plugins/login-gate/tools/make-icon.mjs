// 生成插件图标 icon.png（128×128）：深色圆角底 + 白色钥匙孔。零依赖手工构造 PNG。
// 运行：node tools/make-icon.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SIZE = 128

function crc32(buffer) {
  let c
  const table = []
  for (let n = 0; n < 256; n += 1) {
    c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

// 圆角矩形内的点判定（半径 r，边距 m）。
function inRoundedRect(x, y, m, r) {
  const x0 = m
  const y0 = m
  const x1 = SIZE - m
  const y1 = SIZE - m
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

// 钥匙孔：上圆（cx=64,cy=56,r=21）+ 下梯形（y 56..96，半宽 12→7）。
function inKeyhole(x, y) {
  if ((x - 64) ** 2 + (y - 56) ** 2 <= 21 * 21) return true
  if (y <= 56 || y > 96) return false
  const t = (y - 56) / 40
  const half = 12 * (1 - t) + 7 * t
  return Math.abs(x - 64) <= half
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y += 1) {
  const rowStart = y * (SIZE * 4 + 1)
  raw[rowStart] = 0 // filter: none
  for (let x = 0; x < SIZE; x += 1) {
    const at = rowStart + 1 + x * 4
    const px = x + 0.5
    const py = y + 0.5
    if (!inRoundedRect(px, py, 8, 24)) {
      raw.writeUInt32BE(0, at) // 完全透明
      continue
    }
    if (inKeyhole(px, py)) {
      raw[at] = 0xf5; raw[at + 1] = 0xf7; raw[at + 2] = 0xfa; raw[at + 3] = 0xff
    } else {
      raw[at] = 0x24; raw[at + 1] = 0x30; raw[at + 2] = 0x42; raw[at + 3] = 0xff
    }
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type: RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'icon.png')
writeFileSync(out, png)
console.log(`wrote ${out} (${png.length} bytes)`)
