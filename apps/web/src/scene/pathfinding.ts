import { COLS, isWalkable, ROWS, type TilePos } from './layout'

/*
 * 타일 그리드 4방향 A*. 순수 함수(PixiJS 비의존).
 * 경로가 없으면 L자 이동(가로 → 세로)으로 대체한다 — 캐릭터가 멈춰 서는 것보다 낫다.
 */

const key = (c: number, r: number) => r * COLS + c

export function findPath(
  from: TilePos,
  to: TilePos,
  walkable: (col: number, row: number) => boolean = isWalkable,
): TilePos[] {
  if (from.col === to.col && from.row === to.row) return [to]
  const ok = (c: number, r: number) =>
    c >= 0 &&
    c < COLS &&
    r >= 0 &&
    r < ROWS &&
    (walkable(c, r) || (c === to.col && r === to.row) || (c === from.col && r === from.row))

  const startK = key(from.col, from.row)
  const goalK = key(to.col, to.row)
  const g = new Map<number, number>([[startK, 0]])
  const came = new Map<number, number>()
  const open: { k: number; f: number }[] = [{ k: startK, f: manhattan(from, to) }]
  const closed = new Set<number>()

  while (open.length > 0) {
    let bi = 0
    for (let i = 1; i < open.length; i++) {
      if ((open[i]?.f ?? Infinity) < (open[bi]?.f ?? Infinity)) bi = i
    }
    const cur = open.splice(bi, 1)[0]
    if (cur === undefined) break
    if (cur.k === goalK) return reconstruct(came, goalK)
    if (closed.has(cur.k)) continue
    closed.add(cur.k)
    const cc = cur.k % COLS
    const cr = Math.floor(cur.k / COLS)
    for (const [dc, dr] of DIRS) {
      const nc = cc + dc
      const nr = cr + dr
      if (!ok(nc, nr)) continue
      const nk = key(nc, nr)
      const ng = (g.get(cur.k) ?? 0) + 1
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng)
        came.set(nk, cur.k)
        open.push({ k: nk, f: ng + manhattan({ col: nc, row: nr }, to) })
      }
    }
  }
  return lPath(from, to)
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

function manhattan(a: TilePos, b: TilePos): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row)
}

function reconstruct(came: Map<number, number>, goal: number): TilePos[] {
  const out: TilePos[] = []
  let k: number | undefined = goal
  while (k !== undefined) {
    out.push({ col: k % COLS, row: Math.floor(k / COLS) })
    k = came.get(k)
  }
  out.reverse()
  return out.slice(1) // 시작 타일 제외
}

/** 가로 먼저, 세로 다음 L자 경로(시작 타일 제외) */
export function lPath(from: TilePos, to: TilePos): TilePos[] {
  const out: TilePos[] = []
  const sc = Math.sign(to.col - from.col)
  for (let c = from.col + sc; sc !== 0 && c !== to.col + sc; c += sc)
    out.push({ col: c, row: from.row })
  const sr = Math.sign(to.row - from.row)
  for (let r = from.row + sr; sr !== 0 && r !== to.row + sr; r += sr)
    out.push({ col: to.col, row: r })
  return out.length > 0 ? out : [to]
}
