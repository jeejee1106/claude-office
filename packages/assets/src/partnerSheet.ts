import { PixelImage } from './canvas'
import type { CharacterVariant, ColorName } from './palette'
import { colorize, type NamedFrame } from './sheet'
import {
  PET_ANIMS,
  PET_H,
  PET_KINDS,
  PET_W,
  type PetAnimDef,
  type PetKind,
  petAnimDrawDirs,
  petKeyFrames,
} from './sprites/partner'

/*
 * 파트너 몬스터 시트 조립 → apps/web/public/assets/partners.png + partners.json
 * 캐릭터 시트(16×24, char_*)와 프레임 크기·이름 체계가 달라 별도 시트로 둔다.
 *   프레임: pet_{kind}_{anim}_{dir}_{n}   (kind = research|planning|design|dev|boss)
 *   애니메이션: pet_{kind}_{anim}_{dir}
 *   dir: walk·idle 은 down|up|left|right(right = left 반전), 나머지는 down 만(meta.downOnly)
 */

/** 종마다 몸(c/C)·장식(h/H) 색. 캐릭터 변형 구조를 빌려 colorize 를 그대로 쓴다 */
export const PET_COLORS: Record<PetKind, CharacterVariant> = {
  research: pet(0, 'research', 'teal', 'tealDark', 'green', 'greenDark'),
  planning: pet(1, 'planning', 'purple', 'purpleDark', 'pink', 'pinkDark'),
  design: pet(2, 'design', 'pink', 'pinkDark', 'purple', 'purpleDark'),
  dev: pet(3, 'dev', 'blue', 'blueDark', 'yellow', 'yellowDark'),
  boss: pet(4, 'boss', 'coral', 'coralDark', 'yellow', 'yellowDark'),
}

function pet(
  id: number,
  label: string,
  body: ColorName,
  bodyShade: ColorName,
  accent: ColorName,
  accentShade: ColorName,
): CharacterVariant {
  return { id, label, shirt: body, shirtShade: bodyShade, hair: accent, hairShade: accentShade }
}

export const PET_DIRS = ['down', 'up', 'left', 'right'] as const
export type PetDir = (typeof PET_DIRS)[number]

export function petAnimDirs(a: PetAnimDef): readonly PetDir[] {
  return a.downOnly ? ['down'] : PET_DIRS
}

export interface PartnerSheet {
  frames: NamedFrame[]
  animations: Record<string, string[]>
}

export function buildPartnerSheet(): PartnerSheet {
  const frames: NamedFrame[] = []
  const animations: Record<string, string[]> = {}
  for (const kind of PET_KINDS) {
    for (const a of PET_ANIMS) {
      const drawn = new Map(petAnimDrawDirs(a).map((d) => [d, petKeyFrames(kind, a, d)]))
      for (const dir of petAnimDirs(a)) {
        const src = drawn.get(dir === 'right' ? 'left' : dir) ?? []
        const names = src.map((kf, i) => {
          let image = colorize(kf, PET_COLORS[kind])
          if (dir === 'right') image = image.flipH()
          const name = `pet_${kind}_${a.name}_${dir}_${i}`
          frames.push({ name, image })
          return name
        })
        animations[`pet_${kind}_${a.name}_${dir}`] = names
      }
    }
  }
  return { frames, animations }
}

export const PARTNER_COLUMNS = 16

interface Frame {
  frame: { x: number; y: number; w: number; h: number }
  rotated: false
  trimmed: false
  spriteSourceSize: { x: number; y: number; w: number; h: number }
  sourceSize: { w: number; h: number }
  anchor: { x: number; y: number }
}

export interface PartnerAtlas {
  frames: Record<string, Frame>
  animations: Record<string, string[]>
  meta: {
    app: string
    version: string
    image: string
    format: 'RGBA8888'
    size: { w: number; h: number }
    scale: 1
    frameSize: { w: number; h: number }
    anchor: { x: number; y: number }
    kinds: readonly PetKind[]
    directions: readonly PetDir[]
    frameMs: Record<string, number>
    /** 한 번 재생하고 멈추는 연출(loop = false) */
    once: string[]
    /** 방향 무관 행동(키는 `_down` 하나) */
    downOnly: string[]
  }
}

/** 16×16 고정 격자, 프레임 생성 순서대로(결정적) */
export function packPartners(
  sheet: PartnerSheet = buildPartnerSheet(),
  imageName = 'partners.png',
): { image: PixelImage; atlas: PartnerAtlas } {
  const rows = Math.ceil(sheet.frames.length / PARTNER_COLUMNS)
  const image = new PixelImage(PARTNER_COLUMNS * PET_W, rows * PET_H)
  const frames: Record<string, Frame> = {}
  sheet.frames.forEach((f, i) => {
    const x = (i % PARTNER_COLUMNS) * PET_W
    const y = Math.floor(i / PARTNER_COLUMNS) * PET_H
    image.blit(f.image, x, y)
    frames[f.name] = {
      frame: { x, y, w: PET_W, h: PET_H },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: PET_W, h: PET_H },
      sourceSize: { w: PET_W, h: PET_H },
      anchor: { x: 0.5, y: 1 },
    }
  })
  return {
    image,
    atlas: {
      frames,
      animations: sheet.animations,
      meta: {
        app: '@claude-office/assets (generated — do not edit by hand)',
        version: '1',
        image: imageName,
        format: 'RGBA8888',
        size: { w: image.width, h: image.height },
        scale: 1,
        frameSize: { w: PET_W, h: PET_H },
        anchor: { x: 0.5, y: 1 },
        kinds: PET_KINDS,
        directions: PET_DIRS,
        frameMs: Object.fromEntries(PET_ANIMS.map((a) => [a.name, a.frameMs])),
        once: PET_ANIMS.filter((a) => a.once).map((a) => a.name),
        downOnly: PET_ANIMS.filter((a) => a.downOnly).map((a) => a.name),
      },
    },
  }
}
