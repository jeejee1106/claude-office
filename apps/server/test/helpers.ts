import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type OfficeEvent, ServerMessage } from '@claude-office/shared'
import WebSocket from 'ws'
import { parseJsonl } from '../src/replay'

export const FIXTURE = fileURLToPath(
  new URL('../../../fixtures/sample-session.jsonl', import.meta.url),
)

export function fixtureEvents(): OfficeEvent[] {
  return parseJsonl(readFileSync(FIXTURE, 'utf8')).events
}

export function makeEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    id: `t-${Math.random().toString(36).slice(2)}`,
    ts: '2026-01-01T00:00:00.000Z',
    sessionId: 's1',
    agentId: 'main',
    kind: 'prompt.submit',
    ...overrides,
  }
}

/** 실제 WS 클라이언트. 받은 메시지를 ServerMessage.parse 해 순서대로 꺼낼 수 있다. */
export class WsClient {
  private queue: ServerMessage[] = []
  private waiters: ((m: ServerMessage) => void)[] = []
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const msg = ServerMessage.parse(JSON.parse(String(data)))
      const w = this.waiters.shift()
      if (w) w(msg)
      else this.queue.push(msg)
    })
  }

  static connect(url: string, origin?: string): Promise<WsClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, origin ? { headers: { origin } } : {})
      const client = new WsClient(ws)
      ws.once('open', () => resolve(client))
      ws.once('error', reject)
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
    })
  }

  next(timeoutMs = 2000): Promise<ServerMessage> {
    const queued = this.queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for WS message')), timeoutMs)
      this.waiters.push((m) => {
        clearTimeout(t)
        resolve(m)
      })
    })
  }

  /** heartbeat 를 건너뛰고 다음 메시지 */
  async nextNonHeartbeat(timeoutMs = 2000): Promise<ServerMessage> {
    for (;;) {
      const m = await this.next(timeoutMs)
      if (m.type !== 'heartbeat') return m
    }
  }

  close(): void {
    this.ws.close()
  }
}
