import type { Dir } from '../layout'
import { PARTNER_ANIMS, PARTNER_KINDS, type PartnerAnim, type PartnerKind } from '../partner'
import { DIRS } from './characterSheet'

/*
 * 파트너 시트(apps/web/public/assets/partners.json) 조회 규칙. PixiJS 비의존 — 단위 테스트 대상.
 * 이름은 pixel-artist 요약(02_pixel-artist_summary.md "시트·이름")을 따른다. 지어내지 않는다.
 *
 * - animations 키: `pet_{kind}_{anim}_{dir}`. walk·idle 은 4방향, 나머지(meta.downOnly)는 `_down` 만
 * - 프레임 간격: meta.frameMs[anim], 한 번 재생(meta.once: hop·surprised)은 마지막 프레임에서 멈춘다
 * - 프레임 16×16, 앵커 (0.5, 1) = 발끝 중앙 (캐릭터와 같은 바닥 y)
 */

export const PARTNER_ATLAS_URL = 'assets/partners.json'

/** meta.downOnly 와 같은 값(test/partner.test.ts 가 대조) */
export const PARTNER_DOWN_ONLY: ReadonlySet<PartnerAnim> = new Set<PartnerAnim>([
  'sit',
  'hop',
  'surprised',
  'sleep',
])
/** meta.once 와 같은 값 */
export const PARTNER_ONCE: ReadonlySet<PartnerAnim> = new Set<PartnerAnim>(['hop', 'surprised'])
/** meta.frameMs 가 없을 때의 간격(pixel-artist 권장값) */
export const PARTNER_FRAME_MS: Readonly<Record<PartnerAnim, number>> = {
  walk: 140,
  idle: 400,
  sit: 600,
  hop: 110,
  surprised: 160,
  sleep: 800,
}

export interface PartnerAtlas<T> {
  readonly animations: Readonly<Record<string, readonly T[] | undefined>>
  readonly frameMs: Readonly<Record<string, number | undefined>>
}

export function partnerAnimKey(kind: PartnerKind, anim: PartnerAnim, dir: Dir): string {
  return `pet_${kind}_${anim}_${PARTNER_DOWN_ONLY.has(anim) ? 'down' : dir}`
}

function frameMsOf(atlas: PartnerAtlas<unknown>, anim: PartnerAnim): number {
  const ms = atlas.frameMs[anim]
  return typeof ms === 'number' && ms > 0 ? ms : PARTNER_FRAME_MS[anim]
}

/** 경과 시간에 맞는 프레임. 한 번 재생 동작은 마지막 프레임에서 멈춘다. 키가 없으면 null */
export function pickPartnerFrame<T>(
  atlas: PartnerAtlas<T>,
  kind: PartnerKind,
  anim: PartnerAnim,
  dir: Dir,
  elapsedMs: number,
): T | null {
  const frames = atlas.animations[partnerAnimKey(kind, anim, dir)]
  if (frames === undefined || frames.length === 0) return null
  const n = Math.floor(Math.max(elapsedMs, 0) / frameMsOf(atlas, anim))
  const i = PARTNER_ONCE.has(anim) ? Math.min(n, frames.length - 1) : n % frames.length
  return frames[i] ?? null
}

/** 씬이 쓰는 키 중 시트에 없는 것(로드 직후 1회 경고용) */
export function missingPartnerKeys(
  animations: Readonly<Record<string, readonly unknown[] | undefined>>,
): string[] {
  const keys = new Set<string>()
  for (const kind of PARTNER_KINDS)
    for (const anim of PARTNER_ANIMS)
      for (const dir of DIRS) keys.add(partnerAnimKey(kind, anim, dir))
  return [...keys].filter((k) => (animations[k]?.length ?? 0) === 0)
}
