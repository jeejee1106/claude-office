import {
  COLS,
  DOOR_OUTSIDE,
  DOORWAYS,
  isWall,
  type Prop,
  ROOMS,
  ROWS,
  SPOTS,
  TILE,
  tileFoot,
} from '../layout'

/*
 * office 아틀라스(apps/web/public/assets/office.json) 조회·배치 규칙. PixiJS 비의존 — 단위 테스트 대상.
 *
 * 프레임 이름·앵커·배치 오프셋은 pixel-artist 요약(_workspace/02_pixel-artist_summary.md)의 표 그대로다.
 * 이름을 지어내지 않는다. 이번 범위는 업무 공간(바닥·뒤 벽·칸막이·책상·의자·간판·화분·창문)뿐이고,
 * 다른 방(자료실·서버실 등)은 지금처럼 코드로 그린다.
 *
 * 깊이: 업무 공간 가구는 캐릭터 층에서 "바닥 접점 y"로 정렬한다(작은 것 먼저).
 *   팀장: 의자(−15) < 캐릭터 발끝(−14) < 큰 책상(0)   — 책상이 하체를 가린다
 *   직원: 책상(0) < 캐릭터 발끝(+8) < 의자(+11)        — 의자 등받이가 몸을 가린다
 *   (괄호 = 책상 앵커 기준 y 오프셋)
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
  partitionV: 'tile_partition_v_0',
  partitionVEnd: 'tile_partition_v_end_0',
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

/** 씬이 쓰는 office 프레임 전체 */
export const OFFICE_FRAME_NAMES: readonly string[] = Object.values(OFFICE_FRAMES).flat()

/** 시트에 없는 프레임(로드 직후 1회 경고 — 그 조각만 코드로 그린다) */
export function missingOfficeFrames(has: (name: string) => boolean): string[] {
  return OFFICE_FRAME_NAMES.filter((n) => !has(n))
}

/** 책상 앵커 기준 오프셋(요약 "가구 배치 규칙" 표) */
export const OFFSET = {
  staffFeet: 8,
  staffChair: 11,
  bossChair: -15,
  bossFeet: -14,
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
// 가구 배치 (앵커 = 바닥 접점)
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

/**
 * 캐릭터 층에서 깊이 정렬로 그리는 업무 공간 가구의 앵커. 그 밖의 가구는 null(가구 층에 타일 좌표로).
 * - desk / chair: 같은 직원 자리(prop 은 두 칸 폭, 가운데 = 자리) — 발끝(타일 바닥 −2) 기준
 * - mainDesk / mainChair: 팀장 발끝 기준
 * - teamSign: 왼쪽 끝 x, 바닥 = 간판 칸 아래 끝
 * - plant: 가운데 x, 바닥 = 칸 아래 끝
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
// 업무 공간 타일 (바닥·뒤 벽·칸막이)
// ---------------------------------------------------------------------------

const WORK = ROOMS.find((r) => r.id === 'work')?.area ?? { col: 0, row: 0, w: 0, h: 0 }
/** 업무 공간 양옆 칸막이 열 */
export const WORK_PARTITION_COLS: readonly number[] = [WORK.col - 1, WORK.col + WORK.w]

function isWorkProp(p: Prop): boolean {
  return p.col >= WORK.col && p.col < WORK.col + WORK.w
}

/** 업무 공간 바닥 변형(결정적): 대부분 _0, 가끔 _1·_2 */
export function floorFrame(col: number, row: number): string {
  const h = (col * 7 + row * 13) % 11
  return h === 0
    ? OFFICE_FRAMES.floor[1]
    : h === 5
      ? OFFICE_FRAMES.floor[2]
      : OFFICE_FRAMES.floor[0]
}

export interface TilePlacement {
  col: number
  row: number
  frame: string
}

/**
 * 업무 공간 구역의 타일 목록(그리는 순서대로: 바닥 → 벽·칸막이).
 * 범위: 업무 공간 + 양옆 칸막이 열 + 그 위 뒤 벽 2줄 + 아래 벽 1줄. 그 밖은 지금처럼 코드로 그린다.
 */
export function workAreaTiles(): TilePlacement[] {
  const [left = 0, right = COLS - 1] = WORK_PARTITION_COLS
  const floor: TilePlacement[] = []
  const walls: TilePlacement[] = []
  const doorCols = new Set([DOOR_OUTSIDE.col, DOOR_OUTSIDE.col + 1])
  for (let c = left; c <= right; c++) {
    // 뒤 벽 2줄
    walls.push({ col: c, row: 0, frame: OFFICE_FRAMES.wallTop })
    walls.push({
      col: c,
      row: 1,
      frame: c % 5 === 3 ? OFFICE_FRAMES.wall[1] : OFFICE_FRAMES.wall[0],
    })
    for (let r = 2; r < ROWS - 1; r++) floor.push({ col: c, row: r, frame: floorFrame(c, r) })
    // 아래 벽: 문 자리는 바닥(열린 출입구), 칸막이 열은 세로와 만나는 칸
    const bottom = ROWS - 1
    if (doorCols.has(c)) {
      floor.push({ col: c, row: bottom, frame: floorFrame(c, bottom) })
    } else {
      const frame =
        c === left || c === right
          ? OFFICE_FRAMES.partitionHJoin
          : doorCols.has(c + 1)
            ? OFFICE_FRAMES.partitionHRight
            : doorCols.has(c - 1)
              ? OFFICE_FRAMES.partitionHLeft
              : OFFICE_FRAMES.partitionH
      walls.push({ col: c, row: bottom, frame })
    }
  }
  // 세로 칸막이: 출입구는 비우고, 출입구 바로 위 칸은 아래 끝(마구리)
  for (const c of [left, right]) {
    for (let r = 2; r < ROWS - 1; r++) {
      if (!isWall(c, r)) continue
      const openBelow = DOORWAYS.some((d) => d.col === c && d.row === r + 1)
      walls.push({
        col: c,
        row: r,
        frame: openBelow ? OFFICE_FRAMES.partitionVEnd : OFFICE_FRAMES.partitionV,
      })
    }
  }
  return [...floor, ...walls]
}

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
