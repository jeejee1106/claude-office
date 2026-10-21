/*
 * 사무실 층 타일맵·방·벽·가구·스팟 정의. PixiJS 비의존(순수 데이터) — director·pathfinding·테스트가 공유한다.
 *
 * 좌표계: 기준 해상도 픽셀(BASE_WIDTH × BASE_HEIGHT). 화면에는 정수 배율로만 확대한다.
 * 타일 16×16, 캐릭터 프레임 16×24(발끝 앵커).
 *
 * 평면도 (기획서 3절 "공간 구성", 24×14 타일)
 *
 *   col 0         7               16            23
 *   row 0-1  ████████████ 위 벽(창문) ███████████████
 *       2   █ 자료실   █   업무 공간     █  서버실    █
 *       3   █ 책장·캐비닛█  창가 큰 책상·지구본 █ 터미널·랙 █
 *       4   █          ▯                ▯           █   ▯ = 출입구(벽 틈)
 *       5   █ 파쇄기    █  책상 1·2       █           █
 *       6   █          █                █           █
 *       7   ████████████                ██████████████
 *       8   █ 휴게실   █  책상 3·4       █  회의실    █
 *       9   █ 커피·소파 █                █  화이트보드  █
 *      10   █          ▯   로비          ▯  회의 테이블 █
 *      11   █          █                █           █
 *      12   █          █                █           █
 *      13   ██████████████ 문 ████████████████████████
 */

export const TILE = 16
export const COLS = 24
export const ROWS = 14
export const BASE_WIDTH = COLS * TILE // 384
export const BASE_HEIGHT = ROWS * TILE // 224

export type Dir = 'down' | 'up' | 'left' | 'right'

/** 고정 스팟 ID. 서브 책상은 desk1..desk4. */
export const FIXED_SPOTS = [
  'door',
  'mainDesk',
  'desk1',
  'desk2',
  'desk3',
  'desk4',
  'commonTable',
  'bookshelf',
  'cabinet',
  'serverTerminal',
  'globe',
  'whiteboard',
  'phone',
  'coffee',
  'shredder',
] as const
export type SpotId = (typeof FIXED_SPOTS)[number]

/** 서브에이전트에게 순서대로 배정하는 책상. 모자라면 commonTable(회의실 테이블). */
export const SUB_DESKS = ['desk1', 'desk2', 'desk3', 'desk4'] as const satisfies readonly SpotId[]

export interface TilePos {
  col: number
  row: number
}

export interface Rect {
  col: number
  row: number
  w: number
  h: number
}

// ---------------------------------------------------------------------------
// 방
// ---------------------------------------------------------------------------

export type RoomId = 'work' | 'archive' | 'server' | 'meeting' | 'lounge'

export interface Room {
  id: RoomId
  /** 방 안쪽(바닥) 영역 */
  area: Rect
  /** 바닥 무늬 */
  floor: 'wood' | 'carpet' | 'metal' | 'tile' | 'checker'
}

export const ROOMS: readonly Room[] = [
  { id: 'work', area: { col: 8, row: 2, w: 8, h: 11 }, floor: 'checker' },
  { id: 'archive', area: { col: 1, row: 2, w: 6, h: 5 }, floor: 'wood' },
  { id: 'lounge', area: { col: 1, row: 8, w: 6, h: 5 }, floor: 'carpet' },
  { id: 'server', area: { col: 17, row: 2, w: 6, h: 5 }, floor: 'metal' },
  { id: 'meeting', area: { col: 17, row: 8, w: 6, h: 5 }, floor: 'tile' },
]

const inRect = (r: Rect, col: number, row: number) =>
  col >= r.col && col < r.col + r.w && row >= r.row && row < r.row + r.h

export function roomAt(t: TilePos): RoomId | null {
  return ROOMS.find((r) => inRect(r.area, t.col, t.row))?.id ?? null
}

// ---------------------------------------------------------------------------
// 벽
// ---------------------------------------------------------------------------

/** 안쪽 칸막이 벽(타일 단위 직사각형). 바깥 벽(0행·1행·13행·0열·23열)은 따로 */
export const INNER_WALLS: readonly Rect[] = [
  { col: 7, row: 2, w: 1, h: 11 }, // 자료실·휴게실 | 업무 공간
  { col: 16, row: 2, w: 1, h: 11 }, // 업무 공간 | 서버실·회의실
  { col: 1, row: 7, w: 6, h: 1 }, // 자료실 / 휴게실
  { col: 17, row: 7, w: 6, h: 1 }, // 서버실 / 회의실
]

/** 벽에 뚫린 출입구(걸을 수 있음) */
export const DOORWAYS: readonly (TilePos & { room: RoomId })[] = [
  { col: 7, row: 4, room: 'archive' },
  { col: 7, row: 10, room: 'lounge' },
  { col: 16, row: 4, room: 'server' },
  { col: 16, row: 10, room: 'meeting' },
]

/** 문 밖(등장·퇴장 시작/끝 위치). 맨 아래 벽의 문 타일. */
export const DOOR_OUTSIDE: TilePos = { col: 11, row: 13 }

/** 벽 타일인가(바깥 벽 + 칸막이, 출입구·문 제외) */
export function isWall(col: number, row: number): boolean {
  if (col === DOOR_OUTSIDE.col && row === DOOR_OUTSIDE.row) return false
  if (DOORWAYS.some((d) => d.col === col && d.row === row)) return false
  if (col <= 0 || col >= COLS - 1 || row <= 1 || row >= ROWS - 1) return true
  return INNER_WALLS.some((w) => inRect(w, col, row))
}

// ---------------------------------------------------------------------------
// 스팟
// ---------------------------------------------------------------------------

export interface Spot {
  id: SpotId
  /** 캐릭터가 서는(앉는) 타일 */
  tile: TilePos
  /** 도착 후 바라보는 방향 */
  face: Dir
  /** 앉는 자리인가 (책상·공용 테이블) */
  seated: boolean
  /**
   * 대기 오프셋 슬롯(픽셀). 같은 스팟에 여러 명이 오면 0번부터 빈 슬롯을 쓴다.
   * 슬롯 수를 넘으면 마지막 슬롯을 겹쳐 쓴다.
   */
  slots: readonly (readonly [number, number])[]
}

const SHARED_SLOTS = [
  [0, 0],
  [-9, 2],
  [9, 2],
  [0, 5],
] as const

const SINGLE_SLOT = [[0, 0]] as const

const spot = (
  id: SpotId,
  col: number,
  row: number,
  face: Dir,
  seated = false,
  slots: Spot['slots'] = SHARED_SLOTS,
): Spot => ({ id, tile: { col, row }, face, seated, slots })

export const SPOTS: Readonly<Record<SpotId, Spot>> = {
  // 출입문 / 로비
  door: spot('door', 11, 12, 'down'),
  // 업무 공간
  mainDesk: spot('mainDesk', 10, 4, 'up', true, SINGLE_SLOT),
  desk1: spot('desk1', 9, 7, 'up', true, SINGLE_SLOT),
  desk2: spot('desk2', 13, 7, 'up', true, SINGLE_SLOT),
  desk3: spot('desk3', 9, 10, 'up', true, SINGLE_SLOT),
  desk4: spot('desk4', 13, 10, 'up', true, SINGLE_SLOT),
  globe: spot('globe', 14, 3, 'up'),
  phone: spot('phone', 14, 5, 'right'),
  // 자료실
  bookshelf: spot('bookshelf', 2, 3, 'up'),
  cabinet: spot('cabinet', 5, 3, 'up'),
  shredder: spot('shredder', 2, 5, 'left'),
  // 서버실
  serverTerminal: spot('serverTerminal', 18, 3, 'up'),
  // 회의실
  whiteboard: spot('whiteboard', 19, 9, 'up'),
  commonTable: spot('commonTable', 19, 11, 'up', true, [
    [0, 0],
    [-14, 0],
    [14, 0],
    [-7, 1],
    [7, 1],
  ]),
  // 휴게실
  coffee: spot('coffee', 2, 9, 'left'),
}

// ---------------------------------------------------------------------------
// 가구
// ---------------------------------------------------------------------------

/** 가구 종류 — 렌더러가 그리는 단위(아틀라스로 바꾸면 `furn_{kind}` 프레임). */
export type PropKind =
  | 'window'
  | 'desk'
  | 'mainDesk'
  | 'commonTable'
  | 'bookshelf'
  | 'cabinet'
  | 'serverRack'
  | 'terminal'
  | 'cables'
  | 'globe'
  | 'whiteboard'
  | 'phone'
  | 'coffee'
  | 'sofa'
  | 'shredder'
  | 'door'
  | 'plant'

export interface Prop {
  kind: PropKind
  /** 왼쪽 위 타일 */
  col: number
  row: number
  /** 타일 단위 크기 */
  w: number
  h: number
  /** 이동 불가 타일로 막는가 */
  solid: boolean
}

/**
 * 가구 배치. 위 벽(0~1행)에 붙는 가구는 row 1 에서 시작해 h 2 로 2행까지 막는다.
 */
export const PROPS: readonly Prop[] = [
  // 업무 공간
  { kind: 'window', col: 9, row: 0, w: 4, h: 2, solid: false },
  { kind: 'plant', col: 8, row: 1, w: 1, h: 2, solid: true },
  { kind: 'mainDesk', col: 9, row: 3, w: 3, h: 1, solid: true },
  { kind: 'globe', col: 14, row: 2, w: 1, h: 1, solid: true },
  { kind: 'phone', col: 15, row: 5, w: 1, h: 1, solid: true },
  { kind: 'desk', col: 8, row: 6, w: 2, h: 1, solid: true },
  { kind: 'desk', col: 12, row: 6, w: 2, h: 1, solid: true },
  { kind: 'desk', col: 8, row: 9, w: 2, h: 1, solid: true },
  { kind: 'desk', col: 12, row: 9, w: 2, h: 1, solid: true },
  { kind: 'plant', col: 15, row: 11, w: 1, h: 2, solid: true },
  { kind: 'door', col: 11, row: 13, w: 2, h: 1, solid: false },
  // 자료실
  { kind: 'bookshelf', col: 1, row: 1, w: 3, h: 2, solid: true },
  { kind: 'cabinet', col: 5, row: 1, w: 2, h: 2, solid: true },
  { kind: 'shredder', col: 1, row: 5, w: 1, h: 1, solid: true },
  // 서버실
  { kind: 'terminal', col: 17, row: 2, w: 2, h: 1, solid: true },
  { kind: 'serverRack', col: 19, row: 1, w: 1, h: 2, solid: true },
  { kind: 'serverRack', col: 20, row: 1, w: 1, h: 2, solid: true },
  { kind: 'serverRack', col: 21, row: 1, w: 1, h: 2, solid: true },
  { kind: 'serverRack', col: 22, row: 1, w: 1, h: 2, solid: true },
  { kind: 'serverRack', col: 22, row: 4, w: 1, h: 2, solid: true },
  { kind: 'cables', col: 19, row: 3, w: 4, h: 3, solid: false },
  // 회의실
  { kind: 'whiteboard', col: 18, row: 7, w: 3, h: 2, solid: true },
  { kind: 'commonTable', col: 18, row: 10, w: 4, h: 1, solid: true },
  // 휴게실
  { kind: 'coffee', col: 1, row: 8, w: 1, h: 2, solid: true },
  { kind: 'sofa', col: 3, row: 12, w: 3, h: 1, solid: true },
  { kind: 'plant', col: 6, row: 7, w: 1, h: 2, solid: true },
]

/** 걸을 수 있는 타일인가 (벽·solid 가구 제외, 출입구·문 타일은 허용) */
export function isWalkable(col: number, row: number): boolean {
  if (col === DOOR_OUTSIDE.col && row === DOOR_OUTSIDE.row) return true
  if (isWall(col, row)) return false
  for (const p of PROPS) {
    if (!p.solid) continue
    if (inRect(p, col, row)) return false
  }
  return true
}

/** 타일의 발끝 기준점(타일 아래쪽 중앙에서 2px 위) — 기준 해상도 픽셀 */
export function tileFoot(t: TilePos): { x: number; y: number } {
  return { x: t.col * TILE + TILE / 2, y: t.row * TILE + TILE - 2 }
}

/** 스팟+슬롯 → 기준 해상도 픽셀 위치 */
export function spotPosition(id: SpotId, slot: number): { x: number; y: number } {
  const s = SPOTS[id]
  const base = tileFoot(s.tile)
  const off = s.slots[Math.min(Math.max(slot, 0), s.slots.length - 1)] ?? [0, 0]
  return { x: base.x + off[0], y: base.y + off[1] }
}
