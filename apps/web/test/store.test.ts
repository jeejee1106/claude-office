import { createInitialState, type OfficeEvent, reduce } from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import {
  createOfficeStore,
  effectiveSessionId,
  pickDefaultSession,
  RECENT_UI_LIMIT,
} from '../src/store/officeStore'
import { ev, loadSampleSession } from './helpers'

describe('officeStore', () => {
  it('event 는 shared reduce 로 반영하고 recent 는 최대 50개', () => {
    const store = createOfficeStore()
    const seen: string[] = []
    store.addSceneListener({ onSnapshot: () => seen.push('snap'), onEvent: (e) => seen.push(e.id) })
    store.applyMessage({
      type: 'snapshot',
      state: createInitialState(),
      recent: [],
      ts: new Date().toISOString(),
    })
    let expected = createInitialState()
    const events: OfficeEvent[] = []
    for (let i = 0; i < 60; i++) {
      const e = ev({
        kind: 'prompt.submit',
        ts: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      })
      events.push(e)
      expected = reduce(expected, e)
      store.applyMessage({ type: 'event', event: e })
    }
    expect(store.getState().office).toEqual(expected)
    expect(store.getState().recent).toHaveLength(RECENT_UI_LIMIT)
    expect(store.getState().recent.at(-1)).toBe(events.at(-1))
    expect(seen[0]).toBe('snap')
    expect(seen).toHaveLength(61)
  })

  it('snapshot ts 로 서버 시계 오프셋을 맞춘다', () => {
    const store = createOfficeStore()
    const clientNow = Date.parse('2026-01-01T00:00:00.000Z')
    store.applyMessage(
      { type: 'snapshot', state: createInitialState(), recent: [], ts: '2026-01-01T00:00:10.000Z' },
      clientNow,
    )
    const drift = store.serverNow() - Date.now()
    expect(Math.abs(drift - 10_000)).toBeLessThan(50)
  })

  it('기본 세션: 열린 세션 중 lastEventAt 최댓값, 없으면 가장 최근 종료 세션', () => {
    let s = createInitialState()
    expect(pickDefaultSession(s)).toBeNull()
    s = reduce(s, ev({ sessionId: 'old', kind: 'session.start', ts: '2026-01-01T00:00:00.000Z' }))
    s = reduce(s, ev({ sessionId: 'new', kind: 'session.start', ts: '2026-01-01T00:01:00.000Z' }))
    expect(pickDefaultSession(s)).toBe('new')
    s = reduce(s, ev({ sessionId: 'old', kind: 'prompt.submit', ts: '2026-01-01T00:02:00.000Z' }))
    expect(pickDefaultSession(s)).toBe('old')
    s = reduce(s, ev({ sessionId: 'old', kind: 'session.end', ts: '2026-01-01T00:03:00.000Z' }))
    expect(pickDefaultSession(s)).toBe('new')
    s = reduce(s, ev({ sessionId: 'new', kind: 'session.end', ts: '2026-01-01T00:02:30.000Z' }))
    expect(pickDefaultSession(s)).toBe('old')
  })

  it('사용자가 고른 세션이 우선(다른 층이면 그 층으로), 사라지면 그 층의 최근 세션으로', () => {
    const store = createOfficeStore()
    let state = createInitialState()
    for (const e of loadSampleSession()) state = reduce(state, e)
    state = reduce(
      state,
      ev({ sessionId: 'other', kind: 'session.start', ts: '2026-01-01T00:00:40.000Z' }),
    )
    store.applyMessage({ type: 'snapshot', state, recent: [], ts: '2026-01-01T00:00:40.000Z' })
    // 처음 접속: pickDefaultSession('other') 의 층으로 고정
    expect(effectiveSessionId(store.getState())).toBe('other')
    store.selectSession('sample')
    expect(effectiveSessionId(store.getState())).toBe('sample')
    expect(store.getState().selectedFloor).toBe('p:demo-app')
    store.selectSession('missing')
    // 이제는 층에 머문다: demo-app 층의 가장 최근 세션
    expect(effectiveSessionId(store.getState())).toBe('sample')
  })
})
