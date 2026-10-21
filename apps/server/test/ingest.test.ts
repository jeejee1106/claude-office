import { IngestResponse, OfficeState } from '@claude-office/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { fixtureEvents, makeEvent } from './helpers'

let app: FastifyInstance
beforeEach(async () => {
  app = await buildApp({ sweepIntervalMs: 0, heartbeatMs: 0, webDistDir: false })
})
afterEach(async () => {
  await app.close()
})

const post = (payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/events', payload: payload as object, headers })

const state = async () => OfficeState.parse((await app.inject({ url: '/api/state' })).json())

describe('POST /events', () => {
  it('accepts a single valid event with 202', async () => {
    const res = await post(fixtureEvents()[0])
    expect(res.statusCode).toBe(202)
    expect(IngestResponse.parse(res.json())).toEqual({ accepted: 1, duplicates: 0, rejected: [] })
  })

  it('rejects a schema violation with 400 and index 0', async () => {
    const res = await post(makeEvent({ kind: 'tool.start' })) // tool 누락
    expect(res.statusCode).toBe(400)
    const body = IngestResponse.parse(res.json())
    expect(body.accepted).toBe(0)
    expect(body.rejected[0]?.index).toBe(0)
  })

  it('handles an array: 2 valid + 1 invalid -> 202, accepted 2, rejected 1', async () => {
    const res = await post([makeEvent(), makeEvent({ v: 2 }), makeEvent({ kind: 'turn.end' })])
    expect(res.statusCode).toBe(202)
    const body = IngestResponse.parse(res.json())
    expect(body.accepted).toBe(2)
    expect(body.rejected).toHaveLength(1)
    expect(body.rejected[0]?.index).toBe(1)
  })

  it('ignores duplicate ids and leaves the state unchanged', async () => {
    const e = makeEvent({ id: 'dup-1' })
    await post(e)
    const once = await state()
    const res = await post(e)
    expect(res.statusCode).toBe(202)
    expect(IngestResponse.parse(res.json())).toEqual({ accepted: 0, duplicates: 1, rejected: [] })
    expect(await state()).toEqual(once)
  })

  it('counts duplicates inside one batch', async () => {
    const e = makeEvent({ id: 'dup-2' })
    const body = IngestResponse.parse((await post([e, e])).json())
    expect(body).toEqual({ accepted: 1, duplicates: 1, rejected: [] })
  })

  it('returns 413 for a body over 64KB', async () => {
    const big = makeEvent({ project: 'x'.repeat(65 * 1024) })
    const res = await post(big)
    expect(res.statusCode).toBe(413)
  })

  it('returns 400 for malformed JSON, non-object bodies and batches over 100', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/events',
      payload: '{nope',
      headers: { 'content-type': 'application/json' },
    })
    expect(bad.statusCode).toBe(400)
    expect((await post('"hello"', { 'content-type': 'application/json' })).statusCode).toBe(400)
    const many = Array.from({ length: 101 }, () => makeEvent())
    expect((await post(many)).statusCode).toBe(400)
  })

  it('rejects requests from a non-localhost Origin with 403', async () => {
    const res = await post(makeEvent(), { origin: 'http://evil.example' })
    expect(res.statusCode).toBe(403)
    expect((await post(makeEvent(), { origin: 'http://localhost:5173' })).statusCode).toBe(202)
  })

  it('applies the 29-event sample session: main and sub-a are gone, endReason exit', async () => {
    const events = fixtureEvents()
    expect(events).toHaveLength(29)
    for (const e of events) expect((await post(e)).statusCode).toBe(202)
    const s = (await state()).sessions.sample
    expect(s?.endReason).toBe('exit')
    expect(s?.agents.main?.activity).toBe('gone')
    expect(s?.agents['sub-a']?.activity).toBe('gone')
  })
})

describe('other routes', () => {
  it('GET /healthz', async () => {
    const res = await app.inject({ url: '/healthz' })
    expect(res.json()).toEqual({ ok: true, version: '0.1.0', schema: 1 })
  })

  it('GET / without a web build returns a hint', async () => {
    const res = await app.inject({ url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('web')
  })
})
