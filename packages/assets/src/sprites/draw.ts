import { PixelImage } from '../canvas'
import { type ColorName, rgba } from '../palette'

/*
 * office 시트(업무 공간 office.ts + 나머지 방 rooms.ts)가 함께 쓰는 그리기 도구.
 * 규칙(pixel-art-pipeline 3절): 16px 격자, 팔레트 색만, 좌상단 광원, 1px 짙은 남색 외곽선, 안티앨리어싱 없음.
 */

export const TILE = 16

/** 문자 그리드 기호 → 팔레트 색 ('.' 투명) */
export const KEY: Record<string, ColorName> = {
  o: 'outline',
  w: 'white',
  W: 'grayLight',
  G: 'gray',
  i: 'ink',
  I: 'inkDark',
  n: 'chestnut',
  N: 'chestnutDark',
  b: 'brown',
  B: 'brownDark',
  y: 'yellow',
  Y: 'yellowDark',
  g: 'green',
  E: 'greenDark',
  t: 'teal',
  T: 'tealDark',
  c: 'coral',
  C: 'coralDark',
  u: 'blue',
  U: 'blueDark',
  p: 'pink',
  P: 'pinkDark',
  v: 'purple',
  V: 'purpleDark',
  s: 'skin',
  S: 'skinShade',
  k: 'sky',
  m: 'cream',
  M: 'creamShade',
  a: 'pants',
  l: 'woodLight',
  x: 'steel',
  X: 'steelDark',
  r: 'carpet',
  R: 'carpetDark',
}

/** 문자 그리드 → 이미지. 모든 행 길이가 같아야 한다 */
export function art(rows: readonly string[]): PixelImage {
  const w = rows[0]?.length ?? 0
  const img = new PixelImage(w, rows.length)
  rows.forEach((r, y) => {
    if (r.length !== w)
      throw new Error(`grid row ${y} has ${r.length} columns, expected ${w}: "${r}"`)
    for (let x = 0; x < r.length; x++) {
      const ch = r[x] as string
      if (ch === '.') continue
      const k = KEY[ch]
      if (!k) throw new Error(`unknown grid key '${ch}' in row "${r}"`)
      img.set(x, y, rgba(k))
    }
  })
  return img
}

/** 바깥(4방향 이웃 중 빈칸)에 1px 외곽선을 두른 새 이미지. 크기 +2 */
export function outlined(img: PixelImage): PixelImage {
  const out = new PixelImage(img.width + 2, img.height + 2)
  out.blit(img, 1, 1)
  const o = rgba('outline')
  for (let y = 0; y < out.height; y++)
    for (let x = 0; x < out.width; x++) {
      if (img.get(x - 1, y - 1) !== 0) continue
      if (img.get(x - 2, y - 1) || img.get(x, y - 1) || img.get(x - 1, y - 2) || img.get(x - 1, y))
        out.set(x, y, o)
    }
  return out
}

/** 이미 그려진 픽셀은 두고, 주어진 픽셀 집합 둘레의 빈칸에만 외곽선 */
export function outlineInPlace(img: PixelImage, px: readonly (readonly [number, number])[]): void {
  const filled = new Set(px.map(([x, y]) => `${x},${y}`))
  const o = rgba('outline')
  for (const [x, y] of px)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx
      const ny = y + dy
      if (!filled.has(`${nx},${ny}`) && img.get(nx, ny) === 0) img.set(nx, ny, o)
    }
}

export function paint(img: PixelImage, x: number, y: number, w: number, h: number, c: ColorName) {
  img.fill(x, y, w, h, rgba(c))
}

/** w×h 프레임에 그림을 아래 가운데 맞춤(바닥 접점이 프레임 맨 아래 줄) */
export function bottomCenter(w: number, h: number, item: PixelImage): PixelImage {
  const f = new PixelImage(w, h)
  f.blit(item, Math.floor((w - item.width) / 2), h - item.height)
  return f
}

/** src 의 (sx, sy, w, h) 영역을 dst 의 (dx, dy) 에 그대로(투명 포함) 복사 */
export function copyRect(
  dst: PixelImage,
  src: PixelImage,
  sx: number,
  sy: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
): void {
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) dst.set(dx + i, dy + j, src.get(sx + i, sy + j))
}

export interface Anchor {
  x: number
  y: number
}

export interface OfficeFrame {
  name: string
  image: PixelImage
  anchor: Anchor
  /** 요약 문서·미리보기용 한 줄 설명 */
  note: string
}

export const TILE_ANCHOR: Anchor = { x: 0, y: 0 }
export const FLOOR_ANCHOR: Anchor = { x: 0.5, y: 1 }
