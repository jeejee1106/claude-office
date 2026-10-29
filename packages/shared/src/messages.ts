import { z } from 'zod'
import { IsoTimestamp, OfficeEvent } from './event'
import { OfficeState } from './state'
import { DailyStats } from './stats'

/*
 * 서버 → web WebSocket 메시지. web 은 safeParse 후 실패하면 무시한다(모르는 type 포함).
 */

/**
 * 항목별로 검증해 통과한 이벤트만 남기는 배열. 서버가 이 web 보다 새 kind 를 알 때
 * 모르는 이벤트 하나 때문에 snapshot 전체가 버려지지 않게 한다(2026-10-24, ADR 0002).
 */
const LenientEventList = z.array(z.unknown()).transform((items) =>
  items.flatMap((item) => {
    const r = OfficeEvent.safeParse(item)
    return r.success ? [r.data] : []
  }),
)

export const SnapshotMessage = z.object({
  type: z.literal('snapshot'),
  state: OfficeState,
  /**
   * 최근 이벤트(오래된 것 → 최신 순, 최대 RECENT_EVENTS_LIMIT). 타임라인 초기화용.
   * 검증에 실패한 항목(모르는 kind 등)은 조용히 빠진다.
   */
  recent: LenientEventList,
  /** 서버 시각. web 이 isAsleep 등 시간 계산을 서버 시계에 맞출 때 쓴다. */
  ts: IsoTimestamp,
  /**
   * 오늘 작업량(2026-10-28). 구버전 서버는 보내지 않는다. 형식이 틀리면 이 필드만
   * 버리고(undefined) snapshot 은 살린다.
   */
  stats: DailyStats.optional().catch(undefined),
})

/**
 * 오늘 작업량이 바뀔 때마다(숫자가 바뀐 event 직후, 자정 0 초기화) 서버가 보낸다.
 * 항상 그날 전체(모든 층)를 담는다 — web 은 받은 값으로 통째로 바꾼다.
 * 구버전 web 은 모르는 type 이라 safeParse 실패로 무시한다(경고 로그만).
 */
export const StatsMessage = z.object({
  type: z.literal('stats'),
  stats: DailyStats,
})

export const EventMessage = z.object({
  type: z.literal('event'),
  event: OfficeEvent,
})

export const HeartbeatMessage = z.object({
  type: z.literal('heartbeat'),
  ts: IsoTimestamp,
})

export const ServerMessage = z.discriminatedUnion('type', [
  SnapshotMessage,
  EventMessage,
  HeartbeatMessage,
  StatsMessage,
])
export type ServerMessage = z.infer<typeof ServerMessage>
export type SnapshotMessage = z.infer<typeof SnapshotMessage>
export type StatsMessage = z.infer<typeof StatsMessage>
export type EventMessage = z.infer<typeof EventMessage>
export type HeartbeatMessage = z.infer<typeof HeartbeatMessage>

/*
 * HTTP 응답 바디 (collector·테스트·QA 스크립트가 참조)
 */

/**
 * POST /events 응답. 바디는 OfficeEvent 하나 또는 배열(항목별로 safeParse).
 * 202: 1개 이상 수용했거나 전부 중복. 400: JSON/형태 오류이거나 모든 항목이 스키마 위반.
 */
export const IngestResponse = z.object({
  accepted: z.number().int().nonnegative(),
  /** 중복 id 로 무시된 수 (accepted 에 포함되지 않음) */
  duplicates: z.number().int().nonnegative(),
  rejected: z.array(z.object({ index: z.number().int().nonnegative(), error: z.string() })),
})
export type IngestResponse = z.infer<typeof IngestResponse>

/** GET /healthz 응답 */
export const HealthResponse = z.object({
  ok: z.literal(true),
  /** 서버 패키지 버전 */
  version: z.string(),
  /** 서버가 받는 OfficeEvent 스키마 버전 */
  schema: z.number().int(),
})
export type HealthResponse = z.infer<typeof HealthResponse>
