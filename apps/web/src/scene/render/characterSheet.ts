import { ANIMATIONS, type AnimName } from '../activityMap'
import type { Dir } from '../layout'

/*
 * 캐릭터 아틀라스(apps/web/public/assets/characters.json) 조회 규칙. PixiJS 비의존 — 단위 테스트 대상.
 *
 * - animations 키: `char_{variant}_{anim}_{dir}` (pixel-artist 요약 파일의 규칙, 이름을 지어내지 않는다)
 * - 프레임 간격: meta.frameMs[anim] (없으면 DEFAULT_FRAME_MS)
 * - 프레임 크기 16×24, 앵커 (0.5, 1) = 발끝 중앙. PlaceholderRenderer 의 원점과 같다.
 */

export const CHARACTER_ATLAS_URL = 'assets/characters.json'
export const DIRS: readonly Dir[] = ['down', 'up', 'left', 'right']
/** frameMs 가 없는 애니메이션의 기본 간격(플레이스홀더와 같은 값) */
export const DEFAULT_FRAME_MS = 180

export interface CharacterAtlas<T> {
  readonly animations: Readonly<Record<string, readonly T[] | undefined>>
  readonly frameMs: Readonly<Record<string, number | undefined>>
}

export function animKey(variant: number, anim: AnimName, dir: Dir): string {
  return `char_${variant}_${anim}_${dir}`
}

export function frameMsFor(atlas: CharacterAtlas<unknown>, anim: AnimName): number {
  const ms = atlas.frameMs[anim]
  return typeof ms === 'number' && ms > 0 ? ms : DEFAULT_FRAME_MS
}

/**
 * 앉은 자세에서 서 있는 동작 프레임을 쓸 때 내리는 높이(px).
 * pixel-artist 요약: 앉은 type_down 은 서서 치는 그림보다 상체가 2px 아래이고 idle_sit_down 과 머리 높이가 같다.
 */
export const SIT_DROP_PX = 2

/**
 * 아틀라스에 아직 프레임이 없는 동작의 대체 그림: 다른 동작 프레임을 dy 만큼 내려 그린다.
 * 아틀라스에 원래 키(char_{v}_{anim}_{dir})가 생기면 그쪽을 쓴다(오프셋 0).
 */
export const ANIM_FALLBACK: Readonly<Partial<Record<AnimName, { anim: AnimName; dy: number }>>> = {
  // 앉아서 전화: 서서 전화하는 phone 을 앉은 높이로. 다리는 책상·의자에 가려진다
  phone_sit: { anim: 'phone', dy: SIT_DROP_PX },
  // 소파 앉기·눕기: 아틀라스(변형)에 프레임이 없으면 책상에 앉은 모습·조는 모습으로 대신
  sofa_sit: { anim: 'idle_sit', dy: 0 },
  sofa_lie: { anim: 'sleep', dy: 0 },
}

/**
 * 방향 무관 동작(pixel-artist 요약 "2026-10-23 sofa", 아틀라스 meta.downOnly): `_down` 키만 있다.
 * 캐릭터 방향과 관계없이 `_down` 을 찾는다. 대체 그림(ANIM_FALLBACK)은 원래 방향으로 찾는다
 * (소파는 방 쪽(위)을 향해 앉으므로 대체 그림은 뒷모습 idle_sit_up).
 */
export const DOWN_ONLY: ReadonlySet<AnimName> = new Set<AnimName>(['sofa_sit', 'sofa_lie'])

/** 소파 위 동작 — 깊이를 발끝 y 가 아니라 "소파 바로 위"(layout SOFA_SORT_Y)로 정렬한다 */
export const SOFA_POSES: ReadonlySet<AnimName> = new Set<AnimName>(['sofa_sit', 'sofa_lie'])
const hasKey = (atlas: CharacterAtlas<unknown>, key: string): boolean =>
  (atlas.animations[key]?.length ?? 0) > 0

/** 실제로 그릴 아틀라스 동작과 세로 오프셋. 원래 키도 대체 키도 없으면 null(플레이스홀더) */
export function resolveAnim(
  atlas: CharacterAtlas<unknown>,
  variant: number,
  anim: AnimName,
  dir: Dir,
): { anim: AnimName; dy: number; dir: Dir } | null {
  const own = DOWN_ONLY.has(anim) ? 'down' : dir
  if (hasKey(atlas, animKey(variant, anim, own))) return { anim, dy: 0, dir: own }
  const fb = ANIM_FALLBACK[anim]
  if (fb !== undefined && hasKey(atlas, animKey(variant, fb.anim, dir))) return { ...fb, dir }
  return null
}

/** 경과 시간(애니메이션 시작부터)에 맞는 프레임. 키가 없으면 null(호출 쪽이 플레이스홀더로 그린다) */
export function pickFrame<T>(
  atlas: CharacterAtlas<T>,
  variant: number,
  anim: AnimName,
  dir: Dir,
  elapsedMs: number,
): T | null {
  const r = resolveAnim(atlas, variant, anim, dir)
  if (r === null) return null
  const frames = atlas.animations[animKey(variant, r.anim, r.dir)]
  if (frames === undefined || frames.length === 0) return null
  const i = Math.floor(Math.max(elapsedMs, 0) / frameMsFor(atlas, r.anim)) % frames.length
  return frames[i] ?? null
}

/** 아틀라스에 원래 키가 없어 ANIM_FALLBACK 으로 그리는 키 (pixel-artist 에게 요청할 목록) */
export function fallbackAnimationKeys(
  animations: Readonly<Record<string, readonly unknown[] | undefined>>,
  variantCount: number,
): string[] {
  const atlas: CharacterAtlas<unknown> = { animations, frameMs: {} }
  const out: string[] = []
  for (let v = 0; v < variantCount; v++) {
    for (const anim of ANIMATIONS) {
      for (const dir of DIRS) {
        const r = resolveAnim(atlas, v, anim, dir)
        if (r !== null && r.anim !== anim) out.push(animKey(v, anim, dir))
      }
    }
  }
  return out
}

/** 아틀라스 meta 의 frameMs 를 안전하게 읽는다(형식이 틀리면 빈 객체 → 기본 간격) */
export function parseFrameMs(meta: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (typeof meta !== 'object' || meta === null) return out
  const raw = (meta as { frameMs?: unknown }).frameMs
  if (typeof raw !== 'object' || raw === null) return out
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v
  }
  return out
}

/** 씬이 쓸 수 있는 모든 키 중 그릴 프레임이 없는 것(ANIM_FALLBACK 으로 그릴 수 있으면 제외) (로드 직후 1회 경고용) */
export function missingAnimationKeys(
  animations: Readonly<Record<string, readonly unknown[] | undefined>>,
  variantCount: number,
): string[] {
  const atlas: CharacterAtlas<unknown> = { animations, frameMs: {} }
  const missing: string[] = []
  for (let v = 0; v < variantCount; v++) {
    for (const anim of ANIMATIONS) {
      for (const dir of DIRS) {
        if (resolveAnim(atlas, v, anim, dir) === null) missing.push(animKey(v, anim, dir))
      }
    }
  }
  return missing
}
