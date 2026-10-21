/*
 * 사무실 타일맵·가구·스팟 정의. PixiJS 비의존(순수 데이터) — director·pathfinding·테스트가 공유한다.
 *
 * 좌표계: 기준 해상도 픽셀(BASE_WIDTH × BASE_HEIGHT). 화면에는 정수 배율로만 확대한다.
 * 타일 16×16, 캐릭터 프레임 16×24(발끝 앵커).
 */

export const TILE = 16
export const COLS = 20
export const ROWS = 12
export const BASE_WIDTH = COLS * TILE // 320
export const BASE_HEIGHT = ROWS * TILE // 192

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
  'serverRack',
  'globe',
  'whiteboard',
  'phone',
  'coffee',
  'shredder',
] as const
export type SpotId = (typeof FIXED_SPOTS)[number]

/** 서브에이전트에게 순서대로 배정하는 책상. 모자라면 commonTable. */
export const SUB_DESKS = ['desk1', 'desk2', 'desk3', 'desk4'] as const satisfies readonly SpotId[]

export interface TilePos {
  col: number
  row: number
}

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

export const SPOTS: Readonly<Record<SpotId, Spot>> = {
  door: {
    id: 'door',
    tile: { col: 10, row: 10 },
    face: 'down',
    seated: false,
    slots: SHARED_SLOTS,
  },
  mainDesk: {
    id: 'mainDesk',
    tile: { col: 4, row: 4 },
    face: 'up',
    seated: true,
    slots: SINGLE_SLOT,
  },
  desk1: { id: 'desk1', tile: { col: 4, row: 7 }, face: 'up', seated: true, slots: SINGLE_SLOT },
  desk2: { id: 'desk2', tile: { col: 7, row: 7 }, face: 'up', seated: true, slots: SINGLE_SLOT },
  desk3: { id: 'desk3', tile: { col: 4, row: 10 }, face: 'up', seated: true, slots: SINGLE_SLOT },
  desk4: { id: 'desk4', tile: { col: 7, row: 10 }, face: 'up', seated: true, slots: SINGLE_SLOT },
  commonTable: {
    id: 'commonTable',
    tile: { col: 14, row: 9 },
    face: 'up',
    seated: true,
    slots: [
      [0, 0],
      [-14, 0],
      [14, 0],
      [-7, 2],
      [7, 2],
    ],
  },
  bookshelf: {
    id: 'bookshelf',
    tile: { col: 12, row: 3 },
    face: 'up',
    seated: false,
    slots: SHARED_SLOTS,
  },
  cabinet: {
    id: 'cabinet',
    tile: { col: 17, row: 7 },
    face: 'right',
    seated: false,
    slots: SHARED_SLOTS,
  },
  serverRack: {
    id: 'serverRack',
    tile: { col: 17, row: 4 },
    face: 'right',
    seated: false,
    slots: SHARED_SLOTS,
  },
  globe: { id: 'globe', tile: { col: 8, row: 3 }, face: 'up', seated: false, slots: SHARED_SLOTS },
  whiteboard: {
    id: 'whiteboard',
    tile: { col: 15, row: 3 },
    face: 'up',
    seated: false,
    slots: SHARED_SLOTS,
  },
  phone: {
    id: 'phone',
    tile: { col: 17, row: 9 },
    face: 'right',
    seated: false,
    slots: SHARED_SLOTS,
  },
  coffee: {
    id: 'coffee',
    tile: { col: 2, row: 8 },
    face: 'left',
    seated: false,
    slots: SHARED_SLOTS,
  },
  shredder: {
    id: 'shredder',
    tile: { col: 2, row: 10 },
    face: 'left',
    seated: false,
    slots: SHARED_SLOTS,
  },
}

/** 문 밖(등장·퇴장 시작/끝 위치). 맨 아래 벽의 문 타일. */
export const DOOR_OUTSIDE: TilePos = { col: 10, row: 11 }

/** 가구 종류 — 렌더러가 그리는 단위(아틀라스로 바꾸면 `furn_{kind}` 프레임). */
export type PropKind =
  | 'window'
  | 'desk'
  | 'mainDesk'
  | 'commonTable'
  | 'bookshelf'
  | 'cabinet'
  | 'serverRack'
  | 'globe'
  | 'whiteboard'
  | 'phone'
  | 'coffee'
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
 * 가구 배치. 벽: 0~1행(위 벽), 11행(아래 벽, 문), 0열·19열(좌우 벽).
 */
export const PROPS: readonly Prop[] = [
  { kind: 'window', col: 2, row: 0, w: 4, h: 2, solid: false },
  { kind: 'mainDesk', col: 3, row: 3, w: 3, h: 1, solid: true },
  { kind: 'globe', col: 8, row: 2, w: 1, h: 1, solid: true },
  { kind: 'bookshelf', col: 11, row: 1, w: 3, h: 2, solid: true },
  { kind: 'whiteboard', col: 14, row: 0, w: 3, h: 2, solid: false },
  { kind: 'serverRack', col: 18, row: 3, w: 1, h: 2, solid: true },
  { kind: 'cabinet', col: 18, row: 6, w: 1, h: 2, solid: true },
  { kind: 'phone', col: 18, row: 9, w: 1, h: 1, solid: true },
  { kind: 'desk', col: 3, row: 6, w: 2, h: 1, solid: true },
  { kind: 'desk', col: 6, row: 6, w: 2, h: 1, solid: true },
  { kind: 'desk', col: 3, row: 9, w: 2, h: 1, solid: true },
  { kind: 'desk', col: 6, row: 9, w: 2, h: 1, solid: true },
  { kind: 'commonTable', col: 13, row: 7, w: 3, h: 2, solid: true },
  { kind: 'coffee', col: 1, row: 7, w: 1, h: 2, solid: true },
  { kind: 'shredder', col: 1, row: 10, w: 1, h: 1, solid: true },
  { kind: 'door', col: 9, row: 11, w: 2, h: 1, solid: false },
  { kind: 'plant', col: 18, row: 1, w: 1, h: 2, solid: true },
]

/** 걸을 수 있는 타일인가 (벽·solid 가구 제외, 문 타일은 허용) */
export function isWalkable(col: number, row: number): boolean {
  if (col === DOOR_OUTSIDE.col && row === DOOR_OUTSIDE.row) return true
  if (col <= 0 || col >= COLS - 1 || row <= 1 || row >= ROWS - 1) return false
  for (const p of PROPS) {
    if (!p.solid) continue
    if (col >= p.col && col < p.col + p.w && row >= p.row && row < p.row + p.h) return false
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
