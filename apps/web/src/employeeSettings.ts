/*
 * 직원 설정(기획서 4절 "직원 설정") — 팀장·팀원 종류별 이름·팀·옷/머리 색.
 * 뷰어별 편의 설정이라 localStorage 에만 둔다(서버 상태 아님). PixiJS·React 비의존(테스트 대상).
 *
 * - 저장 키 `claude-office.employees`, 구조 버전 필드 `v`. 버전이 다르거나 깨진 값이면 기본값.
 * - 값이 없는 칸은 기본 규칙을 따른다: 이름 = main / 종류 이름, 팀 = teams.ts, 색 = variant.ts.
 * - i18n.ts 의 언어 설정처럼 get/set/subscribe. 씬은 바뀌면 상태대로 다시 그린다(resync).
 */

import { type AgentState, MAIN_AGENT_ID, type SessionState } from '@claude-office/shared'
import { DEFAULT_TEAM_CONFIG, TEAM_IDS, type TeamConfig, type TeamId } from './scene/teams'
import { FIXED_VARIANTS, VARIANT_COUNT, variantFor } from './scene/variant'

export const EMPLOYEE_SETTINGS_VERSION = 1
export const EMPLOYEE_STORAGE_KEY = 'claude-office.employees'
/** 이름 최대 길이(이름표가 너무 길어지지 않게) */
export const NAME_MAX = 20

export interface BossSettings {
  readonly name?: string
  readonly variant?: number
}

export interface TypeSettings {
  readonly name?: string
  readonly team?: TeamId
  readonly variant?: number
}

export interface EmployeeSettings {
  readonly v: typeof EMPLOYEE_SETTINGS_VERSION
  /** 팀장(메인 에이전트). 팀은 없다 */
  readonly boss: BossSettings
  /** 서브에이전트 종류(agentType, 정확히 같은 이름) → 설정 */
  readonly types: Readonly<Record<string, TypeSettings>>
}

export const DEFAULT_EMPLOYEE_SETTINGS: EmployeeSettings = {
  v: EMPLOYEE_SETTINGS_VERSION,
  boss: {},
  types: {},
}

// ---------------------------------------------------------------------------
// 검증
// ---------------------------------------------------------------------------

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

function cleanName(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined
  const s = x.trim().slice(0, NAME_MAX)
  return s === '' ? undefined : s
}

function cleanVariant(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < VARIANT_COUNT ? x : undefined
}

function cleanTeam(x: unknown): TeamId | undefined {
  return typeof x === 'string' && (TEAM_IDS as readonly string[]).includes(x)
    ? (x as TeamId)
    : undefined
}

function cleanBoss(x: unknown): BossSettings {
  if (!isObj(x)) return {}
  const name = cleanName(x.name)
  const variant = cleanVariant(x.variant)
  return { ...(name !== undefined ? { name } : {}), ...(variant !== undefined ? { variant } : {}) }
}

function cleanType(x: unknown): TypeSettings {
  if (!isObj(x)) return {}
  const name = cleanName(x.name)
  const team = cleanTeam(x.team)
  const variant = cleanVariant(x.variant)
  return {
    ...(name !== undefined ? { name } : {}),
    ...(team !== undefined ? { team } : {}),
    ...(variant !== undefined ? { variant } : {}),
  }
}

/** 저장된 값(JSON parse 결과) → 설정. 버전이 다르거나 형식이 틀리면 기본값, 틀린 칸만 버린다 */
export function parseEmployeeSettings(raw: unknown): EmployeeSettings {
  if (!isObj(raw) || raw.v !== EMPLOYEE_SETTINGS_VERSION) return DEFAULT_EMPLOYEE_SETTINGS
  const types: Record<string, TypeSettings> = {}
  if (isObj(raw.types)) {
    for (const [k, v] of Object.entries(raw.types)) {
      if (k === '') continue
      const t = cleanType(v)
      if (Object.keys(t).length > 0) types[k] = t
    }
  }
  return { v: EMPLOYEE_SETTINGS_VERSION, boss: cleanBoss(raw.boss), types }
}

// ---------------------------------------------------------------------------
// 설정 → 규칙
// ---------------------------------------------------------------------------

/** 기본 팀 구성 + 사용자가 팀을 정한 종류 (Director 의 teams 옵션) */
export function toTeamConfig(s: EmployeeSettings): TeamConfig {
  const members: Record<string, TeamId> = { ...DEFAULT_TEAM_CONFIG.members }
  for (const [type, t] of Object.entries(s.types)) if (t.team !== undefined) members[type] = t.team
  return { members, fallback: DEFAULT_TEAM_CONFIG.fallback }
}

/** 이 종류의 사용자 설정(프로토타입 이름에 속지 않게 hasOwn) */
function typeSettings(s: EmployeeSettings, agentType: string | undefined): TypeSettings {
  if (agentType === undefined || !Object.hasOwn(s.types, agentType)) return {}
  return s.types[agentType] ?? {}
}

/** 옷·머리 색 변형: 사용자가 고른 값, 없으면 기본 규칙(main=0, FIXED_VARIANTS, 해시) */
export function variantOf(
  agentId: string,
  agentType: string | undefined,
  s: EmployeeSettings,
): number {
  if (agentId === MAIN_AGENT_ID) return s.boss.variant ?? variantFor(agentId, agentType)
  return typeSettings(s, agentType).variant ?? variantFor(agentId, agentType)
}

/** 번호 없는 이름: 사용자가 정한 이름, 없으면 main / 종류 이름 / id 앞 8자 */
export function baseName(
  agentId: string,
  agentType: string | undefined,
  s: EmployeeSettings,
): string {
  if (agentId === MAIN_AGENT_ID) return s.boss.name ?? 'main'
  return typeSettings(s, agentType).name ?? agentType ?? agentId.slice(0, 8)
}

/**
 * 세션 안 에이전트별 표시 이름. 지금 사무실에 있는(gone 아닌) 사람 중 같은 이름이 2명 이상이면
 * 나타난 순서(상태의 에이전트 순서)대로 두 번째부터 "이름 2", "이름 3". 퇴장한 사람은 번호 없이.
 * 이름표(씬)·직원 목록·타임라인이 모두 이 함수를 쓴다 — 상태만으로 정해지므로 화면끼리 어긋나지 않는다.
 */
export function displayNames(
  session: SessionState | undefined,
  s: EmployeeSettings,
): Map<string, string> {
  const out = new Map<string, string>()
  if (session === undefined) return out
  const agents: AgentState[] = Object.values(session.agents)
  const seen = new Map<string, number>()
  for (const a of agents) {
    const base = baseName(a.id, a.type, s)
    if (a.activity === 'gone') {
      out.set(a.id, base)
      continue
    }
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    out.set(a.id, n === 1 ? base : `${base} ${n}`)
  }
  return out
}

/** 세션이 없거나 상태에 없는 에이전트도 이름은 나오게 */
export function displayNameOf(
  agentId: string,
  session: SessionState | undefined,
  s: EmployeeSettings,
): string {
  return (
    displayNames(session, s).get(agentId) ?? baseName(agentId, session?.agents[agentId]?.type, s)
  )
}

/** 설정 창의 팀원 종류 행: 기본 종류(teams.ts·variant.ts) + 저장된 종류 + 지금까지 나타난 종류 */
export function knownAgentTypes(s: EmployeeSettings, seen: Iterable<string | undefined>): string[] {
  const out: string[] = []
  const add = (t: string | undefined) => {
    if (t !== undefined && t !== '' && !out.includes(t)) out.push(t)
  }
  for (const t of Object.keys(DEFAULT_TEAM_CONFIG.members)) add(t)
  for (const t of Object.keys(FIXED_VARIANTS)) add(t)
  for (const t of Object.keys(s.types)) add(t)
  for (const t of seen) add(t)
  return out
}

/** 지금까지 office 상태에 나타난 서브에이전트 종류 */
export function seenAgentTypes(sessions: Readonly<Record<string, SessionState>>): string[] {
  const out: string[] = []
  for (const session of Object.values(sessions))
    for (const a of Object.values(session.agents))
      if (a.id !== MAIN_AGENT_ID && a.type !== undefined && !out.includes(a.type)) out.push(a.type)
  return out
}

// ---------------------------------------------------------------------------
// 현재 설정 (뷰어별)
// ---------------------------------------------------------------------------

let current: EmployeeSettings = readStored()
const listeners = new Set<() => void>()

function readStored(): EmployeeSettings {
  try {
    const v = globalThis.localStorage?.getItem(EMPLOYEE_STORAGE_KEY)
    if (v === null || v === undefined) return DEFAULT_EMPLOYEE_SETTINGS
    return parseEmployeeSettings(JSON.parse(v))
  } catch {
    return DEFAULT_EMPLOYEE_SETTINGS
  }
}

export function getEmployeeSettings(): EmployeeSettings {
  return current
}

export function setEmployeeSettings(next: EmployeeSettings): void {
  const clean = parseEmployeeSettings(next)
  if (JSON.stringify(clean) === JSON.stringify(current)) return
  current = clean
  try {
    globalThis.localStorage?.setItem(EMPLOYEE_STORAGE_KEY, JSON.stringify(clean))
  } catch {
    // 저장 실패해도 이번 화면에서는 적용된다
  }
  for (const l of listeners) l()
}

/** 팀장 설정 일부 바꾸기. undefined 인 칸은 기본값으로 돌린다 */
export function updateBoss(patch: Partial<Record<keyof BossSettings, unknown>>): void {
  setEmployeeSettings({ ...current, boss: { ...current.boss, ...patch } as BossSettings })
}

/** 팀원 종류 설정 일부 바꾸기. undefined 인 칸은 기본값으로 돌린다 */
export function updateType(
  agentType: string,
  patch: Partial<Record<keyof TypeSettings, unknown>>,
): void {
  const prev = typeSettings(current, agentType)
  setEmployeeSettings({
    ...current,
    types: { ...current.types, [agentType]: { ...prev, ...patch } as TypeSettings },
  })
}

export function resetEmployeeSettings(): void {
  setEmployeeSettings(DEFAULT_EMPLOYEE_SETTINGS)
}

export function subscribeEmployeeSettings(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
