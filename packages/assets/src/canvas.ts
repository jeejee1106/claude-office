import { crc32, deflateSync, inflateSync } from 'node:zlib'

/*
 * 픽셀 버퍼 + PNG 인코딩/디코딩. 외부 라이브러리 없이 node:zlib 만 쓴다(순수 JS, 재현 가능).
 * 색은 0xRRGGBBAA 정수, 0 = 완전 투명. 안티앨리어싱 없음(알파는 0 또는 255만).
 */

export class PixelImage {
  readonly data: Uint32Array

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint32Array(width * height)
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0
    return this.data[y * this.width + x] ?? 0
  }

  set(x: number, y: number, color: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    this.data[y * this.width + x] = color >>> 0
  }

  fill(x: number, y: number, w: number, h: number, color: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, color)
  }

  /** src 를 (dx, dy) 에 복사. 투명 픽셀은 건너뛴다. scale 은 정수 확대 배율 */
  blit(src: PixelImage, dx: number, dy: number, scale = 1): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.get(x, y)
        if (c === 0) continue
        this.fill(dx + x * scale, dy + y * scale, scale, scale, c)
      }
    }
  }

  flipH(): PixelImage {
    const out = new PixelImage(this.width, this.height)
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) out.set(this.width - 1 - x, y, this.get(x, y))
    return out
  }

  equals(other: PixelImage): boolean {
    if (other.width !== this.width || other.height !== this.height) return false
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== other.data[i]) return false
    return true
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(body.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, body])) >>> 0)
  return Buffer.concat([len, typeBuf, body, crc])
}

/** RGBA 8bit PNG (필터 0, 결정적 출력 — 같은 입력이면 같은 바이트) */
export function encodePng(img: PixelImage): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width, 0)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = img.width * 4 + 1
  const raw = Buffer.alloc(stride * img.height)
  for (let y = 0; y < img.height; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < img.width; x++) raw.writeUInt32BE(img.get(x, y), y * stride + 1 + x * 4)
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** encodePng 가 쓰는 형식(RGBA 8bit, 인터레이스 없음)만 읽는다. 검증 스크립트용 */
export function decodePng(buf: Buffer): PixelImage {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG')
  let off = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const body = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0)
        throw new Error('only 8-bit RGBA non-interlaced PNG is supported')
    } else if (type === 'IDAT') idat.push(body)
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const img = new PixelImage(width, height)
  const stride = width * 4
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? (line[i - 4] ?? 0) : 0
      const b = prev[i] ?? 0
      const c = i >= 4 ? (prev[i - 4] ?? 0) : 0
      let pred = 0
      if (filter === 1) pred = a
      else if (filter === 2) pred = b
      else if (filter === 3) pred = (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      line[i] = ((line[i] ?? 0) + pred) & 0xff
    }
    for (let x = 0; x < width; x++) img.set(x, y, line.readUInt32BE(x * 4))
    prev = line
  }
  return img
}
