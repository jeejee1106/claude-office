/*
 * 문자열 사전(대사 + UI 문구) — 한국어 기본, 영어 옵션 (기획서 2절 "대사 언어").
 * 화면에 나오는 문장은 모두 여기서 가져온다. PixiJS·React 비의존(테스트 대상).
 *
 * 언어 선택은 뷰어별 편의 설정이므로 localStorage 에만 둔다(서버 상태 아님).
 */

import type { TeamId } from './scene/teams'

export type Lang = 'ko' | 'en'
export const LANGS: readonly Lang[] = ['ko', 'en']

/** 대사 상황 (기획서 5절 "대사(말풍선)" 열) */
export type LineKey =
  | 'sessionStart'
  | 'promptSubmit'
  | 'subSpawn'
  | 'subFinish'
  | 'error'
  | 'errorRepeated'
  | 'attention'
  | 'turnEnd'
  | 'compact'
  | 'sessionEnd'

/**
 * 상황별 대사 후보(기획서 6절: 단조롭지 않게 여러 개). 첫 번째가 기획서에 적힌 대사.
 * 어떤 후보를 쓸지는 pickLine(이벤트 id) 으로 결정 — 리플레이마다 같다.
 */
export const LINES: Readonly<Record<Lang, Readonly<Record<LineKey, readonly string[]>>>> = {
  ko: {
    sessionStart: ['출근했습니다!', '좋은 아침입니다!', '오늘도 힘내 보겠습니다!'],
    promptSubmit: ['네, 알겠습니다!', '바로 할게요!', '맡겨 주세요!'],
    subSpawn: ['부르셨어요?', '네, 팀장님!', '무슨 일이세요?'],
    subFinish: ['퇴근하겠습니다!', '먼저 들어가 보겠습니다!', '오늘 일 끝! 퇴근합니다!'],
    error: ['앗…', '어라…', '앗, 이런…'],
    errorRepeated: ['이상하다…', '왜 안 되지…', '이게 왜…'],
    attention: ['확인 부탁드려요!', '확인해 주세요!', '이거 해도 될까요?'],
    turnEnd: ['휴~', '한숨 돌리자~', '커피 한 잔~'],
    compact: ['정리 좀 할게요', '서류 정리 중…', '책상 좀 치울게요'],
    sessionEnd: ['퇴근하겠습니다!', '수고하셨습니다, 퇴근합니다!', '내일 뵙겠습니다!'],
  },
  en: {
    sessionStart: ['Clocking in!', 'Good morning!', "Let's do this!"],
    promptSubmit: ['On it!', 'Got it!', 'Leave it to me!'],
    subSpawn: ['You called?', 'Yes, boss!', "What's up?"],
    subFinish: ['Heading home!', 'Signing off!', 'Done for today!'],
    error: ['Oops…', 'Uh-oh…', 'Huh…'],
    errorRepeated: ['That’s odd…', 'Why won’t it work…', 'Not again…'],
    attention: ['Please check this!', 'Need your OK!', 'May I go ahead?'],
    turnEnd: ['Phew~', 'Coffee break~', 'Ahh~'],
    compact: ['Tidying up', 'Sorting papers…', 'Clearing my desk'],
    sessionEnd: ['Heading home!', 'Good work today, bye!', 'See you tomorrow!'],
  },
}

/** 문자열 해시(FNV-1a 32bit) — 결정적 후보 선택용 */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 이벤트 id(+대상)로 후보 하나를 결정적으로 고른다 */
export function pickLine(key: LineKey, seed: string, lang: Lang = getLang()): string {
  const list = LINES[lang][key]
  return list[hashString(`${seed}:${key}`) % list.length] ?? list[0] ?? ''
}

/** 그 상황의 모든 언어 후보(테스트에서 "대사인가" 판단용) */
export function allLines(): ReadonlySet<string> {
  const out = new Set<string>()
  for (const l of LANGS)
    for (const list of Object.values(LINES[l])) for (const s of list) out.add(s)
  return out
}

// ---------------------------------------------------------------------------
// UI 문구
// ---------------------------------------------------------------------------

export const UI = {
  ko: {
    agents: '에이전트',
    nobody: '아직 아무도 출근하지 않았습니다.',
    idle: '대기',
    working: '작업 중',
    waiting: '확인 필요',
    gone: '퇴장',
    asleep: '잠듦 Zzz',
    errorTag: '⚠ 오류',
    recent: '최근 이벤트',
    session: '세션',
    floors: '층',
    floorNo: '{n}층',
    floorNew: '새 활동',
    noSession: '세션 없음',
    auto: '자동 (가장 최근 활성',
    ended: '(종료)',
    connOpen: '연결됨',
    connConnecting: '연결 중…',
    connClosed: '연결 끊김',
    offline: '서버에 연결되어 있지 않습니다 — 재접속 중',
    language: '언어',
    evSessionStart: '세션 시작',
    evSessionEnd: '세션 종료',
    evPrompt: '프롬프트 입력',
    evToolFail: '실패',
    evToolOk: '완료',
    evSpawn: '서브에이전트 입장',
    evFinish: '서브에이전트 퇴장',
    evFinishErr: ' (오류)',
    evTurnEnd: '턴 종료',
    evAttention: '확인 필요',
    evCompact: '컨텍스트 정리',
    evIdle: '쉬는 중',
    evUnknown: '알 수 없는 이벤트',
    teamResearch: '조사팀',
    teamPlanning: '기획팀',
    teamDesign: '디자인팀',
    teamDev: '개발팀',
    locale: 'ko-KR',
  },
  en: {
    agents: 'Agents',
    nobody: 'Nobody has clocked in yet.',
    idle: 'Idle',
    working: 'Working',
    waiting: 'Needs you',
    gone: 'Left',
    asleep: 'Asleep Zzz',
    errorTag: '⚠ error',
    recent: 'Recent events',
    session: 'Session',
    floors: 'Floors',
    floorNo: '{n}F',
    floorNew: 'new activity',
    noSession: 'No sessions',
    auto: 'Auto (most recent',
    ended: '(ended)',
    connOpen: 'Connected',
    connConnecting: 'Connecting…',
    connClosed: 'Disconnected',
    offline: 'Not connected to the server — reconnecting',
    language: 'Language',
    evSessionStart: 'Session start',
    evSessionEnd: 'Session end',
    evPrompt: 'Prompt submitted',
    evToolFail: 'failed',
    evToolOk: 'done',
    evSpawn: 'Subagent joined',
    evFinish: 'Subagent left',
    evFinishErr: ' (error)',
    evTurnEnd: 'Turn end',
    evAttention: 'Needs attention',
    evCompact: 'Context compacted',
    evIdle: 'Resting',
    evUnknown: 'Unknown event',
    teamResearch: 'Research',
    teamPlanning: 'Planning',
    teamDesign: 'Design',
    teamDev: 'Dev Team',
    locale: 'en-US',
  },
} as const satisfies Record<Lang, Record<string, string>>

export type UiKey = keyof (typeof UI)['ko']

export function t(key: UiKey, lang: Lang = getLang()): string {
  return UI[lang][key]
}

const TEAM_KEYS: Readonly<Record<TeamId, UiKey>> = {
  research: 'teamResearch',
  planning: 'teamPlanning',
  design: 'teamDesign',
  dev: 'teamDev',
}

/** 팀 간판 글자: "조사팀" / "Research" (기획서 3절 팀 구역) */
export function teamName(team: TeamId, lang: Lang = getLang()): string {
  return t(TEAM_KEYS[team], lang)
}

/** 층 탭 이름: "1층 claude-office" / "1F claude-office" */
export function floorLabel(n: number, name: string, lang: Lang = getLang()): string {
  return `${t('floorNo', lang).replace('{n}', String(n))} ${name}`
}

// ---------------------------------------------------------------------------
// 현재 언어 (뷰어별)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'claude-office.lang'
let current: Lang = readStored()
const listeners = new Set<() => void>()

function readStored(): Lang {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY)
    return v === 'en' ? 'en' : 'ko'
  } catch {
    return 'ko'
  }
}

export function getLang(): Lang {
  return current
}

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang)
  } catch {
    // 저장 실패해도 이번 화면에서는 적용된다
  }
  for (const l of listeners) l()
}

export function subscribeLang(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
