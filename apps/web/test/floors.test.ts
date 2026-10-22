import {
  createInitialState,
  type OfficeEvent,
  type OfficeState,
  reduce,
} from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import { floorLabel } from '../src/i18n'
import {
  eventsOnFloor,
  floorTabs,
  listFloors,
  resolveFloor,
  sessionOnFloor,
  updateFloorOrder,
} from '../src/store/floors'
import { createOfficeStore, currentFloor, effectiveSessionId } from '../src/store/officeStore'
import { ev } from './helpers'

const T = (sec: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, sec)).toISOString()

function build(events: OfficeEvent[]): OfficeState {
  let s = createInitialState()
  for (const e of events) s = reduce(s, e)
  return s
}

const start = (sessionId: string, sec: number, project?: string) =>
  ev({ sessionId, kind: 'session.start', ts: T(sec), ...(project ? { project } : {}) })

function connectedStore(state: OfficeState = createInitialState()) {
  const store = createOfficeStore()
  const snaps: string[] = []
  store.addSceneListener({
    onSnapshot: (s) => snaps.push(effectiveSessionId(s) ?? 'null'),
    onEvent: () => {},
  })
  store.applyMessage({ type: 'snapshot', state, recent: [], ts: T(0) })
  snaps.length = 0
  const send = (e: OfficeEvent) => store.applyMessage({ type: 'event', event: e })
  return { store, send, snaps }
}

describe('floors (순수 함수)', () => {
  it('층 = 프로젝트, project 없는 세션은 세션마다 한 층(이름은 id 앞부분)', () => {
    const office = build([
      start('a1', 0, 'claude-office'),
      start('b1', 1, 'my-app'),
      start('a2', 2, 'claude-office'),
      start('abcdef1234567890', 3),
    ])
    const order = updateFloorOrder([], office)
    expect(order).toEqual(['p:claude-office', 'p:my-app', 's:abcdef1234567890'])
    const floors = listFloors(office, order)
    expect(floors.map((f) => [f.number, f.name, f.sessions.length])).toEqual([
      [1, 'claude-office', 2],
      [2, 'my-app', 1],
      [3, 'abcdef12', 1],
    ])
    expect(floorLabel(1, 'claude-office', 'ko')).toBe('1층 claude-office')
    expect(floorLabel(2, 'my-app', 'en')).toBe('2F my-app')
  })

  it('층 번호는 처음 나타난 순서로 고정(활동 순서가 바뀌어도, 층이 사라져도)', () => {
    let office = build([start('b', 0, 'beta'), start('a', 1, 'alpha')])
    let order = updateFloorOrder([], office)
    expect(order).toEqual(['p:beta', 'p:alpha'])
    office = reduce(office, ev({ sessionId: 'a', kind: 'prompt.submit', ts: T(5) }))
    expect(updateFloorOrder(order, office)).toBe(order) // 바뀐 것 없음 → 같은 참조
    office = reduce(office, start('c', 6, 'gamma'))
    order = updateFloorOrder(order, office)
    expect(order).toEqual(['p:beta', 'p:alpha', 'p:gamma'])
    // beta 층의 세션이 사라져도 나머지 번호는 그대로
    const { b: _b, ...rest } = office.sessions
    const tabs = listFloors({ sessions: rest }, order)
    expect(tabs.map((f) => `${f.number}:${f.name}`)).toEqual(['2:alpha', '3:gamma'])
  })

  it('층 안에서는 가장 최근 활동 세션, pinned 가 그 층에 있으면 pinned', () => {
    const office = build([
      start('a1', 0, 'proj'),
      start('a2', 1, 'proj'),
      start('x', 9, 'other'),
      ev({ sessionId: 'a1', kind: 'prompt.submit', ts: T(5) }),
    ])
    expect(sessionOnFloor(office, 'p:proj', null)).toBe('a1')
    expect(sessionOnFloor(office, 'p:proj', 'a2')).toBe('a2')
    expect(sessionOnFloor(office, 'p:proj', 'x')).toBe('a1') // 다른 층 pinned 는 무시
    expect(sessionOnFloor(office, null, null)).toBeNull()
  })

  it('resolveFloor: 고른 층에 세션이 있으면 그 층, 없으면 pickDefaultSession 의 층', () => {
    const office = build([start('a', 0, 'alpha'), start('b', 1, 'beta')])
    expect(resolveFloor(office, 'p:alpha')).toBe('p:alpha')
    expect(resolveFloor(office, null)).toBe('p:beta')
    expect(resolveFloor(office, 'p:gone')).toBe('p:beta')
  })

  it('탭: 다른 층 확인 필요 → attention, 종료만 남은 층 → ended, 현재 층은 표시 안 함', () => {
    const office = build([
      start('a', 0, 'alpha'),
      start('b', 1, 'beta'),
      start('c', 2, 'gamma'),
      ev({ sessionId: 'b', kind: 'attention', reason: 'permission', ts: T(3) }),
      ev({ sessionId: 'a', kind: 'attention', reason: 'idle', ts: T(3) }),
      ev({ sessionId: 'c', kind: 'session.end', ts: T(4) }),
    ])
    const order = updateFloorOrder([], office)
    const tabs = floorTabs(office, order, 'p:alpha', { 'p:alpha': 3, 'p:beta': 2 })
    expect(tabs.map((f) => [f.name, f.current, f.attention, f.ended, f.pulse])).toEqual([
      ['alpha', true, false, false, 0],
      ['beta', false, true, false, 2],
      ['gamma', false, false, true, 0],
    ])
    // waiting(idle 사유)도 다른 층이면 빨간 점
    expect(floorTabs(office, order, 'p:beta', {})[0]?.attention).toBe(true)
  })
})

describe('officeStore 층 선택', () => {
  it('처음에만 기본 규칙으로 층을 고르고, 다른 층 활동으로 자동 전환하지 않는다', () => {
    const { store, send, snaps } = connectedStore()
    expect(currentFloor(store.getState())).toBeNull()
    send(start('a', 1, 'alpha'))
    expect(store.getState().selectedFloor).toBe('p:alpha')
    send(start('b', 2, 'beta'))
    send(ev({ sessionId: 'b', kind: 'prompt.submit', ts: T(3) }))
    expect(effectiveSessionId(store.getState())).toBe('a')
    expect(store.getState().floorPulse).toEqual({ 'p:beta': 2 })
    // 현재 층 활동은 깜빡임 대상 아님, agent.idle 도 제외
    send(ev({ sessionId: 'a', kind: 'prompt.submit', ts: T(4) }))
    send(ev({ sessionId: 'b', kind: 'agent.idle', ts: T(5) }))
    expect(store.getState().floorPulse).toEqual({ 'p:beta': 2 })
    expect(snaps).toEqual([])
  })

  it('같은 층 안의 새 세션으로는 전환한다', () => {
    const { store, send } = connectedStore()
    send(start('a1', 1, 'alpha'))
    send(start('a2', 2, 'alpha'))
    expect(effectiveSessionId(store.getState())).toBe('a2')
  })

  it('selectFloor: 층 전환 → 씬 resync(onSnapshot), 그 층 깜빡임 해제, pinned 해제', () => {
    const { store, send, snaps } = connectedStore()
    send(start('a', 1, 'alpha'))
    send(start('b1', 2, 'beta'))
    send(start('b2', 3, 'beta'))
    store.selectSession('b1')
    expect(store.getState().selectedFloor).toBe('p:beta')
    expect(effectiveSessionId(store.getState())).toBe('b1')
    store.selectFloor('p:alpha')
    expect(effectiveSessionId(store.getState())).toBe('a')
    store.selectFloor('p:beta')
    expect(store.getState().pinnedSessionId).toBeNull()
    expect(effectiveSessionId(store.getState())).toBe('b2')
    expect(store.getState().floorPulse['p:beta']).toBeUndefined()
    expect(snaps).toEqual(['b1', 'a', 'b2'])
    store.selectFloor('p:nope') // 없는 층은 무시
    expect(snaps).toHaveLength(3)
  })

  it('재접속 snapshot 에도 층 번호와 고른 층을 유지한다', () => {
    const office = build([start('a', 0, 'alpha'), start('b', 1, 'beta')])
    const { store } = connectedStore(office)
    expect(store.getState().selectedFloor).toBe('p:beta')
    store.selectFloor('p:alpha')
    const more = reduce(office, start('c', 2, 'gamma'))
    store.applyMessage({ type: 'snapshot', state: more, recent: [], ts: T(3) })
    expect(store.getState().floorOrder).toEqual(['p:alpha', 'p:beta', 'p:gamma'])
    expect(currentFloor(store.getState())).toBe('p:alpha')
  })

  it('고른 층의 세션이 모두 사라지면 기본 층으로 다시 고정', () => {
    const office = build([start('a', 0, 'alpha'), start('b', 1, 'beta')])
    const { store } = connectedStore(office)
    store.selectFloor('p:alpha')
    const { a: _a, ...rest } = office.sessions
    store.applyMessage({ type: 'snapshot', state: { sessions: rest }, recent: [], ts: T(3) })
    expect(store.getState().selectedFloor).toBe('p:beta')
    expect(effectiveSessionId(store.getState())).toBe('b')
  })
})

describe('eventsOnFloor (최근 이벤트는 현재 층만)', () => {
  it('같은 프로젝트의 세션 이벤트만 남기고, 세션 정보가 없는 이벤트는 뺀다', () => {
    const events = [
      start('a1', 1, 'claude-office'),
      start('b1', 2, 'my-app'),
      start('a2', 3, 'claude-office'),
      start('x', 4),
    ]
    const office = build(events.slice(0, 3))
    const floor = 'p:claude-office'
    expect(eventsOnFloor(office, events, floor).map((e) => e.sessionId)).toEqual(['a1', 'a2'])
    expect(eventsOnFloor(office, events, null)).toEqual([])
  })
})
