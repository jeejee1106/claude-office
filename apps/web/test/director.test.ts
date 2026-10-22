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
import { MAIN_VARIANT, VARIANT_COUNT, variantFor } from '../src/scene/variant'
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
      .map((c) => (c.type === 'moveTo' ? c.spot : ''))
    expect(spots).toEqual([
      'cabinet',
      'bookshelf',
      'whiteboard',
      'door',
      'mainDesk',
      'serverTerminal',
      'globe',
      'phone',
      'coffee',
      'shredder',
    ])
  })

  it('메인: tool.end 사이에는 자기 책상 복귀(soft)만 끼어든다', () => {
    const between = charCmds(all, 'main').filter(
      (c) => c.type === 'moveTo' && kindOf.get(c.cause) === 'tool.end',
    )
    // 도구 사이에는 moveTo(soft) 외에 오류 반응(act)만 낀다
    const other = charCmds(all, 'main').filter(
      (c) => kindOf.get(c.cause) === 'tool.end' && c.type !== 'moveTo' && c.type !== 'mark',
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
      .filter((c) => c.type !== 'mark')
      .filter((c) => !(c.type === 'moveTo' && c.spot === 'desk1'))
      .map((c) => (c.type === 'moveTo' ? c.spot : c.type))
    expect(path).toEqual(['spawn', 'cabinet', 'bookshelf', 'leave'])
    // 서브는 빈 책상을 배정받고 agentType 해시 색
    expect(sub.find((c) => c.type === 'moveTo' && c.cause === 'e10')).toMatchObject({
      spot: 'desk1',
    })
    expect(sub[0]).toMatchObject({ variant: variantFor('sub-a', 'Explore') })
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
  it('서브에이전트 책상은 순서대로, 모자라면 공용 테이블', () => {
    const subs = ['a', 'b', 'c', 'd', 'e', 'f']
    const { director } = run([
      ev({ kind: 'session.start' }),
      ...subs.map((id) => ev({ kind: 'agent.spawn', agentId: id, parentAgentId: 'main' })),
    ])
    expect(subs.map((id) => director.deskOf(id))).toEqual([
      'desk1',
      'desk2',
      'desk3',
      'desk4',
      'commonTable',
      'commonTable',
    ])
    expect(director.deskOf('main')).toBe('mainDesk')
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
    expect(director.deskOf('b')).toBe('desk1')
  })

  it('보고 후 머무는 서브의 책상은 피한다(겹치지 않게), 빈 책상이 그것뿐이면 쓴다', () => {
    const d1 = runTimed([
      ev({ kind: 'agent.spawn', agentId: 'a', ts: at(0) }),
      ev({ kind: 'agent.finish', agentId: 'a', ts: at(1) }),
      ev({ kind: 'agent.spawn', agentId: 'b', ts: at(2) }),
      // 같은 ID 재사용(재개)도 새 책상
      ev({ kind: 'agent.spawn', agentId: 'a', ts: at(2.5) }),
    ])
    expect(d1.deskOf('b')).toBe('desk2')
    expect(d1.deskOf('a')).toBe('desk3')

    const d2 = runTimed([
      ...['a', 'b', 'c', 'd'].map((id) => ev({ kind: 'agent.spawn', agentId: id, ts: at(0) })),
      ev({ kind: 'agent.finish', agentId: 'b', ts: at(1) }),
      ev({ kind: 'agent.spawn', agentId: 'e', ts: at(2) }),
    ])
    expect(d2.deskOf('e')).toBe('desk2')
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
        spot: 'desk1',
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
})
