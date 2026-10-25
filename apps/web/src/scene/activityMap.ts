import {
  mcpServerName,
  type OfficeEventKind,
  type ToolCategory,
  type ToolInfo,
} from '@claude-office/shared'
import type { LineKey } from '../i18n'
import type { SpotId } from './layout'
import { hashString } from './variant'

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
  /** 자기 자리에 앉은 채 전화(서브에이전트 호출). 아틀라스에 없으면 phone 프레임을 앉은 높이로 내려 그린다(characterSheet ANIM_FALLBACK) */
  'phone_sit',
  'idle_drink',
  /** 휴게실 소파에 앉아 쉼. 아틀라스에 없으면 idle_sit 프레임(characterSheet ANIM_FALLBACK) */
  'sofa_sit',
  /** 휴게실 소파에 누워 쉼(넓은 프레임). 아틀라스에 없으면 sleep 프레임 */
  'sofa_lie',
  'raise_hand',
  'shred',
  'sleep',
  'flinch',
  'head_hold',
  'pack',
  'report',
] as const
export type AnimName = (typeof ANIMATIONS)[number]

/** 대사 말풍선 표시 시간(기획서 6절: 도구 사용이 없는 순간에 1~2초). brief 행동도 이 시간만큼 */
export const SPEECH_MS = 1500

/** 'ownDesk' 는 director 가 에이전트별 책상(메인: mainDesk, 서브: 자기 팀 책상 research1..dev3 / 모자라면 commonTable)으로 푼다. */
export type SpotRef = SpotId | 'ownDesk'

/**
 * 머리 위 표시. alert="!", question="?"(깜빡임), sleep=Zzz,
 * sweat=이마에서 떨어지는 식은땀 1~2방울(에러), sweat_heavy=땀 3방울(연속 에러)
 */
export type Mark = 'alert' | 'question' | 'sleep' | 'sweat' | 'sweat_heavy'

/**
 * 행동 중 추가 이펙트. paper=종이 쌓임(write), steam=김 나는 컵(커피), shreds=종이 조각(파쇄),
 * bag=퇴근 가방(세션 종료 퇴장)
 */
export type Effect = 'paper' | 'steam' | 'shreds' | 'bag'

export interface ToolActivity {
  spot: SpotRef
  anim: AnimName
  /** 행동 중 추가 이펙트 (write: 종이 쌓임) */
  effect?: Effect
  /** 말풍선 문자열. null 이면 말풍선 없음 */
  bubble: (tool: Pick<ToolInfo, 'name' | 'target'>) => string | null
  /**
   * 잠깐만 하는 행동: 도착 후 BRIEF_TOOL_MS 동안 anim(말풍선 유지) → 자기 책상 idle_sit(soft).
   * tool.end 를 기다리지 않는다(Agent 도구는 서브가 끝날 때까지 tool.end 가 오지 않으므로).
   * 다시 배치(syncAll)할 때도 진행 중인 도구로 보지 않고 자기 책상 idle_sit 로 둔다.
   */
  brief?: boolean
}

/** brief 도구 행동(전화 걸기) 시간. 말풍선(대사 자리)도 이만큼 뜬다 */
export const BRIEF_TOOL_MS = SPEECH_MS

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
    spot: 'serverTerminal',
    anim: 'type',
    bubble: (t) => {
      const w = firstWord(t.target)
      return w ? `>_ ${w}` : '>_'
    },
  },
  web: { spot: 'globe', anim: 'look', bubble: () => '🌐' },
  // 자기 자리(팀장: mainDesk, 서브: 자기 팀 책상)에 앉은 채 전화로 팀원을 부르고, 끊으면 하던 자리 동작으로
  agent: { spot: 'ownDesk', anim: 'phone_sit', brief: true, bubble: withTarget('📞') },
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
 * - resume: 하던 일로 돌아감 — reduce 뒤 상태의 currentTool 이 있으면 그 도구의 자리·동작
 *           (brief 도구는 자기 책상 idle_sit + 말풍선, 다시 걸지 않음), 없으면 자기 책상 idle_sit.
 *           새 대사 없음, soft. director 가 상태를 보고 푼다(attention.clear)
 * - none : 이동 없음(표시만)
 *
 * subject: 행동하는 캐릭터. 'self' = 이벤트의 agentId, 'all' = 세션의 모든 캐릭터.
 */
export interface KindActivity {
  subject: 'self' | 'all'
  motion: 'enter' | 'goto' | 'stay' | 'leave' | 'tool' | 'resume' | 'none'
  spot?: SpotRef
  anim?: AnimName
  mark?: Mark
  /** 표시 시간(ms). 없으면 다음 이벤트까지 유지 */
  markMs?: number
  /** 사무실 조명 */
  lights?: 'on' | 'off'
  /** 대사(말풍선) 상황 — 후보 중 하나를 이벤트 id 로 고른다(i18n.ts LINES) */
  line?: LineKey
  /** 도착 후 이펙트 */
  effect?: Effect
  /**
   * stay 전용: 대사 시간(SPEECH_MS)만큼 그 자리에서 행동한 뒤 자기 책상으로 돌아간다(soft).
   * 뒤에 도구 명령이 오면 바로 끊긴다(도구 말풍선 우선).
   */
  brief?: boolean
  /** leave 전용: 퇴장 직전 동작. pack=짐 챙기기 + 가방 들고 나감, report=팀장 쪽을 보고 보고 */
  leaveStyle?: 'pack' | 'report'
  /**
   * soft: 뒤에 다른 명령이 이미 큐에 있으면 건너뛰는 명령(도구 사이 "자기 책상 복귀"처럼
   * 최종 상태에는 필요하지만 재생할 가치가 낮은 이동).
   */
  soft?: boolean
}

export const KIND_ACTIVITY: Readonly<Record<OfficeEventKind, KindActivity>> = {
  // 사무실 조명 켜짐, 메인 캐릭터가 문으로 등장("출근했습니다!")해 자기 책상으로
  'session.start': {
    subject: 'self',
    motion: 'enter',
    spot: 'ownDesk',
    anim: 'idle_sit',
    lights: 'on',
    line: 'sessionStart',
  },
  // 전원 짐을 챙겨("퇴근하겠습니다!") 퇴장, 마지막 사람이 나가면 조명 꺼짐(Roster 가 미룸)
  'session.end': {
    subject: 'all',
    motion: 'leave',
    lights: 'off',
    line: 'sessionEnd',
    leaveStyle: 'pack',
  },
  // 자리에서 일어남("네, 알겠습니다!") + 머리 위 "!" 0.8초
  'prompt.submit': {
    subject: 'self',
    motion: 'stay',
    anim: 'idle_stand',
    brief: true,
    mark: 'alert',
    markMs: 800,
    line: 'promptSubmit',
  },
  // 도구 매핑표로 위임
  'tool.start': { subject: 'self', motion: 'tool' },
  // 도구 끝: 자기 책상 복귀(soft). status:error 면 director 가 ERROR_REACTION 후 복귀
  'tool.end': { subject: 'self', motion: 'goto', spot: 'ownDesk', anim: 'idle_sit', soft: true },
  // 새 캐릭터 문에서 등장("부르셨어요?") → 배정된 책상
  'agent.spawn': {
    subject: 'self',
    motion: 'enter',
    spot: 'ownDesk',
    anim: 'idle_sit',
    line: 'subSpawn',
  },
  // 팀장 쪽을 보고 보고 후 퇴근 인사("퇴근하겠습니다!")와 함께 문으로 퇴장
  'agent.finish': { subject: 'self', motion: 'leave', line: 'subFinish', leaveStyle: 'report' },
  // 휴게실에서 쉼("휴~"). 기본(이 행) = 커피머신 idle_drink + 김 나는 컵.
  // director 가 이벤트 id 로 LOUNGE_REST(커피·소파 앉기·소파 눕기) 중 하나를 고른다(소파가 차 있으면 커피)
  'turn.end': {
    subject: 'self',
    motion: 'goto',
    spot: 'coffee',
    anim: 'idle_drink',
    effect: 'steam',
    line: 'turnEnd',
  },
  // raise_hand + 깜빡이는 "?" ("확인 부탁드려요!")
  attention: {
    subject: 'self',
    motion: 'stay',
    anim: 'raise_hand',
    mark: 'question',
    line: 'attention',
  },
  // 사용자가 확인에 답함(허락): "?"와 손들기를 거두고 하던 일로(resume). 대사 없음.
  // "?"가 없거나 상태에 아직 attention 이 남아 있으면(reason 불일치) director 는 아무것도 하지 않는다
  'attention.clear': { subject: 'self', motion: 'resume', soft: true },
  // 자료실 파쇄기 앞 shred + 종이 조각("정리 좀 할게요")
  'context.compact': {
    subject: 'self',
    motion: 'goto',
    spot: 'shredder',
    anim: 'shred',
    effect: 'shreds',
    line: 'compact',
  },
  // 자기 책상 idle_sit, isAsleep 이면 sleep(Zzz) — director 가 SLEEP_ACTIVITY 로 바꾼다
  'agent.idle': { subject: 'self', motion: 'goto', spot: 'ownDesk', anim: 'idle_sit' },
}

/**
 * 한 턴 끝(turn.end) 휴게실 쉬기 3가지 (기획서 5절 "한 턴 끝"). 대사 "휴~"는 공통, 김 나는 컵은 커피만.
 * 어떤 것을 할지는 pickLoungeRest(이벤트 id) — 리플레이마다 같다(기획서 6절 결정성 규칙).
 */
export type LoungeRest = 'coffee' | 'sofaSit' | 'sofaLie'
export const LOUNGE_RESTS: readonly LoungeRest[] = ['coffee', 'sofaSit', 'sofaLie']

export const LOUNGE_REST: Readonly<Record<LoungeRest, KindActivity>> = {
  coffee: KIND_ACTIVITY['turn.end'],
  sofaSit: {
    subject: 'self',
    motion: 'goto',
    spot: 'sofaSit',
    anim: 'sofa_sit',
    line: 'turnEnd',
  },
  sofaLie: {
    subject: 'self',
    motion: 'goto',
    spot: 'sofaLie',
    anim: 'sofa_lie',
    line: 'turnEnd',
  },
}

/**
 * 소파 자리 규칙(pixel-artist 요약 "2026-10-23 sofa"): 앉기는 최대 2명(왼쪽·오른쪽),
 * 누운 사람은 좌석 전부를 차지 → 누가 누워 있으면 앉기·눕기 모두 불가, 누가 앉아 있으면 눕기 불가.
 */
export const SOFA_SIT_MAX = 2

export interface SofaUse {
  /** 다른 사람 중 소파에 앉은 수 */
  sitting: number
  /** 다른 사람 중 소파에 누운 수 */
  lying: number
}

export function sofaAllows(rest: LoungeRest, use: SofaUse): boolean {
  if (rest === 'coffee') return true
  if (use.lying > 0) return false
  return rest === 'sofaSit' ? use.sitting < SOFA_SIT_MAX : use.sitting === 0
}

/**
 * 이벤트 id 로 쉬기 동작을 고른다. 대사 후보 선택(pickLine: `${id}:turnEnd`)과 따로 움직이도록
 * 다른 접두사로 해시한다. 고른 소파 동작이 자리가 없으면(sofaAllows) 커피.
 */
export function pickLoungeRest(
  eventId: string,
  use: SofaUse = { sitting: 0, lying: 0 },
): LoungeRest {
  const rest = LOUNGE_RESTS[hashString(`lounge:${eventId}`) % LOUNGE_RESTS.length] ?? 'coffee'
  return sofaAllows(rest, use) ? rest : 'coffee'
}

/**
 * 소파에 누워 있다가 오래 쉬면(isAsleep) 책상으로 가지 않고 그 자리에서 Zzz.
 * 기획서 5절 "오래 쉼 = 책상에서 졺"의 예외: 이미 누워 있는 사람을 책상까지 걸려 보내 재우는 것이
 * 더 어색하다. 소파에 앉기·커피는 기존 규칙대로 책상에서 졺. 다시 배치(syncAll)는 상태에
 * 소파 정보가 없으므로 기존대로 책상 sleep.
 */
export const SOFA_SLEEP_ACTIVITY: KindActivity = {
  subject: 'self',
  motion: 'none',
  mark: 'sleep',
}

/** agent.idle + isAsleep() 일 때 */
export const SLEEP_ACTIVITY: KindActivity = {
  subject: 'self',
  motion: 'goto',
  spot: 'ownDesk',
  anim: 'sleep',
  mark: 'sleep',
}

/**
 * tool.end status:error 반응 (기획서 5절 "에러 발생" / "에러 연속 3회 이상").
 * 그 자리에서 anim(멈칫 / 머리 감싸기) + 대사 + 식은땀(mark) 를 ms 동안. 그 뒤 자기 책상(soft).
 * 뒤에 도구 명령이 오면 행동·대사는 바로 끊기고(도구 말풍선 우선) 땀 표시는 ms 동안 남는다.
 */
export interface ErrorReaction {
  anim: AnimName
  mark: Mark
  line: LineKey
  ms: number
}

export const ERROR_REACTION_MS = 1200
/** 같은 캐릭터의 tool.end error 가 연속(사이에 ok 없이) 이 횟수 이상이면 REPEATED */
export const REPEATED_ERROR_THRESHOLD = 3

export const ERROR_REACTION: ErrorReaction = {
  anim: 'flinch',
  mark: 'sweat',
  line: 'error',
  ms: ERROR_REACTION_MS,
}
export const REPEATED_ERROR_REACTION: ErrorReaction = {
  anim: 'head_hold',
  mark: 'sweat_heavy',
  line: 'errorRepeated',
  ms: ERROR_REACTION_MS,
}

export function errorReaction(consecutiveErrors: number): ErrorReaction {
  return consecutiveErrors >= REPEATED_ERROR_THRESHOLD ? REPEATED_ERROR_REACTION : ERROR_REACTION
}

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
