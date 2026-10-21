import {
  mcpServerName,
  type OfficeEventKind,
  type ToolCategory,
  type ToolInfo,
} from '@claude-office/shared'
import type { SpotId } from './layout'

/*
 * 이벤트 → 사무실 행동 매핑 (단일 테이블).
 * 기준표: .claude/skills/pixel-office-scene/references/activity-mapping.md — 1:1 로 일치해야 한다.
 * 한쪽을 바꾸면 같은 작업에서 다른 쪽도 바꾼다(integration-qa B4 가 대조).
 * PixiJS 비의존 — 단위 테스트 대상.
 */

/** 매핑표 "필요한 애니메이션 목록"과 같은 문자열 (pixel-artist 아틀라스의 action 이름) */
export const ANIMATIONS = [
  'walk',
  'idle_sit',
  'idle_stand',
  'type',
  'read',
  'search',
  'look',
  'wave',
  'write_board',
  'phone',
  'idle_drink',
  'raise_hand',
  'shred',
  'sleep',
] as const
export type AnimName = (typeof ANIMATIONS)[number]

/** 'ownDesk' 는 director 가 에이전트별 책상(메인: mainDesk, 서브: desk1..4/commonTable)으로 푼다. */
export type SpotRef = SpotId | 'ownDesk'

/** 머리 위 표시. alert="!", question="?"(깜빡임), error=빨간 "!", sleep=Zzz */
export type Mark = 'alert' | 'question' | 'error' | 'sleep'

export interface ToolActivity {
  spot: SpotRef
  anim: AnimName
  /** 행동 중 추가 이펙트 (write: 종이 쌓임) */
  effect?: 'paper'
  /** 말풍선 문자열. null 이면 말풍선 없음 */
  bubble: (tool: Pick<ToolInfo, 'name' | 'target'>) => string | null
}

const withTarget = (icon: string) => (t: Pick<ToolInfo, 'target'>) =>
  t.target ? `${icon} ${t.target}` : icon

/** 명령 첫 단어 (collector 가 이미 첫 토큰만 보내지만 방어적으로 한 번 더 자른다) */
const firstWord = (s: string | undefined): string => (s ?? '').trim().split(/\s+/)[0] ?? ''

/** `tool.start` 매핑 — 매핑표 "도구 이벤트" 절 */
export const TOOL_ACTIVITY: Readonly<Record<ToolCategory, ToolActivity>> = {
  read: { spot: 'bookshelf', anim: 'read', bubble: withTarget('📄') },
  edit: { spot: 'ownDesk', anim: 'type', bubble: withTarget('✏️') },
  write: { spot: 'ownDesk', anim: 'type', effect: 'paper', bubble: withTarget('🆕') },
  search: { spot: 'cabinet', anim: 'search', bubble: withTarget('🔍') },
  bash: {
    spot: 'serverRack',
    anim: 'type',
    bubble: (t) => {
      const w = firstWord(t.target)
      return w ? `>_ ${w}` : '>_'
    },
  },
  web: { spot: 'globe', anim: 'look', bubble: () => '🌐' },
  agent: { spot: 'door', anim: 'wave', bubble: withTarget('👋') },
  plan: { spot: 'whiteboard', anim: 'write_board', bubble: () => '📋' },
  mcp: {
    spot: 'phone',
    anim: 'phone',
    bubble: (t) => {
      const server = t.target || mcpServerName(t.name)
      return server ? `☎️ ${server}` : '☎️'
    },
  },
  other: { spot: 'ownDesk', anim: 'idle_sit', bubble: () => null },
}

/** 모르는 category 문자열(새 버전 서버)은 other 로 처리한다. throw 하지 않는다. */
export function toolActivity(category: string): ToolActivity {
  return Object.hasOwn(TOOL_ACTIVITY, category)
    ? (TOOL_ACTIVITY[category as ToolCategory] ?? TOOL_ACTIVITY.other)
    : TOOL_ACTIVITY.other
}

/**
 * 생명주기 이벤트 매핑 — 매핑표 "생명주기 이벤트" 절 (+ tool.start/tool.end).
 *
 * motion
 * - enter: 문에서 등장(spawning) 후 spot 으로 이동
 * - goto : spot 으로 걸어가서 anim
 * - stay : 제자리에서 anim (spot 없음)
 * - leave: 문으로 이동 후 퇴장
 * - tool : TOOL_ACTIVITY 로 위임
 * - none : 이동 없음(표시만)
 *
 * subject: 행동하는 캐릭터. 'self' = 이벤트의 agentId, 'all' = 세션의 모든 캐릭터.
 */
export interface KindActivity {
  subject: 'self' | 'all'
  motion: 'enter' | 'goto' | 'stay' | 'leave' | 'tool' | 'none'
  spot?: SpotRef
  anim?: AnimName
  mark?: Mark
  /** 표시 시간(ms). 없으면 다음 이벤트까지 유지 */
  markMs?: number
  /** 사무실 조명 */
  lights?: 'on' | 'off'
  /**
   * soft: 뒤에 다른 명령이 이미 큐에 있으면 건너뛰는 명령(도구 사이 "자기 책상 복귀"처럼
   * 최종 상태에는 필요하지만 재생할 가치가 낮은 이동).
   */
  soft?: boolean
}

export const KIND_ACTIVITY: Readonly<Record<OfficeEventKind, KindActivity>> = {
  // 사무실 조명 켜짐, 메인 캐릭터가 문으로 등장해 자기 책상으로
  'session.start': {
    subject: 'self',
    motion: 'enter',
    spot: 'ownDesk',
    anim: 'idle_sit',
    lights: 'on',
  },
  // 전원 퇴장, 조명 꺼짐
  'session.end': { subject: 'all', motion: 'leave', lights: 'off' },
  // 메인 캐릭터 머리 위 "!" 0.8초
  'prompt.submit': { subject: 'self', motion: 'none', mark: 'alert', markMs: 800 },
  // 도구 매핑표로 위임
  'tool.start': { subject: 'self', motion: 'tool' },
  // 도구 끝: 자기 책상 복귀(soft). status:error 면 director 가 빨간 "!" 1초 후 복귀
  'tool.end': { subject: 'self', motion: 'goto', spot: 'ownDesk', anim: 'idle_sit', soft: true },
  // 새 캐릭터 문에서 등장 → 배정된 책상
  'agent.spawn': { subject: 'self', motion: 'enter', spot: 'ownDesk', anim: 'idle_sit' },
  // 문으로 이동 후 퇴장
  'agent.finish': { subject: 'self', motion: 'leave' },
  // 커피머신으로 이동 후 idle_drink
  'turn.end': { subject: 'self', motion: 'goto', spot: 'coffee', anim: 'idle_drink' },
  // raise_hand + 깜빡이는 "?"
  attention: { subject: 'self', motion: 'stay', anim: 'raise_hand', mark: 'question' },
  // 파쇄기 앞 shred
  'context.compact': { subject: 'self', motion: 'goto', spot: 'shredder', anim: 'shred' },
  // 자기 책상 idle_sit, isAsleep 이면 sleep(Zzz) — director 가 SLEEP_ACTIVITY 로 바꾼다
  'agent.idle': { subject: 'self', motion: 'goto', spot: 'ownDesk', anim: 'idle_sit' },
}

/** agent.idle + isAsleep() 일 때 */
export const SLEEP_ACTIVITY: KindActivity = {
  subject: 'self',
  motion: 'goto',
  spot: 'ownDesk',
  anim: 'sleep',
  mark: 'sleep',
}

/** tool.end status:error 표시 */
export const ERROR_MARK_MS = 1000

/** 모르는 kind 의 기본: 자기 책상 idle_sit */
export const DEFAULT_ACTIVITY: KindActivity = {
  subject: 'self',
  motion: 'goto',
  spot: 'ownDesk',
  anim: 'idle_sit',
  soft: true,
}

export function kindActivity(kind: string): KindActivity {
  return Object.hasOwn(KIND_ACTIVITY, kind)
    ? (KIND_ACTIVITY[kind as OfficeEventKind] ?? DEFAULT_ACTIVITY)
    : DEFAULT_ACTIVITY
}
