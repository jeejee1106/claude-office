import { describe, expect, it } from 'vitest'
import {
  createInitialState,
  DailyStats,
  DailyStatsCounter,
  floorKeyFor,
  localDayKey,
  OfficeEvent,
  reduce,
  ServerMessage,
} from '../src/index'
import { loadSample } from './helpers'

// 현지 시각 생성자로 만들어 실행 환경의 시간대와 무관하게 한다.
const NOW = new Date(2026, 9, 28, 10, 0, 0).getTime()
const BEFORE_MIDNIGHT = new Date(2026, 9, 28, 23, 59, 59).getTime()
const AFTER_MIDNIGHT = new Date(2026, 9, 29, 0, 0, 1).getTime()

let seq = 0
function ev(body: Record<string, unknown>, agentId = 'main', sessionId = 's1'): OfficeEvent {
  return OfficeEvent.parse({
    v: 1,
    id: `st${++seq}`,
    ts: new Date(NOW).toISOString(),
    sessionId,
    agentId,
    project: 'demo',
    ...body,
  })
}
const toolEnd = (name: string, category: string, target?: string, status = 'ok') =>
  ev({ kind: 'tool.end', status, tool: { name, category, ...(target ? { target } : {}) } })

const demo = (c: DailyStatsCounter) => c.toWire().floors['p:demo']

describe('localDayKey / floorKeyFor', () => {
  it('현지 날짜를 YYYY-MM-DD 로', () => {
    expect(localDayKey(NOW)).toBe('2026-10-28')
    expect(localDayKey(AFTER_MIDNIGHT)).toBe('2026-10-29')
  })
  it('web 층 키와 같은 규칙', () => {
    expect(floorKeyFor('demo', 's1')).toBe('p:demo')
    expect(floorKeyFor(undefined, 's1')).toBe('s:s1')
    expect(floorKeyFor('', 's1')).toBe('s:s1')
  })
})

describe('DailyStatsCounter — 세는 규칙', () => {
  it('도구 횟수·명령 수·같은 파일 1번·팀원 수', () => {
    const c = new DailyStatsCounter(NOW)
    c.count(toolEnd('Edit', 'edit', 'a.ts'), NOW)
    c.count(toolEnd('Edit', 'edit', 'a.ts'), NOW) // 같은 파일
    c.count(toolEnd('Write', 'write', 'b.ts'), NOW)
    c.count(toolEnd('Edit', 'edit', 'c.ts', 'error'), NOW) // 실패한 수정은 파일 수 제외
    c.count(toolEnd('Bash', 'bash', 'pnpm'), NOW)
    c.count(toolEnd('Bash', 'bash', 'git', 'error'), NOW) // 실패한 명령도 실행한 명령
    c.count(toolEnd('BashOutput', 'bash'), NOW) // 명령 실행 아님
    c.count(toolEnd('Read', 'read', 'a.ts'), NOW)
    c.count(ev({ kind: 'agent.spawn', agentType: 'Explore' }, 'sub-1'), NOW)
    c.count(ev({ kind: 'agent.spawn', agentType: 'Explore' }, 'sub-1'), NOW) // 같은 팀원
    c.count(ev({ kind: 'agent.spawn', agentType: 'Plan' }, 'sub-2'), NOW)
    c.count(ev({ kind: 'agent.spawn' }, 'main'), NOW) // main 은 팀원 아님
    c.count(toolEnd('Read', 'read', 'x.ts'), NOW) // 읽기는 파일 수 제외
    expect(demo(c)).toEqual({ filesEdited: 2, commands: 2, teammates: 2, toolUses: 9 })
  })

  it('서브에이전트 도구도 같은 층에 합산, tool.start·turn.end 등은 세지 않는다', () => {
    const c = new DailyStatsCounter(NOW)
    expect(c.count(ev({ kind: 'tool.start', tool: { name: 'Bash', category: 'bash' } }), NOW)).toBe(
      false,
    )
    expect(c.count(ev({ kind: 'turn.end' }), NOW)).toBe(false)
    expect(
      c.count(
        ev({ kind: 'tool.end', status: 'ok', tool: { name: 'Bash', category: 'bash' } }, 'sub-1'),
        NOW,
      ),
    ).toBe(true)
    expect(demo(c)).toEqual({ filesEdited: 0, commands: 1, teammates: 0, toolUses: 1 })
  })

  it('target 이 없는 수정은 파일 수에 넣지 않는다(도구 횟수에는 넣는다)', () => {
    const c = new DailyStatsCounter(NOW)
    c.count(toolEnd('Edit', 'edit'), NOW)
    expect(demo(c)).toEqual({ filesEdited: 0, commands: 0, teammates: 0, toolUses: 1 })
  })

  it('같은 층의 여러 세션은 합산, 같은 파일은 세션이 달라도 1번', () => {
    const c = new DailyStatsCounter(NOW)
    const e1 = ev(
      { kind: 'tool.end', status: 'ok', tool: { name: 'Edit', category: 'edit', target: 'a.ts' } },
      'main',
      's1',
    )
    const e2 = ev(
      { kind: 'tool.end', status: 'ok', tool: { name: 'Edit', category: 'edit', target: 'a.ts' } },
      'main',
      's2',
    )
    c.count(e1, NOW)
    c.count(e2, NOW)
    // 같은 agentId 라도 세션이 다르면 다른 팀원
    c.count(ev({ kind: 'agent.spawn' }, 'sub-1', 's1'), NOW)
    c.count(ev({ kind: 'agent.spawn' }, 'sub-1', 's2'), NOW)
    expect(demo(c)).toEqual({ filesEdited: 1, commands: 0, teammates: 2, toolUses: 2 })
  })

  it('층이 다르면 따로 센다. project 가 없으면 state 의 세션 project, 그것도 없으면 세션 층', () => {
    const c = new DailyStatsCounter(NOW)
    c.count(
      ev({
        kind: 'tool.end',
        status: 'ok',
        project: 'other',
        tool: { name: 'Read', category: 'read' },
      }),
      NOW,
    )
    const bare = OfficeEvent.parse({
      v: 1,
      id: 'bare-1',
      ts: new Date(NOW).toISOString(),
      sessionId: 's9',
      agentId: 'main',
      kind: 'tool.end',
      status: 'ok',
      tool: { name: 'Read', category: 'read' },
    })
    c.count(bare, NOW)
    const state = reduce(createInitialState(), ev({ kind: 'session.start' }, 'main', 's9'))
    c.count({ ...bare, id: 'bare-2' }, NOW, state)
    const floors = c.toWire().floors
    expect(floors['p:other']?.toolUses).toBe(1)
    expect(floors['s:s9']?.toolUses).toBe(1)
    expect(floors['p:demo']?.toolUses).toBe(1)
  })
})

describe('DailyStatsCounter — 자정', () => {
  it('rollover: 날짜가 바뀌면 0 으로, 같은 날이면 그대로', () => {
    const c = new DailyStatsCounter(BEFORE_MIDNIGHT)
    c.count(toolEnd('Read', 'read'), BEFORE_MIDNIGHT)
    expect(c.rollover(BEFORE_MIDNIGHT)).toBe(false)
    expect(c.toWire()).toEqual({
      day: '2026-10-28',
      floors: { 'p:demo': { filesEdited: 0, commands: 0, teammates: 0, toolUses: 1 } },
    })
    expect(c.rollover(AFTER_MIDNIGHT)).toBe(true)
    expect(c.toWire()).toEqual({ day: '2026-10-29', floors: {} })
  })

  it('자정 뒤 첫 이벤트는 어제 키를 잊은 상태에서 센다', () => {
    const c = new DailyStatsCounter(BEFORE_MIDNIGHT)
    c.count(toolEnd('Edit', 'edit', 'a.ts'), BEFORE_MIDNIGHT)
    expect(c.count(toolEnd('Edit', 'edit', 'a.ts'), AFTER_MIDNIGHT)).toBe(true)
    expect(c.toWire().day).toBe('2026-10-29')
    expect(demo(c)?.filesEdited).toBe(1)
  })

  it('날짜는 이벤트 ts 가 아니라 서버 시각으로 정한다', () => {
    const c = new DailyStatsCounter(NOW)
    const future = OfficeEvent.parse({
      ...toolEnd('Read', 'read'),
      id: 'future',
      ts: new Date(AFTER_MIDNIGHT + 86_400_000).toISOString(),
    })
    c.count(future, NOW)
    expect(c.toWire().day).toBe('2026-10-28')
    expect(demo(c)?.toolUses).toBe(1)
  })
})

describe('DailyStats — 화면으로 나가는 형식', () => {
  it('숫자만 담는다(파일 이름·명령·에이전트 ID 가 직렬화되지 않음)', () => {
    const c = new DailyStatsCounter(NOW)
    c.count(toolEnd('Edit', 'edit', 'secret-plan.md'), NOW)
    c.count(toolEnd('Bash', 'bash', 'rm'), NOW)
    c.count(ev({ kind: 'agent.spawn', agentType: 'Explore' }, 'agent-xyz'), NOW)
    const json = JSON.stringify(c.toWire())
    expect(json).not.toContain('secret-plan')
    expect(json).not.toContain('"rm"')
    expect(json).not.toContain('agent-xyz')
    expect(DailyStats.safeParse(c.toWire()).success).toBe(true)
  })

  it('toWire 결과를 바꿔도 카운터는 영향받지 않는다', () => {
    const c = new DailyStatsCounter(NOW)
    c.count(toolEnd('Read', 'read'), NOW)
    const w = c.toWire()
    const f = w.floors['p:demo']
    if (f) f.toolUses = 99
    expect(demo(c)?.toolUses).toBe(1)
  })

  it('샘플 세션 전체를 throw 없이 센다', () => {
    const c = new DailyStatsCounter(NOW)
    let state = createInitialState()
    for (const raw of loadSample()) {
      const e = OfficeEvent.parse(raw)
      state = reduce(state, e)
      c.count(e, NOW, state)
    }
    expect(DailyStats.safeParse(c.toWire()).success).toBe(true)
    const floor = c.toWire().floors['p:demo-app']
    expect(floor?.teammates).toBe(1)
    expect((floor?.toolUses ?? 0) > 0).toBe(true)
  })
})

describe('ServerMessage — stats 와 하위 호환', () => {
  const snapshotBase = {
    type: 'snapshot',
    state: { sessions: {} },
    recent: [],
    ts: new Date(NOW).toISOString(),
  }

  it('stats 메시지를 파싱한다', () => {
    const r = ServerMessage.safeParse({
      type: 'stats',
      stats: {
        day: '2026-10-28',
        floors: { 'p:demo': { filesEdited: 1, commands: 2, teammates: 0, toolUses: 5 } },
      },
    })
    expect(r.success).toBe(true)
  })

  it('구버전 서버의 snapshot(stats 없음)도 그대로 통과', () => {
    const r = ServerMessage.safeParse(snapshotBase)
    expect(r.success).toBe(true)
    if (r.success && r.data.type === 'snapshot') expect(r.data.stats).toBeUndefined()
  })

  it('snapshot.stats 형식이 틀리면 그 필드만 버리고 snapshot 은 살린다', () => {
    const r = ServerMessage.safeParse({ ...snapshotBase, stats: { day: 'yesterday', floors: 3 } })
    expect(r.success).toBe(true)
    if (r.success && r.data.type === 'snapshot') expect(r.data.stats).toBeUndefined()
  })

  it('숫자 항목이 빠지거나 이상하면 0 으로, 모르는 항목은 버린다(새 서버·구 web 혼용)', () => {
    const r = DailyStats.safeParse({
      day: '2026-10-28',
      floors: { 'p:demo': { filesEdited: 2, commands: -1, toolUses: 3, futureCounter: 7 } },
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.floors['p:demo']).toEqual({
        filesEdited: 2,
        commands: 0,
        teammates: 0,
        toolUses: 3,
      })
    }
  })
})
