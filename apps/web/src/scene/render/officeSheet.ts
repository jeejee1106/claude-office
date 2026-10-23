import {
  COLS,
  DOOR_OUTSIDE,
  DOORWAYS,
  isWall,
  PROPS,
  type Prop,
  type PropKind,
  ROOMS,
  ROWS,
  type Room,
  SPOTS,
  type SpotId,
  spotPosition,
  TILE,
  tileFoot,
} from '../layout'

/*
 * office 아틀라스(apps/web/public/assets/office.json) 조회·배치 규칙. PixiJS 비의존 — 단위 테스트 대상.
 *
 * 프레임 이름·앵커·배치 오프셋·애니메이션 간격은 pixel-artist 요약(_workspace/02_pixel-artist_summary.md)의
 * 표 그대로다. 이름을 지어내지 않는다. 범위: 층 전체(모든 방 바닥·벽·칸막이·출입구 + 모든 가구).
 *
 * 타일 지도 규칙(officeTiles)은 packages/assets/src/floorplan.ts floorTileMap 을 옮긴 것이다.
 * apps/web 은 빌드 시 생성기 패키지(packages/assets)에 의존하지 않으므로 같은 규칙을 여기 둔다.
 * 두 곳이 어긋나면 test/officeRooms.test.ts 가 "모든 칸의 프레임이 시트에 있다"로 잡는다.
 *
 * 깊이: 가구는 캐릭터 층에서 "바닥 접점 y"(앵커 y)로 정렬한다(작은 것 먼저).
 *   팀장: 의자(−15) < 캐릭터 발끝(−14) < 큰 책상(0)   — 책상이 하체를 가린다
 *   직원: 책상(0) < 캐릭터 발끝(+8) < 의자(+11)        — 의자 등받이가 몸을 가린다
 *   (괄호 = 책상 앵커 기준 y 오프셋)
 *   다른 방 가구: 앵커 = (col·16 + w·8, (row+h)·16). 스팟 발끝은 가구 앞(+14) → 캐릭터가 가구 앞.
 *   바닥 장식(케이블·현관 매트·러그)은 바닥 층, 출입문은 가구 층(캐릭터 아래).
 */

export const OFFICE_ATLAS_URL = 'assets/office.json'

export const OFFICE_FRAMES = {
  floor: ['tile_floor_0', 'tile_floor_1', 'tile_floor_2'],
  wallTop: 'tile_wall_top_0',
  wall: ['tile_wall_0', 'tile_wall_1'],
  partitionH: 'tile_partition_h_0',
  partitionHLeft: 'tile_partition_h_left_0',
  partitionHRight: 'tile_partition_h_right_0',
  partitionHJoin: 'tile_partition_h_join_0',
  desk: 'furn_desk',
  chair: 'furn_chair',
  bossDesk: 'furn_desk_boss',
  bossChair: 'furn_chair_boss',
  signLeft: 'furn_teamsign_left',
  signMid: 'furn_teamsign_mid',
  signRight: 'furn_teamsign_right',
  plant: 'furn_plant',
  window: 'furn_window',
  corkboard: 'furn_corkboard',
} as const

/** 다른 방 가구(요약 3절). 배열 = 애니메이션 프레임 순서(office.json animations 와 같음) */
export const ROOM_FRAMES = {
  bookshelf: 'furn_bookshelf',
  cabinet: 'furn_cabinet',
  cabinetOpen: 'furn_cabinet_open',
  shredder: 'furn_shredder',
  shredderOn: ['furn_shredder_on_0', 'furn_shredder_on_1'],
  serverRack: ['furn_server_rack_0', 'furn_server_rack_1', 'furn_server_rack_2'],
  terminal: 'furn_terminal',
  terminalBusy: ['furn_terminal_busy_0', 'furn_terminal_busy_1', 'furn_terminal_busy_2'],
  cables: 'furn_cables',
  whiteboard: 'furn_whiteboard',
  whiteboardWritten: 'furn_whiteboard_written',
  meetingTable: 'furn_table_meeting',
  meetingChair: 'furn_chair_meeting',
  coffee: 'furn_coffee',
  coffeeBrew: ['furn_coffee_brew_0', 'furn_coffee_brew_1'],
  sofa: 'furn_sofa',
  globe: 'furn_globe',
  phone: 'furn_phone',
  /** 닫힘 → 반쯤 → 열림 (furn_door_open 애니메이션) */
  door: ['furn_door', 'furn_door_ajar', 'furn_door_open'],
  doormat: 'furn_doormat',
  rug: 'furn_rug',
} as const

/** 애니메이션 간격(ms) — 요약 4절 */
export const ANIM_MS = {
  rackIdle: 500,
  rackBusy: 100,
  terminalBusy: 150,
  shredder: 150,
  coffee: 250,
  door: 80,
} as const

/** 책상 앵커 기준 오프셋(요약 "가구 배치 규칙" 표) */
export const OFFSET = {
  staffFeet: 8,
  staffChair: 11,
  bossChair: -15,
  bossFeet: -14,
  /** 회의 의자·터미널 의자 = 앉은 사람 발끝 + 3 (직원 의자와 같은 규칙) */
  seatChair: 3,
} as const

/** 팀 간판 판 위치(간판 왼쪽 위 기준 px). office.json meta.sign 과 같은 뜻 */
export interface SignGeometry {
  pieceW: number
  pieceH: number
  panelInsetX: number
  panelTop: number
  panelHeight: number
  textPadX: number
}

export const DEFAULT_SIGN: SignGeometry = {
  pieceW: 16,
  pieceH: 32,
  panelInsetX: 6,
  panelTop: 4,
  panelHeight: 12,
  textPadX: 2,
}

/** meta.sign 을 안전하게 읽는다(빠진 값은 기본값) */
export function parseSignMeta(meta: unknown): SignGeometry {
  const raw =
    typeof meta === 'object' && meta !== null ? (meta as { sign?: unknown }).sign : undefined
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SIGN
  const r = raw as Record<string, unknown>
  const num = (k: keyof SignGeometry) => {
    const v = r[k]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_SIGN[k]
  }
  return {
    pieceW: num('pieceW'),
    pieceH: num('pieceH'),
    panelInsetX: num('panelInsetX'),
    panelTop: num('panelTop'),
    panelHeight: num('panelHeight'),
    textPadX: num('textPadX'),
  }
}

// ---------------------------------------------------------------------------
// 업무 공간 가구 배치 (앵커 = 바닥 접점)
// ---------------------------------------------------------------------------

export interface Placement {
  /** 앵커 x(가운데) — 간판은 왼쪽 끝 */
  x: number
  /** 앵커 y(바닥 접점) = 정렬 y */
  y: number
}

/** 팀장 발끝(mainDesk 스팟) */
function bossFeet(): { x: number; y: number } {
  const s = SPOTS.mainDesk
  const f = tileFoot(s.tile)
  const off = s.slots[0] ?? [0, 0]
  return { x: f.x + off[0], y: f.y + off[1] }
}

const WORK = ROOMS.find((r) => r.id === 'work')?.area ?? { col: 0, row: 0, w: 0, h: 0 }

function isWorkProp(p: Prop): boolean {
  return p.col >= WORK.col && p.col < WORK.col + WORK.w
}

/**
 * 업무 공간 책상류의 앵커(스팟 발끝 기준 규칙). 그 밖의 가구는 null → roomPropSprite 규칙.
 * - desk / chair: 같은 직원 자리(prop 은 두 칸 폭, 가운데 = 자리) — 발끝(타일 바닥 −2) 기준
 * - mainDesk / mainChair: 팀장 발끝 기준
 * - teamSign: 왼쪽 끝 x, 바닥 = 간판 칸 아래 끝
 * - plant(업무 공간): 가운데 x, 바닥 = 칸 아래 끝
 */
export function placementOf(p: Prop): Placement | null {
  const cx = p.col * TILE + (p.w * TILE) / 2
  switch (p.kind) {
    case 'desk': {
      // 책상 칸 바로 아래가 자리: 발끝 = (row+1)·16 + 14
      const feet = (p.row + 1) * TILE + TILE - 2
      return { x: cx, y: feet - OFFSET.staffFeet }
    }
    case 'chair': {
      const feet = p.row * TILE + TILE - 2
      return { x: cx, y: feet - OFFSET.staffFeet + OFFSET.staffChair }
    }
    case 'mainDesk': {
      const b = bossFeet()
      return { x: b.x, y: b.y - OFFSET.bossFeet }
    }
    case 'mainChair': {
      const b = bossFeet()
      return { x: b.x, y: b.y - OFFSET.bossFeet + OFFSET.bossChair }
    }
    case 'teamSign':
      return { x: p.col * TILE, y: (p.row + p.h) * TILE }
    case 'plant':
      return isWorkProp(p) ? { x: cx, y: (p.row + p.h) * TILE } : null
    default:
      return null
  }
}

/** 간판 가운데 조각 수 (폭 = pieceW × (2 + mids)) */
export function signMids(p: Prop, geo: SignGeometry = DEFAULT_SIGN): number {
  return Math.max(1, Math.round((p.w * TILE) / geo.pieceW) - 2)
}

/** 간판 글자 영역(기준 해상도 px). 판 가운데 정렬은 렌더러가 한다 */
export function signTextBox(
  p: Prop,
  geo: SignGeometry = DEFAULT_SIGN,
): { x: number; y: number; w: number; h: number } {
  const w = geo.pieceW * (2 + signMids(p, geo))
  const top = (p.row + p.h) * TILE - geo.pieceH
  const inset = geo.panelInsetX + geo.textPadX
  return { x: p.col * TILE + inset, y: top + geo.panelTop, w: w - 2 * inset, h: geo.panelHeight }
}

// ---------------------------------------------------------------------------
// 다른 방 가구 (요약 3절) — 앵커 (0.5, 1) = 바닥 접점 가운데
// ---------------------------------------------------------------------------

/** floor = 바닥 장식(바닥 타일 바로 위), under = 가구 층(캐릭터 아래), depth = 캐릭터 층 y 정렬 */
export type PropLayer = 'floor' | 'under' | 'depth'

export interface PropSprite {
  /** 기본(정지) 프레임 */
  frame: string
  x: number
  y: number
  layer: PropLayer
}

/** 모든 방 가구 공통 앵커 = (col·16 + w·8, (row+h)·16) — floorplan.ts propAnchor */
export function propAnchor(p: Pick<Prop, 'col' | 'row' | 'w' | 'h'>): { x: number; y: number } {
  return { x: p.col * TILE + p.w * (TILE / 2), y: (p.row + p.h) * TILE }
}

const ROOM_PROP_FRAME: Partial<Record<PropKind, string>> = {
  bookshelf: ROOM_FRAMES.bookshelf,
  cabinet: ROOM_FRAMES.cabinet,
  shredder: ROOM_FRAMES.shredder,
  serverRack: ROOM_FRAMES.serverRack[0],
  terminal: ROOM_FRAMES.terminal,
  cables: ROOM_FRAMES.cables,
  whiteboard: ROOM_FRAMES.whiteboard,
  commonTable: ROOM_FRAMES.meetingTable,
  coffee: ROOM_FRAMES.coffee,
  sofa: ROOM_FRAMES.sofa,
  globe: ROOM_FRAMES.globe,
  phone: ROOM_FRAMES.phone,
  door: ROOM_FRAMES.door[0],
  plant: OFFICE_FRAMES.plant,
}

/**
 * 업무 공간 책상류(placementOf)와 창문을 뺀 가구의 스프라이트 배치. 해당 없으면 null.
 * 애니메이션·상태 프레임은 렌더러가 같은 자리에서 텍스처만 바꾼다.
 */
export function roomPropSprite(p: Prop): PropSprite | null {
  if (placementOf(p) !== null) return null
  const frame = ROOM_PROP_FRAME[p.kind]
  if (frame === undefined) return null
  const layer: PropLayer = p.kind === 'cables' ? 'floor' : p.kind === 'door' ? 'under' : 'depth'
  return { frame, ...propAnchor(p), layer }
}

/**
 * layout 에 없는 장식(요약 3·5절): 회의 의자(commonTable 슬롯 0·1·2), 서버실 터미널 의자,
 * 현관 매트(door 스팟 발밑), 휴게실 러그(소파 앞). 프레임이 없으면 그리지 않는다(코드 그림 대체 없음).
 */
export function roomExtras(): PropSprite[] {
  const seat = (id: SpotId, slot: number, frame: string): PropSprite => {
    const f = spotPosition(id, slot)
    return { frame, x: f.x, y: f.y + OFFSET.seatChair, layer: 'depth' }
  }
  const door = spotPosition('door', 0)
  const sofa = PROPS.find((p) => p.kind === 'sofa')
  const out: PropSprite[] = [
    seat('commonTable', 0, ROOM_FRAMES.meetingChair),
    seat('commonTable', 1, ROOM_FRAMES.meetingChair),
    seat('commonTable', 2, ROOM_FRAMES.meetingChair),
    seat('serverTerminal', 0, OFFICE_FRAMES.chair),
    // 매트 = 문(2칸) 가운데, door 스팟 발끝 + 2 (요약: 매트 기준 발끝 (−8, −2))
    { frame: ROOM_FRAMES.doormat, x: door.x + 8, y: door.y + 2, layer: 'floor' },
  ]
  // 러그 = 소파 앞(소파 앵커 위 14px)
  if (sofa !== undefined) {
    const a = propAnchor(sofa)
    out.push({ frame: ROOM_FRAMES.rug, x: a.x, y: a.y - 14, layer: 'floor' })
  }
  return out
}

// ---------------------------------------------------------------------------
// 층 전체 타일 (바닥·벽·칸막이·출입구) — floorplan.ts floorTileMap 과 같은 규칙
// ---------------------------------------------------------------------------

/** 칸 양쪽 바닥 종류: work(업무 공간), 방 바닥, out(건물 바깥) */
export type Side = 'work' | 'wood' | 'carpet' | 'metal' | 'tile' | 'out'
type RoomFloor = Exclude<Side, 'work' | 'out'>

/** 방 경계 타일 이름(요약 2절: 이름의 {왼}_{오} = 그 칸 왼쪽/오른쪽 바닥) */
export const WALL_FRAME = {
  v: (l: Side, r: Side) => `tile_wall_v_${l}_${r}_0`,
  vEnd: (l: Side, r: Side) => `tile_wall_v_end_${l}_${r}_0`,
  vTop: (l: Side, r: Side) => `tile_wall_v_top_${l}_${r}_0`,
  teeLeft: (l: Side, r: Side) => `tile_wall_tee_left_${l}_${r}_0`,
  teeRight: (l: Side, r: Side) => `tile_wall_tee_right_${l}_${r}_0`,
  h: (below: Side) => `tile_wall_h_${below}_0`,
  doorway: (l: Side, r: Side) => `tile_doorway_${l}_${r}_0`,
  topEdgeLeft: 'tile_wall_top_edge_left_0',
  topEdgeRight: 'tile_wall_top_edge_right_0',
  edgeLeft: 'tile_wall_edge_left_0',
  edgeRight: 'tile_wall_edge_right_0',
  cornerLeft: 'tile_wall_corner_left_0',
  cornerRight: 'tile_wall_corner_right_0',
} as const

/** 업무 공간 바닥 변형(결정적): 대부분 _0, 가끔 _1·_2 */
export function floorFrame(col: number, row: number): string {
  const h = (col * 7 + row * 13) % 11
  return h === 0
    ? OFFICE_FRAMES.floor[1]
    : h === 5
      ? OFFICE_FRAMES.floor[2]
      : OFFICE_FRAMES.floor[0]
}

/** 방 바닥 변형(결정적): 대부분 _0, 다섯 칸에 하나꼴 _1 */
export function roomFloorFrame(kind: RoomFloor, col: number, row: number): string {
  return `tile_floor_${kind}_${(col * 7 + row * 13) % 5 === 0 ? 1 : 0}`
}

const inArea = (r: Room['area'], c: number, w: number) =>
  c >= r.col && c < r.col + r.w && w >= r.row && w < r.row + r.h

function floorSideAt(col: number, row: number): Exclude<Side, 'out'> | null {
  const room = ROOMS.find((r) => inArea(r.area, col, row))
  if (room === undefined) return null
  return room.floor === 'checker' ? 'work' : room.floor
}

export interface TilePlacement {
  col: number
  row: number
  frame: string
}

/** 층 전체 타일(칸마다 하나, 불투명 — 바닥을 따로 깔지 않는다). 행 순서대로 */
export function officeTiles(): TilePlacement[] {
  const last = COLS - 1
  const bottom = ROWS - 1
  const side = (c: number, r: number): Side =>
    c < 0 || c > last ? 'out' : (floorSideAt(c, r) ?? 'out')
  const isDoorway = (c: number, r: number) => DOORWAYS.some((d) => d.col === c && d.row === r)
  const doorCols = new Set([DOOR_OUTSIDE.col, DOOR_OUTSIDE.col + 1])
  const wall = (c: number, r: number) => c >= 0 && c <= last && isWall(c, r)

  const out: TilePlacement[] = []
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let f: string
      if (r === 0)
        f =
          c === 0
            ? WALL_FRAME.topEdgeLeft
            : c === last
              ? WALL_FRAME.topEdgeRight
              : OFFICE_FRAMES.wallTop
      else if (r === 1)
        f =
          c === 0
            ? WALL_FRAME.edgeLeft
            : c === last
              ? WALL_FRAME.edgeRight
              : c % 5 === 3
                ? OFFICE_FRAMES.wall[1]
                : OFFICE_FRAMES.wall[0]
      else if (r === bottom) {
        // 아래 벽: 문 자리는 바닥(열린 출입구), 세로 칸막이와 만나는 칸은 join
        if (c === 0) f = WALL_FRAME.cornerLeft
        else if (c === last) f = WALL_FRAME.cornerRight
        else if (doorCols.has(c)) f = floorFrame(c, r)
        else if (wall(c, r - 1)) f = OFFICE_FRAMES.partitionHJoin
        else if (doorCols.has(c + 1)) f = OFFICE_FRAMES.partitionHRight
        else if (doorCols.has(c - 1)) f = OFFICE_FRAMES.partitionHLeft
        else f = OFFICE_FRAMES.partitionH
      } else if (!wall(c, r)) {
        if (isDoorway(c, r)) f = WALL_FRAME.doorway(side(c - 1, r), side(c + 1, r))
        else {
          const k = floorSideAt(c, r) ?? 'work'
          f = k === 'work' ? floorFrame(c, r) : roomFloorFrame(k, c, r)
        }
      } else {
        const edge = c === 0 || c === last
        const hL = c > 0 && wall(c - 1, r) && !edge
        const hR = c < last && wall(c + 1, r) && !edge
        const vertical = edge || wall(c, r - 1) || wall(c, r + 1) || r === 2
        if (vertical && !(hL && hR)) {
          if (c === 0 && wall(c + 1, r)) f = WALL_FRAME.teeRight('out', side(c + 1, r + 1))
          else if (c === last && wall(c - 1, r)) f = WALL_FRAME.teeLeft(side(c - 1, r + 1), 'out')
          else if (hL) f = WALL_FRAME.teeLeft(side(c - 1, r + 1), side(c + 1, r))
          else if (hR) f = WALL_FRAME.teeRight(side(c - 1, r), side(c + 1, r + 1))
          else {
            const l = side(c - 1, r)
            const rr = side(c + 1, r)
            f = isDoorway(c, r + 1)
              ? WALL_FRAME.vEnd(l, rr)
              : isDoorway(c, r - 1)
                ? WALL_FRAME.vTop(l, rr)
                : WALL_FRAME.v(l, rr)
          }
        } else {
          f = WALL_FRAME.h(floorSideAt(c, r + 1) ?? 'work')
        }
      }
      out.push({ col: c, row: r, frame: f })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 방 가구 애니메이션 트리거 — 캐릭터 상태의 투영(새 연출을 만들지 않고 기존 행동에 붙인다)
// ---------------------------------------------------------------------------

/** 렌더러가 매 프레임 넘기는 캐릭터 요약(발끝 기준 해상도 px + 지금 동작) */
export interface ViewSample {
  x: number
  y: number
  anim: string
}

export interface RoomActivity {
  /** 누군가 문 근처(등장·퇴장 중) — 문 열림 */
  doorOpen: boolean
  /** cabinet 스팟에서 search — 서랍 열림 */
  cabinet: boolean
  /** whiteboard 스팟에서 write_board — 보드에 글씨 */
  whiteboard: boolean
  /** shredder 스팟에서 shred — 파쇄기 작동(종이 조각은 프레임에 있음) */
  shredder: boolean
  /** coffee 스팟에서 idle_drink — 커피 추출 */
  coffee: boolean
}

/** 스팟에 "도착해 있다"로 보는 거리(px). 슬롯 오프셋(±9, +5)보다 넓게 */
export const AT_SPOT_PX = 12

/** 문 열림 범위: 문(2칸) 가운데 기준 좌우 dx, 위로는 door 스팟 타일 윗변까지(문 밖 포함) */
export const DOOR_OPEN_RANGE = { dx: 20, top: SPOTS.door.tile.row * TILE } as const

const SPOT_ANIM: readonly (readonly [Exclude<keyof RoomActivity, 'doorOpen'>, SpotId, string])[] = [
  ['cabinet', 'cabinet', 'search'],
  ['whiteboard', 'whiteboard', 'write_board'],
  ['shredder', 'shredder', 'shred'],
  ['coffee', 'coffee', 'idle_drink'],
]

export function roomActivity(views: Iterable<ViewSample>): RoomActivity {
  const doorX = DOOR_OUTSIDE.col * TILE + TILE
  const out: RoomActivity = {
    doorOpen: false,
    cabinet: false,
    whiteboard: false,
    shredder: false,
    coffee: false,
  }
  for (const v of views) {
    if (Math.abs(v.x - doorX) <= DOOR_OPEN_RANGE.dx && v.y >= DOOR_OPEN_RANGE.top)
      out.doorOpen = true
    for (const [key, spot, anim] of SPOT_ANIM) {
      if (v.anim !== anim) continue
      const p = spotPosition(spot, 0)
      if (Math.abs(v.x - p.x) <= AT_SPOT_PX && Math.abs(v.y - p.y) <= AT_SPOT_PX) out[key] = true
    }
  }
  return out
}

/** 서버랙 i 의 지금 프레임 번호: 시작 프레임을 i % n 으로 엇갈린다(요약 4절) */
export function rackFrameIndex(rack: number, step: number, n: number): number {
  return n <= 0 ? 0 : (step + rack) % n
}

/** 문 프레임 번호를 목표(열림 = n−1, 닫힘 = 0)로 한 칸 옮긴다(반복 없음, 닫을 땐 거꾸로) */
export function stepDoor(current: number, open: boolean, n: number): number {
  const target = open ? Math.max(0, n - 1) : 0
  return current < target ? current + 1 : current > target ? current - 1 : current
}

// ---------------------------------------------------------------------------
// 뒤 벽 장식
// ---------------------------------------------------------------------------

/** 뒤 벽에 거는 장식(창문 2개 + 가운데 게시판) — window prop 하나를 대신한다. 앵커 (0.5, 1) */
export function wallDecor(p: Prop): { frame: string; x: number; y: number }[] {
  const x0 = p.col * TILE
  const x1 = (p.col + p.w) * TILE
  const mid = Math.round((x0 + x1) / 2)
  return [
    { frame: OFFICE_FRAMES.window, x: x0 - 8, y: 28 },
    { frame: OFFICE_FRAMES.corkboard, x: mid, y: 26 },
    { frame: OFFICE_FRAMES.window, x: x1 + 8, y: 28 },
  ]
}

// ---------------------------------------------------------------------------
// 프레임 목록
// ---------------------------------------------------------------------------

/** 씬이 쓰는 office 프레임 전체(가구 + 층 타일 지도에 나오는 모든 타일) */
export const OFFICE_FRAME_NAMES: readonly string[] = [
  ...new Set([
    ...Object.values(OFFICE_FRAMES).flat(),
    ...Object.values(ROOM_FRAMES).flat(),
    ...officeTiles().map((t) => t.frame),
  ]),
]

/** 시트에 없는 프레임(로드 직후 1회 경고 — 그 조각만 코드로 그린다) */
export function missingOfficeFrames(has: (name: string) => boolean): string[] {
  return OFFICE_FRAME_NAMES.filter((n) => !has(n))
}
