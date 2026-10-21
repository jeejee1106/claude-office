import { createInitialState, type OfficeEvent } from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import type { DirectorOutput } from '../src/scene/commands'
import { Director } from '../src/scene/director'
import { routeSceneEvent } from '../src/scene/sceneRouting'
import { createOfficeStore } from '../src/store/officeStore'
import { loadSampleSession } from './helpers'

/** OfficeScene.onEvent 와 같은 경로로 이벤트를 흘린다 */
function harness() {
  const director = new Director({ now: () => 0 })
  const store = createOfficeStore()
  let sessionId: string | null = null
  const log: { e: OfficeEvent; resynced: boolean; out: DirectorOutput[] }[] = []
  store.addSceneListener({
    onSnapshot: (s) => {
      sessionId = null
      director.syncAll(s.office, null)
    },
    onEvent: (e, s) => {
      const r = routeSceneEvent(director, sessionId, e, s)
      sessionId = r.sessionId
      log.push({ e, resynced: r.resynced, out: r.outputs })
    },
  })
  store.applyMessage({
    type: 'snapshot',
    ts: '2026-01-01T00:00:00.000Z',
    state: createInitialState(),
    recent: [],
  })
  const send = (e: OfficeEvent) => store.applyMessage({ type: 'event', event: e })
  return { director, log, send, sessionId: () => sessionId }
}

const types = (out: DirectorOutput[]) =>
  out.map((c) => (c.type === 'lights' ? `lights:${c.on}` : `${c.type}:${c.agentId}`))

describe('routeSceneEvent (QA B4-e)', () => {
  const events = loadSampleSession()

  it('빈 사무실에서 새 세션의 session.start → 조명 켜짐 + main 이 문에서 등장(spawn), place 없음', () => {
    const h = harness()
    h.send(events[0] as OfficeEvent)
    const first = h.log[0]
    expect(first?.resynced).toBe(true)
    const t = types(first?.out ?? [])
    expect(t).toContain('lights:true')
    expect(t).toContain('spawn:main')
    expect(t).not.toContain('place:main')
    expect(t.indexOf('spawn:main')).toBeLessThan(t.indexOf('moveTo:main'))
    // 이후 이벤트는 같은 세션이라 resync 없이 handle
    h.send(events[1] as OfficeEvent)
    expect(h.log[1]?.resynced).toBe(false)
  })

  it('이전 세션이 종료된 뒤 새 세션이 시작돼도 문에서 등장한다', () => {
    const h = harness()
    for (const e of events) h.send(e)
    expect(h.director.characterIds()).toEqual([])
    const second = events.map((e) => ({ ...e, id: `2-${e.id}`, sessionId: 'second' }))
    h.send(second[0] as OfficeEvent)
    const last = h.log.at(-1)
    expect(last?.resynced).toBe(true)
    expect(types(last?.out ?? [])).toContain('spawn:main')
    expect(h.sessionId()).toBe('second')
  })

  it('진행 중이던 다른 세션으로 전환되면 상태대로 배치(place)하고, 이후 이벤트는 handle', () => {
    const h = harness()
    const b0 = {
      ...(events[0] as OfficeEvent),
      id: 'b0',
      sessionId: 'B',
      ts: '2026-01-01T00:00:00.000Z',
    }
    h.send(b0)
    const a = events.map((e) => ({ ...e, id: `a-${e.id}`, sessionId: 'A' }))
    for (const e of a) h.send(e)
    // A 의 session.end 로 활성 세션이 B 하나만 남아 B 로 전환 → B 의 main 은 즉시 배치
    const switched = h.log.find((l) => l.e.id === 'a-e29')
    expect(switched?.resynced).toBe(true)
    expect(types(switched?.out ?? [])).toContain('place:main')
    expect(h.sessionId()).toBe('B')
    const b1 = {
      ...(events[1] as OfficeEvent),
      id: 'b1',
      sessionId: 'B',
      ts: '2026-12-01T00:00:00.000Z',
    }
    h.send(b1)
    const last = h.log.at(-1)
    expect(last?.resynced).toBe(false)
    expect(last?.out.some((c) => c.type === 'mark' && c.mark === 'alert')).toBe(true)
  })
})
