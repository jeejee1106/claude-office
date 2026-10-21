import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BACKOFF_MAX_MS,
  backoffDelay,
  type ConnectionStatus,
  defaultSocketUrl,
  HEARTBEAT_TIMEOUT_MS,
  OfficeSocket,
  parseServerMessage,
  type WebSocketLike,
} from '../src/net/socket'

const TS = '2026-01-01T00:00:00.000Z'

describe('parseServerMessage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('모르는 type·JSON 아닌 문자열·잘못된 형태를 throw 없이 무시한다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseServerMessage(JSON.stringify({ type: 'hello' }))).toBeNull()
    expect(parseServerMessage({ type: 'hello' })).toBeNull()
    expect(parseServerMessage('not json {')).toBeNull()
    expect(parseServerMessage('')).toBeNull()
    expect(parseServerMessage(null)).toBeNull()
    expect(parseServerMessage(42)).toBeNull()
    expect(
      parseServerMessage(JSON.stringify({ type: 'event', event: { kind: 'tool.mystery' } })),
    ).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('snapshot·event·heartbeat 를 파싱한다', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'heartbeat', ts: TS }))).toEqual({
      type: 'heartbeat',
      ts: TS,
    })
    const snap = parseServerMessage(
      JSON.stringify({ type: 'snapshot', state: { sessions: {} }, recent: [], ts: TS }),
    )
    expect(snap?.type).toBe('snapshot')
    const event = parseServerMessage(
      JSON.stringify({
        type: 'event',
        event: { v: 1, id: 'e', ts: TS, sessionId: 's', agentId: 'main', kind: 'turn.end' },
      }),
    )
    expect(event?.type).toBe('event')
  })
})

describe('OfficeSocket', () => {
  it('URL 은 상대 경로 /ws', () => {
    expect(defaultSocketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws',
    )
    expect(defaultSocketUrl({ protocol: 'https:', host: 'x' })).toBe('wss://x/ws')
  })

  it('지수 백오프 0.5s → 최대 10s', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(backoffDelay)).toEqual([
      500,
      1000,
      2000,
      4000,
      8000,
      10_000,
      BACKOFF_MAX_MS,
    ])
  })

  it('끊기면 백오프로 재접속, 열리면 attempt 초기화, heartbeat 미수신이면 재접속', () => {
    vi.useFakeTimers()
    try {
      const sockets: FakeWs[] = []
      const statuses: ConnectionStatus[] = []
      const messages: string[] = []
      const s = new OfficeSocket({
        url: 'ws://x/ws',
        onMessage: (m) => messages.push(m.type),
        onStatus: (st) => statuses.push(st),
        createSocket: () => {
          const ws = new FakeWs()
          sockets.push(ws)
          return ws
        },
      })
      s.start()
      expect(sockets).toHaveLength(1)
      sockets[0]?.onclose?.({})
      vi.advanceTimersByTime(499)
      expect(sockets).toHaveLength(1)
      vi.advanceTimersByTime(1)
      expect(sockets).toHaveLength(2)
      sockets[1]?.onclose?.({})
      vi.advanceTimersByTime(1000)
      expect(sockets).toHaveLength(3)
      // 열림 → 메시지 수신
      sockets[2]?.onopen?.({})
      sockets[2]?.onmessage?.({ data: JSON.stringify({ type: 'heartbeat', ts: TS }) })
      sockets[2]?.onmessage?.({ data: '{"type":"hello"}' })
      expect(messages).toEqual(['heartbeat'])
      // heartbeat 45초 미수신 → 닫고 500ms 후 재접속(attempt 초기화됨)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS)
      expect(sockets[2]?.closed).toBe(true)
      vi.advanceTimersByTime(500)
      expect(sockets).toHaveLength(4)
      warn.mockRestore()
      expect(statuses).toContain('open')
      expect(statuses.at(-1)).toBe('connecting')
      s.stop()
      expect(statuses.at(-1)).toBe('closed')
      vi.advanceTimersByTime(60_000)
      expect(sockets).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })
})

class FakeWs implements WebSocketLike {
  onopen: ((ev: unknown) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  closed = false
  close() {
    this.closed = true
  }
}
