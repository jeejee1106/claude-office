import {
  createInitialState,
  floorKeyFor,
  type OfficeEvent,
  type OfficeState,
  reduce,
} from '@claude-office/shared'
import { describe, expect, it, vi } from 'vitest'
import { attachSoundController } from '../src/sound/soundController'
import { decideSound, SOUND_COOLDOWN_MS, type SoundId } from '../src/sound/soundRules'
import { createWebAudioSynth, VOICES, voiceDuration } from '../src/sound/synth'
import { createOfficeStore } from '../src/store/officeStore'
import { ev } from './helpers'

const T = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString()
const HERE = floorKeyFor('here', 'a')
const THERE = floorKeyFor('there', 'b')

/** 'a' 세션 = here 층, 'b' 세션 = there 층 */
function base(): OfficeState {
  let s = createInitialState()
  s = reduce(s, ev({ sessionId: 'a', project: 'here', kind: 'session.start', ts: T(0) }))
  s = reduce(s, ev({ sessionId: 'b', project: 'there', kind: 'session.start', ts: T(1) }))
  return s
}

function decide(
  prev: OfficeState,
  e: OfficeEvent,
  floor: string | null = HERE,
  lastPlayed: Partial<Record<SoundId, number>> = {},
  now = 10_000,
): SoundId | null {
  return decideSound({ event: e, prev, next: reduce(prev, e), floor, lastPlayed, now })
}

const spawn = (sessionId: string, agentId = 'sub1', ts = T(5)) =>
  ev({ sessionId, agentId, parentAgentId: 'main', kind: 'agent.spawn', agentType: 'Explore', ts })

describe('decideSound — 직원 출근', () => {
  it('지금 층의 서브에이전트 spawn → spawn', () => {
    expect(decide(base(), spawn('a'))).toBe('spawn')
  })
  it('다른 층이면 울리지 않음', () => {
    expect(decide(base(), spawn('b'))).toBeNull()
  })
  it('main 의 spawn 은 아님', () => {
    expect(decide(base(), ev({ sessionId: 'a', kind: 'agent.spawn', ts: T(5) }))).toBeNull()
  })
  it('이미 있는 서브에이전트에 spawn 이 또 와도 아님', () => {
    const s = reduce(base(), spawn('a'))
    expect(decide(s, spawn('a', 'sub1', T(6)))).toBeNull()
  })
  it('퇴장 전 시각의 늦은 spawn(되살아나지 않음)은 아님', () => {
    const s = reduce(
      base(),
      ev({ sessionId: 'a', agentId: 'sub1', kind: 'agent.finish', ts: T(9) }),
    )
    expect(decide(s, spawn('a', 'sub1', T(5)))).toBeNull()
  })
})

describe('decideSound — 확인 요청', () => {
  const att = (sessionId: string, agentId = 'main', ts = T(5)) =>
    ev({ sessionId, agentId, kind: 'attention', reason: 'permission', ts })

  it('"?"가 새로 뜨면 → attention', () => {
    expect(decide(base(), att('a'))).toBe('attention')
  })
  it('다른 층이어도 울림', () => {
    expect(decide(base(), att('b'))).toBe('attention')
  })
  it('층이 아직 없어도 울림', () => {
    expect(decide(base(), att('a'), null)).toBe('attention')
  })
  it('이미 "?"인 에이전트에 또 오면 아님', () => {
    const s = reduce(base(), att('a'))
    expect(decide(s, att('a', 'main', T(6)))).toBeNull()
  })
  it('"?"가 풀린 뒤 다시 오면 울림', () => {
    let s = reduce(base(), att('a'))
    s = reduce(s, ev({ sessionId: 'a', kind: 'attention.clear', ts: T(6) }))
    expect(decide(s, att('a', 'main', T(7)))).toBe('attention')
  })
  it('서브에이전트의 확인 요청도 울림', () => {
    const s = reduce(base(), spawn('a'))
    expect(decide(s, att('a', 'sub1', T(6)))).toBe('attention')
  })
  it('종료된 세션에 늦게 온 attention 은 아님', () => {
    const s = reduce(base(), ev({ sessionId: 'a', kind: 'session.end', ts: T(9) }))
    expect(decide(s, att('a', 'main', T(8)))).toBeNull()
  })
})

describe('decideSound — 팀장 일 끝', () => {
  const end = (sessionId: string, agentId = 'main') =>
    ev({ sessionId, agentId, kind: 'turn.end', ts: T(5) })

  it('지금 층의 main turn.end → turnEnd', () => {
    expect(decide(base(), end('a'))).toBe('turnEnd')
  })
  it('다른 층이면 아님', () => {
    expect(decide(base(), end('b'))).toBeNull()
  })
  it('서브에이전트 turn.end 는 아님', () => {
    const s = reduce(base(), spawn('a'))
    expect(decide(s, end('a', 'sub1'))).toBeNull()
  })
  it('다른 이벤트는 소리 없음', () => {
    expect(decide(base(), ev({ sessionId: 'a', kind: 'prompt.submit', ts: T(5) }))).toBeNull()
  })
})

describe('decideSound — 2초 제한', () => {
  const end = ev({ sessionId: 'a', kind: 'turn.end', ts: T(5) })
  it('같은 소리는 2초 안에 다시 울리지 않음', () => {
    expect(decide(base(), end, HERE, { turnEnd: 10_000 - SOUND_COOLDOWN_MS + 1 })).toBeNull()
    expect(decide(base(), end, HERE, { turnEnd: 10_000 - SOUND_COOLDOWN_MS })).toBe('turnEnd')
  })
  it('다른 소리의 재생 시각은 상관없음', () => {
    expect(decide(base(), end, HERE, { spawn: 9_999, attention: 9_999 })).toBe('turnEnd')
  })
})

describe('attachSoundController', () => {
  function setup(enabled = true) {
    const store = createOfficeStore()
    const played: SoundId[] = []
    let clock = 0
    let on = enabled
    const detach = attachSoundController(store, {
      player: { unlock: () => {}, play: (id) => played.push(id) },
      isEnabled: () => on,
      now: () => clock,
    })
    return {
      store,
      played,
      detach,
      tick: (ms: number) => {
        clock += ms
      },
      setOn: (v: boolean) => {
        on = v
      },
    }
  }

  it('snapshot(처음·재접속)으로는 울리지 않고, 실시간 event 에서만 울림', () => {
    const { store, played } = setup()
    let s = base()
    s = reduce(s, ev({ sessionId: 'a', kind: 'attention', reason: 'permission', ts: T(3) }))
    store.applyMessage({ type: 'snapshot', state: s, recent: [], ts: T(3) })
    store.applyMessage({ type: 'snapshot', state: s, recent: [], ts: T(4) })
    expect(played).toEqual([])
    // snapshot 에서 이미 "?" 였으므로 같은 에이전트의 attention 은 울리지 않음
    store.applyMessage({
      type: 'event',
      event: ev({ sessionId: 'a', kind: 'attention', reason: 'permission', ts: T(5) }),
    })
    expect(played).toEqual([])
    store.applyMessage({ type: 'event', event: spawn('a', 'sub1', T(6)) })
    expect(played).toEqual(['spawn'])
  })

  it('지금 보는 층을 따른다(층 전환 후)', () => {
    const { store, played } = setup()
    store.applyMessage({ type: 'snapshot', state: base(), recent: [], ts: T(2) })
    store.selectFloor(THERE)
    store.applyMessage({ type: 'event', event: ev({ sessionId: 'a', kind: 'turn.end', ts: T(5) }) })
    store.applyMessage({ type: 'event', event: ev({ sessionId: 'b', kind: 'turn.end', ts: T(6) }) })
    expect(played).toEqual(['turnEnd'])
  })

  it('2초 제한, 꺼져 있으면 울리지 않음, detach 후 조용함', () => {
    const { store, played, tick, setOn, detach } = setup()
    store.applyMessage({ type: 'snapshot', state: base(), recent: [], ts: T(2) })
    store.selectFloor(HERE)
    const end = (s: number) => ev({ sessionId: 'a', kind: 'turn.end', ts: T(s) })
    store.applyMessage({ type: 'event', event: end(5) })
    tick(1000)
    store.applyMessage({ type: 'event', event: end(6) })
    tick(1000)
    store.applyMessage({ type: 'event', event: end(7) })
    expect(played).toEqual(['turnEnd', 'turnEnd'])
    setOn(false)
    tick(5000)
    store.applyMessage({ type: 'event', event: end(8) })
    expect(played).toHaveLength(2)
    setOn(true)
    detach()
    tick(5000)
    store.applyMessage({ type: 'event', event: end(9) })
    expect(played).toHaveLength(2)
  })

  it('꺼진 동안의 상태도 따라가므로, 켠 뒤 이미 "?"인 에이전트에는 울리지 않음', () => {
    const { store, played, setOn } = setup(false)
    store.applyMessage({ type: 'snapshot', state: base(), recent: [], ts: T(2) })
    const att = (s: number) =>
      ev({ sessionId: 'b', kind: 'attention', reason: 'permission', ts: T(s) })
    store.applyMessage({ type: 'event', event: att(5) })
    setOn(true)
    store.applyMessage({ type: 'event', event: att(6) })
    expect(played).toEqual([])
  })
})

describe('createWebAudioSynth', () => {
  it('모든 소리는 0.1~0.4초', () => {
    for (const v of Object.values(VOICES)) {
      const d = voiceDuration(v)
      expect(d).toBeGreaterThanOrEqual(0.1)
      expect(d).toBeLessThanOrEqual(0.4)
    }
  })

  it('AudioContext 를 만들 수 없으면 조용히 무시, 경고는 한 번', () => {
    const warn = vi.fn()
    const p = createWebAudioSynth(() => {
      throw new Error('no audio')
    }, warn)
    p.unlock()
    p.play('spawn')
    p.play('attention')
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('unlock 전에는 만들지 않고, 실행 중이면 음 개수만큼 오실레이터를 만든다', () => {
    const made = { ctx: 0, osc: 0 }
    const param = () => ({
      value: 0,
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
    })
    const fakeCtx = {
      state: 'running',
      currentTime: 0,
      destination: {},
      resume: () => Promise.resolve(),
      createGain: () => ({ gain: param(), connect: () => {} }),
      createOscillator: () => {
        made.osc++
        return { type: '', frequency: param(), connect: () => {}, start: () => {}, stop: () => {} }
      },
    }
    const p = createWebAudioSynth(() => {
      made.ctx++
      return fakeCtx as unknown as AudioContext
    })
    expect(made.ctx).toBe(0)
    p.unlock()
    p.play('turnEnd')
    expect(made.ctx).toBe(1)
    expect(made.osc).toBe(VOICES.turnEnd.notes.length)
  })
})
