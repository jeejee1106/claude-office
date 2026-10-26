import { createInitialState, type OfficeEvent, type SessionState } from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import { allLines, LINES } from '../src/i18n'
import type { AnimName, Mark } from '../src/scene/activityMap'
import { ERROR_REACTION_MS, SPEECH_MS, toolActivity } from '../src/scene/activityMap'
import { LEAVE_PREP_MS, LEAVE_REPORT_MAX_MS, REPORT_LINGER_MS } from '../src/scene/Character'
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
/**
 * 퇴장 이벤트 후 캐릭터가 사라져야 하는 시간. Character 의 퇴장 자체는 시작 후 LEAVE_MAX_MS(2초)
 * 안에 끝나고(대사 있는 퇴장 = 준비 0.4 + 걷기 1.1 + 페이드 0.3 = 1.8초), 앞선 명령이 남아 있으면
 * 그만큼(따라잡기 MAX_LAG_MS 1.5초 이내) 늦게 시작한다 → 3.5초. 3차 작업에서도 그대로 둔다.
 */
const LEAVE_BUDGET_MS = 3500
/**
 * 서브 완료(report) 퇴장은 보고 0.4 + 머묾 3.0 + 걷기 1.1 + 페이드 0.3 = 4.8초(LEAVE_REPORT_MAX_MS 5초 안)
 * + 따라잡기 1.5초 → 6.5초. session.end 의 조명 끄기는 그대로 LEAVE_BUDGET_MS(머묾은 hurryLeave 로 끊김).
 */
const REPORT_LEAVE_BUDGET_MS = LEAVE_REPORT_MAX_MS + 1500
const DIALOG = allLines()
const FAREWELL = new Set([...LINES.ko.sessionEnd, ...LINES.en.sessionEnd])

class CountingView implements CharacterView {
  mark: Mark | null = null
  bubble: string | null = null
  anim: AnimName | null = null
  destroyed = false
  calls = 0
  /** 지금 말풍선이 처음 뜬 시각(시뮬레이션 ms) */
  bubbleSince = 0
  /** 퇴근 대사가 떠 있던 총 시간 */
  farewellMs = 0
  clock: () => number = () => 0
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
    if (t !== this.bubble) this.bubbleSince = this.clock()
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
  /** 조명 꺼진 시각 / 그때 화면에 남은 캐릭터 수 */
  lightsOffAt: number | null
  visibleAtLightsOff: number
  sessionEndAt: number
  /** agent.finish 후 서브가 화면에 남아 있던 최대 시간 */
  subLingerMs: number
}

function simulate(frameMs: number): SimResult {
  const events = loadSampleSession()
  const t0 = Date.parse(events[0]?.ts ?? '')
  const at = (e: OfficeEvent) => Date.parse(e.ts) - t0
  let simNow = 0
  const director = new Director({ now: () => t0 + simNow })
  const views: CountingView[] = []
  let lightsOffAt: number | null = null
  let visibleAtLightsOff = -1
  const roster: Roster = new Roster(
    () => {
      const v = new CountingView()
      v.clock = () => simNow
      views.push(v)
      return v
    },
    (cmd) => {
      if (cmd.type === 'lights' && !cmd.on) {
        lightsOffAt = simNow
        visibleAtLightsOff = roster.visibleCount
      }
    },
    // 파트너 몬스터도 같이 돈다(프레임당 비용 예산에 포함)
    () => ({
      setPosition() {},
      setAnimation() {},
      setAlpha() {},
      tick() {},
      destroy() {},
    }),
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
  /** agentId → [퇴장 이벤트 시각, 허용 시간] */
  const finishAt = new Map<string, { at: number; budget: number }>()
  let next = 0
  let frames = 0
  let subLingerMs = 0
  const started = performance.now()
  for (let t = frameMs; t <= endAt + LEAVE_BUDGET_MS; t += frameMs) {
    // 프레임 사이에 도착한 이벤트(WS 는 rAF 와 무관하게 도착) → 이벤트 시각에 처리
    while (next < events.length && at(events[next] as OfficeEvent) <= t) {
      const e = events[next++] as OfficeEvent
      simNow = at(e)
      if (e.kind === 'agent.finish')
        finishAt.set(e.agentId, { at: simNow, budget: REPORT_LEAVE_BUDGET_MS })
      if (e.kind === 'session.end')
        for (const id of relevant.keys()) {
          const prev = finishAt.get(id)
          // 이미 보고 후 머무는 중이면 조명 끄기와 함께 서두른다 → 세션 종료 기준 LEAVE_BUDGET_MS
          if (prev === undefined || simNow + LEAVE_BUDGET_MS < prev.at + prev.budget)
            finishAt.set(id, { at: simNow, budget: LEAVE_BUDGET_MS })
        }
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
      if (fin !== undefined && id !== 'main') subLingerMs = Math.max(subLingerMs, t - fin.at)
      if (fin !== undefined && t - fin.at > fin.budget)
        violations.push(`t=${t} ${id}: 퇴장 후 ${t - fin.at}ms 동안 남아 있음`)
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
        // 도구 말풍선이 우선: 서버에 도구가 있으면 반드시 그 말풍선, 없으면 비었거나 대사(기획서 6절)
        const ok =
          ch.bubble === want || (want === null && ch.bubble !== null && DIALOG.has(ch.bubble))
        if (!ok) violations.push(`t=${t} ${id}: 말풍선 ${ch.bubble} ≠ 서버 현재 도구 ${want}`)
      }
    }
    // 대사는 1~2초만(퇴장 대사는 사라질 때까지)
    for (const v of views) {
      if (v.destroyed || v.bubble === null || !DIALOG.has(v.bubble)) continue
      if (FAREWELL.has(v.bubble) || LINES.ko.subFinish.includes(v.bubble)) {
        if (FAREWELL.has(v.bubble)) v.farewellMs += frameMs
        continue
      }
      if (t - v.bubbleSince > SPEECH_MS + frameMs)
        violations.push(`t=${t}: 대사 "${v.bubble}" 가 ${t - v.bubbleSince}ms 째 떠 있음`)
    }
    // 표시 아이콘 수명
    for (const v of views) {
      if (v.destroyed) continue
      if (v.mark === 'alert') {
        const p = events.filter((e) => e.kind === 'prompt.submit' && at(e) <= t).at(-1)
        if (p === undefined || t - at(p) > 800 + frameMs)
          violations.push(`t=${t}: "!" 가 prompt.submit 후 0.8초 넘게 남아 있음`)
      }
      if (v.mark === 'sweat' || v.mark === 'sweat_heavy') {
        const p = events
          .filter((e) => e.kind === 'tool.end' && e.status === 'error' && at(e) <= t)
          .at(-1)
        if (p === undefined || t - at(p) > ERROR_REACTION_MS + frameMs)
          violations.push(`t=${t}: 식은땀이 ${ERROR_REACTION_MS}ms 넘게 남아 있음`)
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
    lightsOffAt,
    visibleAtLightsOff,
    sessionEndAt: endAt,
    subLingerMs,
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

      it('session.end: 퇴근 대사가 퇴장 동안 보이고, 마지막 사람이 나간 뒤 조명이 꺼진다', () => {
        const main = r.views[0]
        // 60fps: 준비 0.4 + 걷기 1.1 + 페이드 0.3 ≈ 1.8초 / 1fps: 퇴장 시작 프레임부터 사라질 때까지
        expect(main?.farewellMs ?? 0).toBeGreaterThanOrEqual(frameMs >= 1000 ? 1000 : 1500)
        expect(r.lightsOffAt).not.toBeNull()
        expect(r.visibleAtLightsOff).toBe(0)
        expect((r.lightsOffAt ?? 0) - r.sessionEndAt).toBeGreaterThan(0)
        expect((r.lightsOffAt ?? 0) - r.sessionEndAt).toBeLessThanOrEqual(LEAVE_BUDGET_MS)
      })

      it('agent.finish 후 서브가 보고하고 3초 넘게 머문 뒤 사라진다', () => {
        // 보고(0.4초) + 머묾(3초). 1fps 는 1초 간격으로만 보이므로(캐릭터 시계가 한 프레임 늦게
        // 명령을 받는다) 머묾 3초만큼 보이면 된다 — 자리 위치·이동 거리에 따라 한 프레임씩 달라진다.
        expect(r.subLingerMs).toBeGreaterThanOrEqual(
          frameMs >= 1000 ? REPORT_LINGER_MS : LEAVE_PREP_MS + REPORT_LINGER_MS,
        )
        expect(r.subLingerMs).toBeLessThanOrEqual(REPORT_LEAVE_BUDGET_MS)
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
