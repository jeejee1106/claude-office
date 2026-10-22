import type { PixelImage } from './canvas'
import { MAX_PALETTE_SIZE, PALETTE, paletteRgbaSet } from './palette'

/** 팔레트 밖 색·반투명 픽셀 목록(최대 limit 개). 빈 배열이면 통과 */
export function offPalettePixels(img: PixelImage, limit = 20): string[] {
  const allowed = paletteRgbaSet()
  const bad: string[] = []
  for (let y = 0; y < img.height && bad.length < limit; y++) {
    for (let x = 0; x < img.width && bad.length < limit; x++) {
      const c = img.get(x, y)
      if (c === 0) continue
      if (!allowed.has(c)) bad.push(`(${x},${y}) #${c.toString(16).padStart(8, '0')}`)
    }
  }
  return bad
}

export function assertPalette(): void {
  const n = Object.keys(PALETTE).length
  if (n > MAX_PALETTE_SIZE) throw new Error(`palette has ${n} colors (max ${MAX_PALETTE_SIZE})`)
  const values = Object.values(PALETTE)
  if (new Set(values).size !== values.length) throw new Error('palette has duplicate colors')
}
