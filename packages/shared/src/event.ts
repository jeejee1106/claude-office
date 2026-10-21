import { z } from 'zod'
import { SCHEMA_VERSION, TARGET_MAX } from './constants'
import { ToolCategory } from './tools'

/*
 * OfficeEvent v1 — 사람이 읽는 명세는 .claude/skills/event-contract/references/event-catalog.md.
 * 이 파일과 카탈로그가 다르면 버그다.
 *
 * 호환 규칙
 * - 객체는 zod 기본(strip) 동작: 모르는 필드는 버린다 → 새 optional 필드 추가는 하위 호환.
 * - 모르는 `kind` 는 parse 실패 → 소비자는 safeParse 후 버린다(throw 금지).
 * - 열거형 보조 필드(category, reason, source, status?)는 모르는 값을 기본값으로 떨어뜨린다(.catch).
 * - 개인정보: 파일 내용·diff·명령 출력·프롬프트 원문·절대 경로를 담는 필드는 만들지 않는다.
 */

const shortText = (max: number) => z.string().min(1).max(max)

export const IsoTimestamp = z.iso.datetime({ offset: true })

export const EventBase = z.object({
  v: z.literal(SCHEMA_VERSION),
  /** collector 가 생성하는 고유 ID. 중복 제거는 서버 hub 책임(reduce 는 하지 않는다). */
  id: shortText(128),
  ts: IsoTimestamp,
  sessionId: shortText(128),
  /** 메인 에이전트는 "main", 서브에이전트는 Claude Code 가 준 agent ID. */
  agentId: shortText(128),
  parentAgentId: shortText(128).optional(),
  /** 작업 디렉터리 basename (경로 아님). */
  project: shortText(120).optional(),
})

export const ToolInfo = z.object({
  /** 원래 도구 이름 (Read, Bash, mcp__github__create_pr …) */
  name: shortText(200),
  category: ToolCategory,
  /** 표시용 요약(파일 basename, 명령 첫 토큰 등). 원문 금지. 최대 60자 — collector 가 자른다. */
  target: z.string().max(TARGET_MAX).optional(),
  /** Claude Code tool_use_id — start/end 짝 맞추기용 */
  useId: shortText(128).optional(),
})
export type ToolInfo = z.infer<typeof ToolInfo>

export const ToolStatus = z.enum(['ok', 'error'])
export type ToolStatus = z.infer<typeof ToolStatus>

export const AttentionReason = z.enum(['permission', 'idle', 'other']).catch('other')
export type AttentionReason = z.infer<typeof AttentionReason>

export const SessionStartSource = z.enum(['startup', 'resume', 'clear', 'compact'])

export const SessionStartEvent = EventBase.extend({
  kind: z.literal('session.start'),
  source: SessionStartSource.optional().catch(undefined),
})

export const SessionEndEvent = EventBase.extend({
  kind: z.literal('session.end'),
  /** 예: exit, clear, logout, timeout(서버 비활성 정리) */
  reason: shortText(40).optional(),
})

export const PromptSubmitEvent = EventBase.extend({
  kind: z.literal('prompt.submit'),
  /** 프롬프트 글자 수. 원문은 싣지 않는다. */
  length: z.number().int().nonnegative().optional(),
})

export const ToolStartEvent = EventBase.extend({
  kind: z.literal('tool.start'),
  tool: ToolInfo,
})

export const ToolEndEvent = EventBase.extend({
  kind: z.literal('tool.end'),
  tool: ToolInfo,
  status: ToolStatus,
})

export const AgentSpawnEvent = EventBase.extend({
  kind: z.literal('agent.spawn'),
  agentType: shortText(60).optional(),
  /** 짧은 작업 설명 (최대 120자) */
  description: z.string().max(120).optional(),
})

export const AgentFinishEvent = EventBase.extend({
  kind: z.literal('agent.finish'),
  status: ToolStatus.optional().catch(undefined),
})

export const TurnEndEvent = EventBase.extend({
  kind: z.literal('turn.end'),
})

export const AttentionEvent = EventBase.extend({
  kind: z.literal('attention'),
  reason: AttentionReason,
})

export const ContextCompactEvent = EventBase.extend({
  kind: z.literal('context.compact'),
  trigger: z.enum(['manual', 'auto']).optional().catch(undefined),
})

/**
 * 서버 전용(server-origin) 이벤트. hub 의 비활성 타이머가 idleSweep() 으로 만들어
 * reduce 와 WS 브로드캐스트를 거친다. collector 는 보내지 않는다(보내도 무해).
 */
export const AgentIdleEvent = EventBase.extend({
  kind: z.literal('agent.idle'),
})

export const OfficeEvent = z.discriminatedUnion('kind', [
  SessionStartEvent,
  SessionEndEvent,
  PromptSubmitEvent,
  ToolStartEvent,
  ToolEndEvent,
  AgentSpawnEvent,
  AgentFinishEvent,
  TurnEndEvent,
  AttentionEvent,
  ContextCompactEvent,
  AgentIdleEvent,
])
export type OfficeEvent = z.infer<typeof OfficeEvent>
export type OfficeEventKind = OfficeEvent['kind']
/** kind 로 좁힌 이벤트 타입. 예: EventOf<'tool.start'> */
export type EventOf<K extends OfficeEventKind> = Extract<OfficeEvent, { kind: K }>

export const OFFICE_EVENT_KINDS = [
  'session.start',
  'session.end',
  'prompt.submit',
  'tool.start',
  'tool.end',
  'agent.spawn',
  'agent.finish',
  'turn.end',
  'attention',
  'context.compact',
  'agent.idle',
] as const satisfies readonly OfficeEventKind[]

/** 메인 에이전트 ID */
export const MAIN_AGENT_ID = 'main'
