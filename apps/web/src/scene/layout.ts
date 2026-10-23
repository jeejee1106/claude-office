/*
 * 사무실 층 타일맵·방·벽·가구·스팟 정의. PixiJS 비의존(순수 데이터) — director·pathfinding·테스트가 공유한다.
 *
 * 좌표계: 기준 해상도 픽셀(BASE_WIDTH × BASE_HEIGHT). 화면에는 정수 배율로만 확대한다.
 * 타일 16×16, 캐릭터 프레임 16×24(발끝 앵커).
 *
 * 평면도 (기획서 3절 "공간 구성", 24×14 타일)
 *
 *   col 0        6                    17          23
 *   row 0-1  ███████████ 위 벽(창문) ██████████████████
 *       2   █ 자료실  █      업무 공간       █  서버실   █
 *       3   █책장·캐비닛█    팀장 큰 책상     █ 터미널·랙 █
 *       4   █         ▯                    ▯          █   ▯ = 출입구(벽 틈)
 *       5   █ 파쇄기   █   조사팀 · 기획팀    █          █
 *       6   █         █                    █          █
 *       7   ███████████                    ████████████
 *       8   █ 휴게실  █                    █  회의실    █
 *       9   █커피·소파 █  디자인팀 · 개발팀   █ 화이트보드 █
 *      10   █         ▯                    ▯ 회의 테이블 █
 *      11   █         █                    █          █
 *      12   █         █       로비          █          █
 *      13   ███████████████ 문 ████████████████████████
 *
 * 업무 공간(col 7..16, 2026-10-23 팀 구역 때문에 8칸 → 10칸으로 넓힘. 양옆 방은 6칸 → 5칸,
 * 방의 가구·스팟·출입구 순서는 그대로). 팀장은 위쪽 큰 책상 뒤에 앉아 아래(직원들)를
 * 바라본다(face down, 얼굴이 보임). 직원은 자기 팀 책상에 앉아 위(모니터·팀장 쪽)를 본다.
 *
 *        7  8  9  10 11 12 13 14 15 16
 *    2   P  T  .  .  W  W  .  .  G  P     P 화분, T 전화, G 지구본, W 팀장 의자(팀장 뒤)
 *    3   .  ph .  .  [B ] .  .  gl .      B 팀장 자리(mainDesk: 11열+8px, face down)
 *    4   .  .  .  D  D  D  D  .  .  .     D 팀장 큰 책상(팀장 앞에 겹쳐 그림)
 *    5   S  S  S  S  .  .  S  S  S  S     S 팀 간판(2타일 높이, 기둥은 6행): 조사팀 | 기획팀
 *    6   S  S  S  S  .  .  S  S  S  S
 *    7   d  d  d  d  .  .  d  d  d  d     d 책상(32px, 두 칸에 하나)
 *    8   [s2] [s1]  .  .  [s1] [s2]       s 자리(+의자, 직원 앞에 겹침): research / planning
 *    9   S  S  S  S  .  .  S  S  S  S     디자인팀 | 개발팀
 *   10   S  S  S  S  .  .  S  S  S  S
 *   11   d  d  d  d  .  .  d  d  d  d
 *   12   [s2] [s1]  .  X  [s1] [s2]       design / dev,  X = door 스팟(11,12)
 *
 *  - 자리 [sN] 은 두 타일 사이 가운데(왼쪽 타일 + 8px 슬롯 오프셋). 1번이 가운데 통로 쪽.
 *  - 가운데 통로(11~12열)와 간판 줄(5·6, 9·10행)로 오간다. 간판은 걸을 수 있다.
 */

import type { TeamId } from './teams'

export const TILE = 16
export const COLS = 24
export const ROWS = 14
export const BASE_WIDTH = COLS * TILE // 384
export const BASE_HEIGHT = ROWS * TILE // 224

export type Dir = 'down' | 'up' | 'left' | 'right'

/** 고정 스팟 ID. 서브 책상은 팀별 {team}1..2 (TEAM_ZONES). */
export const FIXED_SPOTS = [
  'door',
  'mainDesk',
  'research1',
  'research2',
  'planning1',
  'planning2',
  'design1',
  'design2',
  'dev1',
  'dev2',
  'commonTable',
  'bookshelf',
  'cabinet',
  'serverTerminal',
  'globe',
  'whiteboard',
  'phone',
  'coffee',
  /** 휴게실 소파에 앉기·눕기(한 턴 끝 쉬기). 소파는 한 사람만 — 둘 중 하나라도 차 있으면 커피 */
  'sofaSit',
  'sofaLie',
  'shredder',
] as const
export type SpotId = (typeof FIXED_SPOTS)[number]

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
// 팀 구역 (기획서 3절) — 팀원이 없어도 간판·책상은 항상 보인다
// ---------------------------------------------------------------------------

export interface TeamZone {
  team: TeamId
  /** 간판 자리(타일). 걸을 수 있는 바닥 위에 세운 판(아래 행에 기둥) */
  sign: Rect
  /** 이 팀의 자리 — 배정 순서대로(1번이 가운데 통로 쪽) */
  desks: readonly SpotId[]
}

export const TEAM_ZONES: readonly TeamZone[] = [
  { team: 'research', sign: { col: 7, row: 5, w: 4, h: 2 }, desks: ['research1', 'research2'] },
  { team: 'planning', sign: { col: 13, row: 5, w: 4, h: 2 }, desks: ['planning1', 'planning2'] },
  { team: 'design', sign: { col: 7, row: 9, w: 4, h: 2 }, desks: ['design1', 'design2'] },
  { team: 'dev', sign: { col: 13, row: 9, w: 4, h: 2 }, desks: ['dev1', 'dev2'] },
]

/** 팀의 자리(배정 순서). 팀 자리가 다 차면 director 가 commonTable(회의 테이블)로 보낸다. */
export function teamDesks(team: TeamId): readonly SpotId[] {
  return TEAM_ZONES.find((z) => z.team === team)?.desks ?? []
}

/** 서브에이전트 자리 전체 */
export const SUB_DESKS: readonly SpotId[] = TEAM_ZONES.flatMap((z) => z.desks)

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
  { id: 'work', area: { col: 7, row: 2, w: 10, h: 11 }, floor: 'checker' },
  { id: 'archive', area: { col: 1, row: 2, w: 5, h: 5 }, floor: 'wood' },
  { id: 'lounge', area: { col: 1, row: 8, w: 5, h: 5 }, floor: 'carpet' },
  { id: 'server', area: { col: 18, row: 2, w: 5, h: 5 }, floor: 'metal' },
  { id: 'meeting', area: { col: 18, row: 8, w: 5, h: 5 }, floor: 'tile' },
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
  { col: 6, row: 2, w: 1, h: 11 }, // 자료실·휴게실 | 업무 공간
  { col: 17, row: 2, w: 1, h: 11 }, // 업무 공간 | 서버실·회의실
  { col: 1, row: 7, w: 5, h: 1 }, // 자료실 / 휴게실
  { col: 18, row: 7, w: 5, h: 1 }, // 서버실 / 회의실
]

/** 벽에 뚫린 출입구(걸을 수 있음) */
export const DOORWAYS: readonly (TilePos & { room: RoomId })[] = [
  { col: 6, row: 4, room: 'archive' },
  { col: 6, row: 10, room: 'lounge' },
  { col: 17, row: 4, room: 'server' },
  { col: 17, row: 10, room: 'meeting' },
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

/** 두 타일 사이 가운데에 앉는 자리(32px 책상 가운데) — 왼쪽 타일 + 8px */
const BETWEEN_TILES_SLOT = [[TILE / 2, 0]] as const

const spot = (
  id: SpotId,
  col: number,
  row: number,
  face: Dir,
  seated = false,
  slots: Spot['slots'] = SHARED_SLOTS,
): Spot => ({ id, tile: { col, row }, face, seated, slots })

/** 직원 자리: (col, col+1) 두 타일 가운데에 앉아 위(모니터·팀장 쪽)를 본다 */
const desk = (id: SpotId, col: number, row: number): Spot =>
  spot(id, col, row, 'up', true, BETWEEN_TILES_SLOT)

/**
 * 소파 위 캐릭터 앵커 = 소파 앵커 (72, 208) + 이 오프셋 (pixel-artist 요약 "2026-10-23 sofa" 배치 표).
 * 프레임 맨 아래 3줄에 등받이 윗면이 그려져 있어 이 자리에 정확히 놓아야 소파 그림과 이어진다.
 * 소파는 방 쪽(위)을 향한다 → 앉은 사람은 뒷모습.
 */
export const SOFA_SEAT = {
  sitLeft: [-9, -8],
  sitRight: [9, -8],
  lie: [-3, -8],
} as const satisfies Record<string, readonly [number, number]>

/**
 * 소파 prop (3,12,3×1) 앵커(바닥 접점) — officeSheet.propAnchor 와 같은 규칙. PROPS 보다 먼저 쓰이므로
 * 숫자로 두고 test/lounge.test.ts 가 PROPS 의 소파와 같은지 확인한다.
 */
export const SOFA_ANCHOR = { x: 3 * TILE + 3 * (TILE / 2), y: (12 + 1) * TILE } as const
/**
 * 소파 위 캐릭터의 깊이 정렬 y = 소파 앵커 y + 1 (209). 발끝(200)으로 정렬하면 좌석 쿠션이 사람을 덮는다.
 * 소파 앞(아래)은 바깥 벽이라 이 깊이로 그려도 다른 캐릭터와 겹칠 일이 없다.
 */
export const SOFA_SORT_Y = SOFA_ANCHOR.y + 1

/** 스팟 타일 발끝 기준 슬롯 = 소파 앵커 + 오프셋 − 타일 발끝 */
const sofaSlot = (col: number, row: number, off: readonly [number, number]) =>
  [
    SOFA_ANCHOR.x + off[0] - (col * TILE + TILE / 2),
    SOFA_ANCHOR.y + off[1] - (row * TILE + TILE - 2),
  ] as const

export const SPOTS: Readonly<Record<SpotId, Spot>> = {
  // 출입문 / 로비
  door: spot('door', 11, 12, 'down'),
  // 업무 공간 — 팀장: 큰 책상 뒤(위)에 앉아 직원들 쪽(아래)을 본다. 얼굴이 보인다
  mainDesk: spot('mainDesk', 11, 3, 'down', true, BETWEEN_TILES_SLOT),
  // 팀 자리(1번이 가운데 통로 쪽)
  research1: desk('research1', 9, 8),
  research2: desk('research2', 7, 8),
  planning1: desk('planning1', 13, 8),
  planning2: desk('planning2', 15, 8),
  design1: desk('design1', 9, 12),
  design2: desk('design2', 7, 12),
  dev1: desk('dev1', 13, 12),
  dev2: desk('dev2', 15, 12),
  globe: spot('globe', 15, 3, 'up'),
  phone: spot('phone', 8, 3, 'up'),
  // 자료실
  bookshelf: spot('bookshelf', 2, 3, 'up'),
  cabinet: spot('cabinet', 4, 3, 'up'),
  shredder: spot('shredder', 2, 5, 'left'),
  // 서버실
  serverTerminal: spot('serverTerminal', 19, 3, 'up'),
  // 회의실
  whiteboard: spot('whiteboard', 19, 9, 'up'),
  commonTable: spot('commonTable', 20, 11, 'up', true, [
    [0, 0],
    [-14, 0],
    [14, 0],
    [-7, 1],
    [7, 1],
  ]),
  // 휴게실
  coffee: spot('coffee', 2, 9, 'left'),
  // 소파(3..5열, 12행, 막힘) 바로 앞 칸까지 걸어가서 슬롯 오프셋으로 소파 위에 앉는다/눕는다.
  // 소파는 방 쪽(위)을 향함 → face up(뒷모습). 앉기는 왼쪽·오른쪽 2자리, 눕기는 1자리(SOFA_SEAT)
  sofaSit: spot('sofaSit', 3, 11, 'up', true, [
    sofaSlot(3, 11, SOFA_SEAT.sitLeft),
    sofaSlot(3, 11, SOFA_SEAT.sitRight),
  ]),
  sofaLie: spot('sofaLie', 4, 11, 'up', true, [sofaSlot(4, 11, SOFA_SEAT.lie)]),
}

// ---------------------------------------------------------------------------
// 가구
// ---------------------------------------------------------------------------

/** 가구 종류 — 렌더러가 그리는 단위(office 아틀라스가 있으면 업무 공간 가구는 `furn_*` 프레임). */
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
  | 'chair'
  | 'mainChair'
  | 'teamSign'

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
  /** teamSign 의 팀(간판 글자) */
  team?: TeamId
}

/**
 * 직원 자리 하나의 책상(자리 바로 위 두 칸, 막힘) + 의자(자리, 직원 앞에 겹침).
 * 업무 공간 가구의 그림 위치·깊이는 render/officeSheet.ts placementOf 가 정한다.
 */
function deskProps(id: SpotId): Prop[] {
  const t = SPOTS[id].tile
  return [
    { kind: 'desk', col: t.col, row: t.row - 1, w: 2, h: 1, solid: true },
    { kind: 'chair', col: t.col, row: t.row, w: 2, h: 1, solid: false },
  ]
}

/**
 * 가구 배치. 위 벽(0~1행)에 붙는 가구는 row 1 에서 시작해 h 2 로 2행까지 막는다.
 * 2칸 폭 가구의 그림 가운데 = 두 타일 경계(x = (col+1)·16).
 */
export const PROPS: readonly Prop[] = [
  // 업무 공간
  { kind: 'window', col: 10, row: 0, w: 4, h: 2, solid: false },
  { kind: 'plant', col: 7, row: 1, w: 1, h: 2, solid: true },
  { kind: 'plant', col: 16, row: 1, w: 1, h: 2, solid: true },
  { kind: 'phone', col: 8, row: 2, w: 1, h: 1, solid: true },
  { kind: 'globe', col: 15, row: 2, w: 1, h: 1, solid: true },
  { kind: 'mainChair', col: 11, row: 3, w: 2, h: 1, solid: false },
  { kind: 'mainDesk', col: 10, row: 4, w: 4, h: 1, solid: true },
  ...TEAM_ZONES.flatMap((z): Prop[] => [
    { kind: 'teamSign', ...z.sign, solid: false, team: z.team },
    ...z.desks.flatMap(deskProps),
  ]),
  { kind: 'door', col: 11, row: 13, w: 2, h: 1, solid: false },
  // 자료실
  { kind: 'bookshelf', col: 1, row: 1, w: 3, h: 2, solid: true },
  { kind: 'cabinet', col: 4, row: 1, w: 2, h: 2, solid: true },
  { kind: 'shredder', col: 1, row: 5, w: 1, h: 1, solid: true },
  // 서버실
  { kind: 'terminal', col: 18, row: 2, w: 2, h: 1, solid: true },
  { kind: 'serverRack', col: 20, row: 1, w: 1, h: 2, solid: true },
  { kind: 'serverRack', col: 21, row: 1, w: 1, h: 2, solid: true },
  { kind: 'serverRack', col: 22, row: 1, w: 1, h: 2, solid: true },
  { kind: 'serverRack', col: 22, row: 4, w: 1, h: 2, solid: true },
  { kind: 'cables', col: 19, row: 3, w: 4, h: 3, solid: false },
  // 회의실
  { kind: 'whiteboard', col: 18, row: 7, w: 3, h: 2, solid: true },
  { kind: 'commonTable', col: 19, row: 10, w: 4, h: 1, solid: true },
  // 휴게실
  { kind: 'coffee', col: 1, row: 8, w: 1, h: 2, solid: true },
  { kind: 'sofa', col: 3, row: 12, w: 3, h: 1, solid: true },
  { kind: 'plant', col: 5, row: 7, w: 1, h: 2, solid: true },
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
