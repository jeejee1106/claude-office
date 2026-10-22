import type { OfficeState, SessionState } from '@claude-office/shared'

/*
 * 층(여러 프로젝트) 계산 — 순수 함수, PixiJS·React 비의존 (기획서 7절 "층(여러 프로젝트)").
 *
 * - 층 = 프로젝트. project 가 없는 세션은 세션마다 따로 한 층(이름은 세션 id 앞부분).
 * - 층 번호는 처음 나타난 순서로 고정한다(floorOrder 는 덧붙이기만 한다).
 * - 화면은 고른 층에 머문다. 층 안에서는 가장 최근 활동 세션을 보여 준다.
 */

/** 층 식별자. 'p:<project>' 또는 'p' 없는 세션은 's:<sessionId>' */
export type FloorKey = string

export interface Floor {
  key: FloorKey
  /** 1부터. 처음 나타난 순서로 고정 */
  number: number
  name: string
  /** 이 층의 세션(최근 활동 순) */
  sessions: readonly SessionState[]
  /** 모든 세션이 종료됨 → 탭을 흐리게 */
  ended: boolean
  /** 확인 필요(권한 요청 또는 waiting) 에이전트가 있음 */
  needsAttention: boolean
}

export interface FloorTab {
  key: FloorKey
  number: number
  name: string
  current: boolean
  ended: boolean
  /** 현재 층이 아닐 때만 true */
  attention: boolean
  /** 다른 층의 새 활동 횟수(바뀔 때마다 한 번 깜빡인다). 현재 층은 0 */
  pulse: number
}

const time = (iso: string | undefined): number => {
  if (iso === undefined) return Number.NEGATIVE_INFINITY
  const t = Date.parse(iso)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

export const shortId = (id: string): string => (id.length > 8 ? id.slice(0, 8) : id)

export function floorKeyOf(s: SessionState): FloorKey {
  return s.project !== undefined && s.project !== '' ? `p:${s.project}` : `s:${s.id}`
}

export function floorNameOf(s: SessionState): string {
  return s.project !== undefined && s.project !== '' ? s.project : shortId(s.id)
}

/**
 * 기본 세션: 종료되지 않은 세션 중 lastEventAt 최댓값.
 * 없으면 가장 최근에 종료된 세션(조명 꺼진 상태로 보여 준다). 세션이 없으면 null.
 */
export function pickDefaultSession(
  office: OfficeState,
  sessions: Iterable<SessionState> = Object.values(office.sessions),
): string | null {
  let best: { id: string; t: number } | null = null
  let bestEnded: { id: string; t: number } | null = null
  for (const s of sessions) {
    if (s.endedAt === undefined) {
      const t = time(s.lastEventAt)
      if (best === null || t > best.t) best = { id: s.id, t }
    } else {
      const t = time(s.endedAt)
      if (bestEnded === null || t > bestEnded.t) bestEnded = { id: s.id, t }
    }
  }
  return best?.id ?? bestEnded?.id ?? null
}

/** 층별 세션 묶음 */
function groupByFloor(office: OfficeState): Map<FloorKey, SessionState[]> {
  const m = new Map<FloorKey, SessionState[]>()
  for (const s of Object.values(office.sessions)) {
    const k = floorKeyOf(s)
    const list = m.get(k)
    if (list === undefined) m.set(k, [s])
    else list.push(s)
  }
  return m
}

/**
 * 새로 나타난 층을 뒤에 덧붙인다(기존 순서는 절대 바꾸지 않는다).
 * 한 번에 여러 층이 새로 나타나면(첫 snapshot) 가장 이른 startedAt 순.
 * 바뀐 것이 없으면 prev 를 그대로 돌려준다(참조 유지).
 */
export function updateFloorOrder(
  prev: readonly FloorKey[],
  office: OfficeState,
): readonly FloorKey[] {
  const known = new Set(prev)
  const fresh: { key: FloorKey; t: number }[] = []
  for (const [key, list] of groupByFloor(office)) {
    if (known.has(key)) continue
    fresh.push({ key, t: Math.min(...list.map((s) => time(s.startedAt))) })
  }
  if (fresh.length === 0) return prev
  fresh.sort((a, b) => a.t - b.t || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  return [...prev, ...fresh.map((f) => f.key)]
}

const agentNeedsAttention = (s: SessionState): boolean =>
  Object.values(s.agents).some((a) => a.attention === 'permission' || a.activity === 'waiting')

/** 세션이 있는 층만, 층 번호 순 */
export function listFloors(office: OfficeState, order: readonly FloorKey[]): Floor[] {
  const groups = groupByFloor(office)
  const out: Floor[] = []
  order.forEach((key, i) => {
    const list = groups.get(key)
    if (list === undefined || list.length === 0) return
    const sessions = [...list].sort((a, b) => time(b.lastEventAt) - time(a.lastEventAt))
    out.push({
      key,
      number: i + 1,
      name: floorNameOf(sessions[0] as SessionState),
      sessions,
      ended: sessions.every((s) => s.endedAt !== undefined),
      needsAttention: sessions.some(agentNeedsAttention),
    })
  })
  return out
}

/** 이 층에 세션이 하나라도 있는가 */
export function floorExists(office: OfficeState, key: FloorKey | null): boolean {
  if (key === null) return false
  return Object.values(office.sessions).some((s) => floorKeyOf(s) === key)
}

/**
 * 보여 줄 층: 고른 층에 세션이 남아 있으면 그 층.
 * 아직 고르지 않았거나(null) 그 층의 세션이 모두 사라졌으면 pickDefaultSession 의 층.
 */
export function resolveFloor(office: OfficeState, selected: FloorKey | null): FloorKey | null {
  if (floorExists(office, selected)) return selected
  const id = pickDefaultSession(office)
  const s = id !== null ? office.sessions[id] : undefined
  return s !== undefined ? floorKeyOf(s) : null
}

/**
 * 층 안에서 보여 줄 세션: 사용자가 고른(pinned) 세션이 그 층에 있으면 그것,
 * 아니면 그 층의 pickDefaultSession(가장 최근 활동).
 */
export function sessionOnFloor(
  office: OfficeState,
  floor: FloorKey | null,
  pinned: string | null,
): string | null {
  if (floor === null) return null
  const p = pinned !== null ? office.sessions[pinned] : undefined
  if (p !== undefined && floorKeyOf(p) === floor) return p.id
  return pickDefaultSession(
    office,
    Object.values(office.sessions).filter((s) => floorKeyOf(s) === floor),
  )
}

/** 최근 이벤트 중 이 층 세션의 것만. 세션 정보가 없는 이벤트는 뺀다 */
export function eventsOnFloor<E extends { sessionId: string }>(
  office: OfficeState,
  events: readonly E[],
  floor: FloorKey | null,
): E[] {
  if (floor === null) return []
  return events.filter((e) => {
    const s = office.sessions[e.sessionId]
    return s !== undefined && floorKeyOf(s) === floor
  })
}

/** 상단 층 탭 표시용 */
export function floorTabs(
  office: OfficeState,
  order: readonly FloorKey[],
  current: FloorKey | null,
  pulse: Readonly<Record<FloorKey, number>>,
): FloorTab[] {
  return listFloors(office, order).map((f) => {
    const isCurrent = f.key === current
    return {
      key: f.key,
      number: f.number,
      name: f.name,
      current: isCurrent,
      ended: f.ended,
      attention: !isCurrent && f.needsAttention,
      pulse: isCurrent ? 0 : (pulse[f.key] ?? 0),
    }
  })
}
