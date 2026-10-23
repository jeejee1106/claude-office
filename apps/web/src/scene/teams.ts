/*
 * 팀 구성(기획서 3절 "팀 구역") — 서브에이전트 종류(agentType) → 팀. PixiJS·React 비의존 순수 데이터.
 *
 * 팀 매핑은 이 파일 한 곳에만 데이터로 둔다. 나중에 "직원 설정" 화면이 생기면
 * TeamConfig 를 사용자 값으로 만들어 Director 에 넘기면 된다(코드 수정 없이).
 */

/** 팀 ID. 화면 배치 순서(layout.TEAM_ZONES)와 무관한 이름 */
export type TeamId = 'research' | 'planning' | 'design' | 'dev'

export const TEAM_IDS: readonly TeamId[] = ['research', 'planning', 'design', 'dev']

export interface TeamConfig {
  /** agentType → 팀 (정확히 같은 이름) */
  readonly members: Readonly<Record<string, TeamId>>
  /** 표에 없는 종류(그리고 종류를 모르는 서브)가 가는 팀 */
  readonly fallback: TeamId
}

/** 기본 팀 구성(기획서 3절, 2026-10-23) */
export const DEFAULT_TEAM_CONFIG: TeamConfig = {
  members: {
    Explore: 'research',
    Plan: 'planning',
    'pixel-artist': 'design',
    'general-purpose': 'dev',
    'office-scene-dev': 'dev',
    'realtime-backend': 'dev',
    'hook-integrator': 'dev',
  },
  fallback: 'dev',
}

/**
 * 서브에이전트 종류 → 팀.
 * 1) 정확히 같은 이름 2) 대소문자 무시 3) 플러그인 접두사(`plugin:pixel-artist`)를 뗀 이름 순으로 찾고,
 * 없으면 fallback.
 */
export function teamOf(
  agentType: string | undefined,
  config: TeamConfig = DEFAULT_TEAM_CONFIG,
): TeamId {
  if (agentType === undefined || agentType === '') return config.fallback
  const exact = config.members[agentType]
  if (exact !== undefined) return exact
  const lower = agentType.toLowerCase()
  const bare = lower.slice(lower.lastIndexOf(':') + 1)
  for (const [k, team] of Object.entries(config.members)) {
    const kl = k.toLowerCase()
    if (kl === lower || kl === bare) return team
  }
  return config.fallback
}
