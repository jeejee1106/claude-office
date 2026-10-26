import {
  createInitialState,
  type OfficeEvent,
  type OfficeState,
  reduce,
  type SessionState,
} from '@claude-office/shared'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_EMPLOYEE_SETTINGS,
  displayNameOf,
  displayNames,
  EMPLOYEE_SETTINGS_VERSION,
  type EmployeeSettings,
  getEmployeeSettings,
  knownAgentTypes,
  parseEmployeeSettings,
  resetEmployeeSettings,
  seenAgentTypes,
  setEmployeeSettings,
  subscribeEmployeeSettings,
  toTeamConfig,
  updateBoss,
  updateType,
  variantOf,
} from '../src/employeeSettings'
import { pickLine } from '../src/i18n'
import {
  type CharacterCommand,
  type DirectorOutput,
  isCharacterCommand,
} from '../src/scene/commands'
import { Director } from '../src/scene/director'
import { teamDesks } from '../src/scene/layout'
import { routeSceneEvent } from '../src/scene/sceneRouting'
import { teamOf } from '../src/scene/teams'
import { FIXED_VARIANTS, variantFor } from '../src/scene/variant'
import { createOfficeStore } from '../src/store/officeStore'
import { ev } from './helpers'

const settings = (p: Partial<EmployeeSettings>): EmployeeSettings => ({
  ...DEFAULT_EMPLOYEE_SETTINGS,
  ...p,
})

function sessionOf(events: OfficeEvent[]): SessionState | undefined {
  let s: OfficeState = createInitialState()
  for (const e of events) s = reduce(s, e)
  return s.sessions.s
}

const spawn = (agentId: string, agentType: string, ts = '2026-01-01T00:00:01.000Z') =>
  ev({ kind: 'agent.spawn', agentId, agentType, parentAgentId: 'main', ts })
const finish = (agentId: string) =>
  ev({ kind: 'agent.finish', agentId, ts: '2026-01-01T00:00:05.000Z' })

describe('직원 설정 저장 형식', () => {
  afterEach(() => resetEmployeeSettings())

  it('깨진 값·다른 버전이면 기본값, 틀린 칸만 버린다', () => {
    expect(parseEmployeeSettings(null)).toEqual(DEFAULT_EMPLOYEE_SETTINGS)
    expect(parseEmployeeSettings('x')).toEqual(DEFAULT_EMPLOYEE_SETTINGS)
    expect(parseEmployeeSettings({ v: 99, boss: { name: 'A' } })).toEqual(DEFAULT_EMPLOYEE_SETTINGS)
    expect(
      parseEmployeeSettings({
        v: EMPLOYEE_SETTINGS_VERSION,
        boss: { name: '  김팀장  ', variant: 9, team: 'dev' },
        types: {
          Explore: { name: '탐정 민수', team: 'design', variant: 5 },
          Plan: { team: 'nope', variant: 2.5, name: '' },
          '': { name: 'x' },
          bad: 'oops',
        },
      }),
    ).toEqual({
      v: EMPLOYEE_SETTINGS_VERSION,
      boss: { name: '김팀장' },
      types: { Explore: { name: '탐정 민수', team: 'design', variant: 5 } },
    })
  })

  it('set/update/reset 은 구독자에게 알리고, 같은 값이면 알리지 않는다', () => {
    let n = 0
    const off = subscribeEmployeeSettings(() => n++)
    updateBoss({ name: '김팀장' })
    expect(getEmployeeSettings().boss.name).toBe('김팀장')
    updateBoss({ name: '김팀장' })
    expect(n).toBe(1)
    updateType('Explore', { team: 'dev', variant: 4 })
    updateType('Explore', { variant: undefined })
    expect(getEmployeeSettings().types.Explore).toEqual({ team: 'dev' })
    updateType('Explore', { team: undefined })
    expect(getEmployeeSettings().types).toEqual({})
    resetEmployeeSettings()
    expect(getEmployeeSettings()).toEqual(DEFAULT_EMPLOYEE_SETTINGS)
    expect(n).toBe(5)
    off()
    setEmployeeSettings(settings({ boss: { variant: 3 } }))
    expect(n).toBe(5)
  })
})

describe('설정 → 규칙', () => {
  it('비우면 지금 규칙 그대로(이름·팀·색)', () => {
    const d = DEFAULT_EMPLOYEE_SETTINGS
    expect(variantOf('main', undefined, d)).toBe(0)
    expect(variantOf('a1', 'Explore', d)).toBe(FIXED_VARIANTS.Explore)
    expect(variantOf('a1', 'zzz', d)).toBe(variantFor('a1', 'zzz'))
    expect(teamOf('Explore', toTeamConfig(d))).toBe('research')
    expect(teamOf('whatever', toTeamConfig(d))).toBe('dev')
  })

  it('정한 팀·색·이름을 따른다(팀장도 색을 고를 수 있다)', () => {
    const s = settings({
      boss: { name: '김팀장', variant: 4 },
      types: { Explore: { name: '탐정', team: 'design', variant: 0 } },
    })
    expect(variantOf('main', undefined, s)).toBe(4)
    expect(variantOf('a1', 'Explore', s)).toBe(0)
    expect(teamOf('Explore', toTeamConfig(s))).toBe('design')
    expect(teamOf('Plan', toTeamConfig(s))).toBe('planning')
    const session = sessionOf([ev({ kind: 'session.start' }), spawn('a1', 'Explore')])
    expect(displayNameOf('main', session, s)).toBe('김팀장')
    expect(displayNameOf('a1', session, s)).toBe('탐정')
  })

  it('같은 이름이 동시에 2명 이상이면 두 번째부터 번호, 퇴장한 사람은 번호 없이', () => {
    const d = DEFAULT_EMPLOYEE_SETTINGS
    const evs = [ev({ kind: 'session.start' }), spawn('a1', 'Explore'), spawn('a2', 'Explore')]
    expect([...displayNames(sessionOf(evs), d)]).toEqual([
      ['main', 'main'],
      ['a1', 'Explore'],
      ['a2', 'Explore 2'],
    ])
    const after = sessionOf([...evs, finish('a1')])
    expect(displayNames(after, d).get('a1')).toBe('Explore')
    expect(displayNames(after, d).get('a2')).toBe('Explore')
    // 다른 종류라도 같은 이름을 붙이면 번호로 구분
    const s = settings({ types: { Explore: { name: '민수' }, Plan: { name: '민수' } } })
    const mixed = sessionOf([
      ev({ kind: 'session.start' }),
      spawn('a1', 'Explore'),
      spawn('b1', 'Plan'),
    ])
    expect(displayNames(mixed, s).get('b1')).toBe('민수 2')
  })

  it('설정 창 행: 기본 종류 + 저장된 종류 + 나타난 종류(중복 없이)', () => {
    const s = settings({ types: { custom: { name: 'c' } } })
    const office = reduce(createInitialState(), spawn('x1', 'seen-type'))
    const rows = knownAgentTypes(s, seenAgentTypes(office.sessions))
    expect(rows).toContain('Explore')
    expect(rows).toContain('pixel-artist')
    expect(rows).toContain('claude-code-guide')
    expect(rows).toContain('custom')
    expect(rows).toContain('seen-type')
    expect(new Set(rows).size).toBe(rows.length)
    expect(rows).not.toContain('main')
  })
})

describe('director × 직원 설정', () => {
  const charCmds = (out: DirectorOutput[]) =>
    out.filter((c): c is CharacterCommand => isCharacterCommand(c))

  it('이름표·색·팀 책상이 설정을 따른다', () => {
    let s = settings({
      boss: { name: '김팀장', variant: 5 },
      types: { Explore: { name: '탐정', team: 'dev', variant: 6 } },
    })
    const director = new Director({ now: () => 0, employees: () => s })
    const evs = [ev({ kind: 'session.start' }), spawn('a1', 'Explore')]
    let state: OfficeState = createInitialState()
    const out: DirectorOutput[] = []
    for (const e of evs) {
      state = reduce(state, e)
      out.push(...director.handle(e, state.sessions.s))
    }
    const spawns = charCmds(out).filter((c) => c.type === 'spawn')
    expect(spawns.map((c) => c.type === 'spawn' && [c.agentId, c.label, c.variant])).toEqual([
      ['main', '김팀장', 5],
      ['a1', '탐정', 6],
    ])
    expect(teamDesks('dev')).toContain(director.deskOf('a1'))

    // 설정을 바꾸고 다시 그리면(syncAll) 즉시 새 팀 책상·새 이름
    s = settings({ types: { Explore: { team: 'design' } } })
    const placed = charCmds(director.syncAll(state, 's')).filter((c) => c.type === 'place')
    expect(placed.map((c) => c.type === 'place' && [c.agentId, c.label])).toEqual([
      ['main', 'main'],
      ['a1', 'Explore'],
    ])
    expect(teamDesks('design')).toContain(director.deskOf('a1'))
  })

  it('같은 종류가 들어오면 "이름 2", 앞사람이 나가면 이름표를 다시 맞춘다', () => {
    const director = new Director({ now: () => 0 })
    const evs = [
      ev({ kind: 'session.start' }),
      spawn('a1', 'Explore'),
      spawn('a2', 'Explore'),
      finish('a1'),
    ]
    let state: OfficeState = createInitialState()
    const out: DirectorOutput[] = []
    for (const e of evs) {
      state = reduce(state, e)
      out.push(...director.handle(e, state.sessions.s))
    }
    const a2 = charCmds(out).filter((c) => c.agentId === 'a2')
    expect(a2.find((c) => c.type === 'spawn')).toMatchObject({ label: 'Explore 2' })
    expect(a2.filter((c) => c.type === 'label')).toEqual([
      expect.objectContaining({ label: 'Explore' }),
    ])
  })

  it('이름을 바꿔도 대사 선택은 그대로(이벤트 id 로 결정)', () => {
    const named = new Director({
      now: () => 0,
      lang: () => 'ko',
      employees: () => settings({ boss: { name: '김팀장' } }),
    })
    const e = ev({ kind: 'session.start' })
    const state = reduce(createInitialState(), e)
    const sp = named.handle(e, state.sessions.s).find((c) => c.type === 'spawn')
    expect(sp).toMatchObject({ say: pickLine('sessionStart', e.id, 'ko') })
  })
})

describe('조명: session.start 없이 생긴 세션 (서버 재시작)', () => {
  it('세션 없는 snapshot → 새 세션의 tool.start → 조명 켜짐', () => {
    const director = new Director({ now: () => 0 })
    const store = createOfficeStore()
    let sessionId: string | null = null
    const outs: DirectorOutput[] = []
    store.addSceneListener({
      onSnapshot: (s) => {
        sessionId = null
        outs.push(...director.syncAll(s.office, null))
      },
      onEvent: (e, s) => {
        const r = routeSceneEvent(director, sessionId, e, s)
        sessionId = r.sessionId
        outs.push(...r.outputs)
      },
    })
    store.applyMessage({
      type: 'snapshot',
      ts: '2026-01-01T00:00:00.000Z',
      state: createInitialState(),
      recent: [],
    })
    expect(director.lightsOn()).toBe(false)
    store.applyMessage({
      type: 'event',
      event: ev({
        kind: 'tool.start',
        sessionId: 'restarted',
        ts: '2026-01-01T00:01:00.000Z',
        tool: { name: 'Read', category: 'read', target: 'a.ts' },
      }),
    })
    expect(director.lightsOn()).toBe(true)
    expect(outs.filter((c) => c.type === 'lights').map((c) => c.type === 'lights' && c.on)).toEqual(
      [false, false, true],
    )
  })

  it('세션 종료 뒤 늦은 이벤트로는 켜지지 않는다(끄는 규칙은 그대로)', () => {
    const director = new Director({ now: () => 0 })
    const evs = [
      ev({ kind: 'session.start', ts: '2026-01-01T00:00:00.000Z' }),
      ev({ kind: 'session.end', ts: '2026-01-01T00:00:10.000Z' }),
      ev({
        kind: 'tool.end',
        ts: '2026-01-01T00:00:05.000Z',
        status: 'ok',
        tool: { name: 'Read', category: 'read' },
      }),
    ]
    let state: OfficeState = createInitialState()
    for (const e of evs) {
      state = reduce(state, e)
      director.handle(e, state.sessions.s)
    }
    expect(director.lightsOn()).toBe(false)
  })
})
