import { OfficeState } from '@claude-office/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app'
import { makeEvent, WsClient } from './helpers'

let app: FastifyInstance | undefined
let client: WsClient | undefined
afterEach(async () => {
  client?.close()
  await app?.close()
  app = undefined
  vi.useRealTimers()
})

describe('idleSweep timer', () => {
  it('broadcasts agent.idle after 61s of silence and the state becomes idle', async () => {
    // setInterval 만 가짜로: 소켓·inject 는 실제 시간으로 동작한다.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const t0 = Date.parse('2026-05-01T00:00:00.000Z')
    let clock = t0
    app = await buildApp({
      now: () => clock,
      sweepIntervalMs: 5000,
      heartbeatMs: 0,
      webDistDir: false,
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('no address')
    client = await WsClient.connect(`ws://127.0.0.1:${addr.port}/ws`)
    expect((await client.next()).type).toBe('snapshot')

    const e = makeEvent({ id: 'p1', sessionId: 'idle-s', ts: new Date(t0).toISOString() })
    await app.inject({ method: 'POST', url: '/events', payload: e })
    expect((await client.next()).type).toBe('event')

    // 30초: 아직 working
    clock = t0 + 30_000
    vi.advanceTimersByTime(5000)
    let s = OfficeState.parse((await app.inject({ url: '/api/state' })).json())
    expect(s.sessions['idle-s']?.agents.main?.activity).toBe('working')

    // 61초: idle
    clock = t0 + 61_000
    vi.advanceTimersByTime(5000)
    const msg = await client.next()
    expect(msg.type).toBe('event')
    if (msg.type === 'event') {
      expect(msg.event.kind).toBe('agent.idle')
      expect(msg.event.agentId).toBe('main')
    }
    s = OfficeState.parse((await app.inject({ url: '/api/state' })).json())
    expect(s.sessions['idle-s']?.agents.main?.activity).toBe('idle')

    // 같은 상태로 다시 sweep 해도 추가 이벤트 없음
    vi.advanceTimersByTime(5000)
    expect(app.hub.sweep()).toEqual([])
  })

  it('expires a quiet session with session.end timeout after 30 minutes', async () => {
    const t0 = Date.parse('2026-05-01T00:00:00.000Z')
    let clock = t0
    app = await buildApp({
      now: () => clock,
      sweepIntervalMs: 0,
      heartbeatMs: 0,
      webDistDir: false,
    })
    await app.inject({
      method: 'POST',
      url: '/events',
      payload: makeEvent({ sessionId: 'old', ts: new Date(t0).toISOString() }),
    })
    clock = t0 + 30 * 60_000
    const out = app.hub.sweep()
    expect(out.map((e) => e.kind)).toEqual(['session.end'])
    expect(app.hub.getState().sessions.old?.endReason).toBe('timeout')
  })
})
