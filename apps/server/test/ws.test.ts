import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'
import { fixtureEvents, WsClient } from './helpers'

let app: FastifyInstance | undefined
const clients: WsClient[] = []
afterEach(async () => {
  for (const c of clients.splice(0)) c.close()
  await app?.close()
  app = undefined
})

async function start(opts: Parameters<typeof buildApp>[0] = {}) {
  app = await buildApp({ sweepIntervalMs: 0, heartbeatMs: 0, webDistDir: false, ...opts })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  if (!addr || typeof addr === 'string') throw new Error('no address')
  return { app, base: `127.0.0.1:${addr.port}` }
}

async function connect(base: string, origin?: string) {
  const c = await WsClient.connect(`ws://${base}/ws`, origin)
  clients.push(c)
  return c
}

describe('GET /ws', () => {
  it('sends snapshot first, then the posted event', async () => {
    const { app, base } = await start()
    const [first, second] = fixtureEvents()
    if (!first || !second) throw new Error('fixture')
    await app.inject({ method: 'POST', url: '/events', payload: first })

    const c = await connect(base)
    const snap = await c.next()
    expect(snap.type).toBe('snapshot')
    if (snap.type !== 'snapshot') return
    expect(snap.recent.map((e) => e.id)).toEqual([first.id])
    expect(snap.state.sessions.sample).toBeDefined()

    await app.inject({ method: 'POST', url: '/events', payload: second })
    const ev = await c.next()
    expect(ev.type).toBe('event')
    if (ev.type === 'event') expect(ev.event.id).toBe(second.id)
  })

  it('accepts localhost origins on any port and rejects others', async () => {
    const { base } = await start()
    await expect(connect(base, 'http://evil.example')).rejects.toThrow(/403/)
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:7333', 'http://[::1]:9']) {
      const c = await connect(base, origin)
      expect((await c.next()).type).toBe('snapshot')
    }
  })

  it('sends heartbeats periodically', async () => {
    const { base } = await start({ heartbeatMs: 20 })
    const c = await connect(base)
    expect((await c.next()).type).toBe('snapshot')
    expect((await c.next()).type).toBe('heartbeat')
  })

  it('drops closed subscribers', async () => {
    const { app, base } = await start()
    const c = await connect(base)
    await c.next()
    expect(app.hub.subscriberCount).toBe(1)
    c.close()
    await new Promise((r) => setTimeout(r, 50))
    expect(app.hub.subscriberCount).toBe(0)
  })
})
