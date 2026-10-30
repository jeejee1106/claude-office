import { PixelImage } from '../canvas'
import { rgba } from '../palette'
import {
  type Anchor,
  art,
  bottomCenter,
  FLOOR_ANCHOR,
  KEY,
  type OfficeFrame,
  outlined,
} from './draw'

/*
 * 계절 장식(decor 시트, docs/product-spec.md 3절 "계절 장식").
 * 규칙은 office 시트와 같다(pixel-art-pipeline 3절): 16px 격자, 팔레트 색만, 좌상단 광원,
 * 1px 짙은 남색 외곽선(outlined), 안티앨리어싱 없음. 문자 기호는 draw.ts 의 KEY 를 쓴다.
 *
 * 프레임 이름: deco_{season}_{item}_{n}. 2프레임 이상이면 애니메이션 키 deco_{season}_{item}.
 * 놓는 곳(place)과 기준점(anchor):
 *   floor   바닥(또는 책상 위) — anchor (0.5, 1) 아래 가운데 = 바닥 접점 (office 가구와 같다)
 *   hang    벽·천장에 거는 것(가랜드·리스·박쥐) — anchor (0.5, 0) 위 가운데 = 거는 점(못·실 끝)
 *   corner  벽 모서리(거미줄) — anchor (0, 0) 왼쪽 위 = 모서리. 오른쪽 모서리는 좌우 반전(scale.x = -1)
 */

/** 달력 순서(가을 = 11월, 할로윈 다음·크리스마스 앞). 시트 안 배치 순서는 buildDecorItems 순서를 따른다 */
export const SEASONS = ['spring', 'summer', 'halloween', 'autumn', 'christmas'] as const
export type Season = (typeof SEASONS)[number]

export type DecorPlace = 'floor' | 'hang' | 'corner'

export const HANG_ANCHOR: Anchor = { x: 0.5, y: 0 }
export const CORNER_ANCHOR: Anchor = { x: 0, y: 0 }
export const PLACE_ANCHOR: Record<DecorPlace, Anchor> = {
  floor: FLOOR_ANCHOR,
  hang: HANG_ANCHOR,
  corner: CORNER_ANCHOR,
}

export interface DecorItem {
  season: Season
  item: string
  place: DecorPlace
  frames: PixelImage[]
  /** 애니메이션 한 프레임 시간(ms). 1프레임이면 없음 */
  frameMs?: number
  note: string
}

// ---------------------------------------------------------------------------
// 그리기 도구: 칸 함수로 문자 그리드를 만든 뒤 art() 로 칠한다
// ---------------------------------------------------------------------------

type Cell = string | null

/** w×h 그리드. fn 은 픽셀 중심 좌표(px = x + 0.5, py = y + 0.5)를 받는다 */
function shape(
  w: number,
  h: number,
  fn: (px: number, py: number, x: number, y: number) => Cell,
): string[][] {
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => fn(x + 0.5, y + 0.5, x, y) ?? '.'),
  )
}

function put(g: string[][], cells: readonly (readonly [number, number, string])[]): void {
  for (const [x, y, c] of cells) {
    const row = g[y]
    if (!row || x < 0 || x >= row.length) throw new Error(`put out of range (${x},${y})`)
    row[x] = c
  }
}

const rowsOf = (g: string[][]): string[] => g.map((r) => r.join(''))

/** 그리드 → 외곽선 두른 이미지 → w×h 프레임 아래 가운데 */
function floorItem(w: number, h: number, g: string[][] | readonly string[]): PixelImage {
  const rows = typeof g[0] === 'string' ? (g as string[]) : rowsOf(g as string[][])
  return bottomCenter(w, h, outlined(art(rows)))
}

/** 그리드 → 외곽선 두른 이미지 → w×h 프레임 위 가운데 */
function hangItem(w: number, h: number, rows: readonly string[], top = 0): PixelImage {
  const item = outlined(art(rows))
  const f = new PixelImage(w, h)
  f.blit(item, Math.floor((w - item.width) / 2), top)
  return f
}

function setKey(img: PixelImage, x: number, y: number, k: string): void {
  const c = KEY[k]
  if (!c) throw new Error(`unknown key ${k}`)
  img.set(x, y, rgba(c))
}

/** Bresenham 선 */
function line(img: PixelImage, x0: number, y0: number, x1: number, y1: number, k: string): void {
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  let x = x0
  let y = y0
  for (;;) {
    setKey(img, x, y, k)
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
}

// ---------------------------------------------------------------------------
// 봄
// ---------------------------------------------------------------------------

/** 벚꽃 화분 채움 14×21 (분홍 꽃 덩어리 + 갈색 가지 + 나무 화분) */
const BLOSSOM_POT = [
  '....pp..pp....',
  '..ppwpp.pwpp..',
  '.pwpppPpppppP.',
  'ppppPpppwppPpp',
  'pPpwpppPpppppP',
  '.ppppPppppwpP.',
  '.PpPpppbpPpPP.',
  '..PPP.bb.PPP..',
  '......bb.b....',
  '......bbb.....',
  '.......bB.....',
  '......bbB.....',
  '......bB......',
  '......bB......',
  '.nnnnnnnnnnnN.',
  '.NNNNNNNNNNNN.',
  '..nnnnnnnnNN..',
  '..nnnnnnnnNN..',
  '..nnnnnnnnNN..',
  '...nnnnnnNN...',
  '...NNNNNNNN...',
]

/** 꽃 가랜드 32×16: 늘어진 끈 + 꽃 5송이(분홍·흰·보라 번갈아) */
function garland(): PixelImage {
  const W = 32
  const img = new PixelImage(W, 16)
  const sag = (x: number) => 1 + Math.round(5 * Math.sin((Math.PI * x) / (W - 1)))
  for (let x = 0; x < W; x++) setKey(img, x, sag(x), 'b')
  // 양 끝 고정 핀
  setKey(img, 0, 0, 'X')
  setKey(img, W - 1, 0, 'X')
  // 꽃 사이 잎
  for (const x of [7, 13, 18, 24]) setKey(img, x, sag(x), x < 16 ? 'g' : 'E')
  const flowers: [number, string, string][] = [
    [4, 'p', 'Y'],
    [10, 'w', 'y'],
    [16, 'v', 'y'],
    [21, 'w', 'y'],
    [27, 'p', 'Y'],
  ]
  for (const [cx, petal, mid] of flowers) {
    const f = outlined(art([`.${petal}.`, `${petal}${mid}${petal}`, `.${petal}.`]))
    img.blit(f, cx - 2, sag(cx) + 2 - 2)
  }
  return img
}

// ---------------------------------------------------------------------------
// 여름
// ---------------------------------------------------------------------------

/** 선풍기 채움 14×30. blades = 날개 3개의 각도(도) */
function fan(blades: readonly number[]): string[][] {
  const cx = 7
  const cy = 6.5
  const g = shape(14, 30, (px, py, x, y) => {
    if (y <= 12) {
      const dx = px - cx
      const dy = py - cy
      const d = Math.hypot(dx, dy)
      if (d > 6.6) return null
      if (d > 5.6) return dx + dy < -2 ? 'w' : dx + dy > 3 ? 'G' : 'W'
      if (d < 1.3) return 'x'
      const a = (Math.atan2(dy, dx) * 180) / Math.PI
      for (const b of blades) {
        const diff = ((a - b + 540) % 360) - 180
        if (Math.abs(diff) < 30 && d <= 5) return diff > 8 ? 'U' : 'u'
      }
      return 'k'
    }
    // 기둥
    if (y <= 26) return x === 6 ? 'W' : x === 7 ? 'G' : null
    // 받침
    if (y === 27) return x >= 2 && x <= 11 ? (x >= 10 ? 'G' : 'W') : null
    if (y === 28) return x >= 1 && x <= 12 ? (x >= 10 ? 'G' : 'W') : null
    return x >= 2 && x <= 11 ? 'G' : null
  })
  put(g, [[4, 28, 'c']]) // 전원 버튼
  return g
}

/** 수박 조각(반달, 위가 과육 단면) 채움 14×7 */
function watermelon(): string[][] {
  const g = shape(14, 7, (px, py) => {
    const dx = px - 7
    const d = Math.hypot(dx, py)
    if (d > 7) return null
    if (d > 6.2) return 'E'
    if (d > 5.3) return 'g'
    if (d > 4.6) return 'w'
    return dx + py > 5 ? 'C' : 'c'
  })
  put(g, [
    [4, 1, 'i'],
    [7, 2, 'i'],
    [10, 1, 'i'],
    [5, 3, 'i'],
    [9, 3, 'i'],
  ])
  return g
}

/** 해바라기 화분 채움 14×30 (꽃 머리 + 줄기·잎 + 파란 화분) */
function sunflowerPot(): string[][] {
  const cx = 7
  const cy = 6.5
  const g = shape(14, 30, (px, py, x, y) => {
    if (y <= 13) {
      const dx = px - cx
      const dy = py - cy
      const d = Math.hypot(dx, dy)
      const a = Math.atan2(dy, dx)
      if (d <= 2.9) {
        if (dx + dy < -1.5) return 'n'
        return (x + y) % 2 === 0 ? 'B' : 'b'
      }
      const edge = 4.6 + 1.5 * Math.max(0, Math.cos(10 * a))
      if (d <= edge) return dx + dy > 2.5 ? 'Y' : 'y'
      if (y < 13) return null
    }
    if (y >= 13 && y <= 22) return x === 6 ? 'g' : x === 7 ? 'E' : null
    if (y === 23) return x >= 1 && x <= 12 ? (x === 12 ? 'U' : 'u') : null
    if (y === 24) return x >= 1 && x <= 12 ? 'U' : null
    if (y <= 28) return x >= 2 && x <= 11 ? (x >= 10 ? 'U' : 'u') : null
    return x >= 3 && x <= 10 ? 'U' : null
  })
  put(g, [
    [3, 16, 'g'],
    [4, 16, 'g'],
    [5, 16, 'g'],
    [2, 17, 'g'],
    [3, 17, 'E'],
    [4, 17, 'E'],
    [5, 17, 'E'],
    [8, 19, 'g'],
    [9, 19, 'g'],
    [10, 19, 'g'],
    [8, 20, 'E'],
    [9, 20, 'E'],
    [10, 20, 'E'],
    [11, 20, 'E'],
  ])
  return g
}

// ---------------------------------------------------------------------------
// 할로윈
// ---------------------------------------------------------------------------

/** 호박 등불 채움 14×14. bright = 불빛이 센 프레임(노랑 + 흰 심지), 아니면 어두운 노랑 */
function pumpkin(bright: boolean): string[][] {
  const glow = bright ? 'y' : 'Y'
  const g = shape(14, 14, (px, py, x, y) => {
    if (y < 3) return null
    const dx = px - 7
    const dy = py - 8.5
    if ((dx / 6.8) ** 2 + (dy / 5.6) ** 2 > 1) return null
    if (dx + dy > 6 || y === 13) return 'C'
    if (x === 4 || x === 9) return 'C' // 골
    return 'c'
  })
  put(g, [
    // 꼭지·잎
    [8, 0, 'g'],
    [7, 1, 'g'],
    [8, 1, 'E'],
    [6, 2, 'g'],
    [7, 2, 'E'],
    [8, 2, 'g'],
    [9, 2, 'g'],
  ])
  const face: [number, number][] = [
    [4, 6],
    [9, 6],
    [3, 7],
    [4, 7],
    [5, 7],
    [8, 7],
    [9, 7],
    [10, 7],
    [3, 10],
    [4, 10],
    [6, 10],
    [7, 10],
    [9, 10],
    [10, 10],
    [4, 11],
    [5, 11],
    [6, 11],
    [7, 11],
    [8, 11],
    [9, 11],
  ]
  put(
    g,
    face.map(([x, y]) => [x, y, glow] as const),
  )
  // 밝은 프레임: 눈·입 가운데가 하얗게 타오른다
  if (bright)
    put(g, [
      [4, 7, 'w'],
      [9, 7, 'w'],
      [6, 11, 'w'],
      [7, 11, 'w'],
    ])
  return g
}

/** 박쥐 (실에 매달린 종이 박쥐) 날개 위 / 아래 채움 14×8 */
const BAT_UP = [
  'v...i....i...v',
  'vv..iiiiii..vv',
  'vVv.iyiiyi.vVv',
  'vvVviiiiiivVvv',
  'vvvvViiiiVvvvv',
  '.V.vvIiiIvv.V.',
  '.....IiiI.....',
  '......II......',
]
const BAT_DOWN = [
  '....i....i....',
  '....iiiiii....',
  '....iyiiyi....',
  '.vvvViiiiVvvv.',
  'vvvVvIiiIvVvvv',
  'vVv.vIiiIv.vVv',
  'v.v..IiiI..v.v',
  '......II......',
]

function bat(rows: readonly string[]): PixelImage {
  const img = hangItem(16, 16, rows, 4)
  // 천장에서 내려온 실(외곽선 없이 1px)
  for (let y = 0; y <= 5; y++) if (img.get(7, y) === 0) setKey(img, 7, y, 'G')
  return img
}

/** 거미줄 16×16, 왼쪽 위 모서리에서 퍼진다(외곽선 없이 가는 실) */
function cobweb(): PixelImage {
  const img = new PixelImage(16, 16)
  const angles = [0, 22.5, 45, 67.5, 90].map((d) => (d * Math.PI) / 180)
  const at = (r: number, a: number) =>
    [Math.min(15, Math.round(r * Math.cos(a))), Math.min(15, Math.round(r * Math.sin(a)))] as const
  for (const a of angles) {
    const [x, y] = at(16, a)
    line(img, 0, 0, x, y, 'G')
  }
  for (const r of [4, 8, 12]) {
    for (let i = 0; i + 1 < angles.length; i++) {
      const [x0, y0] = at(r, angles[i] as number)
      const [x1, y1] = at(r, angles[i + 1] as number)
      line(img, x0, y0, x1, y1, 'W')
    }
  }
  return img
}

// ---------------------------------------------------------------------------
// 크리스마스
// ---------------------------------------------------------------------------

/** 트리 채움 30×46. lit = 켜진 전구 묶음(0 | 1) */
function tree(lit: 0 | 1): string[][] {
  const tiers: [number, number, number, number][] = [
    // yTop, yBottom, 위 반폭, 아래 반폭
    [4, 14, 1, 8],
    [11, 24, 3, 11],
    [20, 36, 5, 14],
  ]
  const g = shape(30, 46, (px, _py, x, y) => {
    const dx = px - 15
    for (const [t, b, w0, w1] of tiers) {
      if (y < t || y > b) continue
      const hw = w0 + ((w1 - w0) * (y - t)) / (b - t)
      if (Math.abs(dx) > hw) continue
      // 단 아래 끝 줄·오른쪽은 그늘
      if (y >= b - 1 || dx > hw * 0.4) return 'E'
      return (x * 3 + y * 5) % 11 === 0 ? 'E' : 'g'
    }
    if (y < 37) return null
    if (y <= 39) return x >= 13 && x <= 16 ? (x === 16 ? 'B' : 'b') : null
    if (y === 40) return x >= 9 && x <= 20 ? (x === 20 ? 'N' : 'n') : null
    if (y === 41) return x >= 9 && x <= 20 ? 'N' : null
    if (y <= 44) return x >= 10 && x <= 19 ? (x >= 18 ? 'N' : 'n') : null
    if (y === 45) return x >= 11 && x <= 18 ? 'N' : null
    return null
  })
  // 단이 겹치는 줄은 위 단이 먼저 맞으므로 위 단의 아래 끝 그늘이 아래 단 위로 드리운다
  // 별
  put(g, [
    [14, 0, 'y'],
    [15, 0, 'y'],
    [13, 1, 'y'],
    [14, 1, 'w'],
    [15, 1, 'y'],
    [16, 1, 'y'],
    [11, 2, 'y'],
    [12, 2, 'y'],
    [13, 2, 'y'],
    [14, 2, 'y'],
    [15, 2, 'y'],
    [16, 2, 'y'],
    [17, 2, 'Y'],
    [18, 2, 'Y'],
    [13, 3, 'y'],
    [14, 3, 'y'],
    [15, 3, 'y'],
    [16, 3, 'Y'],
    [12, 4, 'Y'],
    [13, 4, 'Y'],
    [16, 4, 'Y'],
    [17, 4, 'Y'],
  ])
  const bulbs: [number, number][] = [
    [13, 8],
    [16, 10],
    [10, 13],
    [18, 12],
    [14, 16],
    [9, 18],
    [20, 19],
    [12, 22],
    [17, 23],
    [6, 24],
    [23, 24],
    [15, 27],
    [9, 29],
    [20, 30],
    [4, 33],
    [12, 33],
    [25, 33],
    [17, 35],
  ]
  const bright = ['c', 'u', 'y', 'p']
  const dim = ['C', 'U', 'Y', 'P']
  // 켜진 전구는 2px(밝은 색), 꺼진 전구는 1px(어두운 색) — 두 묶음이 번갈아 켜진다
  put(
    g,
    bulbs.flatMap(([x, y], i) => {
      const on = i % 2 === lit
      const c = (on ? bright : dim)[i % 4] as string
      return on ? [[x, y, c] as const, [x + 1, y, c] as const] : [[x, y, c] as const]
    }),
  )
  return g
}

/** 선물 상자 채움 14×13 (빨간 상자 + 노란 리본) */
const GIFT = [
  '...yy....yy...',
  '..y..yyyy..y..',
  '...yyyYYyyy...',
  'wcccccyYcccccC',
  'CCCCCCyYCCCCCC',
  '.cccccyYccccC.',
  '.cccccyYccccC.',
  '.yyyyyyYyyyyY.',
  '.cccccyYccccC.',
  '.cccccyYccccC.',
  '.cccccyYccccC.',
  '.cccccyYccccC.',
  '.CCCCCyYCCCCC.',
]

/** 리스 채움 14×14 (초록 고리 + 빨간 열매 + 아래 리본) */
function wreath(): string[][] {
  const g = shape(14, 14, (px, py, x, y) => {
    const dx = px - 7
    const dy = py - 7
    const d = Math.hypot(dx, dy)
    if (d < 3 || d > 6.9) return null
    if (dx + dy > 4 || (x * 3 + y * 5) % 4 === 0) return 'E'
    return 'g'
  })
  put(g, [
    [3, 4, 'c'],
    [10, 3, 'c'],
    [11, 8, 'c'],
    [2, 9, 'c'],
    [6, 1, 'c'],
    // 리본
    [4, 10, 'c'],
    [5, 10, 'c'],
    [6, 10, 'C'],
    [7, 10, 'C'],
    [8, 10, 'c'],
    [9, 10, 'c'],
    [3, 11, 'c'],
    [4, 11, 'c'],
    [5, 11, 'c'],
    [6, 11, 'C'],
    [7, 11, 'C'],
    [8, 11, 'c'],
    [9, 11, 'c'],
    [10, 11, 'c'],
    [5, 12, 'c'],
    [8, 12, 'c'],
    [4, 13, 'C'],
    [9, 13, 'C'],
  ])
  return g
}

// ---------------------------------------------------------------------------
// 가을 (11월 단풍)
// 팔레트에 순수 주황이 없어 빨강 = coral(c)/coralDark(C), 주황 = yellowDark(Y)/chestnut(n),
// 노랑 = yellow(y)/yellowDark(Y) 로 칠한다.
// ---------------------------------------------------------------------------

type LeafTone = 'red' | 'orange' | 'yellow'
const LEAF: Record<LeafTone, { light: string; dark: string }> = {
  red: { light: 'c', dark: 'C' },
  orange: { light: 'Y', dark: 'n' },
  yellow: { light: 'y', dark: 'Y' },
}

/** 단풍나무 화분 채움 14×30 (빨강·주황 잎 덩어리 + 갈색 줄기 + 크림 도자기 화분) */
function maplePot(): string[][] {
  const clusters: [number, number, number, LeafTone][] = [
    // 중심 x, y, 반지름, 색
    [7, 5.4, 4.6, 'red'],
    [3.9, 9.2, 3.6, 'orange'],
    [10.1, 9.4, 3.6, 'red'],
    [7, 12, 3, 'orange'],
  ]
  const g = shape(14, 30, (px, py, x, y) => {
    if (y <= 15) {
      // 가장 가까운(가장자리까지 여유가 큰) 덩어리의 색을 쓴다
      let best: (typeof clusters)[number] | undefined
      let room = 0
      for (const c of clusters) {
        const r = c[2] - Math.hypot(px - c[0], py - c[1])
        if (r > room) {
          room = r
          best = c
        }
      }
      // 가장자리를 들쭉날쭉하게(잎 끝): 비우고 아래 줄기·빈칸으로 넘긴다
      if (room < 0.6 && (x + y) % 3 === 0) best = undefined
      if (best) {
        const [cx, cy, r, tone] = best
        const { light, dark } = LEAF[tone]
        const lit = px - cx + (py - cy)
        if (lit < -r * 0.9) return 'y' // 좌상단 하이라이트
        let shade = lit > r * 0.5
        if ((x * 7 + y * 3) % 9 === 0) shade = !shade // 잎 결
        return shade ? dark : light
      }
    }
    // 줄기
    if (y < 13) return null
    if (y <= 22) return x === 6 ? 'b' : x === 7 ? 'B' : null
    // 화분 (크림 도자기 — 잎의 주황·갈색과 구별되게)
    if (y === 23) return x >= 1 && x <= 12 ? (x === 12 ? 'M' : 'm') : null
    if (y === 24) return x >= 1 && x <= 12 ? 'M' : null
    if (y <= 28) return x >= 2 && x <= 11 ? (x >= 10 ? 'M' : 'm') : null
    return x >= 3 && x <= 10 ? 'M' : null
  })
  // 화분 테에 떨어진 잎 두 장
  put(g, [
    [3, 23, 'c'],
    [9, 23, 'Y'],
  ])
  return g
}

/** 낙엽 더미 채움 14×8 (빨강·주황·노랑 잎이 2px 덩어리로 섞인 둔덕 + 위에 꽂힌 잎자루) */
function leafPile(): string[][] {
  const tones: LeafTone[] = ['red', 'orange', 'yellow']
  const g = shape(14, 8, (px, py, x, y) => {
    const dx = (px - 7) / 7
    const dy = (py - 8) / 7
    if (dx * dx + dy * dy > 1) return null
    if (y === 0) return null
    const bx = Math.floor(x / 2)
    const by = Math.floor((y + (bx % 2)) / 2)
    const tone = tones[(bx * 2 + by) % 3] as LeafTone
    const { light, dark } = LEAF[tone]
    const shade = y === 7 || px - 7 + (py - 8) > 3 || (x + y * 2) % 5 === 0
    return shade ? dark : light
  })
  put(g, [
    [8, 0, 'B'], // 잎자루
    [4, 2, 'y'], // 하이라이트
    [5, 2, 'y'],
  ])
  return g
}

/** 단풍잎 가랜드 32×16 (봄 꽃 가랜드와 같은 끈·핀·규격, 그림 y 0..10): 잎 5장 + 사이 도토리 구슬 */
function mapleGarland(): PixelImage {
  const W = 32
  const img = new PixelImage(W, 16)
  const sag = (x: number) => 1 + Math.round(5 * Math.sin((Math.PI * x) / (W - 1)))
  for (let x = 0; x < W; x++) setKey(img, x, sag(x), 'b')
  setKey(img, 0, 0, 'X')
  setKey(img, W - 1, 0, 'X')
  for (const x of [7, 13, 18, 24]) setKey(img, x, sag(x), 'n')
  const leaves: [number, LeafTone][] = [
    [4, 'red'],
    [10, 'orange'],
    [16, 'yellow'],
    [21, 'red'],
    [27, 'orange'],
  ]
  for (const [cx, tone] of leaves) {
    const { light: L, dark: D } = LEAF[tone]
    // 끈에 매달린 단풍잎: 위 두 갈래 + 가운데 넓은 잎 + 아래 뾰족한 끝
    const f = outlined(art([`${L}.${L}`, `${L}${L}${L}`, `${L}${L}${D}`, `.${D}.`]))
    img.blit(f, cx - 2, sag(cx) - 1)
  }
  return img
}

// ---------------------------------------------------------------------------
// 목록
// ---------------------------------------------------------------------------

export function buildDecorItems(): DecorItem[] {
  return [
    {
      season: 'spring',
      item: 'blossom_pot',
      place: 'floor',
      frames: [floorItem(16, 32, BLOSSOM_POT)],
      note: '벚꽃 화분(바닥)',
    },
    {
      season: 'spring',
      item: 'garland',
      place: 'hang',
      frames: [garland()],
      note: '꽃 가랜드(벽 위, 양 끝 핀이 맨 윗줄)',
    },
    {
      season: 'summer',
      item: 'fan',
      place: 'floor',
      frames: [floorItem(16, 32, fan([-90, 30, 150])), floorItem(16, 32, fan([-30, 90, 210]))],
      frameMs: 120,
      note: '선풍기(바닥, 날개 회전 2프레임)',
    },
    {
      season: 'summer',
      item: 'watermelon',
      place: 'floor',
      frames: [floorItem(16, 16, watermelon())],
      note: '수박 조각(책상·테이블 위나 바닥)',
    },
    {
      season: 'summer',
      item: 'sunflower_pot',
      place: 'floor',
      frames: [floorItem(16, 32, sunflowerPot())],
      note: '해바라기 화분(바닥)',
    },
    {
      season: 'halloween',
      item: 'pumpkin',
      place: 'floor',
      frames: [floorItem(16, 16, pumpkin(true)), floorItem(16, 16, pumpkin(false))],
      frameMs: 400,
      note: '호박 등불(바닥, 불빛 깜빡임 2프레임)',
    },
    {
      season: 'halloween',
      item: 'bat',
      place: 'hang',
      frames: [bat(BAT_UP), bat(BAT_DOWN)],
      frameMs: 180,
      note: '박쥐(천장·벽 위에 실로 매달림, 날갯짓 2프레임)',
    },
    {
      season: 'halloween',
      item: 'cobweb',
      place: 'corner',
      frames: [cobweb()],
      note: '거미줄(왼쪽 위 모서리. 오른쪽 모서리는 좌우 반전)',
    },
    {
      season: 'christmas',
      item: 'tree',
      place: 'floor',
      frames: [floorItem(32, 48, tree(0)), floorItem(32, 48, tree(1))],
      frameMs: 600,
      note: '트리(바닥, 전구 깜빡임 2프레임)',
    },
    {
      season: 'christmas',
      item: 'gift',
      place: 'floor',
      frames: [floorItem(16, 16, GIFT)],
      note: '선물 상자(바닥)',
    },
    {
      season: 'christmas',
      item: 'wreath',
      place: 'hang',
      frames: [hangItem(16, 16, rowsOf(wreath()))],
      note: '리스(벽, 맨 윗줄이 거는 점)',
    },
    // 가을은 나중에 추가해 시트 맨 끝에 둔다(기존 프레임 좌표가 그대로 남는다)
    {
      season: 'autumn',
      item: 'maple_pot',
      place: 'floor',
      frames: [floorItem(16, 32, maplePot())],
      note: '단풍나무 화분(바닥)',
    },
    {
      season: 'autumn',
      item: 'leaves',
      place: 'floor',
      frames: [floorItem(16, 16, leafPile())],
      note: '낙엽 더미(바닥)',
    },
    {
      season: 'autumn',
      item: 'garland',
      place: 'hang',
      frames: [mapleGarland()],
      note: '단풍잎 가랜드(벽 위, 양 끝 핀이 맨 윗줄)',
    },
  ]
}

export const decorKey = (d: Pick<DecorItem, 'season' | 'item'>) => `deco_${d.season}_${d.item}`

/** 시트에 넣을 프레임(이름 순서 = 목록 순서, 결정적) */
export function buildDecorFrames(items: DecorItem[] = buildDecorItems()): OfficeFrame[] {
  return items.flatMap((d) =>
    d.frames.map((image, i) => ({
      name: `${decorKey(d)}_${i}`,
      image,
      anchor: PLACE_ANCHOR[d.place],
      note: d.note,
    })),
  )
}

export function decorAnimations(items: DecorItem[] = buildDecorItems()): Record<string, string[]> {
  return Object.fromEntries(
    items
      .filter((d) => d.frames.length > 1)
      .map((d) => [decorKey(d), d.frames.map((_, i) => `${decorKey(d)}_${i}`)]),
  )
}
