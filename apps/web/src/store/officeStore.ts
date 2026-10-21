import {
  createInitialState,
  type OfficeEvent,
  type OfficeState,
  reduce,
  type ServerMessage,
} from '@claude-office/shared'
import type { ConnectionStatus } from '../net/socket'

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
  /** 사용자가 고른 세션. null = 자동(가장 최근 활성 세션) */
  selectedSessionId: string | null
  highlightAgentId: string | null
}

export interface SceneListener {
  /** snapshot 수신(재접속 포함) — 씬은 syncAll 로 다시 맞춘다 */
  onSnapshot(state: StoreState): void
  /** 이벤트 하나를 reduce 한 직후 */
  onEvent(event: OfficeEvent, state: StoreState): void
}

const time = (iso: string | undefined): number => {
  if (iso === undefined) return Number.NEGATIVE_INFINITY
  const t = Date.parse(iso)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

/**
 * 기본 세션: 종료되지 않은 세션 중 lastEventAt 최댓값.
 * 없으면 가장 최근에 종료된 세션(조명 꺼진 상태로 보여 준다). 세션이 없으면 null.
 */
export function pickDefaultSession(office: OfficeState): string | null {
  let best: { id: string; t: number } | null = null
  let bestEnded: { id: string; t: number } | null = null
  for (const s of Object.values(office.sessions)) {
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

/** 실제로 사무실에 그릴 세션 */
export function effectiveSessionId(s: StoreState): string | null {
  if (s.selectedSessionId !== null && s.office.sessions[s.selectedSessionId] !== undefined) {
    return s.selectedSessionId
  }
  return pickDefaultSession(s.office)
}

export interface OfficeStore {
  getState(): StoreState
  subscribe(listener: () => void): () => void
  addSceneListener(l: SceneListener): () => void
  applyMessage(msg: ServerMessage, clientNow?: number): void
  setConnection(status: ConnectionStatus): void
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
    selectedSessionId: null,
    highlightAgentId: null,
  }
  /** 서버 시각 - 클라이언트 시각 (ms). 리렌더가 필요 없는 값이라 state 밖에 둔다 */
  let serverOffsetMs = 0
  const listeners = new Set<() => void>()
  const scene = new Set<SceneListener>()

  const set = (next: StoreState) => {
    state = next
    for (const l of listeners) l()
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
          set({ ...state, office: msg.state, recent: msg.recent.slice(-RECENT_UI_LIMIT) })
          for (const l of scene) l.onSnapshot(state)
          break
        case 'event': {
          const e = msg.event
          set({
            ...state,
            office: reduce(state.office, e),
            recent: [...state.recent, e].slice(-RECENT_UI_LIMIT),
          })
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
    selectSession(id) {
      if (id === state.selectedSessionId) return
      set({ ...state, selectedSessionId: id, highlightAgentId: null })
      for (const l of scene) l.onSnapshot(state)
    },
    setHighlight(agentId) {
      if (agentId !== state.highlightAgentId) set({ ...state, highlightAgentId: agentId })
    },
  }
}
