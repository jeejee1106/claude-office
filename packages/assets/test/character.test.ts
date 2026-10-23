import { describe, expect, it } from 'vitest'
import { decodePng, encodePng, type PixelImage } from '../src/canvas'
import { MAX_PALETTE_SIZE, PALETTE, VARIANTS } from '../src/palette'
import { buildCharacterSheet, keyFrames, packSheet } from '../src/sheet'
import {
  ACTIONS,
  ALL_DIRS,
  actionDirs,
  FRAME_H,
  FRAME_W,
  SOFA_SEAT,
} from '../src/sprites/character'
import { buildOfficeFrames } from '../src/sprites/office'
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
  it('creates every action x 4 dirs (down only for down-only actions) x 8 variants with sequential frame names', () => {
    for (const v of VARIANTS)
      for (const a of ACTIONS) {
        for (const d of ALL_DIRS)
          if (!actionDirs(a).includes(d))
            expect(
              sheet.animations[`char_${v.id}_${a.name}_${d}`],
              `${a.name}_${d}`,
            ).toBeUndefined()
        for (const d of actionDirs(a)) {
          const key = `char_${v.id}_${a.name}_${d}`
          const names = sheet.animations[key]
          expect(names, key).toBeDefined()
          expect(names?.length).toBeGreaterThan(0)
          names?.forEach((n, i) => {
            expect(n).toBe(`${key}_${i}`)
          })
        }
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
      for (let x = 0; x < f.image.width; x++)
        if (f.image.get(x, f.image.height - 1) !== 0) bottom = true
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

describe('sofa poses', () => {
  const sofa = buildOfficeFrames().find((f) => f.name === 'furn_sofa')
  if (!sofa) throw new Error('furn_sofa missing')
  /** 소파 앵커 기준 (x, y) 의 소파 픽셀 */
  const sofaAt = (x: number, y: number) =>
    sofa.image.get(
      x + Math.round(sofa.anchor.x * sofa.image.width),
      y + Math.round(sofa.anchor.y * sofa.image.height),
    )

  it('has the documented sizes and two breathing frames, down only', () => {
    for (const v of VARIANTS) {
      const sit = sheet.animations[`char_${v.id}_sofa_sit_down`] ?? []
      const lie = sheet.animations[`char_${v.id}_sofa_lie_down`] ?? []
      expect(sit).toHaveLength(2)
      expect(lie).toHaveLength(2)
      for (const n of sit)
        expect([byName.get(n)?.width, byName.get(n)?.height]).toEqual([FRAME_W, FRAME_H])
      for (const n of lie)
        expect([byName.get(n)?.width, byName.get(n)?.height]).toEqual([
          SOFA_SEAT.lieW,
          SOFA_SEAT.lieH,
        ])
      expect(byName.get(sit[0] as string)?.equals(byName.get(sit[1] as string) as PixelImage)).toBe(
        false,
      )
      expect(byName.get(lie[0] as string)?.equals(byName.get(lie[1] as string) as PixelImage)).toBe(
        false,
      )
    }
  })

  it('backrest strip at the frame bottom matches the sofa underneath (seamless at the documented offsets)', () => {
    const place = (name: string, dx: number) => {
      const img = byName.get(name) as PixelImage
      const left = dx - img.width / 2
      const top = SOFA_SEAT.feetDy - img.height
      // 프레임 맨 아래 3줄 중 팔이 없는 칸은 소파 픽셀과 같아야 한다
      let same = 0
      for (let j = img.height - 3; j < img.height; j++)
        for (let i = 0; i < img.width; i++) {
          const x = left + i
          expect(x).toBeGreaterThanOrEqual(SOFA_SEAT.backX[0])
          expect(x).toBeLessThanOrEqual(SOFA_SEAT.backX[1])
          if (img.get(i, j) === sofaAt(x, top + j)) same++
        }
      return same / (img.width * 3)
    }
    for (const dx of SOFA_SEAT.sitDx)
      expect(place('char_3_sofa_sit_down_0', dx)).toBeGreaterThan(0.6)
    // 누운 자세는 팔이 없으므로 등받이 줄 전체가 소파와 같다
    expect(place('char_3_sofa_lie_down_0', SOFA_SEAT.lieDx)).toBe(1)
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
