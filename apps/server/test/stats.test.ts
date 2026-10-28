import {
  type DailyStats,
  localDayKey,
  OfficeEvent,
  type ServerMessage,
  StatsMessage,
} from '@claude-office/shared'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../src/app'
import { Hub } from '../src/hub'
import { startReplay } from '../src/replay'
import { makeEvent, WsClient } from './helpers'

/*
 * 오늘 작업량(기획서 7절) — hub 연결 테스트. 세는 규칙 자체는 shared/test/stats.test.ts.
 */

// 현지 시각 기준(localDayKey 가 현지 날짜이므로 어느 시간대에서도 같은 결과).
const T0 = new Date(2026, 9, 28, 12, 0, 0).getTime()
const NEXT_DAY = new Date(2026, 9, 29, 0, 0, 1).getTime()

const SECRET_FILE = 'secret-file-zq9.ts'
const SECRET_CMD = 'secretcmd-zq9'
const SECRET_AGENT = 'agent-secret-zq9'

const ev = (o: Record<string, unknown>) =>
  OfficeEvent.parse(makeEvent({ project: 'demo', ts: new Date(T0).toISOString(), ...o }))

const editEnd = (o: Record<string, unknown> = {}) =>
  ev({
    kind: 'tool.end',
    status: 'ok',
    tool: { name: 'Edit', category: 'edit', target: SECRET_FILE },
    ...o,
  })
const bashEnd = (o: Record<string, unknown> = {}) =>
  ev({
    kind: 'tool.end',
    status: 'ok',
    tool: { name: 'Bash', category: 'shell', target: SECRET_CMD },
    ...o,
  })
const spawn = (o: Record<string, unknown> = {}) =>
  ev({ kind: 'agent.spawn', agentId: SECRET_AGENT, agentType: 'helper', ...o })

function makeHub() {
  let clock = T0
  const hub = new Hub({ now: () => clock })
  const got: ServerMessage[] = []
  hub.subscribe((m) => {
    got.push(m)
  })
  return {
    hub,
    got,
    setClock(ms: number) {
      clock = ms
    },
    types: () => got.map((m) => m.type),
    lastStats(): DailyStats | undefined {
      const s = got.filter((m) => m.type === 'stats').at(-1)
      return s?.type === 'stats' ? s.stats : undefined
    },
  }
}

describe('hub daily stats', () => {
  it('sends stats right after a counted event, and not after one that changes nothing', () => {
    const h = makeHub()
    expect(h.types()).toEqual(['snapshot'])

    h.hub.ingest(editEnd())
    expect(h.types()).toEqual(['snapshot', 'event', 'stats'])
    expect(h.lastStats()?.floors['p:demo']).toEqual({
      filesEdited: 1,
      commands: 0,
      teammates: 0,
      toolUses: 1,
    })

    h.hub.ingest(ev({ kind: 'turn.end' }))
    h.hub.ingest(ev({ kind: 'prompt.submit' }))
    h.hub.ingest(ev({ kind: 'tool.start', tool: { name: 'Edit', category: 'edit' } }))
    expect(h.types()).toEqual(['snapshot', 'event', 'stats', 'event', 'event', 'event'])

    // 같은 팀원 두 번째 spawn 은 숫자가 안 바뀐다 → stats 없음
    h.hub.ingest(spawn())
    h.hub.ingest(spawn())
    expect(h.types().slice(6)).toEqual(['event', 'stats', 'event'])
    expect(h.lastStats()?.floors['p:demo']?.teammates).toBe(1)
  })

  it('counts a duplicate id only once', () => {
    const h = makeHub()
    const e = bashEnd({ id: 'dup-1' })
    expect(h.hub.ingest(e)).toBe('accepted')
    expect(h.hub.ingest(e)).toBe('duplicate')
    expect(h.types()).toEqual(['snapshot', 'event', 'stats'])
    expect(h.lastStats()?.floors['p:demo']).toEqual({
      filesEdited: 0,
      commands: 1,
      teammates: 0,
      toolUses: 1,
    })
  })

  it('same file edited twice counts as one file, two tool uses', () => {
    const h = makeHub()
    h.hub.ingest(editEnd())
    h.hub.ingest(editEnd())
    expect(h.lastStats()?.floors['p:demo']).toMatchObject({ filesEdited: 1, toolUses: 2 })
  })

  it('a new subscriber gets the numbers so far in snapshot.stats (survives a reload)', () => {
    const h = makeHub()
    h.hub.ingest(editEnd())
    h.hub.ingest(bashEnd())
    h.hub.ingest(spawn())

    const late: ServerMessage[] = []
    h.hub.subscribe((m) => {
      late.push(m)
    })
    const snap = late[0]
    expect(snap?.type).toBe('snapshot')
    if (snap?.type !== 'snapshot') return
    expect(snap.stats).toEqual({
      day: localDayKey(T0),
      floors: { 'p:demo': { filesEdited: 1, commands: 1, teammates: 1, toolUses: 2 } },
    })
  })

  it('sweep on the next day broadcasts all-zero stats with the new day; same day sends nothing', () => {
    const h = makeHub()
    h.hub.ingest(editEnd())
    const before = h.got.length

    h.setClock(T0 + 1000)
    h.hub.sweep()
    expect(h.got.length).toBe(before)

    h.setClock(NEXT_DAY)
    h.hub.sweep()
    const fresh = h.got.slice(before).filter((m) => m.type === 'stats')
    expect(fresh).toHaveLength(1)
    expect(h.lastStats()).toEqual({ day: localDayKey(NEXT_DAY), floors: {} })

    // 한 번 바뀐 뒤 같은 날 sweep 은 다시 보내지 않는다
    const after = h.got.length
    h.hub.sweep()
    expect(h.got.slice(after).filter((m) => m.type === 'stats')).toHaveLength(0)
    // 새 subscriber 도 0 을 받는다
    expect(h.hub.snapshot().stats).toEqual({ day: localDayKey(NEXT_DAY), floors: {} })
  })

  it('replayed events add to the same floor as real ones', async () => {
    const h = makeHub()
    h.hub.ingest(editEnd())
    const r = startReplay(h.hub, [bashEnd({ sessionId: 'rec' }), spawn({ sessionId: 'rec' })], {
      speed: 1000,
      makeSuffix: () => 'rp',
    })
    await r.done
    expect(h.hub.getState().sessions['rec-rp']).toBeDefined()
    expect(h.lastStats()?.floors).toEqual({
      'p:demo': { filesEdited: 1, commands: 1, teammates: 1, toolUses: 2 },
    })
  })

  it('a session without project uses s:<sessionId>, and later events find the project in state', () => {
    const h = makeHub()
    h.hub.ingest(OfficeEvent.parse(makeEvent({ sessionId: 'np', kind: 'session.start' })))
    h.hub.ingest(
      OfficeEvent.parse(
        makeEvent({
          sessionId: 'np',
          kind: 'tool.end',
          status: 'error',
          tool: { name: 'Bash', category: 'shell' },
        }),
      ),
    )
    expect(Object.keys(h.lastStats()?.floors ?? {})).toEqual(['s:np'])
  })
})

describe('stats over HTTP + WS carry no file names, commands or agent ids', () => {
  let app: FastifyInstance | undefined
  let client: WsClient | undefined
  afterEach(async () => {
    client?.close()
    await app?.close()
    app = undefined
  })

  it('raw stats JSON and snapshot.stats contain only numbers', async () => {
    let clock = T0
    app = await buildApp({
      now: () => clock,
      sweepIntervalMs: 0,
      heartbeatMs: 0,
      webDistDir: false,
    })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('no address')
    client = await WsClient.connect(`ws://127.0.0.1:${addr.port}/ws`)
    const raw: string[] = []
    client.ws.on('message', (d) => raw.push(String(d)))
    expect((await client.next()).type).toBe('snapshot')

    const res = await app.inject({
      method: 'POST',
      url: '/events',
      payload: [editEnd(), bashEnd(), spawn()],
    })
    expect(res.statusCode).toBe(202)
    for (const secret of [SECRET_FILE, SECRET_CMD, SECRET_AGENT]) {
      expect(res.body).not.toContain(secret)
    }

    // event, stats, event, stats, event, stats
    const kinds: string[] = []
    for (let i = 0; i < 6; i++) kinds.push((await client.nextNonHeartbeat()).type)
    expect(kinds).toEqual(['event', 'stats', 'event', 'stats', 'event', 'stats'])

    const statsRaw = raw.filter((s) => JSON.parse(s).type === 'stats')
    expect(statsRaw).toHaveLength(3)
    for (const s of statsRaw) {
      for (const secret of [SECRET_FILE, SECRET_CMD, SECRET_AGENT]) expect(s).not.toContain(secret)
      // 서버가 보낸 그대로가 계약과 같다(추가 필드 없음)
      const parsed: unknown = JSON.parse(s)
      expect(StatsMessage.parse(parsed)).toEqual(parsed)
    }
    expect(JSON.parse(statsRaw.at(-1) ?? '{}').stats.floors['p:demo']).toEqual({
      filesEdited: 1,
      commands: 1,
      teammates: 1,
      toolUses: 2,
    })

    // 새로 접속한 클라이언트의 snapshot.stats 에도 이름이 없다
    const second = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`)
    const snapRaw = await new Promise<string>((resolve, reject) => {
      second.once('message', (d) => resolve(String(d)))
      second.once('error', reject)
    })
    second.close()
    const statsPart = JSON.stringify(JSON.parse(snapRaw).stats)
    expect(statsPart).toContain('"toolUses":2')
    for (const secret of [SECRET_FILE, SECRET_CMD, SECRET_AGENT]) {
      expect(statsPart).not.toContain(secret)
    }

    // /api/state 는 OfficeState 그대로(통계 필드 없음)
    const state = (await app.inject({ url: '/api/state' })).json()
    expect(state).not.toHaveProperty('stats')
    expect(JSON.stringify(state)).not.toContain('toolUses')

    // 자정 sweep 도 WS 로 0 을 보낸다(오래 조용한 세션의 만료 event 가 먼저 올 수 있다)
    clock = NEXT_DAY
    app.hub.sweep()
    let zero = await client.nextNonHeartbeat()
    while (zero.type === 'event') zero = await client.nextNonHeartbeat()
    expect(zero).toEqual({ type: 'stats', stats: { day: localDayKey(NEXT_DAY), floors: {} } })
  })
})
