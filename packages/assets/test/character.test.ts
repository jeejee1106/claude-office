import { describe, expect, it } from 'vitest'
import { decodePng, encodePng, type PixelImage } from '../src/canvas'
import { MAX_PALETTE_SIZE, PALETTE, VARIANTS } from '../src/palette'
import { buildCharacterSheet, keyFrames, packSheet } from '../src/sheet'
import { ACTIONS, ALL_DIRS, FRAME_H, FRAME_W } from '../src/sprites/character'
import { offPalettePixels } from '../src/validate'

const sheet = buildCharacterSheet()
const byName = new Map(sheet.frames.map((f) => [f.name, f.image]))

describe('palette', () => {
  it('stays within the limit and has no duplicates', () => {
    const values = Object.values(PALETTE)
    expect(values.length).toBeLessThanOrEqual(MAX_PALETTE_SIZE)
    expect(new Set(values).size).toBe(values.length)
  })

  it('has 8 variants with distinct shirt colors, variant 0 first', () => {
    expect(VARIANTS.map((v) => v.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(new Set(VARIANTS.map((v) => v.shirt)).size).toBe(VARIANTS.length)
  })
})

describe('character sheet', () => {
  it('creates every action x 4 dirs x 8 variants with sequential frame names', () => {
    for (const v of VARIANTS)
      for (const a of ACTIONS)
        for (const d of ALL_DIRS) {
          const key = `char_${v.id}_${a.name}_${d}`
          const names = sheet.animations[key]
          expect(names, key).toBeDefined()
          expect(names?.length).toBeGreaterThan(0)
          names?.forEach((n, i) => {
            expect(n).toBe(`${key}_${i}`)
          })
        }
  })

  it('right is the horizontal mirror of left', () => {
    for (const f of sheet.frames.filter((f) => f.name.includes('_right_'))) {
      const left = byName.get(f.name.replace('_right_', '_left_'))
      expect(left && f.image.equals(left.flipH()), f.name).toBe(true)
    }
  })

  it('every frame stands on the bottom row (feet anchor) and has no off-palette pixels', () => {
    for (const f of sheet.frames) {
      let bottom = false
      for (let x = 0; x < FRAME_W; x++) if (f.image.get(x, FRAME_H - 1) !== 0) bottom = true
      expect(bottom, f.name).toBe(true)
      expect(offPalettePixels(f.image), f.name).toEqual([])
    }
  })

  it('variants differ only by color (same silhouette)', () => {
    const a = byName.get('char_0_walk_down_0') as PixelImage
    const b = byName.get('char_5_walk_down_0') as PixelImage
    for (let i = 0; i < a.data.length; i++) expect(a.data[i] === 0).toBe(b.data[i] === 0)
  })

  it('head is about half of the figure (2-head chibi)', () => {
    const kf = keyFrames().get('idle_stand_down')?.[0]
    // 머리 외곽선 아래(턱 밑) 행 = 12, 전체 24
    expect(kf?.[12]?.some((k) => k === 'o')).toBe(true)
    expect(kf?.[0]?.some((k) => k === 'o')).toBe(true)
  })
})

describe('png', () => {
  it('round-trips through encode/decode and packing is deterministic', () => {
    const packed = packSheet(sheet, 'characters.png')
    const png = encodePng(packed.image)
    expect(decodePng(png).equals(packed.image)).toBe(true)
    expect(encodePng(packSheet(buildCharacterSheet(), 'characters.png').image).equals(png)).toBe(
      true,
    )
    expect(Object.keys(packed.atlas.frames)).toHaveLength(sheet.frames.length)
  })
})
