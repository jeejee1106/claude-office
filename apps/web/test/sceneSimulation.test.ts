import { createInitialState, type OfficeEvent, type SessionState } from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import type { AnimName, Mark } from '../src/scene/activityMap'
import { toolActivity } from '../src/scene/activityMap'
import { isCharacterCommand } from '../src/scene/commands'
import { Director } from '../src/scene/director'
import type { CharacterView } from '../src/scene/render/types'
import { Roster } from '../src/scene/roster'
import { routeSceneEvent } from '../src/scene/sceneRouting'
import { createOfficeStore } from '../src/store/officeStore'
import { loadSampleSession } from './helpers'

/*
 * 1배속 35초 샘플 세션을 시뮬레이션 시계로 흘려 "씬은 서버 상태의 투영" 을 검증한다.
 * OfficeScene 과 같은 경로(store → routeSceneEvent → Roster → Character)를 PixiJS 없이 돈다.
 */

/** 화면이 최신 이벤트보다 뒤처져도 되는 최대 시간 */
const LAG_BUDGET_MS = 2000
/** 퇴장 이벤트 후 캐릭터가 사라져야 하는 시간 */
const LEAVE_BUDGET_MS = 3500

class CountingView implements CharacterView {
  mark: Mark | null = null
  bubble: string | null = null
  anim: AnimName | null = null
  destroyed = false
  calls = 0
  setPosition() {}
  setAnimation(a: AnimName) {
    if (a !== this.anim) this.calls++
    this.anim = a
  }
  setMark(m: Mark | null) {
    this.calls++
    this.mark = m
  }
  setBubble(t: string | null) {
    this.calls++
    this.bubble = t
  }
  setLabel() {}
  setHighlight() {}
  setEffect() {}
  setAlpha() {}
  tick() {}
  destroy() {
    this.destroyed = true
  }
}

interface SimResult {
  violations: string[]
  views: CountingView[]
  roster: Roster
  frames: number
  elapsedMs: number
  spawnedMainFromDoor: boolean
}

function simulate(frameMs: number): SimResult {
  const events = loadSampleSession()
  const t0 = Date.parse(events[0]?.ts ?? '')
  const at = (e: OfficeEvent) => Date.parse(e.ts) - t0
  let simNow = 0
  const director = new Director({ now: () => t0 + simNow })
  const views: CountingView[] = []
  const roster = new Roster(
    () => {
      const v = new CountingView()
      views.push(v)
      return v
    },
    () => {},
  )
  const store = createOfficeStore()
  let sessionId: string | null = null
  /** agentId → [이벤트 id, 시각] (그 캐릭터에게 큐 명령을 낸 이벤트) */
  const relevant = new Map<string, { id: string; t: number }[]>()
  let spawnedMainFromDoor = false
  store.addSceneListener({
    onSnapshot: (s) => {
      sessionId = null
      roster.dispatch(director.syncAll(s.office, sessionId))
    },
    onEvent: (e, s) => {
      const r = routeSceneEvent(director, sessionId, e, s)
      sessionId = r.sessionId
      if (r.resynced) roster.clearDeparting()
      for (const c of r.outputs) {
        if (!isCharacterCommand(c) || c.type === 'mark') continue
        if (c.type === 'spawn' && c.agentId === 'main') spawnedMainFromDoor = true
        const list = relevant.get(c.agentId) ?? []
        if (list.at(-1)?.id !== c.cause) list.push({ id: c.cause, t: simNow })
        relevant.set(c.agentId, list)
      }
      roster.dispatch(r.outputs)
    },
  })
  store.applyMessage({
    type: 'snapshot',
    ts: new Date(t0).toISOString(),
    state: createInitialState(),
    recent: [],
  })

  const violations: string[] = []
  const endAt = at(events.at(-1) as OfficeEvent)
  const finishAt = new Map<string, number>()
  let next = 0
  let frames = 0
  const started = performance.now()
  for (let t = frameMs; t <= endAt + LEAVE_BUDGET_MS; t += frameMs) {
    // 프레임 사이에 도착한 이벤트(WS 는 rAF 와 무관하게 도착) → 이벤트 시각에 처리
    while (next < events.length && at(events[next] as OfficeEvent) <= t) {
      const e = events[next++] as OfficeEvent
      simNow = at(e)
      if (e.kind === 'agent.finish') finishAt.set(e.agentId, simNow)
      if (e.kind === 'session.end') for (const id of relevant.keys()) finishAt.set(id, simNow)
      store.applyMessage({ type: 'event', event: e })
    }
    simNow = t
    roster.update(frameMs)
    frames++

    const s = store.getState()
    const session: SessionState | undefined =
      sessionId !== null ? s.office.sessions[sessionId] : undefined
    const all = [...roster.chars.values(), ...roster.departing]
    for (const ch of all) {
      const id = ch.agentId
      // 퇴장 시간 초과
      const fin = finishAt.get(id)
      if (fin !== undefined && t - fin > LEAVE_BUDGET_MS)
        violations.push(`t=${t} ${id}: 퇴장 후 ${t - fin}ms 동안 남아 있음`)
      // 지연: 아직 반영 안 된 가장 오래된 관련 이벤트
      const list = relevant.get(id) ?? []
      const idx = list.findIndex((r) => r.id === ch.lastCause)
      const pending = list[idx + 1]
      const lag = pending === undefined ? 0 : t - pending.t
      if (lag > LAG_BUDGET_MS)
        violations.push(
          `t=${t} ${id}: ${pending?.id} 를 ${lag}ms 째 반영 못 함(현재 ${ch.lastCause})`,
        )
      // 따라잡은 상태라면 말풍선 = 서버 상태의 현재 도구
      const agent = session?.agents[id]
      if (pending === undefined && agent !== undefined && agent.activity !== 'gone') {
        const want = agent.currentTool
          ? toolActivity(agent.currentTool.category).bubble(agent.currentTool)
          : null
        if (ch.bubble !== want)
          violations.push(`t=${t} ${id}: 말풍선 ${ch.bubble} ≠ 서버 현재 도구 ${want}`)
      }
    }
    // 표시 아이콘 수명
    for (const v of views) {
      if (v.destroyed) continue
      if (v.mark === 'alert') {
        const p = events.filter((e) => e.kind === 'prompt.submit' && at(e) <= t).at(-1)
        if (p === undefined || t - at(p) > 800 + frameMs)
          violations.push(`t=${t}: "!" 가 prompt.submit 후 0.8초 넘게 남아 있음`)
      }
      if (v.mark === 'error') {
        const p = events
          .filter((e) => e.kind === 'tool.end' && e.status === 'error' && at(e) <= t)
          .at(-1)
        if (p === undefined || t - at(p) > 1000 + frameMs)
          violations.push(`t=${t}: 빨간 "!" 가 1초 넘게 남아 있음`)
      }
    }
  }
  return {
    violations,
    views,
    roster,
    frames,
    elapsedMs: performance.now() - started,
    spawnedMainFromDoor,
  }
}

describe('1배속 샘플 세션 시뮬레이션 (씬 = 서버 상태의 투영)', () => {
  for (const [label, frameMs] of [
    ['60fps', 16],
    ['1fps (탭 스로틀)', 1000],
  ] as const) {
    describe(label, () => {
      const r = simulate(frameMs)

      it('main 이 문에서 등장한다(spawn)', () => {
        expect(r.spawnedMainFromDoor).toBe(true)
      })

      it(`어느 시점에도 최신 이벤트보다 ${LAG_BUDGET_MS}ms 넘게 뒤처지지 않고, 말풍선·표시가 서버 상태와 일치`, () => {
        expect(r.violations.slice(0, 10)).toEqual([])
      })

      it('session.end 후 캐릭터 0명, 모든 뷰 제거', () => {
        expect(r.roster.visibleCount).toBe(0)
        expect(r.views.length).toBeGreaterThanOrEqual(2)
        expect(r.views.every((v) => v.destroyed)).toBe(true)
      })
    })
  }

  it('프레임당 비용: 뷰 변경 호출은 명령 수에 비례(프레임마다 다시 그리지 않음), 업데이트는 프레임당 0.2ms 미만', () => {
    const r = simulate(16)
    const calls = r.views.reduce((n, v) => n + v.calls, 0)
    // 35초 × 60fps ≈ 2400 프레임 동안 말풍선/표시/애니메이션 변경은 수십 번 수준이어야 한다
    expect(r.frames).toBeGreaterThan(2000)
    expect(calls).toBeLessThan(200)
    expect(r.elapsedMs / r.frames).toBeLessThan(0.2)
  })
})
