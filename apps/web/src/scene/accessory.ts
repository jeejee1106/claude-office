/*
 * 외모 소품(기획서 4절 "외모 소품"). PixiJS 비의존 — 단위 테스트 대상.
 *
 * 소품 시트 apps/web/public/assets/accessories.json (pixel-artist 와 정한 이름 규칙):
 * - 프레임 이름 = 캐릭터 프레임 이름의 `char_{v}_` 를 `acc_{kind}_` 로 바꾼 것
 *   (char_3_walk_left_2 → acc_cap_walk_left_2). 옷·머리 색(변형)과 상관없이 같은 소품 그림.
 * - animations 키 `acc_{kind}_{anim}_{dir}` (씬은 프레임 이름만 쓴다 — 캐릭터 프레임과 1:1)
 * - 캐릭터 프레임과 같은 크기·앵커 (0.5, 1). 씬은 캐릭터 스프라이트와 같은 자리·같은 오프셋에 그린다.
 * 시트가 없거나 프레임이 없으면 소품을 그리지 않는다(캐릭터는 그대로).
 */

export const ACCESSORIES = ['none', 'glasses', 'sunglasses', 'cap', 'headphones', 'ribbon'] as const
export type Accessory = (typeof ACCESSORIES)[number]
/** 그림이 있는 소품(none 제외) */
export type AccessoryKind = Exclude<Accessory, 'none'>
export const ACCESSORY_KINDS: readonly AccessoryKind[] = ACCESSORIES.filter(
  (a): a is AccessoryKind => a !== 'none',
)

export const ACCESSORY_ATLAS_URL = 'assets/accessories.json'

export function isAccessory(x: unknown): x is Accessory {
  return typeof x === 'string' && (ACCESSORIES as readonly string[]).includes(x)
}

/** 소품 시트: 프레임 이름 → 그림 */
export interface AccessoryAtlas<T> {
  readonly frames: Readonly<Record<string, T | undefined>>
}

const CHAR_PREFIX = /^char_\d+_/

/** 캐릭터 프레임 이름 → 같은 순간의 소품 프레임 이름. 캐릭터 프레임 이름이 아니면 null */
export function accessoryFrameName(charFrame: string, kind: AccessoryKind): string | null {
  if (!CHAR_PREFIX.test(charFrame)) return null
  return charFrame.replace(CHAR_PREFIX, `acc_${kind}_`)
}

/** 지금 캐릭터 프레임에 겹칠 소품 그림. 없음(none)·시트 없음·프레임 없음이면 null(그리지 않는다) */
export function pickAccessoryFrame<T>(
  atlas: AccessoryAtlas<T> | null,
  accessory: Accessory,
  charFrame: string | null,
): T | null {
  if (atlas === null || accessory === 'none' || charFrame === null) return null
  const name = accessoryFrameName(charFrame, accessory)
  if (name === null || !Object.hasOwn(atlas.frames, name)) return null
  return atlas.frames[name] ?? null
}

/** 캐릭터 프레임마다 있어야 할 소품 프레임 중 시트에 없는 것(로드 직후 1회 경고·테스트용) */
export function missingAccessoryFrames(
  charFrames: Iterable<string>,
  has: (name: string) => boolean,
  kinds: readonly AccessoryKind[] = ACCESSORY_KINDS,
): string[] {
  const want = new Set<string>()
  for (const f of charFrames)
    for (const k of kinds) {
      const n = accessoryFrameName(f, k)
      if (n !== null) want.add(n)
    }
  return [...want].filter((n) => !has(n))
}
