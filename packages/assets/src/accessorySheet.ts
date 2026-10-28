import type { PixelImage } from './canvas'
import { VARIANTS } from './palette'
import { type CharacterSheet, colorize, type NamedFrame, type PixiAtlas, packSheet } from './sheet'
import { ACC_KINDS, type AccKind, accessoryExtra } from './sprites/accessory'
import { ACTIONS, actionDirs, actionFrames, type DrawDir } from './sprites/character'
import type { KeyFrame } from './sprites/layers'

/*
 * 외모 소품 오버레이 시트 → apps/web/public/assets/accessories.png + accessories.json
 *
 * 캐릭터 프레임 char_{v}_{anim}_{dir}_{n} 마다 같은 크기·같은 앵커(0.5, 1)의 오버레이
 * acc_{kind}_{anim}_{dir}_{n} 가 하나씩 있다(변형과 무관 — 소품 색은 고정 색).
 * 애니메이션 키: acc_{kind}_{anim}_{dir} (캐릭터 키와 같은 행동·방향·프레임 수, meta.frameMs 도 같다).
 *
 * 만드는 법: 같은 자세를 소품 레이어를 머리 바로 다음에 끼워 다시 그린 뒤(character.ts HeadExtra),
 * 캐릭터 프레임과 다른 칸만 남긴다. 그래서 캐릭터 위에 오버레이를 그리면 "소품을 머리 위, 팔·손·앞 소품·
 * 소파 등받이 아래에 그린 그림"과 정확히 같아진다(head_hold 의 손, phone 의 수화기가 소품을 가림).
 * sofa_lie 처럼 눕히는 변환도 같은 함수를 지나므로 따로 맞출 필요가 없다.
 * 안경·선글라스는 뒷모습(up, sofa_sit 포함)에서 빈 프레임이다(ACC_HIDDEN).
 */

/** with 에서 base 와 다른 칸만 남긴다 */
function diff(withAcc: KeyFrame, base: KeyFrame): KeyFrame {
  return withAcc.map((row, y) => row.map((k, x) => (k !== base[y]?.[x] ? k : null)))
}

/** 오버레이 기호 프레임: `${anim}_${drawDir}` → 프레임 배열 (테스트에서도 쓴다) */
export function accessoryKeyFrames(kind: AccKind): Map<string, KeyFrame[]> {
  const extra = accessoryExtra(kind)
  const out = new Map<string, KeyFrame[]>()
  for (const action of ACTIONS) {
    const dirs: DrawDir[] = action.downOnly ? ['down'] : ['down', 'up', 'left']
    for (const dir of dirs) {
      const base = actionFrames(action, dir)
      const withAcc = actionFrames(action, dir, extra)
      out.set(
        `${action.name}_${dir}`,
        withAcc.map((f, i) => diff(f, base[i] as KeyFrame)),
      )
    }
  }
  return out
}

export function buildAccessorySheet(): CharacterSheet {
  const frames: NamedFrame[] = []
  const animations: Record<string, string[]> = {}
  const frameMs: Record<string, number> = {}
  // 소품 기호는 고정 색뿐이라 어느 변형으로 칠해도 같다(테스트가 확인)
  const v0 = VARIANTS[0] as (typeof VARIANTS)[number]
  for (const kind of ACC_KINDS) {
    const keyed = accessoryKeyFrames(kind)
    for (const action of ACTIONS) {
      frameMs[action.name] = action.frameMs
      for (const dir of actionDirs(action)) {
        const src = keyed.get(`${action.name}_${dir === 'right' ? 'left' : dir}`) ?? []
        const names = src.map((kf, i) => {
          let image: PixelImage = colorize(kf, v0)
          if (dir === 'right') image = image.flipH()
          const name = `acc_${kind}_${action.name}_${dir}_${i}`
          frames.push({ name, image })
          return name
        })
        animations[`acc_${kind}_${action.name}_${dir}`] = names
      }
    }
  }
  return { frames, animations, frameMs }
}

export type AccessoryAtlas = Omit<PixiAtlas, 'meta'> & {
  meta: Omit<PixiAtlas['meta'], 'variants'> & {
    kinds: readonly AccKind[]
    /**
     * 프레임이 모두 투명한 `{anim}_{dir}` 목록(종류별, 실제 픽셀로 계산).
     * 안경·선글라스의 뒷모습(*_up)과 뒷모습 자세인 sofa_sit_down. 씬은 따로 처리할 필요 없음(그냥 빈 그림)
     */
    empty: Record<AccKind, string[]>
  }
}

function isEmpty(img: PixelImage): boolean {
  return img.data.every((c) => c === 0)
}

/** 캐릭터 시트와 같은 격자 배치(packSheet) — 프레임 순서·크기가 variant 0 과 같다 */
export function packAccessories(sheet: CharacterSheet = buildAccessorySheet()): {
  image: PixelImage
  atlas: AccessoryAtlas
} {
  const packed = packSheet(sheet, 'accessories.png')
  const { variants: _variants, ...meta } = packed.atlas.meta
  const byName = new Map(sheet.frames.map((f) => [f.name, f.image]))
  const empty = Object.fromEntries(
    ACC_KINDS.map((k) => [
      k,
      Object.entries(sheet.animations)
        .filter(
          ([key, names]) =>
            key.startsWith(`acc_${k}_`) && names.every((n) => isEmpty(byName.get(n) as PixelImage)),
        )
        .map(([key]) => key.slice(`acc_${k}_`.length)),
    ]),
  ) as Record<AccKind, string[]>
  return {
    image: packed.image,
    atlas: {
      frames: packed.atlas.frames,
      animations: packed.atlas.animations,
      meta: { ...meta, kinds: ACC_KINDS, empty },
    },
  }
}
