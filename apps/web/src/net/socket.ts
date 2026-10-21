import { PATHS, ServerMessage } from '@claude-office/shared'

/*
 * 서버 WebSocket 연결.
 * - 상대 URL(/ws): dev(Vite 프록시)·prod(서버 정적 서빙) 모두 같은 코드
 * - 수신: JSON.parse → ServerMessage.safeParse. 실패·모르는 type 은 console.warn 후 무시(throw 금지)
 * - 재접속: 지수 백오프 0.5s → 최대 10s, heartbeat(또는 아무 메시지) 45초 미수신 시 끊고 재접속
 */

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

export const BACKOFF_BASE_MS = 500
export const BACKOFF_MAX_MS = 10_000
export const HEARTBEAT_TIMEOUT_MS = 45_000

/** attempt 0 → 500ms, 1 → 1s, 2 → 2s … 최대 10s */
export function backoffDelay(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt))
}

/** WS 수신 데이터 → ServerMessage. 검증 실패·모르는 type·JSON 아님 → null (throw 없음) */
export function parseServerMessage(data: unknown): ServerMessage | null {
  let raw: unknown = data
  if (typeof data === 'string') {
    try {
      raw = JSON.parse(data)
    } catch {
      console.warn('[claude-office] WS: JSON 이 아닌 메시지를 무시합니다')
      return null
    }
  }
  const r = ServerMessage.safeParse(raw)
  if (!r.success) {
    const type =
      typeof raw === 'object' && raw !== null && 'type' in raw ? String(raw.type) : '(없음)'
    console.warn(`[claude-office] WS: 알 수 없거나 잘못된 메시지(type=${type})를 무시합니다`)
    return null
  }
  return r.data
}

export function defaultSocketUrl(loc: Pick<Location, 'protocol' | 'host'> = location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${PATHS.ws}`
}

/** 테스트에서 가짜 WebSocket 을 주입할 수 있도록 필요한 부분만 */
export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  close(): void
}

export interface OfficeSocketOptions {
  url?: string
  onMessage: (msg: ServerMessage) => void
  onStatus: (status: ConnectionStatus) => void
  createSocket?: (url: string) => WebSocketLike
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export class OfficeSocket {
  private readonly opts: Required<Omit<OfficeSocketOptions, 'url'>> & { url: string }
  private ws: WebSocketLike | null = null
  private attempt = 0
  private reconnectTimer: unknown = null
  private watchdog: unknown = null
  private stopped = true

  constructor(opts: OfficeSocketOptions) {
    this.opts = {
      url: opts.url ?? defaultSocketUrl(),
      onMessage: opts.onMessage,
      onStatus: opts.onStatus,
      createSocket: opts.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike),
      setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    }
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    const ws = this.ws
    this.ws = null
    if (ws !== null) {
      ws.onclose = null
      ws.close()
    }
    this.opts.onStatus('closed')
  }

  private connect(): void {
    if (this.stopped) return
    this.opts.onStatus('connecting')
    let ws: WebSocketLike
    try {
      ws = this.opts.createSocket(this.opts.url)
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.opts.onStatus('open')
      this.armWatchdog()
    }
    ws.onmessage = (ev) => {
      this.armWatchdog()
      const msg = parseServerMessage(ev.data)
      if (msg !== null) this.opts.onMessage(msg)
    }
    ws.onerror = () => {
      // close 가 뒤따른다
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      this.opts.onStatus('closed')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    this.clearTimers()
    const delay = backoffDelay(this.attempt)
    this.attempt++
    this.reconnectTimer = this.opts.setTimer(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private armWatchdog(): void {
    if (this.watchdog !== null) this.opts.clearTimer(this.watchdog)
    this.watchdog = this.opts.setTimer(() => {
      this.watchdog = null
      console.warn('[claude-office] WS: heartbeat 미수신 — 재접속합니다')
      const ws = this.ws
      if (ws === null) return
      this.ws = null
      ws.onclose = null
      ws.close()
      this.opts.onStatus('closed')
      this.scheduleReconnect()
    }, HEARTBEAT_TIMEOUT_MS)
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) this.opts.clearTimer(this.reconnectTimer)
    if (this.watchdog !== null) this.opts.clearTimer(this.watchdog)
    this.reconnectTimer = null
    this.watchdog = null
  }
}
