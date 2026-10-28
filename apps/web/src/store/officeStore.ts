import {
  createInitialState,
  type DailyCounts,
  type DailyStats,
  EMPTY_DAILY_COUNTS,
  localDayKey,
  type OfficeEvent,
  type OfficeState,
  reduce,
  type ServerMessage,
} from '@claude-office/shared'
import type { ConnectionStatus } from '../net/socket'
import {
  type FloorKey,
  floorExists,
  floorKeyOf,
  resolveFloor,
  sessionOnFloor,
  updateFloorOrder,
} from './floors'

export { pickDefaultSession } from './floors'

/*
 * 요약 상태 저장소 (React UI 용, 프레임마다 갱신하지 않는다).
 * - snapshot → state 교체 + recent 마지막 50개
 * - event    → shared reduce(state, e) + recent 추가 (reduce 복제 금지)
 * 씬(PixiJS)은 onSnapshot/onEvent 리스너로 같은 흐름을 받아 director 에 넘긴다.
 */

export const RECENT_UI_LIMIT = 50

export interface StoreState {
  connection: ConnectionStatus
  office: OfficeState
  /** 최근 이벤트(오래된 → 최신), 최대 RECENT_UI_LIMIT */
  recent: readonly OfficeEvent[]
  /**
   * 화면이 머무는 층. null = 아직 아무 층도 정해지지 않음.
   * 처음 세션이 보이면 pickDefaultSession 의 층으로 한 번 고정하고, 이후 다른 층 활동으로 바꾸지 않는다.
   */
  selectedFloor: FloorKey | null
  /** 같은 층 안에서 사용자가 고른 세션. null = 그 층의 가장 최근 활동 세션 */
  pinnedSessionId: string | null
  /** 층 번호 순서(처음 나타난 순, 덧붙이기만) */
  floorOrder: readonly FloorKey[]
  /** 현재 층이 아닌 층의 새 활동 횟수 — 탭 깜빡임 트리거 */
  floorPulse: Readonly<Record<FloorKey, number>>
  highlightAgentId: string | null
  /**
   * 오늘 작업량(서버가 센 숫자, 기획서 7절). null = 서버가 보내지 않음(구버전 서버) → 칸을 숨긴다.
   * snapshot.stats 로 채우고 stats 메시지로 통째로 교체한다. web 은 세지 않는다.
   */
  dailyStats: DailyStats | null
}

/**
 * 지금 층의 오늘 숫자. stats 가 없으면(구버전 서버) null.
 * 그 층 숫자가 없거나, stats 의 날짜가 오늘(이 컴퓨터 현지)이 아니면 모두 0.
 */
export function dailyCountsOn(
  stats: DailyStats | null,
  floor: FloorKey | null,
  nowMs: number = Date.now(),
): DailyCounts | null {
  if (stats === null) return null
  if (floor === null || stats.day !== localDayKey(nowMs)) return EMPTY_DAILY_COUNTS
  return stats.floors[floor] ?? EMPTY_DAILY_COUNTS
}

export interface SceneListener {
  /** snapshot 수신(재접속 포함) — 씬은 syncAll 로 다시 맞춘다 */
  onSnapshot(state: StoreState): void
  /** 이벤트 하나를 reduce 한 직후 */
  onEvent(event: OfficeEvent, state: StoreState): void
}

/** 실제로 사무실에 그릴 세션: 고른 층 안에서 pinned 세션 또는 가장 최근 활동 세션 */
export function effectiveSessionId(s: StoreState): string | null {
  return sessionOnFloor(s.office, resolveFloor(s.office, s.selectedFloor), s.pinnedSessionId)
}

/** 화면이 보여 주는 층 */
export function currentFloor(s: StoreState): FloorKey | null {
  return resolveFloor(s.office, s.selectedFloor)
}

export interface OfficeStore {
  getState(): StoreState
  subscribe(listener: () => void): () => void
  addSceneListener(l: SceneListener): () => void
  applyMessage(msg: ServerMessage, clientNow?: number): void
  setConnection(status: ConnectionStatus): void
  /** 층 전환(씬은 resync). 같은 층 안의 세션 고정은 풀린다 */
  selectFloor(key: FloorKey): void
  /** 같은 층 안의 세션 고정. null = 그 층의 가장 최근 활동 세션. 다른 층 세션이면 그 층으로 옮긴다 */
  selectSession(id: string | null): void
  setHighlight(agentId: string | null): void
  /** 서버 시계 기준 현재 시각(epoch ms) — snapshot/heartbeat 의 ts 로 맞춘 오프셋 적용 */
  serverNow(): number
}

export function createOfficeStore(): OfficeStore {
  let state: StoreState = {
    connection: 'connecting',
    office: createInitialState(),
    recent: [],
    selectedFloor: null,
    pinnedSessionId: null,
    floorOrder: [],
    floorPulse: {},
    highlightAgentId: null,
    dailyStats: null,
  }
  /** 서버 시각 - 클라이언트 시각 (ms). 리렌더가 필요 없는 값이라 state 밖에 둔다 */
  let serverOffsetMs = 0
  const listeners = new Set<() => void>()
  const scene = new Set<SceneListener>()

  const set = (next: StoreState) => {
    state = next
    for (const l of listeners) l()
  }

  /** office 가 바뀐 뒤 층 순서·고정 층을 맞춘다 */
  const withFloors = (next: StoreState): StoreState => {
    const floorOrder = updateFloorOrder(next.floorOrder, next.office)
    // 아직 층이 없거나 고른 층의 세션이 모두 사라졌을 때만 기본 층으로 고정
    const selectedFloor = floorExists(next.office, next.selectedFloor)
      ? next.selectedFloor
      : resolveFloor(next.office, null)
    return { ...next, floorOrder, selectedFloor }
  }

  const offsetFrom = (ts: string, clientNow: number): number => {
    const t = Date.parse(ts)
    return Number.isNaN(t) ? serverOffsetMs : t - clientNow
  }

  return {
    getState: () => state,
    serverNow: () => Date.now() + serverOffsetMs,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    addSceneListener(l) {
      scene.add(l)
      return () => scene.delete(l)
    },
    applyMessage(msg, clientNow = Date.now()) {
      switch (msg.type) {
        case 'snapshot':
          serverOffsetMs = offsetFrom(msg.ts, clientNow)
          set(
            withFloors({
              ...state,
              office: msg.state,
              recent: msg.recent.slice(-RECENT_UI_LIMIT),
              dailyStats: msg.stats ?? null,
            }),
          )
          for (const l of scene) l.onSnapshot(state)
          break
        case 'stats':
          // 씬과 무관 — 리렌더만(씬 리스너는 부르지 않는다)
          set({ ...state, dailyStats: msg.stats })
          break
        case 'event': {
          const e = msg.event
          const office = reduce(state.office, e)
          let next = withFloors({
            ...state,
            office,
            recent: [...state.recent, e].slice(-RECENT_UI_LIMIT),
          })
          // 다른 층의 실제 활동이면 그 탭을 깜빡인다(agent.idle 은 서버 합성 이벤트라 제외)
          const session = office.sessions[e.sessionId]
          if (office !== state.office && session !== undefined && e.kind !== 'agent.idle') {
            const key = floorKeyOf(session)
            if (key !== next.selectedFloor) {
              next = {
                ...next,
                floorPulse: { ...next.floorPulse, [key]: (next.floorPulse[key] ?? 0) + 1 },
              }
            }
          }
          set(next)
          for (const l of scene) l.onEvent(e, state)
          break
        }
        case 'heartbeat':
          // 리렌더 없이 오프셋만 갱신
          serverOffsetMs = offsetFrom(msg.ts, clientNow)
          break
        default: {
          const _exhaustive: never = msg
          void _exhaustive
        }
      }
    },
    setConnection(status) {
      if (status !== state.connection) set({ ...state, connection: status })
    },
    selectFloor(key) {
      if (key === state.selectedFloor && state.pinnedSessionId === null) return
      if (!floorExists(state.office, key)) return
      const { [key]: _seen, ...floorPulse } = state.floorPulse
      set({
        ...state,
        selectedFloor: key,
        pinnedSessionId: null,
        floorPulse,
        highlightAgentId: null,
      })
      for (const l of scene) l.onSnapshot(state)
    },
    selectSession(id) {
      if (id === state.pinnedSessionId) return
      const s = id !== null ? state.office.sessions[id] : undefined
      const selectedFloor = s !== undefined ? floorKeyOf(s) : state.selectedFloor
      const floorPulse = { ...state.floorPulse }
      if (selectedFloor !== null) delete floorPulse[selectedFloor]
      set({ ...state, selectedFloor, pinnedSessionId: id, floorPulse, highlightAgentId: null })
      for (const l of scene) l.onSnapshot(state)
    },
    setHighlight(agentId) {
      if (agentId !== state.highlightAgentId) set({ ...state, highlightAgentId: agentId })
    },
  }
}
