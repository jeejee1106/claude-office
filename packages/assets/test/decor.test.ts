import { describe, expect, it } from 'vitest'
import { decodePng, encodePng, type PixelImage } from '../src/canvas'
import { packDecor } from '../src/decorSheet'
import { buildDecorFrames } from '../src/sprites/decor'
import { offPalettePixels } from '../src/validate'

/** 화면 담당과 맞춘 프레임 이름·크기·기준점(바꾸면 씬 코드가 깨진다 — 리더에게 먼저 알린다) */
const FLOOR = { x: 0.5, y: 1 }
const HANG = { x: 0.5, y: 0 }
const CORNER = { x: 0, y: 0 }
const EXPECTED: Record<string, { w: number; h: number; anchor: { x: number; y: number } }> = {
  deco_spring_blossom_pot_0: { w: 16, h: 32, anchor: FLOOR },
  deco_spring_garland_0: { w: 32, h: 16, anchor: HANG },
  deco_summer_fan_0: { w: 16, h: 32, anchor: FLOOR },
  deco_summer_fan_1: { w: 16, h: 32, anchor: FLOOR },
  deco_summer_watermelon_0: { w: 16, h: 16, anchor: FLOOR },
  deco_summer_sunflower_pot_0: { w: 16, h: 32, anchor: FLOOR },
  deco_halloween_pumpkin_0: { w: 16, h: 16, anchor: FLOOR },
  deco_halloween_pumpkin_1: { w: 16, h: 16, anchor: FLOOR },
  deco_halloween_bat_0: { w: 16, h: 16, anchor: HANG },
  deco_halloween_bat_1: { w: 16, h: 16, anchor: HANG },
  deco_halloween_cobweb_0: { w: 16, h: 16, anchor: CORNER },
  deco_christmas_tree_0: { w: 32, h: 48, anchor: FLOOR },
  deco_christmas_tree_1: { w: 32, h: 48, anchor: FLOOR },
  deco_christmas_gift_0: { w: 16, h: 16, anchor: FLOOR },
  deco_christmas_wreath_0: { w: 16, h: 16, anchor: HANG },
}
const ANIMS: Record<string, string[]> = {
  deco_summer_fan: ['deco_summer_fan_0', 'deco_summer_fan_1'],
  deco_halloween_pumpkin: ['deco_halloween_pumpkin_0', 'deco_halloween_pumpkin_1'],
  deco_halloween_bat: ['deco_halloween_bat_0', 'deco_halloween_bat_1'],
  deco_christmas_tree: ['deco_christmas_tree_0', 'deco_christmas_tree_1'],
}

const frames = buildDecorFrames()
const byName = new Map(frames.map((f) => [f.name, f]))
const rowHasPixel = (i: PixelImage, y: number) =>
  Array.from({ length: i.width }, (_, x) => i.get(x, y)).some((c) => c !== 0)

describe('decor frames', () => {
  it('has exactly the agreed frames with the agreed size and anchor', () => {
    expect([...byName.keys()].sort()).toEqual(Object.keys(EXPECTED).sort())
    for (const [name, want] of Object.entries(EXPECTED)) {
      const f = byName.get(name)
      expect(f, name).toBeDefined()
      expect([f?.image.width, f?.image.height], name).toEqual([want.w, want.h])
      expect(f?.anchor, name).toEqual(want.anchor)
    }
  })

  it('uses only palette colors and is not empty', () => {
    for (const f of frames) {
      expect(offPalettePixels(f.image), f.name).toEqual([])
      expect(
        f.image.data.some((c) => c !== 0),
        f.name,
      ).toBe(true)
    }
  })

  it('touches its anchor edge (floor = bottom row, hanging = top row, corner = top-left pixel)', () => {
    for (const f of frames) {
      const { image: i, anchor } = f
      if (anchor.y === 1) expect(rowHasPixel(i, i.height - 1), f.name).toBe(true)
      else expect(rowHasPixel(i, 0), f.name).toBe(true)
      if (anchor.x === 0) expect(i.get(0, 0), f.name).not.toBe(0)
    }
  })

  it('animations: agreed keys, frames exist, same size, frames differ', () => {
    const { atlas } = packDecor()
    expect(atlas.animations).toEqual(ANIMS)
    for (const [key, names] of Object.entries(ANIMS)) {
      expect(atlas.meta.frameMs[key], key).toBeGreaterThan(0)
      const imgs = names.map((n) => byName.get(n)?.image as PixelImage)
      expect(new Set(imgs.map((i) => `${i.width}x${i.height}`)).size, key).toBe(1)
      expect((imgs[0] as PixelImage).equals(imgs[1] as PixelImage), key).toBe(false)
    }
  })

  it('meta lists every decoration by season and place', () => {
    const { atlas } = packDecor()
    expect(atlas.meta.image).toBe('decor.png')
    expect(Object.values(atlas.meta.seasons).flat().sort()).toEqual(
      Object.keys(atlas.meta.place).sort(),
    )
    expect(atlas.meta.seasons.halloween).toEqual([
      'deco_halloween_pumpkin',
      'deco_halloween_bat',
      'deco_halloween_cobweb',
    ])
  })
})

describe('decor sheet', () => {
  it('packs deterministically, frames do not overlap, png round-trips', () => {
    const a = packDecor()
    const b = packDecor()
    const png = encodePng(a.image)
    expect(encodePng(b.image).equals(png)).toBe(true)
    expect(decodePng(png).equals(a.image)).toBe(true)
    const rects = Object.values(a.atlas.frames).map((f) => f.frame)
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const p = rects[i] as (typeof rects)[number]
        const q = rects[j] as (typeof rects)[number]
        const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h
        expect(overlap).toBe(false)
      }
  })
})
