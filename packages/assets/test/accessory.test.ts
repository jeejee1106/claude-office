import { describe, expect, it } from 'vitest'
import { accessoryKeyFrames, buildAccessorySheet, packAccessories } from '../src/accessorySheet'
import type { PixelImage } from '../src/canvas'
import { buildCharacterSheet } from '../src/sheet'
import { ACC_KINDS } from '../src/sprites/accessory'
import { offPalettePixels } from '../src/validate'

const chars = buildCharacterSheet()
const accs = buildAccessorySheet()
const charByName = new Map(chars.frames.map((f) => [f.name, f.image]))
const accByName = new Map(accs.frames.map((f) => [f.name, f.image]))
const v0Frames = chars.frames.filter((f) => f.name.startsWith('char_0_'))

const opaque = (img: PixelImage) => img.data.some((c) => c !== 0)

describe('accessory overlays', () => {
  it('every variant-0 character frame has a same-size overlay per kind', () => {
    for (const kind of ACC_KINDS)
      for (const f of v0Frames) {
        const o = accByName.get(f.name.replace(/^char_0_/, `acc_${kind}_`))
        expect(o, f.name).toBeDefined()
        expect([o?.width, o?.height], f.name).toEqual([f.image.width, f.image.height])
      }
    expect(accs.frames).toHaveLength(v0Frames.length * ACC_KINDS.length)
  })

  it('animation keys mirror the character keys with the same frame counts and timings', () => {
    for (const kind of ACC_KINDS)
      for (const [key, names] of Object.entries(chars.animations)) {
        if (!key.startsWith('char_0_')) continue
        const acc = accs.animations[key.replace(/^char_0_/, `acc_${kind}_`)]
        expect(acc, key).toEqual(names.map((n) => n.replace(/^char_0_/, `acc_${kind}_`)))
      }
    expect(accs.frameMs).toEqual(chars.frameMs)
  })

  it('uses only fixed colors (never shirt/hair variant keys) and stays in the palette', () => {
    for (const kind of ACC_KINDS)
      for (const [key, frames] of accessoryKeyFrames(kind))
        for (const kf of frames)
          for (const row of kf)
            for (const k of row) expect(['c', 'C', 'h', 'H'].includes(k ?? ''), key).toBe(false)
    for (const f of accs.frames) expect(offPalettePixels(f.image), f.name).toEqual([])
  })

  it('is visible in every frame, except glasses/sunglasses from the back (up, sofa_sit)', () => {
    for (const f of accs.frames) {
      const hiddenFromBack =
        /^acc_(glasses|sunglasses)_/.test(f.name) &&
        (/_up_\d+$/.test(f.name) || f.name.includes('_sofa_sit_'))
      expect(opaque(f.image), f.name).toBe(!hiddenFromBack)
    }
  })

  it('right is the mirror of left', () => {
    for (const f of accs.frames.filter((f) => f.name.includes('_right_'))) {
      const left = accByName.get(f.name.replace('_right_', '_left_'))
      expect(left && f.image.equals(left.flipH()), f.name).toBe(true)
    }
  })

  it('sits on the head: overlay pixels are in the top part of the standing frame', () => {
    const o = accByName.get('acc_cap_idle_stand_down_0') as PixelImage
    for (let y = 8; y < o.height; y++)
      for (let x = 0; x < o.width; x++) expect(o.get(x, y), `(${x},${y})`).toBe(0)
    expect(charByName.has('char_0_idle_stand_down_0')).toBe(true)
  })

  it('packs deterministically with the character layout and lists empty animations', () => {
    const a = packAccessories()
    expect(a.image.equals(packAccessories().image)).toBe(true)
    expect(a.atlas.meta.kinds).toEqual(ACC_KINDS)
    expect(a.atlas.meta.empty.cap).toEqual([])
    expect(a.atlas.meta.empty.glasses).toContain('idle_stand_up')
    expect(a.atlas.meta.empty.glasses).toContain('sofa_sit_down')
    expect(
      a.atlas.meta.empty.glasses.every((k) => k.endsWith('_up') || k === 'sofa_sit_down'),
    ).toBe(true)
  })
})
