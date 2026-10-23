import { PixelImage } from '../canvas'
import type { ColorName } from '../palette'
import {
  art,
  bottomCenter,
  copyRect,
  FLOOR_ANCHOR,
  type OfficeFrame,
  outlined,
  paint,
  TILE,
  TILE_ANCHOR,
} from './draw'

/*
 * 나머지 방(office 시트에 함께 들어감): 자료실·서버실·회의실·휴게실 바닥과 가구, 창가 지구본·전화,
 * 출입문(열림/닫힘), 방 사이 칸막이·출입구·바깥 벽.
 *
 * 그림체는 업무 공간(office.ts)과 같다: 3/4 시점(윗면 + 앞면), 좌상단 광원, 1px 남색 외곽선, 밤색 나무.
 * 칸막이 벽은 업무 공간의 세로 띠(x 5..10)·가로 벽(윗면 4px + 벽지 앞면)과 같은 모양이고,
 * 방 경계 칸은 양쪽 바닥 반쪽을 합성한 불투명 타일이라 바닥 위에 따로 깔 필요가 없다.
 *
 * 이름 규칙: 바닥 tile_floor_{kind}_{n}, 칸막이 tile_wall_{모양}_{왼쪽}_{오른쪽}_0
 *   (kind/왼쪽/오른쪽 = work·wood·carpet·metal·tile·out — out 은 건물 바깥)
 * 가구 furn_{name}, 애니메이션 프레임 furn_{name}_{n}, json animations 키는 furn_{name}.
 */

export type RoomFloor = 'wood' | 'carpet' | 'metal' | 'tile'
export type FloorKind = 'work' | RoomFloor
export type Side = FloorKind | 'out'

/** 벽이 바닥에 드리우는 그림자 색(바닥마다) */
const SHADOW: Record<FloorKind, ColorName> = {
  work: 'creamShade',
  wood: 'yellowDark',
  carpet: 'carpetDark',
  metal: 'steelDark',
  tile: 'grayLight',
}

/** 단순 결정적 난수(Park–Miller). 같은 시드 → 같은 그림 */
function rng(seed: number): (n: number) => number {
  let s = seed
  return (n) => {
    s = (s * 16807) % 2147483647
    return s % n
  }
}

// ---------------------------------------------------------------------------
// 바닥 (16×16, 불투명)
// ---------------------------------------------------------------------------

/**
 * 자료실 마루: 가로 널판 4줄(4px). 이음매는 타일당 두 줄에만(긴 널판이라 벽돌처럼 보이지 않게),
 * 결은 널판 가운데 줄의 짧은 밝은 선. -1 = 그 줄은 이음매 없음
 */
function woodFloor(v: number): PixelImage {
  const t = new PixelImage(TILE, TILE)
  paint(t, 0, 0, 16, 16, 'woodLight')
  const joints = v === 0 ? [6, -1, 13, -1] : [-1, 3, -1, 10]
  const grain = v === 0 ? [11, 2, 3, 8] : [5, 10, 12, 1]
  joints.forEach((jx, k) => {
    const y = k * 4
    paint(t, 0, y + 3, 16, 1, 'yellowDark')
    if (jx >= 0) paint(t, jx, y, 1, 3, 'yellowDark')
    const gx = grain[k] ?? 0
    paint(t, gx, y + 1, 3, 1, 'creamShade')
  })
  if (v === 1) paint(t, 7, 9, 1, 1, 'chestnut') // 옹이
  return t
}

/** 휴게실 카펫: 장밋빛 바탕 + 엇갈린 점 무늬 */
function carpetFloor(v: number): PixelImage {
  const t = new PixelImage(TILE, TILE)
  paint(t, 0, 0, 16, 16, 'carpet')
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++)
      if ((x % 8 === 1 && y % 8 === 1) || (x % 8 === 5 && y % 8 === 5))
        paint(t, x, y, 1, 1, 'carpetDark')
  if (v === 1) {
    paint(t, 10, 2, 1, 1, 'pink')
    paint(t, 3, 11, 1, 1, 'pink')
    paint(t, 13, 13, 1, 1, 'carpetDark')
  }
  return t
}

/** 서버실 철판: 밝은 위·왼쪽 모서리, 어두운 줄눈, 리벳. v1 은 바닥 환기구 */
function metalFloor(v: number): PixelImage {
  const t = new PixelImage(TILE, TILE)
  paint(t, 0, 0, 16, 16, 'steel')
  paint(t, 0, 0, 16, 1, 'gray')
  paint(t, 0, 0, 1, 16, 'gray')
  paint(t, 0, 15, 16, 1, 'steelDark')
  paint(t, 15, 0, 1, 16, 'steelDark')
  for (const [x, y] of [
    [2, 2],
    [12, 2],
    [2, 12],
    [12, 12],
  ] as const) {
    paint(t, x, y, 1, 1, 'grayLight')
    paint(t, x + 1, y + 1, 1, 1, 'steelDark')
  }
  if (v === 1) {
    paint(t, 4, 5, 8, 6, 'steelDark')
    for (const y of [6, 8]) paint(t, 5, y, 6, 1, 'inkDark')
    paint(t, 4, 5, 8, 1, 'inkDark')
    paint(t, 4, 11, 8, 1, 'gray')
    paint(t, 12, 5, 1, 7, 'gray')
  }
  return t
}

/** 회의실 타일: 흰 8px 타일 + 회색 줄눈. v1 은 반짝임 */
function tileFloor(v: number): PixelImage {
  const t = new PixelImage(TILE, TILE)
  paint(t, 0, 0, 16, 16, 'white')
  for (const k of [7, 15]) {
    paint(t, k, 0, 1, 16, 'grayLight')
    paint(t, 0, k, 16, 1, 'grayLight')
  }
  if (v === 1) {
    paint(t, 1, 1, 2, 1, 'sky')
    paint(t, 1, 2, 1, 1, 'sky')
    paint(t, 10, 9, 1, 1, 'sky')
  }
  return t
}

const FLOOR_FN: Record<RoomFloor, (v: number) => PixelImage> = {
  wood: woodFloor,
  carpet: carpetFloor,
  metal: metalFloor,
  tile: tileFloor,
}

// ---------------------------------------------------------------------------
// 벽 (칸막이·바깥 벽). 업무 공간 office.ts 의 칸막이와 같은 색 줄
// ---------------------------------------------------------------------------

interface Ctx {
  workFloor: PixelImage
  wallTop: PixelImage
  wallBody: PixelImage
}

function sideImage(s: Side, ctx: Ctx): PixelImage {
  if (s === 'work') return ctx.workFloor
  if (s === 'out') {
    const t = new PixelImage(TILE, TILE)
    paint(t, 0, 0, 16, 16, 'inkDark')
    return t
  }
  return FLOOR_FN[s](0)
}

/** 왼쪽 8px = left 바닥, 오른쪽 8px = right 바닥 */
function halves(left: Side, right: Side, ctx: Ctx): PixelImage {
  const t = new PixelImage(TILE, TILE)
  copyRect(t, sideImage(left, ctx), 0, 0, 8, 16, 0, 0)
  copyRect(t, sideImage(right, ctx), 8, 0, 8, 16, 8, 0)
  return t
}

/** 세로 벽 윗면 띠(x 5..10): 외곽선 · 하이라이트 · 나무 · 그늘 · 외곽선 */
function strip(t: PixelImage, y0: number, h: number) {
  paint(t, 5, y0, 1, h, 'outline')
  paint(t, 6, y0, 1, h, 'yellowDark')
  paint(t, 7, y0, 2, h, 'chestnut')
  paint(t, 9, y0, 1, h, 'chestnutDark')
  paint(t, 10, y0, 1, h, 'outline')
}

/** 가로 벽 줄(x0..x0+w-1): 윗면 4px + 벽지 앞면 + 걸레받이 + 바닥 그림자 */
function hRows(t: PixelImage, x0: number, w: number, shadow: ColorName) {
  paint(t, x0, 0, w, 1, 'outline')
  paint(t, x0, 1, w, 1, 'yellowDark')
  paint(t, x0, 2, w, 1, 'chestnut')
  paint(t, x0, 3, w, 1, 'chestnutDark')
  paint(t, x0, 4, w, 1, 'outline')
  paint(t, x0, 5, w, 8, 'skin')
  for (const sx of [3, 11]) if (sx >= x0 && sx < x0 + w) paint(t, sx, 5, 1, 8, 'skinShade')
  paint(t, x0, 13, w, 2, 'brownDark')
  paint(t, x0, 15, w, 1, shadow)
}

const shadowOf = (s: Side): ColorName | null => (s === 'out' ? null : SHADOW[s])

/** 세로 칸막이. mode: mid(이어짐) · end(아래가 출입구 — 마구리) · top(위가 출입구 — 띠 시작) */
function vWall(left: Side, right: Side, mode: 'mid' | 'end' | 'top', ctx: Ctx): PixelImage {
  const t = halves(left, right, ctx)
  if (mode === 'end') {
    strip(t, 0, 4)
    paint(t, 5, 4, 6, 1, 'outline')
    paint(t, 5, 5, 1, 10, 'outline')
    paint(t, 10, 5, 1, 10, 'outline')
    paint(t, 6, 5, 4, 8, 'skin')
    paint(t, 9, 5, 1, 8, 'skinShade')
    paint(t, 6, 13, 4, 2, 'brownDark')
    paint(t, 5, 15, 6, 1, 'outline')
  } else {
    strip(t, 0, 16)
    if (mode === 'top') paint(t, 5, 0, 6, 1, 'outline')
  }
  const sh = shadowOf(right)
  if (sh) paint(t, 11, mode === 'top' ? 1 : 0, 1, mode === 'top' ? 15 : 16, sh)
  return t
}

/** 세로 칸막이와 가로 벽이 만나는 칸. hSide = 가로 벽이 붙는 쪽. left/right = 그쪽 바닥(가로 벽 쪽은 벽 아래 바닥) */
function teeWall(hSide: 'left' | 'right', left: Side, right: Side, ctx: Ctx): PixelImage {
  const t = halves(left, right, ctx)
  if (hSide === 'left') {
    hRows(t, 0, 5, shadowOf(left) ?? 'inkDark')
    strip(t, 0, 16)
    // 가로 벽 윗면이 세로 띠 윗면으로 이어지게 왼쪽 외곽선을 연다
    paint(t, 5, 1, 1, 1, 'yellowDark')
    paint(t, 5, 2, 1, 1, 'chestnut')
    paint(t, 5, 3, 1, 1, 'chestnutDark')
    const sh = shadowOf(right)
    if (sh) paint(t, 11, 0, 1, 16, sh)
  } else {
    hRows(t, 11, 5, shadowOf(right) ?? 'inkDark')
    strip(t, 0, 16)
    paint(t, 10, 1, 1, 1, 'yellowDark')
    paint(t, 10, 2, 1, 1, 'chestnut')
    paint(t, 10, 3, 1, 1, 'chestnutDark')
  }
  return t
}

/** 가로 칸막이(아래 바닥 below 에 그림자) */
function hWall(below: FloorKind): PixelImage {
  const t = new PixelImage(TILE, TILE)
  hRows(t, 0, 16, SHADOW[below])
  return t
}

/** 칸막이 출입구: 양쪽 바닥 + 가운데 나무 문지방 */
function doorway(left: Side, right: Side, ctx: Ctx): PixelImage {
  const t = halves(left, right, ctx)
  paint(t, 6, 0, 1, 16, 'yellowDark')
  paint(t, 7, 0, 2, 16, 'chestnut')
  paint(t, 9, 0, 1, 16, 'chestnutDark')
  // 문틀 그림자(위 마구리 바로 아래)
  paint(t, 5, 0, 6, 1, 'chestnutDark')
  return t
}

/** 바깥 벽(맨 왼쪽·오른쪽 열)의 뒤 벽 2줄: 바깥(inkDark) + 세로 띠 + 뒤 벽 */
function edgeBackWall(src: PixelImage, side: 'left' | 'right', top: boolean): PixelImage {
  const t = new PixelImage(TILE, TILE)
  copyRect(t, src, 0, 0, 16, 16, 0, 0)
  paint(t, side === 'left' ? 0 : 11, 0, 5, 16, 'inkDark')
  strip(t, 0, 16)
  if (top) paint(t, 5, 0, 6, 1, 'outline')
  return t
}

/** 맨 아래 줄 양 끝 모서리: 바깥 + 위에서 내려온 세로 띠가 아래 벽으로 이어짐 */
function cornerWall(side: 'left' | 'right'): PixelImage {
  const t = new PixelImage(TILE, TILE)
  if (side === 'left') {
    paint(t, 0, 0, 5, 16, 'inkDark')
    hRows(t, 5, 11, 'creamShade')
    paint(t, 5, 0, 1, 16, 'outline')
    paint(t, 6, 0, 1, 4, 'yellowDark')
  } else {
    paint(t, 11, 0, 5, 16, 'inkDark')
    hRows(t, 0, 11, 'creamShade')
    paint(t, 10, 0, 1, 16, 'outline')
    paint(t, 9, 1, 1, 3, 'chestnutDark')
  }
  // 세로 띠가 윗면으로 들어오는 자리
  paint(t, 6, 0, 1, 1, 'yellowDark')
  paint(t, 7, 0, 2, 1, 'chestnut')
  paint(t, 9, 0, 1, 1, 'chestnutDark')
  return t
}

// ---------------------------------------------------------------------------
// 자료실: 책장 · 서류 캐비닛 · 파쇄기
// ---------------------------------------------------------------------------

const BOOKS: readonly (readonly [ColorName, ColorName])[] = [
  ['coral', 'coralDark'],
  ['blue', 'blueDark'],
  ['green', 'greenDark'],
  ['yellow', 'yellowDark'],
  ['purple', 'purpleDark'],
  ['teal', 'tealDark'],
  ['pink', 'pinkDark'],
  ['white', 'grayLight'],
  ['coral', 'coralDark'],
  ['blue', 'blueDark'],
  ['sky', 'blue'],
  ['chestnut', 'chestnutDark'],
]

/** 책장 48×48 (채움 46×40): 3칸, 책 색·높이·폭이 섞이고 가끔 눕힌 책 더미 */
function bookshelf(): PixelImage {
  const W = 46
  const H = 40
  const s = new PixelImage(W, H)
  paint(s, 0, 0, W, H, 'chestnut')
  paint(s, 0, 0, W, 1, 'yellowDark')
  paint(s, 0, 2, W, 1, 'chestnutDark')
  paint(s, 0, 0, 1, H, 'yellowDark')
  paint(s, W - 2, 1, 1, H - 1, 'chestnutDark')
  paint(s, W - 1, 1, 1, H - 1, 'brownDark')
  const rnd = rng(20261023)
  for (let c = 0; c < 3; c++) {
    const top = 3 + c * 11
    const bottom = top + 8
    paint(s, 2, top, W - 4, 9, 'brownDark')
    paint(s, 2, top, W - 4, 1, 'outline') // 위 선반 그늘
    // 선반 판(앞면 하이라이트 + 아래 그늘)
    paint(s, 1, bottom + 1, W - 2, 1, 'yellowDark')
    paint(s, 1, bottom + 2, W - 3, 1, 'chestnutDark')
    let x = 2
    while (x <= W - 4) {
      const r = rnd(12)
      if (r === 0) {
        x += 2 // 빈틈
        continue
      }
      if (r === 1 && x <= W - 12) {
        // 눕힌 책 3권
        for (let k = 0; k < 3; k++) {
          const [c1, c2] = BOOKS[rnd(BOOKS.length)] ?? ['coral', 'coralDark']
          const w = 7 - (k % 2)
          paint(s, x + (k % 2), bottom - 1 - k * 2, w, 1, c1)
          paint(s, x + (k % 2), bottom - k * 2, w, 1, c2)
        }
        x += 8
        continue
      }
      const w = rnd(3) === 0 ? 3 : 2
      if (x + w - 1 > W - 3) break
      const h = 5 + rnd(4)
      const [c1, c2] = BOOKS[rnd(BOOKS.length)] ?? ['coral', 'coralDark']
      paint(s, x, bottom - h + 1, w, h, c1)
      paint(s, x + w - 1, bottom - h + 1, 1, h, c2)
      if (rnd(2) === 0) paint(s, x, bottom - h + 3, w - 1, 1, c1 === 'yellow' ? 'white' : 'yellow')
      x += w
    }
  }
  // 받침
  paint(s, 1, 36, W - 2, 1, 'yellowDark')
  paint(s, 1, 37, W - 3, 2, 'chestnut')
  paint(s, 1, 39, W - 2, 1, 'chestnutDark')
  return bottomCenter(48, 48, outlined(s))
}

/** 캐비닛 한 대(채움 14×28): 회색 철제, 서랍 3칸(이름표 + 손잡이). open = 가운데 서랍이 열림 */
function cabinetUnit(open: boolean, sticker: boolean): PixelImage {
  const u = new PixelImage(14, 28)
  paint(u, 0, 0, 14, 28, 'grayLight')
  paint(u, 0, 0, 14, 1, 'white')
  paint(u, 0, 3, 14, 1, 'white')
  paint(u, 0, 4, 1, 21, 'white')
  paint(u, 13, 3, 1, 22, 'gray')
  const drawer = (y: number) => {
    paint(u, 1, y, 12, 1, 'gray')
    paint(u, 5, y + 2, 4, 2, 'white')
    paint(u, 5, y + 3, 4, 1, 'grayLight')
    paint(u, 4, y + 5, 6, 1, 'gray')
    paint(u, 4, y + 6, 6, 1, 'steel')
  }
  drawer(4)
  drawer(18)
  if (open) {
    // 서랍 안(서류철 탭)이 보이고 서랍 앞판이 3px 앞으로 나옴
    paint(u, 1, 11, 12, 4, 'inkDark')
    paint(u, 2, 12, 2, 3, 'yellow')
    paint(u, 5, 12, 2, 3, 'sky')
    paint(u, 8, 13, 2, 2, 'coral')
    paint(u, 11, 12, 1, 3, 'white')
    paint(u, 0, 15, 14, 7, 'grayLight')
    paint(u, 0, 15, 14, 1, 'white')
    paint(u, 5, 17, 4, 2, 'white')
    paint(u, 5, 18, 4, 1, 'grayLight')
    paint(u, 4, 20, 6, 1, 'gray')
    paint(u, 4, 21, 6, 1, 'steel')
    paint(u, 13, 15, 1, 7, 'gray')
    paint(u, 0, 22, 14, 1, 'steel') // 앞판 아래 그림자
  } else {
    drawer(11)
  }
  if (sticker) {
    paint(u, 10, 6, 2, 2, 'coral')
    paint(u, 2, 20, 2, 2, 'sky')
  }
  paint(u, 0, 25, 14, 1, 'gray')
  paint(u, 0, 26, 14, 2, 'steel')
  return u
}

/** 서류 캐비닛 두 대 32×32 + 오른쪽 위 서류 상자 */
function cabinet(open: boolean): PixelImage {
  const f = new PixelImage(32, 32)
  f.blit(outlined(cabinetUnit(open, false)), 0, 2)
  f.blit(outlined(cabinetUnit(false, true)), 16, 2)
  const box = new PixelImage(9, 4)
  paint(box, 0, 0, 9, 4, 'chestnut')
  paint(box, 0, 0, 9, 1, 'yellowDark')
  paint(box, 8, 1, 1, 3, 'chestnutDark')
  paint(box, 3, 1, 3, 2, 'cream')
  paint(box, 1, 0, 2, 1, 'yellow')
  paint(box, 5, 0, 2, 1, 'sky')
  f.blit(outlined(box), 19, 0)
  return f
}

/** 파쇄기 16×16 (채움 12×13: 위 2줄 = 들어가는 종이). state: idle | 작동 프레임 0·1 */
function shredder(state: 'idle' | 0 | 1): PixelImage {
  // 위: 짙은 머리(투입구 + LED), 아래: 회색 통 + 하늘색 투명 창(종이 조각이 보임)
  const s = art([
    '............',
    '............',
    'iiiiiiiiiiiI',
    'iIooooooooiI',
    'iiiiiiiiiXiI',
    'GGGGGGGGGGGX',
    'WkkkkkkkkkWG',
    'WkkkkkkkkkWG',
    'WkkkkkkkkkWG',
    'WkkkkkkkkkWG',
    'WWWWWWWWWWWG',
    'WWWWWWWWWWWG',
    'GGGGGGGGGGGX',
  ])
  const shred = (x: number, y: number, c: ColorName) => paint(s, x, y, 1, 1, c)
  // 통 안에 쌓인 종이 조각
  for (let x = 1; x <= 9; x++) shred(x, 9, x % 3 === 0 ? 'grayLight' : 'white')
  for (const x of [2, 4, 5, 8]) shred(x, 8, 'white')
  if (state !== 'idle') {
    paint(s, 9, 4, 1, 1, 'green') // 작동 LED
    // 들어가는 종이(점점 짧아짐) + 떨어지는 조각
    const h = state === 0 ? 2 : 1
    paint(s, 3, 2 - h, 6, h + 1, 'white')
    paint(s, 4, 2 - h, 4, 1, 'grayLight')
    if (state === 0) {
      shred(3, 6, 'white')
      shred(6, 7, 'white')
    } else {
      shred(4, 7, 'white')
      shred(7, 6, 'white')
      shred(6, 8, 'white')
    }
  }
  return bottomCenter(16, 16, outlined(s))
}

// ---------------------------------------------------------------------------
// 서버실: 서버랙(LED 3프레임) · 터미널 책상 · 바닥 케이블
// ---------------------------------------------------------------------------

/** LED 켜짐 패턴 [프레임][서버 칸][LED 0..2] */
const RACK_LEDS: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [1, 1, 0],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 0],
  ],
  [
    [1, 0, 1],
    [1, 1, 0],
    [1, 1, 1],
    [0, 1, 1],
  ],
  [
    [0, 1, 1],
    [1, 1, 1],
    [1, 0, 0],
    [1, 0, 1],
  ],
]

/** 서버랙 16×32 (채움 14×30): 짙은 몸체, 1U 서버 4칸, 칸마다 LED 3개(초록·노랑·하늘/빨강) */
function serverRack(frame: number): PixelImage {
  const r = new PixelImage(14, 30)
  paint(r, 0, 0, 14, 28, 'ink')
  paint(r, 0, 0, 14, 1, 'gray')
  paint(r, 0, 1, 14, 2, 'steel')
  paint(r, 0, 3, 14, 1, 'steelDark')
  paint(r, 0, 3, 1, 25, 'steel')
  paint(r, 13, 3, 1, 25, 'inkDark')
  paint(r, 1, 4, 12, 23, 'inkDark')
  const leds = RACK_LEDS[frame % RACK_LEDS.length] ?? []
  for (let k = 0; k < 4; k++) {
    const y = 5 + k * 5
    paint(r, 2, y, 10, 1, 'steel')
    paint(r, 2, y + 1, 10, 2, 'ink')
    paint(r, 2, y + 3, 10, 1, 'steelDark')
    for (const vx of [7, 8, 9]) paint(r, vx, y + 2, 1, 1, vx % 2 ? 'inkDark' : 'steelDark')
    const on = leds[k] ?? [0, 0, 0]
    paint(r, 3, y + 1, 1, 1, on[0] ? 'green' : 'outline')
    paint(r, 5, y + 1, 1, 1, on[1] ? (k % 2 ? 'yellow' : 'green') : 'outline')
    paint(r, 11, y + 1, 1, 1, on[2] ? (k === 1 ? 'coral' : 'sky') : 'outline')
  }
  // 아래 환기 칸 + 받침
  for (let x = 2; x < 12; x += 2) paint(r, x, 25, 1, 1, 'steelDark')
  paint(r, 0, 27, 14, 1, 'steelDark')
  paint(r, 1, 28, 2, 2, 'steelDark')
  paint(r, 11, 28, 2, 2, 'steelDark')
  return outlined(r)
}

/** 터미널 화면 줄(길이, 색) — busy 프레임은 한 줄씩 위로 흐른다 */
const TERM_LINES: readonly (readonly [number, ColorName])[] = [
  [6, 'green'],
  [9, 'green'],
  [4, 'yellow'],
  [8, 'green'],
  [5, 'green'],
  [9, 'sky'],
  [3, 'green'],
  [7, 'green'],
]

const IDLE_BARS = [2, 3, 2, 4] as const
const BUSY_BARS = [
  [3, 2, 4, 3],
  [4, 3, 2, 4],
  [2, 4, 3, 2],
] as const

/** 터미널 책상 32×32: 금속 책상 + 큰 모니터(초록 글자, 오른쪽 = 서 있는 자리 앞) + 작은 그래프 모니터 + 키보드 */
function terminal(state: 'idle' | number): PixelImage {
  const f = new PixelImage(32, 32)
  const d = new PixelImage(30, 12)
  paint(d, 0, 0, 30, 10, 'gray')
  paint(d, 0, 0, 30, 1, 'grayLight')
  paint(d, 0, 4, 30, 1, 'grayLight')
  paint(d, 0, 5, 30, 5, 'steel')
  paint(d, 28, 5, 2, 5, 'steelDark')
  for (const y of [6, 8]) paint(d, 3, y, 8, 1, 'steelDark')
  paint(d, 1, 10, 2, 2, 'steelDark')
  paint(d, 26, 10, 2, 2, 'steelDark')
  f.blit(outlined(d), 0, 18)

  // 큰 모니터(채움 14×12)
  const m = new PixelImage(14, 12)
  paint(m, 0, 0, 14, 10, 'ink')
  paint(m, 0, 0, 14, 1, 'steel')
  paint(m, 1, 1, 12, 8, 'inkDark')
  paint(m, 5, 10, 4, 1, 'ink')
  paint(m, 3, 11, 8, 1, 'steel')
  if (state === 'idle') {
    paint(m, 2, 2, 1, 1, 'green')
    paint(m, 4, 2, 4, 1, 'green')
    paint(m, 2, 4, 1, 1, 'green')
    paint(m, 4, 4, 2, 1, 'white') // 커서
  } else {
    for (let i = 0; i < 3; i++) {
      const [len, c] = TERM_LINES[(state + i) % TERM_LINES.length] ?? [4, 'green']
      paint(m, 2, 2 + i * 2, len, 1, c)
    }
    paint(m, 2, 8, 1, 1, 'green')
    if (state % 2 === 0) paint(m, 4, 8, 2, 1, 'white')
  }
  f.blit(outlined(m), 16, 7)

  // 작은 모니터(채움 10×9): 하늘색 막대그래프
  const g = new PixelImage(10, 9)
  paint(g, 0, 0, 10, 7, 'ink')
  paint(g, 0, 0, 10, 1, 'steel')
  paint(g, 1, 1, 8, 5, 'inkDark')
  const bars = state === 'idle' ? IDLE_BARS : (BUSY_BARS[state % BUSY_BARS.length] ?? IDLE_BARS)
  bars.forEach((h, i) => {
    paint(g, 2 + i * 2, 6 - h, 1, h, i === 2 ? 'teal' : 'sky')
  })
  paint(g, 4, 7, 2, 1, 'ink')
  paint(g, 2, 8, 6, 1, 'steel')
  f.blit(outlined(g), 2, 10)

  // 키보드(큰 모니터 앞)
  paint(f, 18, 20, 12, 1, 'steelDark')
  paint(f, 18, 21, 12, 1, 'ink')
  for (let x = 19; x < 29; x += 2) paint(f, x, 20, 1, 1, 'gray')
  return f
}

/** 바닥 케이블 64×48 (layout cables 4×3 칸): 랙 아래 → 터미널·아래 랙. 2px(색 + 그늘) */
function cables(): PixelImage {
  const f = new PixelImage(64, 48)
  const v = (x: number, y0: number, y1: number, c: ColorName, d: ColorName) => {
    paint(f, x, y0, 1, y1 - y0 + 1, c)
    paint(f, x + 1, y0, 1, y1 - y0 + 1, d)
  }
  const h = (x0: number, x1: number, y: number, c: ColorName, d: ColorName) => {
    paint(f, x0, y, x1 - x0 + 1, 1, c)
    paint(f, x0, y + 1, x1 - x0 + 1, 1, d)
  }
  // 파랑: 가운데 랙 → 터미널 왼쪽
  v(38, 0, 26, 'blue', 'blueDark')
  h(2, 39, 26, 'blue', 'blueDark')
  v(2, 0, 27, 'blue', 'blueDark')
  // 남색: 왼쪽 랙 → 터미널
  v(22, 0, 8, 'ink', 'inkDark')
  h(12, 23, 8, 'ink', 'inkDark')
  v(12, 0, 9, 'ink', 'inkDark')
  // 노랑: 오른쪽 랙 → 아래 랙
  v(56, 0, 19, 'yellow', 'yellowDark')
  // 빨강: 가운데 랙 → 아래 랙 옆면
  v(42, 0, 36, 'coral', 'coralDark')
  h(42, 49, 36, 'coral', 'coralDark')
  return f
}

// ---------------------------------------------------------------------------
// 회의실: 화이트보드(빈 것·글씨) · 회의 테이블 · 회의 의자
// ---------------------------------------------------------------------------

/** 스탠드 화이트보드 48×48 (채움 44×35): 알루미늄 테, 펜 받침, 다리 + 바퀴 */
function whiteboard(written: boolean): PixelImage {
  const b = new PixelImage(44, 35)
  paint(b, 0, 0, 44, 18, 'grayLight')
  paint(b, 0, 0, 44, 1, 'white')
  paint(b, 0, 0, 1, 18, 'white')
  paint(b, 43, 1, 1, 17, 'gray')
  paint(b, 1, 17, 43, 1, 'gray')
  paint(b, 2, 2, 40, 14, 'white')
  // 펜 받침 + 마커·지우개
  paint(b, 1, 18, 42, 1, 'grayLight')
  paint(b, 1, 19, 42, 1, 'gray')
  paint(b, 5, 17, 4, 1, 'coral')
  paint(b, 10, 17, 4, 1, 'blue')
  paint(b, 15, 17, 3, 1, 'green')
  paint(b, 33, 16, 5, 1, 'grayLight')
  paint(b, 33, 17, 5, 1, 'ink')
  // 다리 + 가로대 + 바퀴
  for (const lx of [5, 37]) {
    paint(b, lx, 20, 1, 13, 'gray')
    paint(b, lx + 1, 20, 1, 13, 'steel')
    paint(b, lx - 1, 33, 4, 2, 'inkDark')
  }
  paint(b, 7, 28, 30, 1, 'steel')
  if (written) {
    // 왼쪽: 제목 + 체크 목록, 오른쪽: 상자 → 상자 도식 + 메모지
    paint(b, 4, 3, 12, 1, 'blue')
    paint(b, 4, 4, 12, 1, 'blueDark')
    const rows = [
      [6, 12, true],
      [9, 9, true],
      [12, 13, false],
    ] as const
    for (const [y, len, done] of rows) {
      paint(b, 4, y, 2, 2, done ? 'green' : 'blue')
      if (done) paint(b, 4, y, 1, 1, 'white')
      for (let x = 0; x < len; x++) if (x % 5 !== 4) paint(b, 8 + x, y + 1, 1, 1, 'blue')
    }
    const box = (x: number, y: number, w: number, h: number, c: ColorName) => {
      paint(b, x, y, w, 1, c)
      paint(b, x, y + h - 1, w, 1, c)
      paint(b, x, y, 1, h, c)
      paint(b, x + w - 1, y, 1, h, c)
    }
    box(23, 3, 7, 5, 'coral')
    box(34, 3, 6, 5, 'coral')
    paint(b, 30, 5, 3, 1, 'ink')
    paint(b, 32, 4, 1, 3, 'ink')
    paint(b, 25, 5, 3, 1, 'coralDark')
    paint(b, 24, 10, 5, 5, 'yellow')
    paint(b, 24, 14, 5, 1, 'yellowDark')
    paint(b, 25, 11, 3, 1, 'yellowDark')
    paint(b, 31, 10, 5, 5, 'pink')
    paint(b, 31, 14, 5, 1, 'pinkDark')
    paint(b, 32, 11, 3, 1, 'pinkDark')
    paint(b, 38, 11, 3, 1, 'green')
    paint(b, 37, 12, 2, 1, 'green')
  } else {
    // 지운 자국
    paint(b, 9, 7, 9, 1, 'grayLight')
    paint(b, 12, 8, 7, 1, 'grayLight')
    paint(b, 27, 11, 6, 1, 'grayLight')
  }
  return bottomCenter(48, 48, outlined(b))
}

const LAPTOP = [
  'iiiiiiiii',
  'ikkkkkkki',
  'ikwkkkkki',
  'ikkkkkkki',
  'ikkkkkkki',
  'iiiiiiiii',
  'WWWWWWWWW',
  'GGGGGGGGG',
]

const TABLE_PLANT = ['.g.g.', 'gEgEg', '.EgE.', '.ttt.', '.TTT.']

/** 회의 테이블 64×32 (채움 62×16): 긴 나무 테이블 + 위에 서류·노트북·노트·머그·작은 화분 */
function meetingTable(): PixelImage {
  const f = new PixelImage(64, 32)
  const t = new PixelImage(62, 16)
  paint(t, 0, 0, 62, 12, 'chestnut')
  paint(t, 0, 0, 62, 1, 'yellowDark')
  paint(t, 0, 1, 1, 7, 'yellowDark')
  paint(t, 0, 8, 62, 1, 'yellowDark')
  paint(t, 0, 9, 62, 3, 'chestnutDark')
  paint(t, 60, 9, 2, 3, 'brownDark')
  paint(t, 1, 12, 3, 4, 'brownDark')
  paint(t, 58, 12, 3, 4, 'brownDark')
  f.blit(outlined(t), 0, 14)
  // 서류(왼쪽 자리 앞)
  paint(f, 6, 17, 7, 4, 'white')
  paint(f, 7, 18, 4, 1, 'grayLight')
  paint(f, 7, 20, 5, 1, 'grayLight')
  paint(f, 12, 17, 1, 4, 'grayLight')
  // 노트북(가운데 자리 앞, 화면이 앉은 사람·화면 쪽을 향함)
  f.blit(outlined(art(LAPTOP)), 19, 12)
  // 노트 + 펜(오른쪽 자리 앞)
  paint(f, 35, 17, 6, 4, 'yellow')
  paint(f, 35, 20, 6, 1, 'yellowDark')
  paint(f, 36, 18, 4, 1, 'yellowDark')
  paint(f, 42, 17, 1, 3, 'blue')
  // 머그 2개
  for (const mx of [46, 50]) {
    paint(f, mx, 17, 3, 3, 'white')
    paint(f, mx, 18, 3, 1, mx === 46 ? 'coral' : 'teal')
    paint(f, mx + 3, 18, 1, 1, 'grayLight')
  }
  f.blit(outlined(art(TABLE_PLANT)), 54, 14)
  return f
}

/**
 * 회의 의자 뒷모습(앉은 사람 앞에 겹침) 채움 11×10 — 직원 의자보다 좁다(자리 간격 14px 에 2px 틈), 청록
 */
const CHAIR_MEETING = [
  '.ttttttttt.',
  'tktttttttTT',
  'tktttttttTT',
  'tttttttttTT',
  'tttttttttTT',
  '.TTTTTTTTT.',
  '.....G.....',
  '.....G.....',
  '..GGGGGGG..',
  '.WG.....GW.',
]

// ---------------------------------------------------------------------------
// 휴게실: 커피머신(추출 2프레임) · 소파 · 작은 테이블 · 러그
// ---------------------------------------------------------------------------

/** 커피머신 16×32 (채움 14×28): 나무 수납장 위 에스프레소 머신. state: idle | 추출 0·1 */
function coffeeMachine(state: 'idle' | 0 | 1): PixelImage {
  const c = new PixelImage(14, 28)
  // 수납장
  paint(c, 0, 14, 14, 12, 'chestnutDark')
  paint(c, 0, 14, 14, 1, 'yellowDark')
  paint(c, 0, 15, 14, 2, 'chestnut')
  paint(c, 0, 17, 14, 1, 'yellowDark')
  paint(c, 13, 18, 1, 8, 'brownDark')
  paint(c, 2, 19, 9, 6, 'chestnut')
  paint(c, 2, 19, 9, 1, 'yellowDark')
  paint(c, 2, 24, 9, 1, 'chestnutDark')
  paint(c, 9, 21, 1, 2, 'yellow')
  paint(c, 1, 26, 2, 2, 'brownDark')
  paint(c, 11, 26, 2, 2, 'brownDark')
  // 머신 몸체(수납장 윗면에 놓임)
  paint(c, 1, 3, 12, 13, 'ink')
  paint(c, 1, 3, 12, 1, 'steel')
  paint(c, 12, 4, 1, 12, 'inkDark')
  // 물통(왼쪽 위)
  paint(c, 2, 0, 4, 3, 'sky')
  paint(c, 2, 0, 1, 3, 'white')
  paint(c, 2, 0, 4, 1, 'steel')
  // 버튼 판
  paint(c, 7, 4, 5, 3, 'grayLight')
  paint(c, 8, 5, 1, 1, 'coral')
  paint(c, 10, 5, 1, 1, state === 'idle' ? 'gray' : 'green')
  // 추출구 + 컵 자리
  paint(c, 4, 7, 5, 1, 'gray')
  paint(c, 5, 8, 3, 1, 'steel')
  paint(c, 3, 9, 8, 5, 'inkDark')
  paint(c, 5, 11, 4, 3, 'white')
  paint(c, 9, 12, 1, 1, 'white')
  paint(c, 6, 11, 2, 1, state === 'idle' ? 'grayLight' : 'brown')
  paint(c, 3, 14, 8, 1, 'gray')
  paint(c, 1, 15, 12, 1, 'steel')
  if (state !== 'idle') {
    // 커피 줄기(흔들림) + 머신 위 김
    if (state === 0) paint(c, 6, 9, 1, 2, 'brown')
    else {
      paint(c, 7, 9, 1, 1, 'brown')
      paint(c, 6, 10, 1, 1, 'brown')
    }
    paint(c, state === 0 ? 9 : 10, 1, 1, 1, 'white')
    paint(c, state === 0 ? 10 : 9, 0, 1, 1, 'grayLight')
  }
  return bottomCenter(16, 32, outlined(c))
}

/** 소파 48×32 (채움 46×18): 아래 벽에 붙어 방 쪽(위)을 향함 → 앉는 면(위)과 등받이 뒤판(아래)이 보인다 */
function sofa(): PixelImage {
  const s = new PixelImage(46, 18)
  // 팔걸이(양 끝, 앞에서 뒤까지)
  for (const ax of [0, 40]) {
    paint(s, ax, 0, 6, 9, 'blue')
    paint(s, ax, 0, 6, 1, 'sky')
    paint(s, ax, 9, 6, 7, 'blueDark')
  }
  paint(s, 0, 1, 1, 15, 'sky')
  paint(s, 45, 1, 1, 15, 'ink')
  // 앉는 쿠션 2개
  paint(s, 6, 1, 34, 7, 'blueDark')
  paint(s, 6, 1, 16, 6, 'blue')
  paint(s, 24, 1, 16, 6, 'blue')
  paint(s, 6, 1, 16, 1, 'sky')
  paint(s, 24, 1, 16, 1, 'sky')
  // 노란 쿠션
  paint(s, 8, 2, 6, 4, 'yellow')
  paint(s, 8, 5, 6, 1, 'yellowDark')
  paint(s, 13, 2, 1, 4, 'yellowDark')
  // 등받이 윗면 + 뒤판
  paint(s, 4, 8, 38, 1, 'sky')
  paint(s, 4, 9, 38, 2, 'blue')
  paint(s, 4, 11, 38, 5, 'blueDark')
  for (const sx of [16, 29]) paint(s, sx, 11, 1, 5, 'blue')
  paint(s, 1, 15, 44, 1, 'ink')
  // 다리
  paint(s, 2, 16, 2, 2, 'brownDark')
  paint(s, 42, 16, 2, 2, 'brownDark')
  return bottomCenter(48, 32, outlined(s))
}

/** 작은 커피 테이블 32×16 (채움 26×10): 위에 머그·잡지 */
function smallTable(): PixelImage {
  const t = new PixelImage(26, 10)
  paint(t, 0, 0, 26, 6, 'chestnut')
  paint(t, 0, 0, 26, 1, 'yellowDark')
  paint(t, 0, 5, 26, 1, 'yellowDark')
  paint(t, 0, 6, 26, 1, 'chestnutDark')
  paint(t, 2, 7, 2, 3, 'brownDark')
  paint(t, 22, 7, 2, 3, 'brownDark')
  paint(t, 4, 1, 3, 3, 'white')
  paint(t, 4, 2, 3, 1, 'coral')
  paint(t, 7, 2, 1, 1, 'grayLight')
  paint(t, 13, 1, 8, 4, 'pink')
  paint(t, 13, 4, 8, 1, 'pinkDark')
  paint(t, 14, 2, 5, 1, 'white')
  return bottomCenter(32, 16, outlined(t))
}

/** 러그 48×32 (채움 46×22, 바닥 장식): 크림 바탕 + 노란 테 + 가운데 마름모 + 양끝 술 */
function rug(): PixelImage {
  const r = new PixelImage(46, 22)
  paint(r, 1, 0, 44, 22, 'cream')
  paint(r, 1, 0, 44, 1, 'yellowDark')
  paint(r, 1, 21, 44, 1, 'yellowDark')
  paint(r, 1, 0, 1, 22, 'yellowDark')
  paint(r, 44, 0, 1, 22, 'yellowDark')
  paint(r, 4, 3, 38, 1, 'yellow')
  paint(r, 4, 18, 38, 1, 'yellow')
  paint(r, 4, 3, 1, 16, 'yellow')
  paint(r, 41, 3, 1, 16, 'yellow')
  for (let k = 0; k <= 5; k++) {
    paint(r, 23 - k * 2, 5 + k, 1 + k * 4, 1, k % 2 ? 'coral' : 'carpet')
    paint(r, 23 - k * 2, 16 - k, 1 + k * 4, 1, k % 2 ? 'coral' : 'carpet')
  }
  for (let y = 1; y < 22; y += 2) {
    paint(r, 0, y, 1, 1, 'cream')
    paint(r, 45, y, 1, 1, 'cream')
  }
  return bottomCenter(48, 32, r)
}

// ---------------------------------------------------------------------------
// 업무 공간 소품(창가 지구본 · 전화), 출입문 · 현관 매트
// ---------------------------------------------------------------------------

const GLOBE_BALL = [
  '...uuuu...',
  '.kkuguuuu.',
  'kuugggguuu',
  'kuggggEguU',
  'uugggEguuU',
  'uuuggguugU',
  'uuuuguuggU',
  'uuuuuuuEgU',
  '.uuuuuuUU.',
  '...UUUU...',
]

/** 지구본 16×32 (채움 14×21): 놋쇠 고리 + 나무 받침(다리 3개) */
function globe(): PixelImage {
  const g = new PixelImage(14, 21)
  g.blit(art(GLOBE_BALL), 1, 1)
  paint(g, 11, 2, 1, 8, 'yellowDark')
  paint(g, 10, 1, 1, 1, 'yellowDark')
  paint(g, 10, 10, 1, 1, 'yellowDark')
  paint(g, 5, 0, 2, 1, 'yellowDark')
  paint(g, 5, 11, 2, 1, 'yellowDark')
  paint(g, 5, 12, 2, 4, 'chestnut')
  paint(g, 6, 12, 1, 4, 'chestnutDark')
  paint(g, 3, 16, 8, 1, 'chestnut')
  paint(g, 2, 17, 10, 1, 'chestnutDark')
  paint(g, 2, 18, 2, 2, 'chestnutDark')
  paint(g, 6, 18, 2, 3, 'brownDark')
  paint(g, 10, 18, 2, 2, 'chestnutDark')
  paint(g, 1, 20, 2, 1, 'brownDark')
  paint(g, 11, 20, 2, 1, 'brownDark')
  return bottomCenter(16, 32, outlined(g))
}

/** 다이얼 전화(위에서 본 3/4): 위 = 수화기(양끝 볼록), 아래 = 몸체 + 흰 다이얼 고리 */
const PHONE = [
  '.cc....cc.',
  'cccccccccC',
  '.CC....CC.',
  '.cccccccc.',
  'cccwwwwccC',
  'ccwwccwwcC',
  'cccwwwwccC',
  'CCCCCCCCCC',
]

/** 전화 탁자 16×32 (채움 14×22): 작은 나무 탁자 위 빨간 전화 */
function phoneTable(): PixelImage {
  const p = new PixelImage(14, 22)
  p.blit(art(PHONE), 2, 0)
  paint(p, 0, 8, 14, 1, 'yellowDark')
  paint(p, 0, 9, 14, 2, 'chestnut')
  paint(p, 0, 11, 14, 1, 'yellowDark')
  paint(p, 0, 12, 14, 3, 'chestnutDark')
  paint(p, 13, 12, 1, 3, 'brownDark')
  paint(p, 6, 13, 2, 1, 'yellow')
  paint(p, 1, 15, 2, 7, 'chestnutDark')
  paint(p, 11, 15, 2, 7, 'chestnutDark')
  paint(p, 3, 18, 8, 1, 'chestnut')
  paint(p, 3, 19, 8, 1, 'chestnutDark')
  return bottomCenter(16, 32, outlined(p))
}

/**
 * 출입문 32×16 — 아래 벽(문 2칸, 11~12열) 자리에 그대로 겹친다. 윗면(문틀 위) 4px 는 아래 벽과 같은 줄.
 * closed: 나무 문 두 짝(유리창·손잡이), ajar: 반쯤 열림, open: 양옆으로 젖혀져 바닥이 보임
 */
function door(state: 'closed' | 'ajar' | 'open'): PixelImage {
  const t = new PixelImage(32, 16)
  paint(t, 0, 0, 32, 1, 'outline')
  paint(t, 0, 1, 32, 1, 'yellowDark')
  paint(t, 0, 2, 32, 1, 'chestnut')
  paint(t, 0, 3, 32, 1, 'chestnutDark')
  paint(t, 0, 4, 32, 1, 'outline')
  paint(t, 0, 5, 1, 10, 'outline')
  paint(t, 31, 5, 1, 10, 'outline')
  paint(t, 0, 15, 32, 1, 'creamShade')
  // 열린 자리: 바닥(문틀 아래 그늘)
  paint(t, 1, 5, 30, 11, 'cream')
  paint(t, 1, 5, 30, 2, 'creamShade')
  paint(t, 1, 15, 30, 1, 'cream')
  const leaf = (x: number, w: number, knobRight: boolean) => {
    paint(t, x, 5, w, 9, 'chestnut')
    paint(t, x, 5, w, 1, 'yellowDark')
    paint(t, x, 5, 1, 9, 'yellowDark')
    paint(t, x + w - 1, 6, 1, 8, 'chestnutDark')
    paint(t, x, 13, w, 1, 'chestnutDark')
    paint(t, x, 14, w, 1, 'brownDark')
    if (w >= 8) {
      paint(t, x + 3, 6, w - 6, 3, 'sky')
      paint(t, x + 3, 6, 1, 1, 'white')
      paint(t, x + 3, 10, w - 6, 1, 'chestnutDark')
      paint(t, x + 3, 12, w - 6, 1, 'chestnutDark')
    } else {
      paint(t, x + 1, 6, w - 2, 3, 'sky')
    }
    paint(t, knobRight ? x + w - 3 : x + 2, 10, 1, 1, 'yellow')
  }
  if (state === 'closed') {
    leaf(1, 15, true)
    leaf(16, 15, false)
    paint(t, 15, 5, 1, 10, 'outline')
  } else if (state === 'ajar') {
    leaf(1, 8, true)
    leaf(23, 8, false)
    paint(t, 9, 5, 1, 10, 'outline')
    paint(t, 22, 5, 1, 10, 'outline')
  } else {
    // 젖혀진 문짝(옆면만 보임)
    for (const x of [1, 28]) {
      paint(t, x, 5, 3, 10, 'chestnutDark')
      paint(t, x, 5, 1, 10, 'chestnut')
      paint(t, x, 5, 3, 1, 'yellowDark')
    }
    paint(t, 4, 5, 1, 10, 'outline')
    paint(t, 27, 5, 1, 10, 'outline')
  }
  return t
}

/** 현관 매트 32×16 (채움 28×7, 바닥 장식): 납작한 장밋빛 매트 + 크림 줄무늬, 외곽선 없음 */
function doormat(): PixelImage {
  const m = new PixelImage(28, 7)
  paint(m, 0, 0, 28, 7, 'carpetDark')
  paint(m, 1, 1, 26, 5, 'carpet')
  paint(m, 3, 2, 22, 1, 'cream')
  paint(m, 3, 4, 22, 1, 'cream')
  for (let x = 1; x < 28; x += 3) paint(m, x, 6, 1, 1, 'carpet')
  return bottomCenter(32, 16, m)
}

// ---------------------------------------------------------------------------
// 프레임 목록 · 애니메이션
// ---------------------------------------------------------------------------

/** json animations — 키 furn_{name}, 값 = 프레임 순서 */
export const OFFICE_ANIMATIONS: Readonly<Record<string, readonly string[]>> = {
  furn_server_rack: ['furn_server_rack_0', 'furn_server_rack_1', 'furn_server_rack_2'],
  furn_terminal_busy: ['furn_terminal_busy_0', 'furn_terminal_busy_1', 'furn_terminal_busy_2'],
  furn_shredder_on: ['furn_shredder_on_0', 'furn_shredder_on_1'],
  furn_coffee_brew: ['furn_coffee_brew_0', 'furn_coffee_brew_1'],
  furn_door_open: ['furn_door', 'furn_door_ajar', 'furn_door_open'],
}

/** 바닥에 까는 장식(캐릭터·가구보다 먼저, 깊이 정렬 없이 그린다) */
export const FLOOR_DECALS: readonly string[] = ['furn_cables', 'furn_rug', 'furn_doormat']

/** 방 경계 합성 타일 이름 */
export const wallName = {
  v: (l: Side, r: Side) => `tile_wall_v_${l}_${r}_0`,
  vEnd: (l: Side, r: Side) => `tile_wall_v_end_${l}_${r}_0`,
  vTop: (l: Side, r: Side) => `tile_wall_v_top_${l}_${r}_0`,
  teeLeft: (l: Side, r: Side) => `tile_wall_tee_left_${l}_${r}_0`,
  teeRight: (l: Side, r: Side) => `tile_wall_tee_right_${l}_${r}_0`,
  h: (below: FloorKind) => `tile_wall_h_${below}_0`,
  doorway: (l: Side, r: Side) => `tile_doorway_${l}_${r}_0`,
} as const

/** 지금 층 배치(24×14)에 필요한 방 경계 조합. 왼쪽 방 | 업무 공간 | 오른쪽 방 */
const V_PAIRS: readonly (readonly [Side, Side])[] = [
  ['wood', 'work'],
  ['carpet', 'work'],
  ['work', 'metal'],
  ['work', 'tile'],
]

export function buildRoomFrames(ctx: Ctx): OfficeFrame[] {
  const tile = (name: string, image: PixelImage, note: string): OfficeFrame => ({
    name,
    image,
    anchor: TILE_ANCHOR,
    note,
  })
  const furn = (name: string, image: PixelImage, note: string): OfficeFrame => ({
    name,
    image,
    anchor: FLOOR_ANCHOR,
    note,
  })
  const KO: Record<Side, string> = {
    work: '업무 공간',
    wood: '자료실',
    carpet: '휴게실',
    metal: '서버실',
    tile: '회의실',
    out: '바깥',
  }
  const frames: OfficeFrame[] = []
  // 바닥
  const floorNotes: Record<RoomFloor, string> = {
    wood: '자료실 바닥(마루)',
    carpet: '휴게실 바닥(카펫)',
    metal: '서버실 바닥(철판)',
    tile: '회의실 바닥(타일)',
  }
  for (const k of ['wood', 'carpet', 'metal', 'tile'] as const)
    for (const v of [0, 1])
      frames.push(
        tile(`tile_floor_${k}_${v}`, FLOOR_FN[k](v), `${floorNotes[k]}${v ? ' 변형' : ''}`),
      )
  // 방 경계(세로 칸막이) — 업무 공간 양옆
  for (const [l, r] of V_PAIRS) {
    const lr = `${KO[l]} | ${KO[r]}`
    frames.push(tile(wallName.v(l, r), vWall(l, r, 'mid', ctx), `세로 칸막이 ${lr}`))
    frames.push(
      tile(wallName.vEnd(l, r), vWall(l, r, 'end', ctx), `세로 칸막이 끝(아래 출입구) ${lr}`),
    )
    frames.push(
      tile(wallName.vTop(l, r), vWall(l, r, 'top', ctx), `세로 칸막이 시작(위 출입구) ${lr}`),
    )
    frames.push(tile(wallName.doorway(l, r), doorway(l, r, ctx), `출입구 문지방 ${lr}`))
  }
  // 바깥 벽(맨 왼쪽·오른쪽 열)
  for (const [l, r] of [
    ['out', 'wood'],
    ['out', 'carpet'],
    ['metal', 'out'],
    ['tile', 'out'],
  ] as const)
    frames.push(tile(wallName.v(l, r), vWall(l, r, 'mid', ctx), `바깥 벽 ${KO[l]} | ${KO[r]}`))
  // 가로 칸막이(방 위·아래 사이)와 T자 이음
  frames.push(tile(wallName.h('carpet'), hWall('carpet'), '가로 칸막이(아래 휴게실 카펫에 그림자)'))
  frames.push(tile(wallName.h('tile'), hWall('tile'), '가로 칸막이(아래 회의실 타일에 그림자)'))
  frames.push(
    tile(
      wallName.teeLeft('carpet', 'work'),
      teeWall('left', 'carpet', 'work', ctx),
      'T자: 왼쪽 가로 칸막이(아래 휴게실) + 세로 칸막이 | 업무 공간',
    ),
  )
  frames.push(
    tile(
      wallName.teeRight('work', 'tile'),
      teeWall('right', 'work', 'tile', ctx),
      'T자: 업무 공간 | 세로 칸막이 + 오른쪽 가로 칸막이(아래 회의실)',
    ),
  )
  frames.push(
    tile(
      wallName.teeRight('out', 'carpet'),
      teeWall('right', 'out', 'carpet', ctx),
      'T자: 왼쪽 바깥 벽 + 가로 칸막이(아래 휴게실)',
    ),
  )
  frames.push(
    tile(
      wallName.teeLeft('tile', 'out'),
      teeWall('left', 'tile', 'out', ctx),
      'T자: 가로 칸막이(아래 회의실) + 오른쪽 바깥 벽',
    ),
  )
  frames.push(
    tile(
      'tile_wall_top_edge_left_0',
      edgeBackWall(ctx.wallTop, 'left', true),
      '뒤 벽 윗줄 맨 왼쪽(바깥 + 세로 띠)',
    ),
  )
  frames.push(
    tile(
      'tile_wall_edge_left_0',
      edgeBackWall(ctx.wallBody, 'left', false),
      '뒤 벽 아랫줄 맨 왼쪽',
    ),
  )
  frames.push(
    tile(
      'tile_wall_top_edge_right_0',
      edgeBackWall(ctx.wallTop, 'right', true),
      '뒤 벽 윗줄 맨 오른쪽',
    ),
  )
  frames.push(
    tile(
      'tile_wall_edge_right_0',
      edgeBackWall(ctx.wallBody, 'right', false),
      '뒤 벽 아랫줄 맨 오른쪽',
    ),
  )
  frames.push(tile('tile_wall_corner_left_0', cornerWall('left'), '아래 벽 왼쪽 모서리'))
  frames.push(tile('tile_wall_corner_right_0', cornerWall('right'), '아래 벽 오른쪽 모서리'))

  // 자료실
  frames.push(furn('furn_bookshelf', bookshelf(), '책장 3칸(책 색 다양), 뒤 벽에 붙음'))
  frames.push(furn('furn_cabinet', cabinet(false), '서류 캐비닛 두 대 + 서류 상자'))
  frames.push(
    furn('furn_cabinet_open', cabinet(true), '서류 캐비닛(왼쪽 가운데 서랍 열림 — 검색 중)'),
  )
  frames.push(furn('furn_shredder', shredder('idle'), '파쇄기(꺼짐)'))
  frames.push(furn('furn_shredder_on_0', shredder(0), '파쇄기 작동 0(종이 들어감, LED 초록)'))
  frames.push(furn('furn_shredder_on_1', shredder(1), '파쇄기 작동 1'))
  // 서버실
  for (let i = 0; i < 3; i++)
    frames.push(furn(`furn_server_rack_${i}`, serverRack(i), `서버랙 LED 패턴 ${i}`))
  frames.push(furn('furn_terminal', terminal('idle'), '터미널 책상(대기 화면)'))
  for (let i = 0; i < 3; i++)
    frames.push(furn(`furn_terminal_busy_${i}`, terminal(i), `터미널 책상(명령 실행 중 ${i})`))
  frames.push(furn('furn_cables', cables(), '서버실 바닥 케이블(바닥 장식)'))
  // 회의실
  frames.push(furn('furn_whiteboard', whiteboard(false), '화이트보드(빈 것)'))
  frames.push(furn('furn_whiteboard_written', whiteboard(true), '화이트보드(글씨·도식·메모지)'))
  frames.push(furn('furn_table_meeting', meetingTable(), '회의 테이블(공용 자리)'))
  frames.push(
    furn(
      'furn_chair_meeting',
      bottomCenter(16, 16, outlined(art(CHAIR_MEETING))),
      '회의 의자 뒷모습(앉은 사람 앞에 겹침)',
    ),
  )
  // 휴게실
  frames.push(furn('furn_coffee', coffeeMachine('idle'), '커피머신(수납장 위)'))
  frames.push(furn('furn_coffee_brew_0', coffeeMachine(0), '커피머신 추출 0'))
  frames.push(furn('furn_coffee_brew_1', coffeeMachine(1), '커피머신 추출 1'))
  frames.push(furn('furn_sofa', sofa(), '소파(아래 벽에 붙어 방 쪽을 향함)'))
  frames.push(furn('furn_table_small', smallTable(), '작은 커피 테이블'))
  frames.push(furn('furn_rug', rug(), '러그(바닥 장식)'))
  // 창가 · 업무 공간 소품 · 출입문
  frames.push(furn('furn_globe', globe(), '창가 지구본'))
  frames.push(furn('furn_phone', phoneTable(), '전화 탁자(빨간 전화)'))
  frames.push(furn('furn_door', door('closed'), '출입문 닫힘(아래 벽 2칸)'))
  frames.push(furn('furn_door_ajar', door('ajar'), '출입문 반쯤 열림'))
  frames.push(furn('furn_door_open', door('open'), '출입문 열림'))
  frames.push(furn('furn_doormat', doormat(), '현관 매트(바닥 장식)'))
  return frames
}
