import { MAIN_AGENT_ID } from '@claude-office/shared'

/** 캐릭터 색 변형 수 (pixel-art-pipeline 기본 8개). variant 0 은 메인 전용. */
export const VARIANT_COUNT = 8
export const MAIN_VARIANT = 0

/** FNV-1a 32bit — 같은 문자열이면 브라우저·실행과 무관하게 같은 값 */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * 자주 쓰는 서브에이전트 종류는 서로 다른 셔츠색으로 고정한다(해시로는 Explore 와 general-purpose 가
 * 같은 3번이 된다). 값은 1..VARIANT_COUNT-1, 서로 겹치지 않아야 한다(테스트로 확인).
 * 색은 캐릭터 아틀라스 변형 표: 1 blue, 2 green, 3 purple, 4 yellow, 5 teal, 6 pink, 7 gray.
 */
export const FIXED_VARIANTS: Readonly<Record<string, number>> = {
  Explore: 1,
  'general-purpose': 2,
  Plan: 3,
  'claude-code-guide': 4,
  'statusline-setup': 5,
  claude: 6,
}

/** 메인은 0 고정, 자주 쓰는 종류는 FIXED_VARIANTS, 나머지는 agentType(없으면 agentId) 해시로 1..VARIANT_COUNT-1 */
export function variantFor(agentId: string, agentType: string | undefined): number {
  if (agentId === MAIN_AGENT_ID) return MAIN_VARIANT
  // hasOwn: 'toString' 같은 프로토타입 이름이 들어와도 해시로 간다
  if (agentType !== undefined && Object.hasOwn(FIXED_VARIANTS, agentType)) {
    return FIXED_VARIANTS[agentType] ?? MAIN_VARIANT + 1
  }
  return 1 + (hashString(agentType ?? agentId) % (VARIANT_COUNT - 1))
}
