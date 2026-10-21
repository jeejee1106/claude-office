import { SCHEMA_VERSION } from './constants'
import type { OfficeEvent } from './event'
import type { AgentState, OfficeState } from './state'

/*
 * 비활성 타임아웃 — 상태 변경 경로를 reduce 하나로 유지하기 위해
 * "상태를 직접 고치는 함수"가 아니라 "적용할 이벤트를 만드는 순수 함수"로 정의한다.
 *
 *   server hub (setInterval, 예: 5초마다):
 *     for (const e of idleSweep(state, Date.now())) { state = reduce(state, e); broadcast(e); record?(e) }
 *
 * 만들어진 이벤트는 일반 이벤트와 똑같이 WS 로 브로드캐스트되므로 web 은 같은 reduce 로 따라간다.
 * web 은 idleSweep 을 호출하지 않는다(시계가 서버와 달라 상태가 갈라진다).
 */

export interface IdleThresholds {
  /** working 에이전트가 이 시간 동안 이벤트가 없고 진행 중 도구가 없으면 idle (기본 60초) */
  agentIdleMs: number
  /** 진행 중 도구(currentTool)가 있어도 이 시간을 넘으면 tool.end 누락으로 보고 idle (기본 10분) */
  staleToolMs: number
  /** 세션이 이 시간 동안 조용하면 session.end(reason 'timeout') (기본 30분) */
  sessionExpireMs: number
  /** web 표시 전용: idle 상태로 이 시간이 지나면 sleep(Zzz) 애니메이션 (기본 5분) */
  sleepMs: number
}

export const DEFAULT_IDLE_THRESHOLDS: Readonly<IdleThresholds> = {
  agentIdleMs: 60_000,
  staleToolMs: 600_000,
  sessionExpireMs: 1_800_000,
  sleepMs: 300_000,
}

const time = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/**
 * 현재 상태와 시각(now, epoch ms)으로 비활성 처리용 이벤트 목록을 만든다. 순수 함수.
 * - 'waiting'(사용자 확인 대기) 에이전트는 건드리지 않는다.
 * - 이벤트 id 는 (종류, 세션, 에이전트, now) 로 결정적으로 만든다 — 같은 입력이면 같은 출력.
 * - 반환 이벤트를 순서대로 reduce 하면 같은 now 로 다시 호출했을 때 빈 배열이 된다.
 */
export function idleSweep(
  state: OfficeState,
  now: number,
  thresholds: Partial<IdleThresholds> = {},
): OfficeEvent[] {
  const t = { ...DEFAULT_IDLE_THRESHOLDS, ...thresholds }
  const ts = new Date(now).toISOString()
  const out: OfficeEvent[] = []

  for (const session of Object.values(state.sessions)) {
    if (session.endedAt !== undefined) continue
    if (now - time(session.lastEventAt) >= t.sessionExpireMs) {
      out.push({
        v: SCHEMA_VERSION,
        id: `srv:session-expire:${session.id}:${now}`,
        ts,
        sessionId: session.id,
        agentId: 'main',
        kind: 'session.end',
        reason: 'timeout',
      })
      continue
    }
    for (const agent of Object.values(session.agents)) {
      if (agent.activity !== 'working') continue
      const quiet = now - time(agent.lastEventAt)
      const limit = agent.currentTool ? t.staleToolMs : t.agentIdleMs
      if (quiet >= limit) {
        out.push({
          v: SCHEMA_VERSION,
          id: `srv:agent-idle:${session.id}:${agent.id}:${now}`,
          ts,
          sessionId: session.id,
          agentId: agent.id,
          kind: 'agent.idle',
        })
      }
    }
  }
  return out
}

/** web 표시 전용: idle 에이전트가 sleep(Zzz) 애니메이션을 할 시각인가. now 는 서버 시각 기준 권장. */
export function isAsleep(
  agent: AgentState,
  now: number,
  thresholds: Partial<IdleThresholds> = {},
): boolean {
  const { sleepMs } = { ...DEFAULT_IDLE_THRESHOLDS, ...thresholds }
  return agent.activity === 'idle' && now - time(agent.lastEventAt) >= sleepMs
}
