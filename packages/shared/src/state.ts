import { z } from 'zod'
import { MAX_ENDED_SESSIONS } from './constants'
import { IsoTimestamp, MAIN_AGENT_ID, type OfficeEvent, ToolStatus } from './event'
import { ToolCategory } from './tools'

/*
 * OfficeState — 서버(실제 상태)와 web(store)이 같은 reduce 로 계산한다.
 * WS snapshot 으로 전송되므로 zod 스키마로 정의하고 타입은 z.infer 로 얻는다.
 */

export const AgentActivity = z.enum(['idle', 'working', 'waiting', 'gone'])
export type AgentActivity = z.infer<typeof AgentActivity>

export const CurrentTool = z.object({
  name: z.string(),
  category: ToolCategory,
  target: z.string().optional(),
  useId: z.string().optional(),
  /** tool.start 의 ts */
  since: IsoTimestamp,
})
export type CurrentTool = z.infer<typeof CurrentTool>

export const LastToolResult = z.object({
  name: z.string(),
  category: ToolCategory,
  status: ToolStatus,
  at: IsoTimestamp,
})
export type LastToolResult = z.infer<typeof LastToolResult>

export const AgentState = z.object({
  id: z.string(),
  parentId: z.string().optional(),
  /** agent.spawn 의 agentType (서브에이전트 색 변형 해시 키) */
  type: z.string().optional(),
  description: z.string().optional(),
  activity: AgentActivity,
  currentTool: CurrentTool.optional(),
  /** 가장 최근 tool.end 결과. status 'error' 이면 web 이 빨간 "!" 를 띄운다. */
  lastToolResult: LastToolResult.optional(),
  /** activity === 'waiting' 일 때의 사유 */
  attention: z.enum(['permission', 'idle', 'other']).optional(),
  /** 실제 이벤트 기준 마지막 활동 시각(단조 증가). agent.idle 은 갱신하지 않는다. */
  lastEventAt: IsoTimestamp,
  /** agent.finish 시각. 이 시각 이전 ts 의 늦게 도착한 이벤트로는 되살아나지 않는다. */
  finishedAt: IsoTimestamp.optional(),
})
export type AgentState = z.infer<typeof AgentState>

export const SessionState = z.object({
  id: z.string(),
  project: z.string().optional(),
  startedAt: IsoTimestamp,
  endedAt: IsoTimestamp.optional(),
  endReason: z.string().optional(),
  lastEventAt: IsoTimestamp,
  agents: z.record(z.string(), AgentState),
})
export type SessionState = z.infer<typeof SessionState>

export const OfficeState = z.object({
  sessions: z.record(z.string(), SessionState),
})
export type OfficeState = z.infer<typeof OfficeState>

export function createInitialState(): OfficeState {
  return { sessions: {} }
}

// ---------------------------------------------------------------------------
// reduce
// ---------------------------------------------------------------------------

const time = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}
const later = (a: string, b: string): string => (time(b) > time(a) ? b : a)

function newAgent(id: string, ts: string, parentId?: string): AgentState {
  return {
    id,
    ...(parentId !== undefined ? { parentId } : {}),
    activity: 'idle',
    lastEventAt: ts,
  }
}

function newSession(id: string, ts: string): SessionState {
  return { id, startedAt: ts, lastEventAt: ts, agents: {} }
}

/** 종료된 세션이 MAX_ENDED_SESSIONS 를 넘으면 endedAt 이 오래된 것부터 제거한다. */
function trimEnded(sessions: Record<string, SessionState>): Record<string, SessionState> {
  const ended = Object.values(sessions).filter((s) => s.endedAt !== undefined)
  if (ended.length <= MAX_ENDED_SESSIONS) return sessions
  ended.sort((a, b) => time(a.endedAt ?? '') - time(b.endedAt ?? ''))
  const drop = new Set(ended.slice(0, ended.length - MAX_ENDED_SESSIONS).map((s) => s.id))
  return Object.fromEntries(Object.entries(sessions).filter(([id]) => !drop.has(id)))
}

function withoutTool(agent: AgentState): AgentState {
  if (agent.currentTool === undefined) return agent
  const { currentTool: _drop, ...rest } = agent
  return rest
}

function withoutAttention(agent: AgentState): AgentState {
  if (agent.attention === undefined) return agent
  const { attention: _drop, ...rest } = agent
  return rest
}

/** 에이전트에 이벤트 하나를 적용한다. session 수준 처리는 reduce 가 한다. */
function applyToAgent(prev: AgentState | undefined, e: OfficeEvent): AgentState {
  const base = prev ?? newAgent(e.agentId, e.ts, e.parentAgentId)
  const isServerIdle = e.kind === 'agent.idle'
  let a: AgentState = {
    ...base,
    ...(base.parentId === undefined && e.parentAgentId !== undefined
      ? { parentId: e.parentAgentId }
      : {}),
    lastEventAt: isServerIdle ? base.lastEventAt : later(base.lastEventAt, e.ts),
  }

  // finish 이전 시각의 늦은 이벤트: 메타데이터만 반영하고 활동 상태는 건드리지 않는다.
  const staleAfterFinish = a.finishedAt !== undefined && time(e.ts) <= time(a.finishedAt)
  if (staleAfterFinish) {
    if (e.kind === 'agent.spawn') {
      a = {
        ...a,
        ...(e.agentType !== undefined ? { type: e.agentType } : {}),
        ...(e.description !== undefined ? { description: e.description } : {}),
      }
    }
    return a
  }
  // finish 이후 시각의 이벤트(드묾)는 되살린다.
  if (a.finishedAt !== undefined && e.kind !== 'agent.finish' && e.kind !== 'agent.idle') {
    const { finishedAt: _drop, ...rest } = a
    a = { ...rest, activity: 'idle' }
  }

  switch (e.kind) {
    case 'session.start':
      return a.activity === 'gone' ? { ...a, activity: 'idle' } : a
    case 'prompt.submit':
      return { ...withoutAttention(a), activity: 'working' }
    case 'tool.start':
      return {
        ...withoutAttention(a),
        activity: 'working',
        currentTool: {
          name: e.tool.name,
          category: e.tool.category,
          ...(e.tool.target !== undefined ? { target: e.tool.target } : {}),
          ...(e.tool.useId !== undefined ? { useId: e.tool.useId } : {}),
          since: e.ts,
        },
      }
    case 'tool.end': {
      const cur = a.currentTool
      // 짝이 맞으면(useId 동일, 또는 한쪽에 useId 가 없고 이름이 같으면) 현재 도구를 비운다.
      // 짝이 없으면(orphan) 현재 도구는 그대로 둔다 — 병렬 도구 호출 중 다른 도구가 끝난 경우.
      const matches =
        cur !== undefined &&
        (cur.useId !== undefined && e.tool.useId !== undefined
          ? cur.useId === e.tool.useId
          : cur.name === e.tool.name)
      const next = matches ? withoutTool(a) : a
      return {
        ...next,
        activity: next.activity === 'waiting' ? 'waiting' : 'working',
        lastToolResult: {
          name: e.tool.name,
          category: e.tool.category,
          status: e.status,
          at: e.ts,
        },
      }
    }
    case 'agent.spawn':
      return {
        ...a,
        ...(e.agentType !== undefined ? { type: e.agentType } : {}),
        ...(e.description !== undefined ? { description: e.description } : {}),
        activity: a.activity === 'idle' ? 'working' : a.activity,
      }
    case 'agent.finish':
      return { ...withoutAttention(withoutTool(a)), activity: 'gone', finishedAt: e.ts }
    case 'turn.end':
      return { ...withoutAttention(withoutTool(a)), activity: 'idle' }
    case 'attention':
      return { ...a, activity: 'waiting', attention: e.reason }
    case 'agent.idle':
      return a.activity === 'working' ? { ...withoutTool(a), activity: 'idle' } : a
    case 'context.compact':
    case 'session.end':
      return a
    default: {
      // 새 kind 가 추가되면 여기서 컴파일 오류가 난다. 런타임에는 무시한다(throw 금지).
      const _exhaustive: never = e
      void _exhaustive
      return a
    }
  }
}

/**
 * 순수 리듀서. 입력 state 를 변경하지 않고 새 state 를 반환한다. 어떤 입력에도 throw 하지 않는다.
 *
 * 순서·누락 내성
 * - 세션/에이전트가 없으면 lazy 생성한다(session.start·agent.spawn 이 늦게 와도 됨).
 * - 짝 없는 tool.end 는 lastToolResult 만 갱신한다.
 * - spawn 보다 먼저 온 finish: 에이전트를 gone 으로 만들고 finishedAt 을 기록. 이후 도착한
 *   spawn(ts <= finishedAt)은 type/description 만 채우고 되살리지 않는다.
 * - session.end 이후: ts <= endedAt 인 이벤트는 무시, ts > endedAt 이면 세션을 다시 연다
 *   (timeout 으로 정리된 세션이 재개된 경우).
 *
 * 중복 이벤트(id 동일)는 처리하지 않는다 — 서버 hub 가 reduce 전에 최근 ID 집합으로 거른다.
 * web 은 서버가 걸러 보낸 이벤트만 받으므로 따로 거르지 않는다(단, snapshot.recent 와 이후
 * event 가 겹치지 않도록 서버는 snapshot 을 만든 뒤의 이벤트만 그 소켓에 보낸다).
 */
export function reduce(state: OfficeState, event: OfficeEvent): OfficeState {
  try {
    return reduceUnsafe(state, event)
  } catch {
    return state
  }
}

function reduceUnsafe(state: OfficeState, e: OfficeEvent): OfficeState {
  let session = state.sessions[e.sessionId] ?? newSession(e.sessionId, e.ts)

  if (session.endedAt !== undefined) {
    if (time(e.ts) <= time(session.endedAt)) return state // 종료 후 늦게 도착한 이벤트
    // 재개
    const { endedAt: _a, endReason: _b, ...rest } = session
    session = rest
  }

  if (e.kind !== 'agent.idle') {
    session = { ...session, lastEventAt: later(session.lastEventAt, e.ts) }
    if (time(e.ts) < time(session.startedAt)) session = { ...session, startedAt: e.ts }
  }
  if (e.project !== undefined) session = { ...session, project: e.project }

  if (e.kind === 'session.end') {
    const agents = Object.fromEntries(
      Object.entries(session.agents).map(([id, ag]) => [
        id,
        { ...withoutAttention(withoutTool(ag)), activity: 'gone' as const },
      ]),
    )
    session = {
      ...session,
      agents,
      endedAt: e.ts,
      ...(e.reason !== undefined ? { endReason: e.reason } : {}),
    }
    return { ...state, sessions: trimEnded({ ...state.sessions, [session.id]: session }) }
  }

  // agent.idle 은 존재하는 에이전트에만 적용한다(유령 에이전트 생성 방지).
  if (e.kind === 'agent.idle' && session.agents[e.agentId] === undefined) return state

  const agents = { ...session.agents }
  // 서브에이전트 이벤트가 먼저 와도 메인 캐릭터가 화면에 있도록 main 을 보장한다.
  if (agents[MAIN_AGENT_ID] === undefined) agents[MAIN_AGENT_ID] = newAgent(MAIN_AGENT_ID, e.ts)
  agents[e.agentId] = applyToAgent(agents[e.agentId], e)
  session = { ...session, agents }

  return { ...state, sessions: { ...state.sessions, [session.id]: session } }
}
