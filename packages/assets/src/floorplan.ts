import { type FloorKind, type Side, wallName } from './sprites/rooms'

/*
 * 층 배치(apps/web/src/scene/layout.ts 와 같은 모양의 데이터) → office 시트 프레임 배치.
 * 웹 코드에 의존하지 않도록 구조 타입만 받는다. sample.ts 가 실제 layout.ts 를 넘겨 전체 층 그림을 만들고,
 * 씬 담당은 이 규칙(요약 문서의 표)을 그대로 옮기면 된다.
 *
 *  - 타일: floorTileMap() — [row][col] 마다 프레임 하나(불투명, 앵커 0,0). 바닥을 따로 깔 필요 없음.
 *  - 가구: propAnchor() — 모든 가구 앵커 = (col·16 + w·8, (row+h)·16) = 바닥 접점 가운데.
 *    (업무 공간 책상·의자·팀장 책상·간판은 기존 render/officeSheet.ts placementOf 규칙 그대로)
 */

export interface PlanRect {
  col: number
  row: number
  w: number
  h: number
}

export interface PlanRoom {
  area: PlanRect
  floor: 'wood' | 'carpet' | 'metal' | 'tile' | 'checker'
}

export interface Plan {
  cols: number
  rows: number
  rooms: readonly PlanRoom[]
  isWall: (col: number, row: number) => boolean
  doorways: readonly { col: number; row: number }[]
  doorOutside: { col: number; row: number }
}

const inRect = (r: PlanRect, c: number, w: number) =>
  c >= r.col && c < r.col + r.w && w >= r.row && w < r.row + r.h

/** 업무 공간 바닥 변형(결정적) — web render/officeSheet.ts floorFrame 과 같은 식 */
export function workFloorFrame(col: number, row: number): string {
  const h = (col * 7 + row * 13) % 11
  return h === 0 ? 'tile_floor_1' : h === 5 ? 'tile_floor_2' : 'tile_floor_0'
}

/** 방 바닥 변형(결정적): 대부분 _0, 다섯 칸에 하나꼴 _1 */
export function roomFloorFrame(kind: Exclude<FloorKind, 'work'>, col: number, row: number): string {
  return `tile_floor_${kind}_${(col * 7 + row * 13) % 5 === 0 ? 1 : 0}`
}

export function floorKindAt(plan: Plan, col: number, row: number): FloorKind | null {
  const room = plan.rooms.find((r) => inRect(r.area, col, row))
  if (!room) return null
  return room.floor === 'checker' ? 'work' : room.floor
}

/** 층 전체 타일 프레임 [row][col] */
export function floorTileMap(plan: Plan): string[][] {
  const { cols, rows } = plan
  const last = cols - 1
  const bottom = rows - 1
  const kind = (c: number, r: number): Side => {
    if (c < 0 || c > last) return 'out'
    return floorKindAt(plan, c, r) ?? 'out'
  }
  const isDoorway = (c: number, r: number) => plan.doorways.some((d) => d.col === c && d.row === r)
  const doorCols = new Set([plan.doorOutside.col, plan.doorOutside.col + 1])
  const wall = (c: number, r: number) => c >= 0 && c <= last && plan.isWall(c, r)

  const map: string[][] = []
  for (let r = 0; r < rows; r++) {
    const line: string[] = []
    for (let c = 0; c < cols; c++) {
      let f: string
      if (r === 0)
        f =
          c === 0
            ? 'tile_wall_top_edge_left_0'
            : c === last
              ? 'tile_wall_top_edge_right_0'
              : 'tile_wall_top_0'
      else if (r === 1)
        f =
          c === 0
            ? 'tile_wall_edge_left_0'
            : c === last
              ? 'tile_wall_edge_right_0'
              : c % 5 === 3
                ? 'tile_wall_1'
                : 'tile_wall_0'
      else if (r === bottom) {
        if (c === 0) f = 'tile_wall_corner_left_0'
        else if (c === last) f = 'tile_wall_corner_right_0'
        else if (doorCols.has(c)) f = workFloorFrame(c, r)
        else if (wall(c, r - 1)) f = 'tile_partition_h_join_0'
        else if (doorCols.has(c + 1)) f = 'tile_partition_h_right_0'
        else if (doorCols.has(c - 1)) f = 'tile_partition_h_left_0'
        else f = 'tile_partition_h_0'
      } else if (!wall(c, r)) {
        if (isDoorway(c, r)) f = wallName.doorway(kind(c - 1, r), kind(c + 1, r))
        else {
          const k = floorKindAt(plan, c, r) ?? 'work'
          f = k === 'work' ? workFloorFrame(c, r) : roomFloorFrame(k, c, r)
        }
      } else {
        const edge = c === 0 || c === last
        const hL = c > 0 && wall(c - 1, r) && !edge
        const hR = c < last && wall(c + 1, r) && !edge
        const vertical = edge || wall(c, r - 1) || wall(c, r + 1) || r === 2
        if (vertical && !(hL && hR)) {
          if (c === 0 && wall(c + 1, r)) f = wallName.teeRight('out', kind(c + 1, r + 1))
          else if (c === last && wall(c - 1, r)) f = wallName.teeLeft(kind(c - 1, r + 1), 'out')
          else if (hL) f = wallName.teeLeft(kind(c - 1, r + 1), kind(c + 1, r))
          else if (hR) f = wallName.teeRight(kind(c - 1, r), kind(c + 1, r + 1))
          else {
            const l = kind(c - 1, r)
            const rr = kind(c + 1, r)
            f = isDoorway(c, r + 1)
              ? wallName.vEnd(l, rr)
              : isDoorway(c, r - 1)
                ? wallName.vTop(l, rr)
                : wallName.v(l, rr)
          }
        } else {
          const below = floorKindAt(plan, c, r + 1) ?? 'work'
          f = wallName.h(below)
        }
      }
      line.push(f)
    }
    map.push(line)
  }
  return map
}

/** 가구 앵커(바닥 접점 가운데) — 업무 공간 책상류를 뺀 모든 가구 */
export function propAnchor(p: PlanRect): { x: number; y: number } {
  return { x: p.col * 16 + p.w * 8, y: (p.row + p.h) * 16 }
}
