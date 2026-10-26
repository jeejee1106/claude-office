import { describe, expect, it } from 'vitest'
import {
  createInitialState,
  DEFAULT_IDLE_THRESHOLDS,
  idleSweep,
  isAsleep,
  MAX_ENDED_SESSIONS,
  OfficeEvent,
  OfficeState,
  reduce,
  ServerMessage,
} from '../src/index'
import { loadSample } from './helpers'

const T0 = Date.parse('2026-01-01T00:00:00.000Z')
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString()
let seq = 0
function ev(
  sec: number,
  body: Record<string, unknown>,
  agentId = 'main',
  sessionId = 's1',
): OfficeEvent {
  return OfficeEvent.parse({ v: 1, id: `t${++seq}`, ts: at(sec), sessionId, agentId, ...body })
}
const run = (events: OfficeEvent[], state = createInitialState()) => events.reduce(reduce, state)
const sampleEvents = () => loadSample().map((l) => OfficeEvent.parse(l))

describe('reduce — 샘플 세션 전체', () => {
  it('끝까지 throw 없이 적용되고 결과가 OfficeState 스키마를 만족한다', () => {
    const states: OfficeState[] = []
    let s = createInitialState()
    for (const e of sampleEvents()) {
      s = reduce(s, e)
      states.push(s)
      expect(OfficeState.safeParse(s).success).toBe(true)
    }
    const sess = s.sessions.sample
    expect(sess?.project).toBe('demo-app')
    expect(sess?.endedAt).toBe('2026-01-01T00:00:35.000Z')
    expect(sess?.endReason).toBe('exit')
    expect(Object.keys(sess?.agents ?? {}).sort()).toEqual(['main', 'sub-a'])
    expect(sess?.agents.main?.activity).toBe('gone')
    expect(sess?.agents['sub-a']?.activity).toBe('gone')
    expect(sess?.agents['sub-a']?.type).toBe('Explore')
    expect(sess?.agents['sub-a']?.parentId).toBe('main')
  })
})

describe('reduce — 시나리오', () => {
  it('정상 흐름: start → prompt → tool.start → tool.end → turn.end', () => {
    let s = run([ev(0, { kind: 'session.start', project: 'p' })])
    expect(s.sessions.s1?.agents.main?.activity).toBe('idle')

    s = run([ev(1, { kind: 'prompt.submit', length: 3 })], s)
    expect(s.sessions.s1?.agents.main?.activity).toBe('working')

    s = run(
      [
        ev(2, {
          kind: 'tool.start',
          tool: { name: 'Read', category: 'read', target: 'a.ts', useId: 'u1' },
        }),
      ],
      s,
    )
    const m = s.sessions.s1?.agents.main
    expect(m?.activity).toBe('working')
    expect(m?.currentTool).toEqual({
      name: 'Read',
      category: 'read',
      target: 'a.ts',
      useId: 'u1',
      since: at(2),
    })

    s = run(
      [
        ev(3, {
          kind: 'tool.end',
          tool: { name: 'Read', category: 'read', useId: 'u1' },
          status: 'ok',
        }),
      ],
      s,
    )
    expect(s.sessions.s1?.agents.main?.currentTool).toBeUndefined()
    expect(s.sessions.s1?.agents.main?.activity).toBe('working')
    expect(s.sessions.s1?.agents.main?.lastToolResult?.status).toBe('ok')

    s = run([ev(4, { kind: 'turn.end' })], s)
    expect(s.sessions.s1?.agents.main?.activity).toBe('idle')
    expect(s.sessions.s1?.lastEventAt).toBe(at(4))
  })

  it('입력 state 를 변경하지 않는다', () => {
    const s0 = run([ev(0, { kind: 'session.start' })])
    const copy = structuredClone(s0)
    reduce(s0, ev(1, { kind: 'tool.start', tool: { name: 'Bash', category: 'bash' } }))
    reduce(s0, ev(2, { kind: 'session.end' }))
    expect(s0).toEqual(copy)
  })

  it('짝 없는 tool.end 는 throw 하지 않고 진행 중 도구를 지우지 않는다', () => {
    let s = run([
      ev(0, { kind: 'session.start' }),
      ev(1, { kind: 'tool.start', tool: { name: 'Bash', category: 'bash', useId: 'b1' } }),
    ])
    s = reduce(
      s,
      ev(2, {
        kind: 'tool.end',
        tool: { name: 'Read', category: 'read', useId: 'orphan' },
        status: 'ok',
      }),
    )
    expect(s.sessions.s1?.agents.main?.currentTool?.useId).toBe('b1')
    expect(s.sessions.s1?.agents.main?.lastToolResult?.name).toBe('Read')

    // 세션도 에이전트도 없는 상태에서의 tool.end
    const s2 = reduce(
      createInitialState(),
      ev(
        0,
        { kind: 'tool.end', tool: { name: 'Read', category: 'read' }, status: 'ok' },
        'ghost',
        'new',
      ),
    )
    expect(s2.sessions.new?.agents.ghost?.currentTool).toBeUndefined()
    expect(s2.sessions.new?.agents.main).toBeDefined()
  })

  it('병렬 도구: 먼저 시작한 도구의 end 는 나중 도구를 지우지 않는다', () => {
    const s = run([
      ev(0, { kind: 'tool.start', tool: { name: 'Read', category: 'read', useId: 'a' } }),
      ev(0.1, { kind: 'tool.start', tool: { name: 'Grep', category: 'search', useId: 'b' } }),
      ev(0.2, {
        kind: 'tool.end',
        tool: { name: 'Read', category: 'read', useId: 'a' },
        status: 'ok',
      }),
    ])
    expect(s.sessions.s1?.agents.main?.currentTool?.useId).toBe('b')
  })

  it('서브에이전트 spawn → 도구 → finish', () => {
    const s = run([
      ev(0, { kind: 'session.start' }),
      ev(1, { kind: 'agent.spawn', agentType: 'Explore', description: 'find' }, 'sub', 's1'),
      ev(
        2,
        { kind: 'tool.start', parentAgentId: 'main', tool: { name: 'Grep', category: 'search' } },
        'sub',
      ),
    ])
    const sub = s.sessions.s1?.agents.sub
    expect(sub?.activity).toBe('working')
    expect(sub?.type).toBe('Explore')
    expect(sub?.currentTool?.category).toBe('search')

    const s2 = reduce(s, ev(3, { kind: 'agent.finish', status: 'ok' }, 'sub'))
    expect(s2.sessions.s1?.agents.sub?.activity).toBe('gone')
    expect(s2.sessions.s1?.agents.sub?.currentTool).toBeUndefined()
    expect(s2.sessions.s1?.agents.sub?.finishedAt).toBe(at(3))
  })

  it('재개된 서브에이전트(같은 agentId 로 spawn·finish 가 다시 옴): 다시 일하고 다시 퇴장한다', () => {
    let s = run([
      ev(0, { kind: 'session.start' }),
      ev(1, { kind: 'agent.spawn', agentType: 'Explore' }, 'sub'),
      ev(2, { kind: 'agent.finish' }, 'sub'),
      ev(10, { kind: 'agent.spawn', agentType: 'Explore' }, 'sub'),
    ])
    expect(s.sessions.s1?.agents.sub?.activity).toBe('working')
    expect(s.sessions.s1?.agents.sub?.finishedAt).toBeUndefined()

    s = reduce(s, ev(12, { kind: 'agent.finish' }, 'sub'))
    expect(s.sessions.s1?.agents.sub?.activity).toBe('gone')
    expect(s.sessions.s1?.agents.sub?.finishedAt).toBe(at(12))
  })

  it('spawn 보다 먼저 온 finish: throw 없이 gone 유지, 늦은 spawn 은 메타데이터만 채운다', () => {
    const s = run([
      ev(5, { kind: 'agent.finish', parentAgentId: 'main' }, 'sub'),
      ev(1, { kind: 'agent.spawn', parentAgentId: 'main', agentType: 'Plan' }, 'sub'),
      ev(2, { kind: 'tool.start', tool: { name: 'Read', category: 'read' } }, 'sub'),
    ])
    const sub = s.sessions.s1?.agents.sub
    expect(sub?.activity).toBe('gone')
    expect(sub?.type).toBe('Plan')
    expect(sub?.parentId).toBe('main')
    expect(sub?.currentTool).toBeUndefined()
    expect(s.sessions.s1?.startedAt).toBe(at(1))
  })

  it('error 상태: tool.end status=error 가 lastToolResult 에 남고 도구는 비워진다', () => {
    const s = run([
      ev(0, {
        kind: 'tool.start',
        tool: { name: 'Bash', category: 'bash', target: 'pnpm', useId: 'b' },
      }),
      ev(3, {
        kind: 'tool.end',
        tool: { name: 'Bash', category: 'bash', useId: 'b' },
        status: 'error',
      }),
    ])
    const m = s.sessions.s1?.agents.main
    expect(m?.currentTool).toBeUndefined()
    expect(m?.lastToolResult).toEqual({
      name: 'Bash',
      category: 'bash',
      status: 'error',
      at: at(3),
    })
  })

  it('attention → waiting, 다음 도구 시작 시 해제', () => {
    let s = run([ev(0, { kind: 'attention', reason: 'permission' })])
    expect(s.sessions.s1?.agents.main?.activity).toBe('waiting')
    expect(s.sessions.s1?.agents.main?.attention).toBe('permission')
    s = reduce(s, ev(1, { kind: 'tool.start', tool: { name: 'Bash', category: 'bash' } }))
    expect(s.sessions.s1?.agents.main?.activity).toBe('working')
    expect(s.sessions.s1?.agents.main?.attention).toBeUndefined()
  })

  it('attention.clear: 허락 뒤 "?" 해제, 진행 중 도구는 유지하고 working 으로', () => {
    let s = run([
      ev(0, { kind: 'tool.start', tool: { name: 'Bash', category: 'bash', useId: 'u1' } }),
      ev(1, { kind: 'attention', reason: 'permission' }),
    ])
    expect(s.sessions.s1?.agents.main?.activity).toBe('waiting')
    s = reduce(s, ev(2, { kind: 'attention.clear', reason: 'permission' }))
    const m = s.sessions.s1?.agents.main
    expect(m?.attention).toBeUndefined()
    expect(m?.activity).toBe('working')
    expect(m?.currentTool?.useId).toBe('u1')
    expect(m?.lastEventAt).toBe(at(2))
  })

  it('attention.clear: 팀장이 Agent 호출을 허락 → 서브에이전트 입장과 함께 팀장 "?" 해제', () => {
    let s = run([
      ev(0, { kind: 'tool.start', tool: { name: 'Agent', category: 'agent', useId: 'a1' } }),
      ev(1, { kind: 'attention', reason: 'permission' }),
      ev(2, { kind: 'attention.clear', reason: 'permission' }),
      ev(2, { kind: 'agent.spawn', agentType: 'Explore' }, 'sub'),
    ])
    expect(s.sessions.s1?.agents.main?.attention).toBeUndefined()
    expect(s.sessions.s1?.agents.main?.activity).toBe('working')
    expect(s.sessions.s1?.agents.main?.currentTool?.name).toBe('Agent')
    // 서브에이전트가 일하는 동안 팀장 tool.end 가 없어도 "?"는 다시 생기지 않는다
    s = reduce(s, ev(30, { kind: 'tool.start', tool: { name: 'Read', category: 'read' } }, 'sub'))
    expect(s.sessions.s1?.agents.main?.attention).toBeUndefined()
  })

  it('attention.clear: reason 이 다르면 그대로, reason 이 없으면 사유와 관계없이 해제', () => {
    let s = run([ev(0, { kind: 'attention', reason: 'other' })])
    s = reduce(s, ev(1, { kind: 'attention.clear', reason: 'permission' }))
    expect(s.sessions.s1?.agents.main?.attention).toBe('other')
    expect(s.sessions.s1?.agents.main?.activity).toBe('waiting')
    s = reduce(s, ev(2, { kind: 'attention.clear' }))
    expect(s.sessions.s1?.agents.main?.attention).toBeUndefined()
    expect(s.sessions.s1?.agents.main?.activity).toBe('working')
  })

  it('attention.clear: attention 이 없으면 activity 를 바꾸지 않는다', () => {
    let s = run([ev(0, { kind: 'turn.end' })])
    s = reduce(s, ev(1, { kind: 'attention.clear' }))
    expect(s.sessions.s1?.agents.main?.activity).toBe('idle')
  })

  it('attention.clear: 없는 에이전트를 만들지 않고, 끝난 에이전트·세션을 되살리지 않는다', () => {
    let s = run([ev(0, { kind: 'session.start' })])
    const before = s
    s = reduce(s, ev(1, { kind: 'attention.clear' }, 'ghost'))
    expect(s).toBe(before)

    s = run(
      [
        ev(2, { kind: 'agent.spawn' }, 'sub'),
        ev(3, { kind: 'attention', reason: 'permission' }, 'sub'),
        ev(4, { kind: 'agent.finish' }, 'sub'),
        ev(5, { kind: 'attention.clear' }, 'sub'),
      ],
      s,
    )
    expect(s.sessions.s1?.agents.sub?.activity).toBe('gone')
    expect(s.sessions.s1?.agents.sub?.finishedAt).toBe(at(4))

    s = reduce(s, ev(6, { kind: 'session.end', reason: 'exit' }))
    const ended = s
    s = reduce(s, ev(7, { kind: 'attention.clear' }))
    expect(s).toBe(ended)
    expect(s.sessions.s1?.endedAt).toBe(at(6))
  })

  it('session.end: 전원 gone, 이후 늦게 도착한 이벤트는 무시, 더 늦은 이벤트는 세션 재개', () => {
    let s = run([
      ev(0, { kind: 'session.start' }),
      ev(1, { kind: 'agent.spawn' }, 'sub'),
      ev(2, { kind: 'tool.start', tool: { name: 'Read', category: 'read' } }, 'sub'),
      ev(10, { kind: 'session.end', reason: 'exit' }),
    ])
    expect(s.sessions.s1?.endedAt).toBe(at(10))
    expect(Object.values(s.sessions.s1?.agents ?? {}).every((a) => a.activity === 'gone')).toBe(
      true,
    )
    expect(s.sessions.s1?.agents.sub?.currentTool).toBeUndefined()

    const late = reduce(s, ev(9, { kind: 'tool.start', tool: { name: 'Read', category: 'read' } }))
    expect(late).toBe(s)

    s = reduce(s, ev(20, { kind: 'prompt.submit' }))
    expect(s.sessions.s1?.endedAt).toBeUndefined()
    expect(s.sessions.s1?.agents.main?.activity).toBe('working')
    expect(s.sessions.s1?.agents.sub?.activity).toBe('gone')
  })

  it(`종료된 세션은 최대 ${MAX_ENDED_SESSIONS}개만 남긴다`, () => {
    const events: OfficeEvent[] = []
    for (let i = 0; i < MAX_ENDED_SESSIONS + 3; i++) {
      events.push(ev(i, { kind: 'session.start' }, 'main', `x${i}`))
      events.push(ev(i + 0.5, { kind: 'session.end' }, 'main', `x${i}`))
    }
    events.push(ev(100, { kind: 'session.start' }, 'main', 'live'))
    const s = run(events)
    expect(Object.keys(s.sessions)).toHaveLength(MAX_ENDED_SESSIONS + 1)
    expect(s.sessions.x0).toBeUndefined()
    expect(s.sessions.live).toBeDefined()
  })

  it('중복 id 는 reduce 가 거르지 않는다(서버 hub 책임) — 같은 이벤트 두 번도 throw 없음', () => {
    const e = ev(0, { kind: 'tool.start', tool: { name: 'Read', category: 'read' } })
    const s = run([e, e])
    expect(s.sessions.s1?.agents.main?.currentTool?.name).toBe('Read')
  })
})

describe('idleSweep / isAsleep', () => {
  it('60초 조용한 working 에이전트에 agent.idle 을 만들고, 적용 후에는 빈 배열', () => {
    let s = run([ev(0, { kind: 'session.start' }), ev(1, { kind: 'prompt.submit' })])
    expect(idleSweep(s, T0 + 30_000)).toEqual([])

    const now = T0 + 61_000
    const out = idleSweep(s, now)
    expect(out).toHaveLength(1)
    expect(out[0]?.kind).toBe('agent.idle')
    expect(idleSweep(s, now)).toEqual(out) // 결정적
    for (const e of out) s = reduce(s, e)
    expect(s.sessions.s1?.agents.main?.activity).toBe('idle')
    expect(s.sessions.s1?.agents.main?.lastEventAt).toBe(at(1)) // agent.idle 은 lastEventAt 갱신 안 함
    expect(idleSweep(s, now)).toEqual([])
  })

  it('진행 중 도구가 있으면 staleToolMs 까지 기다린다, waiting 은 건드리지 않는다', () => {
    const s = run([
      ev(0, { kind: 'tool.start', tool: { name: 'Bash', category: 'bash' } }),
      ev(0, { kind: 'attention', reason: 'permission' }, 'sub'),
    ])
    expect(idleSweep(s, T0 + 120_000)).toEqual([])
    const out = idleSweep(s, T0 + DEFAULT_IDLE_THRESHOLDS.staleToolMs)
    expect(out.map((e) => e.agentId)).toEqual(['main'])
    const after = run(out, s)
    expect(after.sessions.s1?.agents.main?.currentTool).toBeUndefined()
  })

  it('30분 조용한 세션은 session.end(timeout)', () => {
    let s = run([ev(0, { kind: 'session.start' })])
    const out = idleSweep(s, T0 + DEFAULT_IDLE_THRESHOLDS.sessionExpireMs)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'session.end', reason: 'timeout' })
    s = run(out, s)
    expect(s.sessions.s1?.endReason).toBe('timeout')
    expect(idleSweep(s, T0 + 10 * DEFAULT_IDLE_THRESHOLDS.sessionExpireMs)).toEqual([])
  })

  it('isAsleep: idle 이고 sleepMs 경과 시 true', () => {
    const s = run([ev(0, { kind: 'session.start' })])
    const m = s.sessions.s1?.agents.main
    if (!m) throw new Error('main missing')
    expect(isAsleep(m, T0 + 1000)).toBe(false)
    expect(isAsleep(m, T0 + DEFAULT_IDLE_THRESHOLDS.sleepMs)).toBe(true)
  })

  it('idleSweep 이 만든 이벤트는 OfficeEvent 스키마를 통과한다(WS 로 그대로 브로드캐스트 가능)', () => {
    const s = run([ev(0, { kind: 'prompt.submit' })])
    for (const e of [
      ...idleSweep(s, T0 + 61_000),
      ...idleSweep(s, T0 + DEFAULT_IDLE_THRESHOLDS.sessionExpireMs),
    ]) {
      expect(ServerMessage.safeParse({ type: 'event', event: e }).success).toBe(true)
    }
  })
})
