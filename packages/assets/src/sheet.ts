import { PixelImage } from './canvas'
import { type CharacterVariant, type ColorName, rgba, VARIANTS } from './palette'
import {
  ACTIONS,
  ALL_DIRS,
  actionDirs,
  actionFrames,
  type Dir,
  type DrawDir,
  FRAME_H,
  FRAME_W,
} from './sprites/character'
import type { Key, KeyFrame } from './sprites/layers'

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
  y: 'sky',
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
  const img = new PixelImage(frame[0]?.length ?? FRAME_W, frame.length)
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

/** 변형과 무관한 기호 프레임(그리는 방향만: down·up·left, downOnly 행동은 down) — 테스트·미리보기에서도 쓴다 */
export function keyFrames(): Map<string, KeyFrame[]> {
  const out = new Map<string, KeyFrame[]>()
  for (const action of ACTIONS) {
    const dirs: DrawDir[] = action.downOnly ? ['down'] : ['down', 'up', 'left']
    for (const dir of dirs) out.set(`${action.name}_${dir}`, actionFrames(action, dir))
  }
  return out
}

/** 방향 무관(키가 `_down` 하나뿐인) 행동 이름 — 아틀라스 meta.downOnly */
export const DOWN_ONLY_ACTIONS = ACTIONS.filter((a) => a.downOnly).map((a) => a.name)

export function buildCharacterSheet(): CharacterSheet {
  const keyed = keyFrames()
  const frames: NamedFrame[] = []
  const animations: Record<string, string[]> = {}
  const frameMs: Record<string, number> = {}
  for (const v of VARIANTS) {
    for (const action of ACTIONS) {
      frameMs[action.name] = action.frameMs
      for (const dir of actionDirs(action)) {
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
    /** 방향 무관 행동(키는 `_down` 하나). frameSize 와 크기가 다른 프레임은 frames[].sourceSize 를 본다 */
    downOnly: string[]
  }
}

/**
 * 고정 격자(16×24 칸)로 배치(프레임 순서 = 이름 생성 순서, 결정적).
 * 16 보다 넓은 프레임(sofa_lie 32×16)은 같은 줄의 칸을 ceil(w/16)개 이어 쓰고(칸 위쪽에 붙임),
 * 줄 끝에 안 들어가면 다음 줄로 넘긴다.
 */
export function packSheet(sheet: CharacterSheet, imageName: string): PackedSheet {
  const slots: { x: number; y: number }[] = []
  let col = 0
  let row = 0
  for (const f of sheet.frames) {
    const span = Math.ceil(f.image.width / FRAME_W)
    if (f.image.height > FRAME_H || span > SHEET_COLUMNS)
      throw new Error(`${f.name}: ${f.image.width}x${f.image.height} does not fit a sheet row`)
    if (col + span > SHEET_COLUMNS) {
      col = 0
      row++
    }
    slots.push({ x: col * FRAME_W, y: row * FRAME_H })
    col += span
  }
  const image = new PixelImage(SHEET_COLUMNS * FRAME_W, (row + 1) * FRAME_H)
  const frames: Record<string, PixiFrame> = {}
  sheet.frames.forEach((f, i) => {
    const { x, y } = slots[i] as { x: number; y: number }
    const w = f.image.width
    const h = f.image.height
    image.blit(f.image, x, y)
    frames[f.name] = {
      frame: { x, y, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
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
        downOnly: DOWN_ONLY_ACTIONS,
      },
    },
  }
}
