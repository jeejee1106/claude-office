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

/** 경과 시간(애니메이션 시작부터)에 맞는 프레임. 키가 없으면 null(호출 쪽이 플레이스홀더로 그린다) */
export function pickFrame<T>(
  atlas: CharacterAtlas<T>,
  variant: number,
  anim: AnimName,
  dir: Dir,
  elapsedMs: number,
): T | null {
  const frames = atlas.animations[animKey(variant, anim, dir)]
  if (frames === undefined || frames.length === 0) return null
  const i = Math.floor(Math.max(elapsedMs, 0) / frameMsFor(atlas, anim)) % frames.length
  return frames[i] ?? null
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

/** 씬이 쓸 수 있는 모든 키 중 아틀라스에 없는 것 (로드 직후 1회 경고용) */
export function missingAnimationKeys(
  animations: Readonly<Record<string, readonly unknown[] | undefined>>,
  variantCount: number,
): string[] {
  const missing: string[] = []
  for (let v = 0; v < variantCount; v++) {
    for (const anim of ANIMATIONS) {
      for (const dir of DIRS) {
        const key = animKey(v, anim, dir)
        if ((animations[key]?.length ?? 0) === 0) missing.push(key)
      }
    }
  }
  return missing
}
