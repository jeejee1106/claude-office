import { PixelImage } from './canvas'
import { type CharacterVariant, type ColorName, rgba, VARIANTS } from './palette'
import {
  ACTIONS,
  ALL_DIRS,
  type Dir,
  type DrawDir,
  FRAME_H,
  FRAME_W,
  poseLayers,
} from './sprites/character'
import { compose, type Key, type KeyFrame } from './sprites/layers'

/*
 * 캐릭터 시트 조립: 변형 × 행동 × 방향 × 프레임 → 프레임 이미지 → 한 장의 시트 + PixiJS 아틀라스.
 * 프레임 이름: char_{variant}_{action}_{dir}_{frame} (pixel-art-pipeline 4절)
 * 애니메이션 키: char_{variant}_{action}_{dir}
 */

const FIXED: Record<Exclude<Key, 'c' | 'C' | 'h' | 'H'>, ColorName> = {
  o: 'outline',
  w: 'white',
  s: 'skin',
  S: 'skinShade',
  b: 'blush',
  m: 'pinkDark',
  p: 'pants',
  k: 'brownDark',
  g: 'grayLight',
  G: 'gray',
  r: 'coral',
  u: 'blue',
  U: 'blueDark',
  n: 'chestnut',
  N: 'chestnutDark',
}

export function keyColor(k: Key, v: CharacterVariant): ColorName {
  switch (k) {
    case 'c':
      return v.shirt
    case 'C':
      return v.shirtShade
    case 'h':
      return v.hair
    case 'H':
      return v.hairShade
    default:
      return FIXED[k]
  }
}

export function colorize(frame: KeyFrame, v: CharacterVariant): PixelImage {
  const img = new PixelImage(FRAME_W, FRAME_H)
  frame.forEach((row, y) => {
    row.forEach((k, x) => {
      if (k !== null) img.set(x, y, rgba(keyColor(k, v)))
    })
  })
  return img
}

export interface NamedFrame {
  name: string
  image: PixelImage
}

export interface CharacterSheet {
  frames: NamedFrame[]
  animations: Record<string, string[]>
  frameMs: Record<string, number>
}

/** 변형과 무관한 기호 프레임(방향 3개만) — 테스트·미리보기에서도 쓴다 */
export function keyFrames(): Map<string, KeyFrame[]> {
  const out = new Map<string, KeyFrame[]>()
  for (const action of ACTIONS) {
    for (const dir of ['down', 'up', 'left'] as DrawDir[]) {
      const poses = action.frames(dir)
      out.set(
        `${action.name}_${dir}`,
        poses.map((p, i) =>
          compose(poseLayers(dir, p), FRAME_W, FRAME_H, `${action.name}_${dir}_${i}`),
        ),
      )
    }
  }
  return out
}

export function buildCharacterSheet(): CharacterSheet {
  const keyed = keyFrames()
  const frames: NamedFrame[] = []
  const animations: Record<string, string[]> = {}
  const frameMs: Record<string, number> = {}
  for (const v of VARIANTS) {
    for (const action of ACTIONS) {
      frameMs[action.name] = action.frameMs
      for (const dir of ALL_DIRS) {
        const src = keyed.get(`${action.name}_${dir === 'right' ? 'left' : dir}`) ?? []
        const names: string[] = []
        src.forEach((kf, i) => {
          let image = colorize(kf, v)
          if (dir === 'right') image = image.flipH()
          const name = `char_${v.id}_${action.name}_${dir}_${i}`
          frames.push({ name, image })
          names.push(name)
        })
        animations[`char_${v.id}_${action.name}_${dir}`] = names
      }
    }
  }
  return { frames, animations, frameMs }
}

export const SHEET_COLUMNS = 32

export interface PackedSheet {
  image: PixelImage
  atlas: PixiAtlas
}

interface PixiFrame {
  frame: { x: number; y: number; w: number; h: number }
  rotated: false
  trimmed: false
  spriteSourceSize: { x: number; y: number; w: number; h: number }
  sourceSize: { w: number; h: number }
  anchor: { x: number; y: number }
}

export interface PixiAtlas {
  frames: Record<string, PixiFrame>
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
    frameMs: Record<string, number>
    variants: { id: number; label: string; shirt: string; hair: string }[]
    directions: readonly Dir[]
  }
}

/** 고정 격자로 배치(프레임 순서 = 이름 생성 순서, 결정적) */
export function packSheet(sheet: CharacterSheet, imageName: string): PackedSheet {
  const rows = Math.ceil(sheet.frames.length / SHEET_COLUMNS)
  const image = new PixelImage(SHEET_COLUMNS * FRAME_W, rows * FRAME_H)
  const frames: Record<string, PixiFrame> = {}
  sheet.frames.forEach((f, i) => {
    const x = (i % SHEET_COLUMNS) * FRAME_W
    const y = Math.floor(i / SHEET_COLUMNS) * FRAME_H
    image.blit(f.image, x, y)
    frames[f.name] = {
      frame: { x, y, w: FRAME_W, h: FRAME_H },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: FRAME_W, h: FRAME_H },
      sourceSize: { w: FRAME_W, h: FRAME_H },
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
        frameSize: { w: FRAME_W, h: FRAME_H },
        anchor: { x: 0.5, y: 1 },
        frameMs: sheet.frameMs,
        variants: VARIANTS.map((v) => ({ id: v.id, label: v.label, shirt: v.shirt, hair: v.hair })),
        directions: ALL_DIRS,
      },
    },
  }
}
