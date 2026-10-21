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

/** 메인은 0 고정, 서브는 agentType(없으면 agentId) 해시로 1..VARIANT_COUNT-1 */
export function variantFor(agentId: string, agentType: string | undefined): number {
  if (agentId === MAIN_AGENT_ID) return MAIN_VARIANT
  return 1 + (hashString(agentType ?? agentId) % (VARIANT_COUNT - 1))
}
