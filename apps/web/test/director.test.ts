import {
  createInitialState,
  type OfficeEvent,
  type OfficeState,
  reduce,
} from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import { LINES } from '../src/i18n'
import { LEAVE_REPORT_MAX_MS } from '../src/scene/Character'
import {
  type CharacterCommand,
  type DirectorOutput,
  isCharacterCommand,
} from '../src/scene/commands'
import { Director } from '../src/scene/director'
import { FIXED_VARIANTS, MAIN_VARIANT, VARIANT_COUNT, variantFor } from '../src/scene/variant'
import { ev, loadSampleSession } from './helpers'

/** 이벤트 열을 reduce + director 에 순서대로 흘린다 */
function run(events: OfficeEvent[], director = new Director({ now: () => 0 })) {
  let state: OfficeState = createInitialState()
  const out: { event: OfficeEvent; cmds: DirectorOutput[] }[] = []
  for (const e of events) {
    state = reduce(state, e)
    out.push({ event: e, cmds: director.handle(e, state.sessions[e.sessionId]) })
  }
  return { state, out, director, all: out.flatMap((o) => o.cmds) }
}

const charCmds = (all: DirectorOutput[], agentId: string) =>
  all.filter((c): c is CharacterCommand => isCharacterCommand(c) && c.agentId === agentId)

describe('director × fixtures/sample-session.jsonl', () => {
  const events = loadSampleSession()
  const { out, all, state } = run(events)
  const kindOf = new Map(events.map((e) => [e.id, e.kind]))

  it('29개 이벤트를 throw 없이 처리한다', () => {
    expect(events).toHaveLength(29)
    expect(out).toHaveLength(29)
  })

  it('메인: tool.start·turn.end·context.compact 목표 스팟 순서', () => {
    const spots = charCmds(all, 'main')
      .filter((c) => c.type === 'moveTo')
      .filter((c) =>
        ['tool.start', 'turn.end', 'context.compact'].includes(kindOf.get(c.cause) ?? ''),
      )
      // brief 도구(전화)의 자기 책상 복귀(soft)는 빼고 본다
      .filter((c) => c.type === 'moveTo' && !c.soft)
      .map((c) => (c.type === 'moveTo' ? c.spot : ''))
    expect(spots).toEqual([
      'cabinet',
      'bookshelf',
      'whiteboard',
      'mainDesk', // e09 Agent: 문 앞이 아니라 자기 책상에서 전화
      'mainDesk',
      'serverTerminal',
      'globe',
      'phone',
      'sofaSit', // turn.end: 이벤트 id 해시로 소파 앉기(pickLoungeRest — 리플레이마다 같음)
      'shredder',
    ])
  })

  it('메인: tool.end 사이에는 자기 책상 복귀(soft)만 끼어든다', () => {
    const between = charCmds(all, 'main').filter(
      (c) => c.type === 'moveTo' && kindOf.get(c.cause) === 'tool.end',
    )
    // 도구 사이에는 moveTo(soft) 외에 오류 반응(act)만 낀다 (표시·파트너 반응은 즉시 명령)
    const other = charCmds(all, 'main').filter(
      (c) =>
        kindOf.get(c.cause) === 'tool.end' &&
        c.type !== 'moveTo' &&
        c.type !== 'mark' &&
        c.type !== 'partner',
    )
    expect(other.map((c) => [c.cause, c.type])).toEqual([['e21', 'act']])
    expect(between.length).toBeGreaterThan(0)
    for (const c of between) {
      expect(c).toMatchObject({ spot: 'mainDesk', anim: 'idle_sit', soft: true })
    }
  })

  it('메인: 문에서 등장해 자기 책상으로, 마지막에 퇴장', () => {
    const main = charCmds(all, 'main')
    expect(main[0]).toMatchObject({ type: 'spawn', cause: 'e01', variant: MAIN_VARIANT })
    expect(LINES.ko.sessionStart).toContain((main[0] as { say?: string }).say)
    expect(main[1]).toMatchObject({ type: 'moveTo', spot: 'mainDesk', cause: 'e01' })
    expect(main.at(-1)).toMatchObject({ type: 'leave', cause: 'e29', style: 'pack' })
  })

  it('sub-a: 문에서 등장 → 캐비닛 → 책장 → 문(퇴장)', () => {
    const sub = charCmds(all, 'sub-a')
    expect(sub[0]).toMatchObject({ type: 'spawn', cause: 'e10' })
    const path = sub
      .filter((c) => c.type !== 'mark' && c.type !== 'partner')
      .filter((c) => !(c.type === 'moveTo' && c.spot === 'research1'))
      .map((c) => (c.type === 'moveTo' ? c.spot : c.type))
    expect(path).toEqual(['spawn', 'cabinet', 'bookshelf', 'leave'])
    // 서브(Explore)는 조사팀 책상의 빈자리를 배정받고 agentType 해시 색
    expect(sub.find((c) => c.type === 'moveTo' && c.cause === 'e10')).toMatchObject({
      spot: 'research1',
    })
    expect(sub[0]).toMatchObject({ variant: variantFor('sub-a', 'Explore') })
  })

  it('e09 팀장 Agent 호출 → 자기 책상에 앉아 전화(📞 Explore) 잠깐 → 같은 자리 idle_sit(soft)', () => {
    const e09 = (out.find((o) => o.event.id === 'e09')?.cmds ?? []).filter(isCharacterCommand)
    expect(e09).toEqual([
      expect.objectContaining({
        type: 'moveTo',
        spot: 'mainDesk',
        anim: 'phone_sit',
        bubble: '📞 Explore',
        soft: false,
      }),
      expect.objectContaining({
        type: 'act',
        anim: 'phone_sit',
        durationMs: 1500,
        bubble: '📞 Explore',
        interruptible: true,
      }),
      // 전화를 끊고 하던 자리 동작으로. 서브가 끝날 때(tool.end)까지 말풍선은 유지
      expect.objectContaining({
        type: 'moveTo',
        spot: 'mainDesk',
        anim: 'idle_sit',
        bubble: '📞 Explore',
        soft: true,
      }),
    ])
    expect((e09[1] as { say?: string | null }).say ?? null).toBeNull()
    // 문 앞 손짓은 더 이상 없다
    expect(charCmds(all, 'main').some((c) => c.type === 'moveTo' && c.spot === 'door')).toBe(false)
  })

  it('e09 이후 다시 배치(syncAll)하면 팀장은 자기 책상 idle_sit + 📞 말풍선(이벤트 경로의 최종 모습)', () => {
    const upTo = events.slice(0, events.findIndex((e) => e.id === 'e09') + 1)
    const r = run(upTo)
    const placed = r.director
      .syncAll(r.state, 'sample')
      .find((c) => c.type === 'place' && c.agentId === 'main')
    expect(placed).toMatchObject({ spot: 'mainDesk', anim: 'idle_sit', bubble: '📞 Explore' })
  })

  it('서브가 Agent 를 쓰면(중첩) 자기 팀 책상에서 같은 전화 동작', () => {
    const r = run([
      ev({ id: 'n1', kind: 'session.start' }),
      ev({ id: 'n2', kind: 'agent.spawn', agentId: 'sub-x', agentType: 'Explore' }),
      ev({
        id: 'n3',
        kind: 'tool.start',
        agentId: 'sub-x',
        tool: { name: 'Agent', category: 'agent', target: 'Plan', useId: 'u1' },
      }),
    ])
    const n3 = charCmds(r.all, 'sub-x').filter((c) => c.cause === 'n3')
    expect(n3[0]).toMatchObject({ type: 'moveTo', spot: 'research1', anim: 'phone_sit' })
    expect(n3[1]).toMatchObject({ type: 'act', anim: 'phone_sit', bubble: '📞 Plan' })
    expect(n3[2]).toMatchObject({ type: 'moveTo', spot: 'research1', anim: 'idle_sit', soft: true })
  })

  it('e19 attention → raise_hand + 깜빡이는 "?"', () => {
    const e19 = out.find((o) => o.event.id === 'e19')?.cmds ?? []
    expect(e19).toContainEqual(expect.objectContaining({ type: 'act', anim: 'raise_hand' }))
    expect(e19).toContainEqual(
      expect.objectContaining({ type: 'mark', mark: 'question', durationMs: null }),
    )
  })

  it('e20 tool.start 가 "?" 를 지운다', () => {
    const e20 = out.find((o) => o.event.id === 'e20')?.cmds ?? []
    expect(e20[0]).toMatchObject({ type: 'mark', mark: null })
  })

  it('e21 Bash 오류 → 그 자리에서 멈칫 + "앗…" + 식은땀, 그 뒤 자기 책상(soft)', () => {
    const e21 = out.find((o) => o.event.id === 'e21')?.cmds ?? []
    expect(e21[0]).toMatchObject({ type: 'mark', mark: 'sweat', durationMs: 1200 })
    expect(e21[1]).toMatchObject({
      type: 'act',
      anim: 'flinch',
      durationMs: 1200,
      interruptible: true,
    })
    expect(LINES.ko.error).toContain((e21[1] as { say?: string }).say)
    // 빨간 "!" 는 더 이상 쓰지 않는다(기획서 5절 표: 식은땀·"앗…" 으로 대체)
    expect(all.some((c) => c.type === 'mark' && (c.mark as string) === 'error')).toBe(false)
    expect(e21.filter((c) => c.type !== 'servers').at(-1)).toMatchObject({
      type: 'moveTo',
      spot: 'mainDesk',
      anim: 'idle_sit',
      soft: true,
    })
  })

  it('e02 prompt.submit → 자리에서 일어나 "네, 알겠습니다!" + "!" 0.8초', () => {
    const e02 = out.find((o) => o.event.id === 'e02')?.cmds ?? []
    expect(e02).toEqual([
      expect.objectContaining({ type: 'act', anim: 'idle_stand', interruptible: true }),
      expect.objectContaining({ type: 'moveTo', spot: 'mainDesk', soft: true }),
      expect.objectContaining({ type: 'mark', mark: 'alert', durationMs: 800 }),
    ])
    expect(LINES.ko.promptSubmit).toContain((e02[0] as { say?: string }).say)
  })

  it('조명: session.start 에 켜지고 session.end 에 꺼진다(끄기는 Roster 가 마지막 퇴장까지 미룸)', () => {
    const lights = all.filter((c) => c.type === 'lights')
    expect(lights).toEqual([
      { type: 'lights', on: true, cause: 'e01' },
      { type: 'lights', on: false, cause: 'e29' },
    ])
  })

  it('서버실 LED: bash 실행(e20) 동안만 busy', () => {
    const servers = all.filter((c) => c.type === 'servers')
    expect(servers).toEqual([
      { type: 'servers', busy: true, cause: 'e20' },
      { type: 'servers', busy: false, cause: 'e21' },
    ])
  })

  it('session.end: 퇴근 대사 + 짐 챙기기(pack) 퇴장', () => {
    const e29 = out.find((o) => o.event.id === 'e29')?.cmds ?? []
    const leave = e29.find((c) => c.type === 'leave')
    expect(leave).toMatchObject({ type: 'leave', agentId: 'main', style: 'pack' })
    expect(LINES.ko.sessionEnd).toContain((leave as { say?: string }).say)
  })

  it('대사 상황: 입장·완료·턴 끝·확인 필요·정리', () => {
    const say = (id: string, type: string) =>
      (out.find((o) => o.event.id === id)?.cmds ?? []).find(
        (c) => c.type === type && 'say' in c && c.say,
      ) as { say?: string; style?: string } | undefined
    expect(LINES.ko.subSpawn).toContain(say('e10', 'spawn')?.say)
    expect(LINES.ko.subFinish).toContain(say('e15', 'leave')?.say)
    expect(say('e15', 'leave')?.style).toBe('report')
    expect(LINES.ko.attention).toContain(say('e19', 'act')?.say)
    expect(LINES.ko.turnEnd).toContain(say('e27', 'moveTo')?.say)
    expect(LINES.ko.compact).toContain(say('e28', 'moveTo')?.say)
  })

  it('마지막에 화면에 아무도 없고, 상태와 일치한다', () => {
    expect(run(events).director.characterIds()).toEqual([])
    const s = state.sessions.sample
    expect(s?.endedAt).toBeDefined()
    expect(Object.values(s?.agents ?? {}).every((a) => a.activity === 'gone')).toBe(true)
  })
})

describe('director 시나리오', () => {
  it('서브에이전트는 자기 팀 책상을 순서대로, 팀 책상이 다 차면 공용 테이블', () => {
    // 종류를 모르는 서브는 개발팀(fallback)
    const subs = ['a', 'b', 'c', 'd']
    const { director } = run([
      ev({ kind: 'session.start' }),
      ...subs.map((id) => ev({ kind: 'agent.spawn', agentId: id, parentAgentId: 'main' })),
    ])
    expect(subs.map((id) => director.deskOf(id))).toEqual([
      'dev1',
      'dev2',
      'commonTable',
      'commonTable',
    ])
    expect(director.deskOf('main')).toBe('mainDesk')
  })

  it('팀 매핑: Explore→조사팀, Plan→기획팀, pixel-artist→디자인팀, 그 밖→개발팀', () => {
    const spawn = (id: string, agentType: string) =>
      ev({ kind: 'agent.spawn', agentId: id, parentAgentId: 'main', agentType })
    const { director } = run([
      ev({ kind: 'session.start' }),
      spawn('x1', 'Explore'),
      spawn('x2', 'Explore'),
      spawn('x3', 'Explore'),
      spawn('p1', 'Plan'),
      spawn('d1', 'pixel-artist'),
      spawn('g1', 'general-purpose'),
      spawn('o1', 'office-scene-dev'),
      spawn('z1', 'some-new-agent'),
    ])
    expect(director.deskOf('x1')).toBe('research1')
    expect(director.deskOf('x2')).toBe('research2')
    // 팀 책상이 다 차면 다른 팀 책상이 비어 있어도 공용 테이블(기존 규칙)
    expect(director.deskOf('x3')).toBe('commonTable')
    expect(director.deskOf('p1')).toBe('planning1')
    expect(director.deskOf('d1')).toBe('design1')
    expect(director.deskOf('g1')).toBe('dev1')
    expect(director.deskOf('o1')).toBe('dev2')
    expect(director.deskOf('z1')).toBe('commonTable')
  })

  it('Edit/Write 의 "자기 책상"은 팀 책상, 팀장은 팀장 책상', () => {
    const { all } = run([
      ev({ kind: 'session.start' }),
      ev({ kind: 'agent.spawn', agentId: 'p', parentAgentId: 'main', agentType: 'Plan' }),
      ev({ kind: 'tool.start', agentId: 'p', tool: { name: 'Edit', category: 'edit' } }),
      ev({ kind: 'tool.start', tool: { name: 'Write', category: 'write' } }),
    ])
    const edits = all.flatMap((c) => (c.type === 'moveTo' && c.anim === 'type' ? [c] : []))
    expect(edits.map((c) => [c.agentId, c.spot])).toEqual([
      ['p', 'planning1'],
      ['main', 'mainDesk'],
    ])
  })

  it('팀 구성은 옵션으로 바꿀 수 있다(직원 설정 화면 대비)', () => {
    const director = new Director({
      teams: () => ({ members: { Explore: 'design' }, fallback: 'research' }),
    })
    let state: OfficeState = createInitialState()
    for (const e of [
      ev({ kind: 'agent.spawn', agentId: 'a', agentType: 'Explore' }),
      ev({ kind: 'agent.spawn', agentId: 'b', agentType: 'Plan' }),
    ]) {
      state = reduce(state, e)
      director.handle(e, state.sessions[e.sessionId])
    }
    expect(director.deskOf('a')).toBe('design1')
    expect(director.deskOf('b')).toBe('research1')
  })

  /** 이벤트 ts 를 director 시계로 쓰는 run */
  const runTimed = (events: OfficeEvent[]) => {
    let now = 0
    const director = new Director({ now: () => now })
    let state: OfficeState = createInitialState()
    for (const e of events) {
      now = Date.parse(e.ts)
      state = reduce(state, e)
      director.handle(e, state.sessions[e.sessionId])
    }
    return director
  }
  const at = (sec: number) =>
    new Date(Date.parse('2026-01-01T00:00:00.000Z') + sec * 1000).toISOString()

  it('퇴장한 서브의 책상은 보고·머묾(LEAVE_REPORT_MAX_MS)이 끝난 뒤 다음 서브가 재사용한다', () => {
    const director = runTimed([
      ev({ kind: 'agent.spawn', agentId: 'a', ts: at(0) }),
      ev({ kind: 'agent.finish', agentId: 'a', ts: at(1) }),
      ev({ kind: 'agent.spawn', agentId: 'b', ts: at(1 + LEAVE_REPORT_MAX_MS / 1000) }),
    ])
    expect(director.deskOf('b')).toBe('dev1')
  })

  it('보고 후 머무는 서브의 책상은 피한다(겹치지 않게), 빈 책상이 그것뿐이면 쓴다', () => {
    const d1 = runTimed([
      ev({ kind: 'agent.spawn', agentId: 'a', ts: at(0) }),
      ev({ kind: 'agent.finish', agentId: 'a', ts: at(1) }),
      ev({ kind: 'agent.spawn', agentId: 'b', ts: at(2) }),
      // 같은 ID 재사용(재개)도 새 책상
      ev({ kind: 'agent.spawn', agentId: 'a', ts: at(2.5) }),
    ])
    expect(d1.deskOf('b')).toBe('dev2')
    // 남은 팀 책상이 머무는 중인 그것뿐 → 그 책상을 쓴다
    expect(d1.deskOf('a')).toBe('dev1')

    const d2 = runTimed([
      ...['a', 'b'].map((id) => ev({ kind: 'agent.spawn', agentId: id, ts: at(0) })),
      ev({ kind: 'agent.finish', agentId: 'b', ts: at(1) }),
      ev({ kind: 'agent.spawn', agentId: 'e', ts: at(2) }),
    ])
    expect(d2.deskOf('e')).toBe('dev2')
  })

  it('같은 스팟에 여럿이 가면 서로 다른 슬롯', () => {
    const { all } = run([
      ev({ kind: 'tool.start', tool: { name: 'Read', category: 'read' } }),
      ev({ kind: 'tool.start', agentId: 'a', tool: { name: 'Read', category: 'read' } }),
      ev({ kind: 'tool.start', agentId: 'b', tool: { name: 'Read', category: 'read' } }),
    ])
    const slots = all
      .filter((c) => c.type === 'moveTo' && c.spot === 'bookshelf')
      .map((c) => (c.type === 'moveTo' ? c.slot : -1))
    expect(new Set(slots).size).toBe(3)
  })

  it('agent.idle: 깨어 있으면 idle_sit, isAsleep 이면 sleep + Zzz', () => {
    const t0 = Date.parse('2026-01-01T00:00:00.000Z')
    const awake = run(
      [ev({ kind: 'prompt.submit' }), ev({ kind: 'agent.idle' })],
      new Director({ now: () => t0 + 61_000 }),
    )
    expect(awake.out[1]?.cmds).toEqual([
      expect.objectContaining({ type: 'moveTo', spot: 'mainDesk', anim: 'idle_sit' }),
    ])
    const asleep = run(
      [ev({ kind: 'prompt.submit' }), ev({ kind: 'agent.idle' })],
      new Director({ now: () => t0 + 6 * 60_000 }),
    )
    expect(asleep.out[1]?.cmds).toEqual([
      expect.objectContaining({ type: 'moveTo', anim: 'sleep' }),
      expect.objectContaining({ type: 'mark', mark: 'sleep', durationMs: null }),
    ])
  })

  it('refreshSleep: 시간이 흘러 잠들면 한 번만 sleep 명령, 새 이벤트가 Zzz 를 지운다', () => {
    let now = Date.parse('2026-01-01T00:00:00.000Z')
    const director = new Director({ now: () => now })
    const r = run([ev({ kind: 'session.start' }), ev({ kind: 'turn.end' })], director)
    const session = r.state.sessions.s
    expect(director.refreshSleep(session)).toEqual([])
    now += 5 * 60_000
    const first = director.refreshSleep(session)
    expect(first).toContainEqual(expect.objectContaining({ type: 'mark', mark: 'sleep' }))
    expect(director.refreshSleep(session)).toEqual([])
    const wake = director.handle(
      ev({ kind: 'prompt.submit', ts: '2026-01-01T00:06:00.000Z' }),
      session,
    )
    expect(wake[0]).toMatchObject({ type: 'mark', mark: null })
  })

  it('늦게 도착한 이벤트로 퇴장한 캐릭터를 되살리지 않는다', () => {
    const { out } = run([
      ev({ kind: 'agent.finish', agentId: 'x', ts: '2026-01-01T00:00:05.000Z' }),
      ev({ kind: 'agent.spawn', agentId: 'x', ts: '2026-01-01T00:00:01.000Z' }),
    ])
    expect(out[1]?.cmds).toEqual([])
  })

  it('syncAll: 상태대로 즉시 배치(작업 중 도구·대기·종료 세션)', () => {
    let state = createInitialState()
    for (const e of [
      ev({ kind: 'session.start' }),
      ev({ kind: 'tool.start', tool: { name: 'Bash', category: 'bash', target: 'git' } }),
      ev({ kind: 'agent.spawn', agentId: 'a', agentType: 'Explore' }),
      ev({ kind: 'attention', agentId: 'a', reason: 'permission' }),
    ]) {
      state = reduce(state, e)
    }
    const d = new Director({ now: () => 0 })
    const cmds = d.syncAll(state, 's')
    expect(cmds).toContainEqual({ type: 'lights', on: true, cause: 'sync' })
    expect(cmds).toContainEqual(
      expect.objectContaining({
        type: 'place',
        agentId: 'main',
        spot: 'serverTerminal',
        anim: 'type',
        bubble: '>_ git',
      }),
    )
    expect(cmds).toContainEqual(
      expect.objectContaining({
        type: 'place',
        agentId: 'a',
        spot: 'research1',
        anim: 'raise_hand',
        mark: 'question',
      }),
    )
    // 다시 sync 하면 기존 캐릭터를 지우고 다시 배치
    const again = d.syncAll(state, 's')
    expect(again.filter((c) => c.type === 'remove')).toHaveLength(2)

    const ended = reduce(state, ev({ kind: 'session.end', ts: '2026-01-01T00:01:00.000Z' }))
    const off = d.syncAll(ended, 's')
    expect(off.filter((c) => c.type === 'place')).toEqual([])
    expect(off).toContainEqual({ type: 'lights', on: false, cause: 'sync' })
    expect(d.syncAll(ended, null)).toContainEqual({ type: 'lights', on: false, cause: 'sync' })
  })

  it('연속 에러 3회 이상: 머리 감싸기 + "이상하다…" + 땀 증가, ok 가 오면 다시 1회부터', () => {
    const bash = { name: 'Bash', category: 'bash', useId: 'u' }
    const fail = () => ev({ kind: 'tool.end', tool: bash, status: 'error' })
    const ok = () => ev({ kind: 'tool.end', tool: bash, status: 'ok' })
    const { out } = run([
      ev({ kind: 'session.start' }),
      fail(),
      fail(),
      fail(),
      fail(),
      ok(),
      fail(),
    ])
    const reaction = (i: number) => {
      const cmds = out[i]?.cmds ?? []
      const act = cmds.find((c) => c.type === 'act') as { anim?: string; say?: string } | undefined
      const mark = cmds.find((c) => c.type === 'mark') as { mark?: string } | undefined
      return [act?.anim, mark?.mark]
    }
    expect([1, 2, 3, 4, 6].map(reaction)).toEqual([
      ['flinch', 'sweat'],
      ['flinch', 'sweat'],
      ['head_hold', 'sweat_heavy'],
      ['head_hold', 'sweat_heavy'],
      ['flinch', 'sweat'],
    ])
    const act3 = (out[3]?.cmds ?? []).find((c) => c.type === 'act') as { say?: string }
    expect(LINES.ko.errorRepeated).toContain(act3.say)
  })

  describe('attention.clear (사용자가 확인에 답함)', () => {
    const bash = { name: 'Bash', category: 'bash', target: 'git', useId: 'ub' }
    const agentTool = { name: 'Agent', category: 'agent', target: 'Explore', useId: 'ua' }
    const cmdsOf = (r: ReturnType<typeof run>, id: string) =>
      r.out.find((o) => o.event.id === id)?.cmds ?? []

    it('Bash 허락 → "?" 해제 + 서버실 터미널 동작(말풍선·LED) 유지, 대사 없음 → tool.end 로 책상 복귀', () => {
      const r = run([
        ev({ id: 'b1', kind: 'session.start' }),
        ev({ id: 'b2', kind: 'tool.start', tool: bash }),
        ev({ id: 'b3', kind: 'attention', reason: 'permission' }),
        ev({ id: 'b4', kind: 'attention.clear', reason: 'permission' }),
        ev({ id: 'b5', kind: 'tool.end', tool: bash, status: 'ok' }),
      ])
      expect(cmdsOf(r, 'b3')).toContainEqual(
        expect.objectContaining({ type: 'mark', mark: 'question', durationMs: null }),
      )
      expect(cmdsOf(r, 'b4')).toEqual([
        { type: 'mark', agentId: 'main', cause: 'b4', mark: null, durationMs: null },
        expect.objectContaining({
          type: 'moveTo',
          spot: 'serverTerminal',
          anim: 'type',
          bubble: '>_ git',
          soft: true,
          say: null,
        }),
        { type: 'servers', busy: true, cause: 'b4' },
      ])
      // 손들기(raise_hand)를 다시 하지 않는다
      expect(cmdsOf(r, 'b4').some((c) => c.type === 'act')).toBe(false)
      expect(r.state.sessions.s?.agents.main?.attention).toBeUndefined()
      expect(cmdsOf(r, 'b5')).toContainEqual(
        expect.objectContaining({ type: 'moveTo', spot: 'mainDesk', anim: 'idle_sit', soft: true }),
      )
    })

    it('clear 직후 모습은 상태로 다시 배치(syncAll)한 모습과 같다', () => {
      const r = run([
        ev({ kind: 'session.start' }),
        ev({ kind: 'tool.start', tool: bash }),
        ev({ kind: 'attention', reason: 'permission' }),
        ev({ id: 'c4', kind: 'attention.clear', reason: 'permission' }),
      ])
      const move = cmdsOf(r, 'c4').find((c) => c.type === 'moveTo')
      const placed = new Director({ now: () => 0 })
        .syncAll(r.state, 's')
        .find((c) => c.type === 'place' && c.agentId === 'main')
      expect(placed).toMatchObject({
        spot: (move as { spot: string }).spot,
        anim: (move as { anim: string }).anim,
        bubble: (move as { bubble: string }).bubble,
        mark: null,
      })
    })

    it('Agent 허락 → "?" 해제(전화는 다시 걸지 않고 자기 책상 idle_sit + 📞) 후 팀원 입장', () => {
      const r = run([
        ev({ id: 'a1', kind: 'session.start' }),
        ev({ id: 'a2', kind: 'tool.start', tool: agentTool }),
        ev({ id: 'a3', kind: 'attention', reason: 'permission' }),
        ev({ id: 'a4', kind: 'attention.clear', reason: 'permission' }),
        ev({ id: 'a5', kind: 'agent.spawn', agentId: 'sub-a', agentType: 'Explore' }),
      ])
      expect(cmdsOf(r, 'a4')).toEqual([
        expect.objectContaining({ type: 'mark', agentId: 'main', mark: null }),
        expect.objectContaining({
          type: 'moveTo',
          agentId: 'main',
          spot: 'mainDesk',
          anim: 'idle_sit',
          bubble: '📞 Explore',
          soft: true,
        }),
      ])
      expect(
        cmdsOf(r, 'a4').some((c) => 'anim' in c && (c as { anim: string }).anim === 'phone_sit'),
      ).toBe(false)
      expect(charCmds(cmdsOf(r, 'a5'), 'sub-a')[0]).toMatchObject({ type: 'spawn' })
      // 이후 팀장 쪽 명령에 "?" 가 다시 붙지 않는다
      expect(charCmds(cmdsOf(r, 'a5'), 'main')).toEqual([])
    })

    it('진행 중 도구가 없으면 자기 책상 idle_sit(soft)', () => {
      const r = run([
        ev({ kind: 'session.start' }),
        ev({ kind: 'agent.spawn', agentId: 'p', agentType: 'Plan' }),
        ev({ kind: 'attention', agentId: 'p', reason: 'permission' }),
        ev({ id: 'd4', kind: 'attention.clear', agentId: 'p' }),
      ])
      expect(cmdsOf(r, 'd4')).toEqual([
        expect.objectContaining({ type: 'mark', agentId: 'p', mark: null }),
        expect.objectContaining({
          type: 'moveTo',
          spot: 'planning1',
          anim: 'idle_sit',
          soft: true,
        }),
      ])
    })

    it('"?" 가 없거나 reason 이 다르거나 모르는 에이전트면 아무것도 하지 않는다(캐릭터도 만들지 않음)', () => {
      const r = run([
        ev({ kind: 'session.start' }),
        ev({ id: 'x1', kind: 'attention.clear' }),
        ev({ kind: 'attention', reason: 'permission' }),
        ev({ id: 'x3', kind: 'attention.clear', reason: 'idle' }),
        ev({ id: 'x4', kind: 'attention.clear', agentId: 'ghost' }),
      ])
      expect(cmdsOf(r, 'x1')).toEqual([])
      expect(cmdsOf(r, 'x3')).toEqual([])
      expect(r.state.sessions.s?.agents.main?.attention).toBe('permission')
      expect(cmdsOf(r, 'x4')).toEqual([])
      expect(r.director.characterIds()).toEqual(['main'])
    })
  })

  it('영어 옵션: lang 이 en 이면 대사도 영어', () => {
    const d = new Director({ now: () => 0, lang: () => 'en' })
    const { out } = run([ev({ kind: 'session.start' })], d)
    const spawn = out[0]?.cmds.find((c) => c.type === 'spawn') as { say?: string }
    expect(LINES.en.sessionStart).toContain(spawn.say)
  })

  it('색 변형: 메인은 0 고정, 서브는 agentType 해시로 결정적(1..N-1)', () => {
    expect(variantFor('main', 'Explore')).toBe(0)
    const v = variantFor('x1', 'Explore')
    expect(variantFor('x2', 'Explore')).toBe(v)
    for (const t of ['Explore', 'Plan', 'general-purpose', 'a', 'b', 'c', 'd', 'e']) {
      const n = variantFor('id', t)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThan(VARIANT_COUNT)
    }
  })

  it('색 변형: 자주 쓰는 서브 종류는 서로 다른 고정 색(1..N-1), 나머지는 해시', () => {
    const common = [
      'Explore',
      'Plan',
      'general-purpose',
      'claude-code-guide',
      'statusline-setup',
      'claude',
    ]
    const vs = common.map((t) => variantFor('sub-1', t))
    expect(new Set(vs).size).toBe(common.length)
    for (const v of vs) {
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThan(VARIANT_COUNT)
    }
    // 해시로는 같은 색(3)이던 두 종류가 이제 다르다
    expect(variantFor('a', 'Explore')).not.toBe(variantFor('b', 'general-purpose'))
    // 표 자체도 겹침 없음·범위 안
    const table = Object.values(FIXED_VARIANTS)
    expect(new Set(table).size).toBe(table.length)
    expect(table.every((v) => v >= 1 && v < VARIANT_COUNT && v !== MAIN_VARIANT)).toBe(true)
    // 메인은 종류와 무관하게 0
    expect(variantFor('main', 'Plan')).toBe(MAIN_VARIANT)
    // 표에 없는 종류·프로토타입 이름은 해시(1..N-1, 결정적)
    for (const t of ['office-scene-dev', 'toString', 'constructor', '__proto__']) {
      const n = variantFor('x', t)
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThan(VARIANT_COUNT)
      expect(variantFor('y', t)).toBe(n)
    }
    // agentType 이 없으면 agentId 해시
    expect(variantFor('sub-z', undefined)).toBe(variantFor('sub-z', undefined))
  })
})
