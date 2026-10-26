import { describe, expect, it } from 'vitest'
import type { PixelImage } from '../src/canvas'
import { buildPartnerSheet, PET_DIRS, packPartners, petAnimDirs } from '../src/partnerSheet'
import { PET_ANIMS, PET_H, PET_KINDS, PET_W } from '../src/sprites/partner'
import { offPalettePixels } from '../src/validate'

const sheet = buildPartnerSheet()
const byName = new Map(sheet.frames.map((f) => [f.name, f.image]))

/** 불투명 픽셀이 있는 맨 위 줄 */
function topRow(img: PixelImage): number {
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) if (img.get(x, y) !== 0) return y
  return img.height
}

describe('partner sheet', () => {
  it('has every kind x anim x dir (down only for down-only anims) with sequential names', () => {
    for (const kind of PET_KINDS)
      for (const a of PET_ANIMS) {
        for (const d of PET_DIRS)
          if (!petAnimDirs(a).includes(d))
            expect(sheet.animations[`pet_${kind}_${a.name}_${d}`]).toBeUndefined()
        for (const d of petAnimDirs(a)) {
          const key = `pet_${kind}_${a.name}_${d}`
          const names = sheet.animations[key]
          expect(names?.length, key).toBeGreaterThan(0)
          names?.forEach((n, i) => {
            expect(n).toBe(`${key}_${i}`)
          })
        }
      }
  })

  it('frames are 16x16, in palette, and touch the bottom row (feet, body or hop shadow)', () => {
    for (const f of sheet.frames) {
      expect([f.image.width, f.image.height], f.name).toEqual([PET_W, PET_H])
      expect(offPalettePixels(f.image), f.name).toEqual([])
      let bottom = false
      for (let x = 0; x < PET_W; x++) if (f.image.get(x, PET_H - 1) !== 0) bottom = true
      expect(bottom, f.name).toBe(true)
    }
  })

  it('right is the mirror of left', () => {
    for (const f of sheet.frames.filter((f) => f.name.includes('_right_'))) {
      const left = byName.get(f.name.replace('_right_', '_left_'))
      expect(left && f.image.equals(left.flipH()), f.name).toBe(true)
    }
  })

  it('standing pet is knee-to-waist of a 24px character (8..12px tall)', () => {
    for (const kind of PET_KINDS) {
      const img = byName.get(`pet_${kind}_idle_down_0`) as PixelImage
      const h = PET_H - topRow(img)
      expect(h, kind).toBeGreaterThanOrEqual(8)
      expect(h, kind).toBeLessThanOrEqual(12)
    }
  })

  it('kinds look different from each other', () => {
    const imgs = PET_KINDS.map((k) => byName.get(`pet_${k}_idle_down_0`) as PixelImage)
    for (let i = 0; i < imgs.length; i++)
      for (let j = i + 1; j < imgs.length; j++)
        expect((imgs[i] as PixelImage).equals(imgs[j] as PixelImage)).toBe(false)
  })

  it('every animation frame differs from the previous one (visible motion)', () => {
    for (const names of Object.values(sheet.animations))
      for (let i = 1; i < names.length; i++) {
        const a = byName.get(names[i - 1] as string) as PixelImage
        const b = byName.get(names[i] as string) as PixelImage
        expect(a.equals(b), names[i]).toBe(false)
      }
  })

  it('packs deterministically with meta for the scene', () => {
    const a = packPartners()
    const b = packPartners()
    expect(a.image.equals(b.image)).toBe(true)
    expect(Object.keys(a.atlas.frames)).toHaveLength(sheet.frames.length)
    expect(a.atlas.meta.once).toEqual(['hop', 'surprised'])
    expect(a.atlas.meta.downOnly).toEqual(['sit', 'hop', 'surprised', 'sleep'])
  })
})
