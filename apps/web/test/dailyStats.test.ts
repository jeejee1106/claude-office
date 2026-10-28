import {
  createInitialState,
  type DailyStats,
  EMPTY_DAILY_COUNTS,
  floorKeyFor,
  localDayKey,
  reduce,
  ServerMessage,
  type SessionState,
} from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import { floorKeyOf } from '../src/store/floors'
import { createOfficeStore, currentFloor, dailyCountsOn } from '../src/store/officeStore'
import { ev } from './helpers'

/* 오늘 작업량 (기획서 7절) — web 은 서버 숫자를 보여 주기만 한다 */

const today = localDayKey(Date.now())

const counts = (n: number) => ({
  filesEdited: n,
  commands: n + 1,
  teammates: n + 2,
  toolUses: n + 3,
})

const stats = (floors: DailyStats['floors'], day = today): DailyStats => ({ day, floors })

/** 층 두 개(p:alpha, p:beta)의 세션이 있는 state */
function twoFloors() {
  let s = createInitialState()
  s = reduce(
    s,
    ev({ sessionId: 'a', project: 'alpha', kind: 'session.start', ts: '2026-01-01T00:00:00.000Z' }),
  )
  s = reduce(
    s,
    ev({ sessionId: 'b', project: 'beta', kind: 'session.start', ts: '2026-01-01T00:00:10.000Z' }),
  )
  return s
}

const snap = (extra: Record<string, unknown> = {}) =>
  ({
    type: 'snapshot',
    state: twoFloors(),
    recent: [],
    ts: new Date().toISOString(),
    ...extra,
  }) as ServerMessage

describe('오늘 작업량 store', () => {
  it('처음에는 null(칸 숨김), stats 없는 snapshot(구버전 서버)도 null', () => {
    const store = createOfficeStore()
    expect(store.getState().dailyStats).toBeNull()
    store.applyMessage(snap())
    expect(store.getState().dailyStats).toBeNull()
    expect(dailyCountsOn(store.getState().dailyStats, currentFloor(store.getState()))).toBeNull()
  })

  it('snapshot.stats 로 채우고 지금 층 숫자를 보여 준다', () => {
    const store = createOfficeStore()
    store.applyMessage(snap({ stats: stats({ 'p:beta': counts(1) }) }))
    const s = store.getState()
    // 처음 층 = 가장 최근 활동 세션 b 의 층
    expect(currentFloor(s)).toBe('p:beta')
    expect(dailyCountsOn(s.dailyStats, currentFloor(s))).toEqual(counts(1))
  })

  it('stats 메시지는 통째로 교체하고 씬 리스너는 부르지 않는다', () => {
    const store = createOfficeStore()
    let sceneCalls = 0
    store.addSceneListener({
      onSnapshot: () => sceneCalls++,
      onEvent: () => sceneCalls++,
    })
    store.applyMessage(snap({ stats: stats({ 'p:beta': counts(1), 'p:alpha': counts(5) }) }))
    sceneCalls = 0
    let renders = 0
    store.subscribe(() => renders++)
    store.applyMessage({ type: 'stats', stats: stats({ 'p:beta': counts(2) }) })
    const s = store.getState()
    expect(s.dailyStats?.floors).toEqual({ 'p:beta': counts(2) })
    expect(dailyCountsOn(s.dailyStats, 'p:alpha')).toEqual(EMPTY_DAILY_COUNTS)
    expect(renders).toBe(1)
    expect(sceneCalls).toBe(0)
  })

  it('층을 바꾸면 그 층 숫자, 숫자가 없는 층은 0', () => {
    const store = createOfficeStore()
    store.applyMessage(snap({ stats: stats({ 'p:alpha': counts(7), 'p:beta': counts(1) }) }))
    store.selectFloor('p:alpha')
    const s = store.getState()
    expect(dailyCountsOn(s.dailyStats, currentFloor(s))).toEqual(counts(7))
    expect(dailyCountsOn(s.dailyStats, 'p:none')).toEqual(EMPTY_DAILY_COUNTS)
    expect(dailyCountsOn(s.dailyStats, null)).toEqual(EMPTY_DAILY_COUNTS)
  })

  it('날짜가 지난 stats 는 0 으로 보여 준다', () => {
    const now = Date.now()
    const old = stats({ 'p:beta': counts(3) }, localDayKey(now - 2 * 86_400_000))
    expect(dailyCountsOn(old, 'p:beta', now)).toEqual(EMPTY_DAILY_COUNTS)
    expect(dailyCountsOn(stats({ 'p:beta': counts(3) }), 'p:beta', now)).toEqual(counts(3))
  })

  it('stats 메시지는 계약 parse 를 통과하고, 이름 같은 다른 값은 화면 상태에 없다', () => {
    const parsed = ServerMessage.parse({ type: 'stats', stats: stats({ 'p:beta': counts(1) }) })
    const store = createOfficeStore()
    store.applyMessage(parsed)
    expect(Object.keys(store.getState().dailyStats?.floors['p:beta'] ?? {}).sort()).toEqual([
      'commands',
      'filesEdited',
      'teammates',
      'toolUses',
    ])
  })
})

describe('층 키: web floorKeyOf === shared floorKeyFor', () => {
  const session = (id: string, project?: string): SessionState => {
    let s = createInitialState()
    s = reduce(
      s,
      ev({ sessionId: id, kind: 'session.start', ...(project !== undefined ? { project } : {}) }),
    )
    return s.sessions[id] as SessionState
  }

  it.each([
    ['project 있음', 'x1', 'claude-office'],
    ['project 없음', 'x2', undefined],
  ])('%s', (_label, id, project) => {
    const s = session(id, project)
    expect(floorKeyOf(s)).toBe(floorKeyFor(s.project, s.id))
  })

  it('project 빈 문자열이면 세션 키', () => {
    const s: SessionState = { ...session('x3'), project: '' }
    expect(floorKeyOf(s)).toBe(floorKeyFor('', 'x3'))
    expect(floorKeyOf(s)).toBe('s:x3')
  })
})
