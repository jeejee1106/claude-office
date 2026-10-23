import { PixelImage } from '../canvas'
import { type ColorName, rgba } from '../palette'
import {
  type Anchor,
  art,
  bottomCenter,
  FLOOR_ANCHOR,
  type OfficeFrame,
  outlined,
  outlineInPlace,
  paint,
  TILE,
  TILE_ANCHOR,
} from './draw'
import { buildRoomFrames } from './rooms'

export { type Anchor, art, type OfficeFrame, outlined, TILE } from './draw'
export { OFFICE_ANIMATIONS } from './rooms'

/*
 * 사무실 시트(office): 업무 공간 한 칸에 필요한 바닥·벽·칸막이 타일, 책상·의자, 팀 간판, 소품.
 *
 * 규칙(pixel-art-pipeline 3절): 16px 격자, 팔레트 색만, 좌상단 광원(오른쪽·아래가 그림자),
 * 1px 짙은 남색 외곽선, 안티앨리어싱 없음. 프레임 크기는 모두 16의 배수.
 * 그림체 기준: 2026-10-23 비교 샘플 A(픽셀) — 크림색 바닥, 복숭아색 벽지 + 나무 징두리, 밤색 나무 가구.
 *
 * 시점: 위에서 비스듬히 내려다본 정면(3/4) 시점. 가구는 윗면(위에서 본 면) + 앞면이 함께 보인다.
 *  - 직원 책상 furn_desk: 직원이 책상 "아래쪽(화면 앞)"에 앉아 위를 본다 → 모니터 화면이 직원·화면 쪽을 향함.
 *  - 팀장 책상 furn_desk_boss: 팀장이 책상 "위쪽(뒤)"에 앉아 아래(직원 쪽)를 본다 → 모니터는 뒷면,
 *    팀장 얼굴이 보이도록 모니터는 왼쪽 구석, 가운데는 납작한 키보드뿐.
 *
 * 앵커(anchor)는 프레임 크기에 대한 비율(PixiJS 규약). 가구는 바닥 접점 = 아래 가운데 (0.5, 1),
 * 타일은 왼쪽 위 (0, 0), 간판 3조각은 아래 왼쪽 (0, 1) — 조각을 x 로 이어 붙이기 쉽게.
 */

// ---------------------------------------------------------------------------
// 타일 (16×16, 완전 불투명)
// ---------------------------------------------------------------------------

/** 바닥: 크림색 타일, 좌상단 밝은 테두리(white)·우하단 줄눈(creamShade) + 잔무늬 */
function floorTile(specks: readonly (readonly [number, number])[], grain = false): PixelImage {
  const t = new PixelImage(TILE, TILE)
  paint(t, 0, 0, 16, 16, 'cream')
  paint(t, 0, 15, 16, 1, 'creamShade')
  paint(t, 15, 0, 1, 16, 'creamShade')
  paint(t, 0, 0, 15, 1, 'white')
  paint(t, 0, 0, 1, 15, 'white')
  for (const [x, y] of specks) paint(t, x, y, 1, 1, 'creamShade')
  if (grain) {
    // 살짝 닳은 결(사선 3점 + 밝은 점)
    paint(t, 9, 9, 1, 1, 'creamShade')
    paint(t, 10, 10, 2, 1, 'creamShade')
    paint(t, 12, 11, 1, 1, 'creamShade')
    paint(t, 9, 10, 1, 1, 'white')
  }
  return t
}

/** 벽지 몸통(복숭아색 + 8px 간격 세로 줄무늬) */
function wallpaper(t: PixelImage, y0: number, h: number) {
  paint(t, 0, y0, 16, h, 'skin')
  paint(t, 3, y0, 1, h, 'skinShade')
  paint(t, 11, y0, 1, h, 'skinShade')
}

/** 뒤 벽 위 테두리: 외곽선 + 천장 몰딩(밝은 윗면 → 밤색 → 짙은 그림자) + 벽지 */
function wallTopTile(): PixelImage {
  const t = new PixelImage(TILE, TILE)
  paint(t, 0, 0, 16, 1, 'outline')
  paint(t, 0, 1, 16, 1, 'yellowDark')
  paint(t, 0, 2, 16, 1, 'chestnut')
  paint(t, 0, 3, 16, 1, 'chestnutDark')
  wallpaper(t, 4, 12)
  return t
}

/** 뒤 벽 몸통: 벽지 + 의자 높이 몰딩 + 나무 징두리 + 걸레받이. outlet=true 면 콘센트 */
function wallBodyTile(outlet: boolean): PixelImage {
  const t = new PixelImage(TILE, TILE)
  wallpaper(t, 0, 7)
  paint(t, 0, 7, 16, 1, 'yellowDark') // 몰딩 윗면
  paint(t, 0, 8, 16, 1, 'chestnutDark')
  paint(t, 0, 9, 16, 5, 'chestnut') // 징두리
  paint(t, 0, 9, 16, 1, 'yellowDark')
  paint(t, 7, 10, 1, 4, 'chestnutDark') // 판자 이음
  paint(t, 15, 10, 1, 4, 'chestnutDark')
  paint(t, 0, 14, 16, 2, 'brownDark') // 걸레받이
  if (outlet) {
    paint(t, 10, 10, 4, 3, 'white')
    paint(t, 13, 10, 1, 3, 'grayLight')
    paint(t, 11, 11, 1, 1, 'gray')
    paint(t, 12, 11, 1, 1, 'gray')
  }
  return t
}

/*
 * 칸막이 벽(방 경계). 화면에서 가로로 놓인 벽은 윗면(두께 4px) + 앞면(벽지)이 보이고,
 * 세로로 놓인 벽은 윗면만 가는 띠로 보인다(x 5..10). 아래쪽 1줄은 바닥에 지는 그림자(creamShade)라
 * 크림색 바닥 위에 놓으면 이어진다.
 */
// 세로 벽 띠: x5 외곽선, 6 하이라이트, 7..8 나무, 9 그늘, 10 외곽선, 11 그림자

function capStrip(t: PixelImage, y0: number, h: number) {
  paint(t, 5, y0, 1, h, 'outline')
  paint(t, 6, y0, 1, h, 'yellowDark')
  paint(t, 7, y0, 2, h, 'chestnut')
  paint(t, 9, y0, 1, h, 'chestnutDark')
  paint(t, 10, y0, 1, h, 'outline')
}

/** 가로 칸막이. left/right = 그쪽이 끝(출입구 옆)이라 옆 외곽선이 있음. join = 위에서 세로 벽이 붙음 */
function partitionH(opts: { left?: boolean; right?: boolean; join?: boolean } = {}): PixelImage {
  const t = new PixelImage(TILE, TILE)
  const x0 = opts.left ? 1 : 0
  const x1 = opts.right ? 15 : 16 // exclusive
  const w = x1 - x0
  paint(t, x0, 0, w, 1, 'outline')
  paint(t, x0, 1, w, 1, 'yellowDark')
  paint(t, x0, 2, w, 1, 'chestnut')
  paint(t, x0, 3, w, 1, 'chestnutDark')
  paint(t, x0, 4, w, 1, 'outline')
  // 앞면 벽지 + 걸레받이
  paint(t, x0, 5, w, 8, 'skin')
  for (const sx of [3, 11]) if (sx >= x0 && sx < x1) paint(t, sx, 5, 1, 8, 'skinShade')
  paint(t, x0, 13, w, 2, 'brownDark')
  paint(t, x0, 15, w, 1, 'creamShade') // 바닥 그림자
  if (opts.left) {
    paint(t, 0, 0, 1, 15, 'outline')
    paint(t, 1, 1, 1, 3, 'yellowDark')
  }
  if (opts.right) {
    paint(t, 15, 0, 1, 15, 'outline')
    paint(t, 14, 1, 1, 3, 'chestnutDark')
    paint(t, 14, 5, 1, 8, 'skinShade')
  }
  if (opts.join) {
    // 위에서 내려온 세로 띠가 가로 벽 윗면으로 이어지게 윗줄 외곽선을 연다
    paint(t, 6, 0, 1, 1, 'yellowDark')
    paint(t, 7, 0, 2, 1, 'chestnut')
    paint(t, 9, 0, 1, 1, 'chestnutDark')
  }
  return t
}

/** 세로 칸막이 띠(위아래로 이어 붙임). 투명 배경 — 바닥 타일 위에 겹친다 */
function partitionV(): PixelImage {
  const t = new PixelImage(TILE, TILE)
  capStrip(t, 0, 16)
  paint(t, 11, 0, 1, 16, 'creamShade') // 오른쪽 그림자
  return t
}

/** 세로 칸막이의 아래 끝: 띠가 끝나고 벽 앞면(마구리)이 보인다 */
function partitionVEnd(): PixelImage {
  const t = new PixelImage(TILE, TILE)
  capStrip(t, 0, 4)
  paint(t, 5, 4, 6, 1, 'outline')
  paint(t, 5, 5, 1, 10, 'outline')
  paint(t, 10, 5, 1, 10, 'outline')
  paint(t, 6, 5, 4, 8, 'skin')
  paint(t, 9, 5, 1, 8, 'skinShade')
  paint(t, 6, 13, 4, 2, 'brownDark')
  paint(t, 5, 15, 6, 1, 'outline')
  paint(t, 11, 0, 1, 16, 'creamShade')
  return t
}

// ---------------------------------------------------------------------------
// 책상·의자
// ---------------------------------------------------------------------------

/** 모니터 앞면(직원 책상) 16×12: 화면에 코드 줄 */
const MONITOR_FRONT = [
  'GGGGGGGGGGGGGGGG',
  'GiIIIIIIIIIIIIIi',
  'GiIttttIIIIIIIIi',
  'GiIIIyyyyIcccIIi',
  'GiIIIIIIwwwwwIIi',
  'GiIIcccIttIIIIIi',
  'GiIIIIIIIyyyyIIi',
  'GiIttttIIIIIIIIi',
  'GiIIIIIIIIIIIIIi',
  'iiiiiiiiiiiiiiii',
  '......iIIi......',
  '....iiiiiiii....',
]

/** 모니터 뒷면(직원 책상 반대 방향용) 16×12 */
const MONITOR_BACK = [
  'WWWWWWWWWWWWWWWG',
  'WWWWWWWWWWWWWWWG',
  'WWWGGGGGGGGGGWWG',
  'WWWWWWWWWWWWWWWG',
  'WWWGGGGGGGGGGWWG',
  'WWWWWWWWWWWWWWWG',
  'WWWWWWWWWWWWWWWG',
  'WWWWWWWWWWWWWWWG',
  'GGGGGGGGGGGGGGGG',
  '......GGGG......',
  '......GGGG......',
  '....GGGGGGGG....',
]

/** 모니터 뒷면(팀장 책상, 작은 것) 14×11 */
const MONITOR_BACK_SMALL = [
  'WWWWWWWWWWWWWG',
  'WWWWWWWWWWWWWG',
  'WWGGGGGGGGGWWG',
  'WWWWWWWWWWWWWG',
  'WWGGGGGGGGGWWG',
  'WWWWWWWWWWWWWG',
  'WWWWWWWWWWWWWG',
  'GGGGGGGGGGGGGG',
  '.....GGGG.....',
  '.....GGGG.....',
  '...GGGGGGGG...',
]

/** 직원 책상 몸통(채움 30×14 → 외곽선 포함 32×16): 윗면 5 + 앞 모서리 1 + 앞판 5 + 다리 3 */
function staffDeskBody(): PixelImage {
  const w = 30
  const d = new PixelImage(w, 14)
  paint(d, 0, 0, w, 5, 'chestnut')
  paint(d, 0, 0, w, 1, 'yellowDark') // 윗면 뒤 모서리 하이라이트
  paint(d, 0, 1, 1, 4, 'yellowDark')
  paint(d, 0, 5, w, 1, 'yellowDark') // 앞 모서리(빛 받는 면)
  paint(d, 0, 6, w, 5, 'chestnutDark')
  paint(d, w - 2, 6, 2, 5, 'brownDark') // 오른쪽 그림자
  // 서랍 + 손잡이
  paint(d, 18, 7, 9, 3, 'chestnut')
  paint(d, 18, 9, 9, 1, 'brown')
  paint(d, 21, 8, 3, 1, 'yellow')
  // 다리
  paint(d, 1, 11, 3, 3, 'brownDark')
  paint(d, w - 4, 11, 3, 3, 'brownDark')
  return d
}

/** 직원 책상 32×32. screen='front' 면 화면이 보이는 모니터, 'back' 이면 뒷면 */
function staffDesk(screen: 'front' | 'back'): PixelImage {
  const f = new PixelImage(32, 32)
  f.blit(outlined(staffDeskBody()), 0, 16)
  const mon = outlined(art(screen === 'front' ? MONITOR_FRONT : MONITOR_BACK))
  // 받침 맨 아랫줄(채움)이 책상 윗면 y19 에 닿게
  f.blit(mon, 7, 19 - (mon.height - 2))
  return f
}

/** 팀장 책상 48×32: 넓은 윗면 + 장식 패널 앞판(다리 없이 바닥까지) + 명패 */
function bossDesk(): PixelImage {
  const w = 46
  const d = new PixelImage(w, 18)
  paint(d, 0, 0, w, 6, 'chestnut')
  paint(d, 0, 0, w, 1, 'yellowDark')
  paint(d, 0, 1, 1, 5, 'yellowDark')
  paint(d, 0, 6, w, 1, 'yellowDark') // 앞 모서리
  paint(d, 0, 7, w, 9, 'chestnutDark')
  // 볼록 패널 3개: 위·왼쪽은 빛(chestnut), 아래·오른쪽은 그늘(brownDark)
  for (const px of [2, 17, 32]) {
    paint(d, px, 8, 12, 1, 'chestnut')
    paint(d, px, 8, 1, 7, 'chestnut')
    paint(d, px, 14, 12, 1, 'brownDark')
    paint(d, px + 11, 9, 1, 6, 'brownDark')
  }
  paint(d, w - 2, 7, 2, 9, 'brownDark') // 오른쪽 그림자
  paint(d, 0, 16, w, 1, 'brown') // 받침
  paint(d, 0, 17, w, 1, 'brownDark')
  // 명패(가운데 패널, 놋쇠)
  paint(d, 19, 10, 8, 3, 'yellow')
  paint(d, 19, 12, 8, 1, 'yellowDark')
  paint(d, 26, 10, 1, 3, 'yellowDark')
  paint(d, 21, 11, 4, 1, 'yellowDark') // 새김 자국(글자 없음)

  const f = new PixelImage(48, 32)
  f.blit(outlined(d), 0, 12) // 윗면 채움 y13..18, 앞 모서리 y19, 앞판 y20..28, 받침 y29..30
  // 왼쪽 구석 모니터 뒷면: 받침 맨 아랫줄이 y15
  const mon = outlined(art(MONITOR_BACK_SMALL))
  f.blit(mon, 1, 15 - (mon.height - 2))
  // 팀장 앞의 납작한 키보드(뒤쪽 모서리만 보임)
  paint(f, 20, 13, 9, 1, 'grayLight')
  paint(f, 20, 14, 9, 1, 'gray')
  // 오른쪽 서류 더미
  f.blit(outlined(art(PAPERS)), 35, 17 - (PAPERS.length + 1))
  return f
}

/** 직원 의자(뒷모습, 직원 앞에 겹침) 채움 14×10 */
const CHAIR_BACK = [
  '.iiiiiiiiiiii.',
  'iviiiiiiiiiiiI',
  'iviiiiiiiiiiiI',
  'iiiiiiiiiiiiII',
  'iiiiiiiiiiiiII',
  '.IIIIIIIIIIII.',
  '......GG......',
  '......GG......',
  '..GGGGGGGGGG..',
  '.WG........GW.',
]

/** 팀장 의자(앞모습, 등받이 높음, 팀장 뒤에 그림) 채움 24×23 */
const CHAIR_BOSS = [
  '.....iiiiiiiiiiiiii.....',
  '....ivviiiiiiiiiiiiI....',
  '...iviiiiiiiiiiiiiiII...',
  '...iviiiiiiiiiiiiiiII...',
  '...iviiiiIiiiiIiiiiII...',
  '...iviiiiiiiiiiiiiiII...',
  '...iviiiiiiiiiiiiiiII...',
  '...iviiIiiiiIiiiiIiII...',
  '...iviiiiiiiiiiiiiiII...',
  '...iviiiiiiiiiiiiiiII...',
  '...iviiiiIiiiiIiiiiII...',
  '...iviiiiiiiiiiiiiiII...',
  '...iviiiiiiiiiiiiiiII...',
  'nnniviiiiiiiiiiiiiiIInnN',
  'NNNiviiiiiiiiiiiiiiIINNB',
  'NNNiIiiiiiiiiiiiiiiIINNB',
  '.viiiiiiiiiiiiiiiiiiiiI.',
  '.IIIIIIIIIIIIIIIIIIIIII.',
  '...........GG...........',
  '...........GG...........',
  '...........GG...........',
  '.....GGGGGGGGGGGGGG.....',
  '....WG............GW....',
]

// ---------------------------------------------------------------------------
// 소품
// ---------------------------------------------------------------------------

const PLANT_SMALL = [
  '..g..g..',
  '.gEg.gg.',
  'gggEggEg',
  '.gEgggg.',
  'EggEgEgE',
  '.EgggEE.',
  '.tttttt.',
  '.tTTTTT.',
  '..tTTT..',
  '..TTTT..',
]

const PLANT_BIG = [
  '.....g...g....',
  '....gEg.gEg...',
  '..g.gEggEgg.g.',
  '.gEggEgggEggEg',
  'gggEgggEggEggg',
  '.gEggEgggEgEg.',
  'gEggEgEgggEggE',
  '.gggEggEggEgg.',
  'gEggEgEgggEgE.',
  '.EgggEgEggEgE.',
  '..EEggEggEEE..',
  '....EEEEEE....',
  '.tttttttttttT.',
  '.TTTTTTTTTTTT.',
  '..ttttttttTT..',
  '..ttttttttTT..',
  '..ttttttttTT..',
  '...tttttTTT...',
  '...TTTTTTTT...',
]

const MUG = ['wwwww..', 'wcccwWW', 'wwwwwGW', 'wWWWWWW', 'WWWWG..']

const PAPERS = [
  '.wwwwwwww',
  'wwWWWWwwW',
  'wwwwwwwwW',
  'wWWWWwwwW',
  'WWWWWWWWG',
  'wwwwwwwwG',
  'GGGGGGGGG',
]

const WINDOW = [
  'wwwwwwwwwwwwww',
  'wkkkkkkwkkkkkW',
  'wkwkkkkwkkkkkW',
  'wkkwkkkwkkwkkW',
  'wkkkkkkwkkkwkW',
  'wwwwwwwwwwwwwW',
  'wkkkkkkwkkkkkW',
  'wkkkkkkwkkkkkW',
  'wkkkkkkwkkkkkW',
  'WWWWWWWWWWWWWW',
  'MMMMMMMMMMMMMM',
]

const CORKBOARD = [
  'nnnnnnnnnnn',
  'nYYYYYYYYYN',
  'nYyyYYccYYN',
  'nYyyYYccYYN',
  'nYYYYYYYYYN',
  'nYkkYYYppYN',
  'nYkkYYYppYN',
  'nYYYYYYYYYN',
  'NNNNNNNNNNN',
]

// ---------------------------------------------------------------------------
// 팀 간판 (3조각: 왼쪽 끝 · 가운데 반복 · 오른쪽 끝, 각 16×32, 바닥에 세우는 스탠드형)
// ---------------------------------------------------------------------------

/*
 * 판(y 0..19): 외곽선 → 하이라이트(yellowDark) → 나무 테(chestnut) → 안쪽 그늘(chestnutDark) →
 * 크림색 글자판(y 4..15, 12줄) → 나무 테 → 그늘 → 외곽선.
 * 기둥(y 20..31): 왼쪽·오른쪽 조각의 x 7..8, 바닥 받침 x 5..10 (y 29..30), 맨 아랫줄 y31 이 바닥 접점.
 * 글자판 가로 범위: 왼쪽 조각 x6..15 + 가운데 조각 전체 + 오른쪽 조각 x0..9.
 */
export const SIGN = {
  pieceW: 16,
  pieceH: 32,
  /** 글자판(크림색) 왼쪽 끝 = 간판 왼쪽 + 6, 오른쪽 끝 = 간판 오른쪽 - 6 (폭 = 전체 - 12) */
  panelInsetX: 6,
  panelTop: 4,
  panelHeight: 12,
  /** 글자 권장 여백(글자판 안쪽) */
  textPadX: 2,
  /** 기둥 아래(바닥 접점)에서 판 아랫면까지 높이 */
  boardBottom: 19,
} as const

type Cell = ColorName | null
const INTERIOR: Cell[] = [
  'outline',
  'yellowDark',
  'chestnut',
  'chestnutDark',
  ...Array<Cell>(12).fill('cream'),
  'chestnut',
  'chestnut',
  'chestnutDark',
  'outline',
]

function col(spec: (y: number) => Cell): Cell[] {
  return Array.from({ length: 20 }, (_, y) => spec(y))
}
const edge = (top: Cell, mid: Cell, bottomShade: Cell) =>
  col((y) => (y === 0 || y === 19 ? 'outline' : y === 1 ? top : y === 18 ? bottomShade : mid))

const LEFT_COLS: Cell[][] = [
  col(() => null),
  col(() => null),
  col(() => 'outline'),
  col((y) => (y === 0 || y === 19 ? 'outline' : 'yellowDark')),
  edge('yellowDark', 'chestnut', 'chestnutDark'),
  col((y) =>
    y === 0 || y === 19
      ? 'outline'
      : y === 1
        ? 'yellowDark'
        : y === 2 || y === 16 || y === 17
          ? 'chestnut'
          : 'chestnutDark',
  ),
]
const RIGHT_COLS: Cell[][] = [
  edge('yellowDark', 'chestnut', 'chestnutDark'),
  edge('yellowDark', 'chestnut', 'chestnutDark'),
  col((y) => (y === 0 || y === 19 ? 'outline' : 'chestnutDark')),
  col(() => 'outline'),
  col(() => null),
  col(() => null),
]

function post(img: PixelImage) {
  const px: [number, number][] = []
  for (let y = 20; y <= 28; y++) {
    paint(img, 7, y, 1, 1, 'chestnut')
    paint(img, 8, y, 1, 1, 'chestnutDark')
    px.push([7, y], [8, y])
  }
  paint(img, 5, 29, 6, 1, 'chestnut')
  paint(img, 5, 30, 6, 1, 'chestnutDark')
  for (let x = 5; x <= 10; x++) px.push([x, 29], [x, 30])
  outlineInPlace(img, px)
}

function signPiece(kind: 'left' | 'mid' | 'right'): PixelImage {
  const cols: Cell[][] =
    kind === 'left'
      ? [...LEFT_COLS, ...Array.from({ length: 10 }, () => INTERIOR)]
      : kind === 'right'
        ? [...Array.from({ length: 10 }, () => INTERIOR), ...RIGHT_COLS]
        : Array.from({ length: 16 }, () => INTERIOR)
  const img = new PixelImage(SIGN.pieceW, SIGN.pieceH)
  cols.forEach((c, x) => {
    c.forEach((k, y) => {
      if (k) img.set(x, y, rgba(k))
    })
  })
  if (kind !== 'mid') post(img)
  return img
}

/** 간판 전체 폭(px) — 가운데 조각 n 개 */
export function signWidth(mids: number): number {
  return SIGN.pieceW * (2 + mids)
}

/** 글자 폭(px)이 들어가는 가운데 조각 수(최소 1) */
export function signMidsFor(textWidth: number): number {
  const need = textWidth + 2 * (SIGN.panelInsetX + SIGN.textPadX)
  return Math.max(1, Math.ceil((need - 2 * SIGN.pieceW) / SIGN.pieceW))
}

// ---------------------------------------------------------------------------
// 프레임 목록
// ---------------------------------------------------------------------------

const SIGN_ANCHOR: Anchor = { x: 0, y: 1 }

export function buildOfficeFrames(): OfficeFrame[] {
  const tile = (name: string, image: PixelImage, note: string): OfficeFrame => ({
    name,
    image,
    anchor: TILE_ANCHOR,
    note,
  })
  const furn = (name: string, image: PixelImage, note: string, anchor = FLOOR_ANCHOR) => ({
    name,
    image,
    anchor,
    note,
  })
  const workFloor = floorTile([
    [4, 5],
    [11, 9],
    [7, 12],
    [12, 3],
  ])
  const work: OfficeFrame[] = [
    tile('tile_floor_0', workFloor, '업무 공간 바닥(기본)'),
    tile(
      'tile_floor_1',
      floorTile([
        [3, 10],
        [9, 4],
        [13, 12],
        [6, 7],
        [7, 7],
      ]),
      '바닥 변형(잔무늬)',
    ),
    tile(
      'tile_floor_2',
      floorTile(
        [
          [4, 4],
          [12, 5],
        ],
        true,
      ),
      '바닥 변형(닳은 결)',
    ),
    tile('tile_wall_top_0', wallTopTile(), '뒤 벽 윗줄(천장 몰딩 + 벽지)'),
    tile('tile_wall_0', wallBodyTile(false), '뒤 벽 아랫줄(벽지 + 징두리 + 걸레받이)'),
    tile('tile_wall_1', wallBodyTile(true), '뒤 벽 아랫줄 변형(콘센트)'),
    tile('tile_partition_h_0', partitionH(), '가로 칸막이(이어 붙임)'),
    tile(
      'tile_partition_h_left_0',
      partitionH({ left: true }),
      '가로 칸막이 왼쪽 끝(오른쪽으로 이어짐)',
    ),
    tile('tile_partition_h_right_0', partitionH({ right: true }), '가로 칸막이 오른쪽 끝'),
    tile(
      'tile_partition_h_join_0',
      partitionH({ join: true }),
      '가로 칸막이 + 위에서 세로 칸막이가 붙는 칸',
    ),
    tile('tile_partition_v_0', partitionV(), '세로 칸막이(투명 배경, 바닥 위에 겹침)'),
    tile('tile_partition_v_end_0', partitionVEnd(), '세로 칸막이 아래 끝(마구리)'),
    furn('furn_desk', staffDesk('front'), '직원 책상(직원이 아래에 앉아 위를 봄, 화면 보임)'),
    furn(
      'furn_desk_down',
      staffDesk('back'),
      '직원 책상 반대 방향(앉은 사람이 아래를 봄, 모니터 뒷면)',
    ),
    furn(
      'furn_chair',
      bottomCenter(16, 16, outlined(art(CHAIR_BACK))),
      '직원 의자 뒷모습(직원 앞에 겹침)',
    ),
    furn('furn_desk_boss', bossDesk(), '팀장 큰 책상(팀장이 뒤에 앉아 아래를 봄)'),
    furn(
      'furn_chair_boss',
      bottomCenter(32, 32, outlined(art(CHAIR_BOSS))),
      '팀장 의자(등받이 높음, 팀장 뒤)',
    ),
    furn('furn_teamsign_left', signPiece('left'), '팀 간판 왼쪽 끝 + 기둥', SIGN_ANCHOR),
    furn('furn_teamsign_mid', signPiece('mid'), '팀 간판 가운데(반복)', SIGN_ANCHOR),
    furn('furn_teamsign_right', signPiece('right'), '팀 간판 오른쪽 끝 + 기둥', SIGN_ANCHOR),
    furn('furn_plant', bottomCenter(16, 32, outlined(art(PLANT_BIG))), '바닥 화분(큰 것)'),
    furn('furn_plant_small', bottomCenter(16, 16, outlined(art(PLANT_SMALL))), '책상 위 작은 화분'),
    furn('furn_mug', bottomCenter(16, 16, outlined(art(MUG))), '머그(책상 위)'),
    furn('furn_papers', bottomCenter(16, 16, outlined(art(PAPERS))), '서류 더미(책상 위)'),
    furn('furn_window', bottomCenter(16, 16, outlined(art(WINDOW))), '창문(벽에 거는 것)'),
    furn('furn_corkboard', bottomCenter(16, 16, outlined(art(CORKBOARD))), '게시판(벽에 거는 것)'),
  ]
  // 나머지 방(자료실·서버실·회의실·휴게실·창가·로비) — 칸막이 합성 타일이 업무 공간 바닥 반쪽을 쓴다
  return [
    ...work,
    ...buildRoomFrames({ workFloor, wallTop: wallTopTile(), wallBody: wallBodyTile(false) }),
  ]
}
