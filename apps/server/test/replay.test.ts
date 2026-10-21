import { readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app'
import { Hub } from '../src/hub'
import { parseJsonl, prepareReplay, startReplay } from '../src/replay'
import { fixtureEvents, makeEvent } from './helpers'

afterEach(() => {
  vi.useRealTimers()
})

describe('parseJsonl', () => {
  it('skips blank lines, comments and invalid lines', () => {
    const text = [
      '// comment',
      '',
      JSON.stringify(makeEvent({ id: 'a' })),
      '{broken',
      JSON.stringify({ v: 1, kind: 'nope' }),
      JSON.stringify(makeEvent({ id: 'b' })),
    ].join('\n')
    const r = parseJsonl(text)
    expect(r.events.map((e) => e.id)).toEqual(['a', 'b'])
    expect(r.skipped.map((s) => s.line)).toEqual([4, 5])
  })
})

describe('prepareReplay', () => {
  const events = fixtureEvents()
  const startAt = Date.parse('2026-10-21T12:00:00.000Z')

  it('moves ts to start at now, keeping intervals divided by speed', () => {
    const out = prepareReplay(events, { startAt, speed: 4, suffix: 'abc' })
    expect(out).toHaveLength(events.length)
    expect(out[0]?.event.ts).toBe(new Date(startAt).toISOString())
    const t0 = Date.parse(events[0]?.ts ?? '')
    out.forEach((item, i) => {
      const orig = Date.parse(events[i]?.ts ?? '') - t0
      expect(item.offsetMs).toBe(Math.round(orig / 4))
      expect(Date.parse(item.event.ts) - startAt).toBeCloseTo(orig / 4, 0)
    })
  })

  it('gives every run a new sessionId and new ids', () => {
    const a = prepareReplay(events, { startAt, speed: 1, suffix: 'run1' })
    const b = prepareReplay(events, { startAt, speed: 1, suffix: 'run2' })
    expect(a[0]?.event.sessionId).toBe('sample-run1')
    expect(b[0]?.event.sessionId).toBe('sample-run2')
    const ids = new Set([...a, ...b].map((x) => x.event.id))
    expect(ids.size).toBe(a.length + b.length)
  })

  it('keeps ids and sessionIds within 128 chars', () => {
    const long = makeEvent({ sessionId: 's'.repeat(128), id: 'i'.repeat(128) })
    const [only] = parseJsonl(JSON.stringify(long)).events
    if (!only) throw new Error('parse')
    const out = prepareReplay([only], { startAt, speed: 1, suffix: 'zzzzzzzz' })
    expect(out[0]?.event.sessionId.length).toBe(128)
    expect(out[0]?.event.sessionId.endsWith('-zzzzzzzz')).toBe(true)
  })
})

describe('startReplay', () => {
  it('replays at speed with fake timers, twice as two separate sessions, not expired by idleSweep', async () => {
    vi.useFakeTimers()
    const startAt = Date.parse('2026-10-21T12:00:00.000Z')
    vi.setSystemTime(startAt)
    const hub = new Hub()
    const events = fixtureEvents()
    const totalMs = (Date.parse(events.at(-1)?.ts ?? '') - Date.parse(events[0]?.ts ?? '')) / 4
    let n = 0
    const suffixes = ['one', 'two']
    const run = () => startReplay(hub, events, { speed: 4, makeSuffix: () => suffixes[n++] ?? 'x' })

    const r1 = run()
    await vi.advanceTimersByTimeAsync(0)
    // 첫 이벤트는 즉시, 나머지는 아직
    expect(hub.getState().sessions['sample-one']).toBeDefined()
    expect(hub.getState().sessions['sample-one']?.endedAt).toBeUndefined()
    // 재생 도중 idleSweep 이 세션을 만료시키지 않는다(ts 가 현재 기준).
    expect(hub.sweep()).toEqual([])
    await vi.advanceTimersByTimeAsync(totalMs)
    await r1.done
    const one = hub.getState().sessions['sample-one']
    expect(one?.endReason).toBe('exit')
    expect(one?.agents.main?.activity).toBe('gone')
    expect(one?.agents['sub-a']?.activity).toBe('gone')

    const r2 = run()
    await vi.advanceTimersByTimeAsync(totalMs)
    await r2.done
    expect(hub.getState().sessions['sample-two']?.endReason).toBe('exit')
    expect(Object.keys(hub.getState().sessions).sort()).toEqual(['sample-one', 'sample-two'])
  })

  it('stop() ends a looping replay', async () => {
    vi.useFakeTimers()
    const hub = new Hub()
    const r = startReplay(hub, fixtureEvents(), { speed: 1000, loop: true, loopGapMs: 10 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(Object.keys(hub.getState().sessions).length).toBeGreaterThan(1)
    r.stop()
    await r.done
  })
})

describe('--record', () => {
  it('records only externally received events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'co-rec-'))
    const file = join(dir, 'rec.jsonl')
    const app = await buildApp({
      recordFile: file,
      sweepIntervalMs: 0,
      heartbeatMs: 0,
      webDistDir: false,
    })
    const e = makeEvent({ id: 'rec-1', ts: new Date(Date.now() - 120_000).toISOString() })
    await app.inject({ method: 'POST', url: '/events', payload: e })
    await app.inject({ method: 'POST', url: '/events', payload: e }) // 중복
    expect(app.hub.sweep().map((x) => x.kind)).toEqual(['agent.idle']) // 서버 생성: 기록 안 함
    await app.close()
    const lines = parseJsonl(readFileSync(file, 'utf8'))
    expect(lines.events.map((x) => x.id)).toEqual(['rec-1'])
  })
})
