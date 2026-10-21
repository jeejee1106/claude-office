import {
  createInitialState,
  type IdleThresholds,
  idleSweep,
  type OfficeEvent,
  type OfficeState,
  RECENT_EVENTS_LIMIT,
  reduce,
  type ServerMessage,
  type SnapshotMessage,
} from '@claude-office/shared'

/** 이벤트가 어디서 왔는가. recorder 는 'external' 만 기록한다. */
export type EventOrigin = 'external' | 'server' | 'replay'

export type IngestResult = 'accepted' | 'duplicate'

/** 구독자에게 메시지를 보내는 함수. throw 하면 hub 가 구독을 해제한다. */
export type Send = (msg: ServerMessage) => void

export interface HubOptions {
  /** 현재 시각(epoch ms). 테스트에서 주입한다. */
  now?: () => number
  idle?: Partial<IdleThresholds>
  /** 중복 제거용으로 기억하는 최근 이벤트 ID 수 (FIFO) */
  dedupeLimit?: number
  /** snapshot.recent 에 담는 최근 이벤트 수 */
  recentLimit?: number
  /** 수용된 이벤트마다 호출 (recorder 등). 예외는 hub 가 삼킨다. */
  onAccepted?: (event: OfficeEvent, origin: EventOrigin) => void
}

export const DEFAULT_DEDUPE_LIMIT = 2000

/**
 * 서버의 유일한 상태 보관소.
 * - 상태 변경은 `this.state = reduce(this.state, event)` 한 곳에서만 일어난다.
 * - 중복 id 는 reduce 전에 최근 ID 집합으로 거른다(reduce 는 거르지 않는다 — 계약).
 * - 구독 등록과 snapshot 전송을 같은 동기 구간에서 해 recent 와 이후 event 가 겹치거나 빠지지 않는다.
 */
export class Hub {
  private state: OfficeState = createInitialState()
  private readonly recent: OfficeEvent[] = []
  private readonly seen = new Set<string>()
  private readonly subscribers = new Set<Send>()
  private readonly now: () => number
  private readonly idle: Partial<IdleThresholds>
  private readonly dedupeLimit: number
  private readonly recentLimit: number
  private readonly onAccepted: HubOptions['onAccepted']

  constructor(opts: HubOptions = {}) {
    this.now = opts.now ?? Date.now
    this.idle = opts.idle ?? {}
    this.dedupeLimit = opts.dedupeLimit ?? DEFAULT_DEDUPE_LIMIT
    this.recentLimit = opts.recentLimit ?? RECENT_EVENTS_LIMIT
    this.onAccepted = opts.onAccepted
  }

  getState(): OfficeState {
    return this.state
  }

  get subscriberCount(): number {
    return this.subscribers.size
  }

  /** 검증된 이벤트 하나를 반영한다. 호출 전에 OfficeEvent.safeParse 를 통과해야 한다. */
  ingest(event: OfficeEvent, origin: EventOrigin = 'external'): IngestResult {
    if (this.seen.has(event.id)) return 'duplicate'
    this.remember(event.id)

    this.state = reduce(this.state, event)

    this.recent.push(event)
    if (this.recent.length > this.recentLimit)
      this.recent.splice(0, this.recent.length - this.recentLimit)

    this.broadcast({ type: 'event', event })

    if (this.onAccepted) {
      try {
        this.onAccepted(event, origin)
      } catch {
        // 기록 실패가 수신을 막지 않게 한다.
      }
    }
    return 'accepted'
  }

  /** 비활성 처리: idleSweep 결과를 일반 이벤트와 같은 경로로 반영한다. 반영된 이벤트를 반환한다. */
  sweep(): OfficeEvent[] {
    const out: OfficeEvent[] = []
    for (const e of idleSweep(this.state, this.now(), this.idle)) {
      if (this.ingest(e, 'server') === 'accepted') out.push(e)
    }
    return out
  }

  snapshot(): SnapshotMessage {
    return {
      type: 'snapshot',
      state: this.state,
      recent: [...this.recent],
      ts: new Date(this.now()).toISOString(),
    }
  }

  /** snapshot 을 즉시 보내고 이후 event/heartbeat 를 받도록 등록한다. 해제 함수를 반환한다. */
  subscribe(send: Send): () => void {
    try {
      send(this.snapshot())
    } catch {
      return () => {}
    }
    this.subscribers.add(send)
    return () => {
      this.subscribers.delete(send)
    }
  }

  heartbeat(): void {
    this.broadcast({ type: 'heartbeat', ts: new Date(this.now()).toISOString() })
  }

  private broadcast(msg: ServerMessage): void {
    for (const send of this.subscribers) {
      try {
        send(msg)
      } catch {
        this.subscribers.delete(send)
      }
    }
  }

  private remember(id: string): void {
    this.seen.add(id)
    if (this.seen.size > this.dedupeLimit) {
      const oldest = this.seen.values().next()
      if (!oldest.done) this.seen.delete(oldest.value)
    }
  }
}
