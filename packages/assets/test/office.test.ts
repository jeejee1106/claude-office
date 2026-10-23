import { describe, expect, it } from 'vitest'
import {
  COLS,
  DOOR_OUTSIDE,
  DOORWAYS,
  isWall,
  ROOMS,
  ROWS,
} from '../../../apps/web/src/scene/layout'
import { decodePng, encodePng, type PixelImage } from '../src/canvas'
import { floorTileMap } from '../src/floorplan'
import { packOffice } from '../src/officeSheet'
import { buildCharacterSheet } from '../src/sheet'
import {
  buildOfficeFrames,
  OFFICE_ANIMATIONS,
  SIGN,
  signMidsFor,
  signWidth,
} from '../src/sprites/office'
import { offPalettePixels } from '../src/validate'

const frames = buildOfficeFrames()
const byName = new Map(frames.map((f) => [f.name, f]))
const img = (n: string) => byName.get(n)?.image as PixelImage

function column(i: PixelImage, x: number): number[] {
  return Array.from({ length: i.height }, (_, y) => i.get(x, y))
}

describe('office frames', () => {
  it('follow the naming rule, are multiples of 16 and use only palette colors', () => {
    expect(new Set(frames.map((f) => f.name)).size).toBe(frames.length)
    for (const f of frames) {
      expect(f.name).toMatch(/^(tile_[a-z_]+_\d+|furn_[a-z_]+(_\d+)?|ui_[a-z_]+)$/)
      expect(f.image.width % 16, f.name).toBe(0)
      expect(f.image.height % 16, f.name).toBe(0)
      expect(offPalettePixels(f.image), f.name).toEqual([])
    }
  })

  it('floor, wall and doorway tiles are fully opaque (no seams)', () => {
    for (const f of frames.filter((f) => /^tile_(floor|wall|doorway)/.test(f.name)))
      for (const c of f.image.data) expect(c, f.name).not.toBe(0)
  })

  it('furniture touches the bottom row (anchor = floor contact)', () => {
    for (const f of frames.filter((f) => f.name.startsWith('furn_'))) {
      expect(f.anchor.y, f.name).toBe(1)
      // 간판 가운데 조각·바닥 장식(케이블)은 바닥 줄이 비어 있을 수 있다
      if (f.name === 'furn_teamsign_mid' || f.name === 'furn_cables') continue
      const bottom = f.image.height - 1
      expect(
        Array.from({ length: f.image.width }, (_, x) => f.image.get(x, bottom)).some((c) => c),
        f.name,
      ).toBe(true)
    }
  })

  it('tiling pieces join without seams', () => {
    // 가로 칸막이·간판 가운데: 왼쪽 끝 열과 오른쪽 끝 열이 같아야 반복해도 이어진다
    for (const n of ['tile_partition_h_0', 'furn_teamsign_mid', 'tile_wall_top_0'])
      expect(column(img(n), 0), n).toEqual(column(img(n), 15))
    // 간판 왼쪽 조각의 오른쪽 끝 열 = 가운데 조각 열 = 오른쪽 조각의 왼쪽 끝 열 (판 부분)
    const mid = column(img('furn_teamsign_mid'), 0).slice(0, 20)
    expect(column(img('furn_teamsign_left'), 15).slice(0, 20)).toEqual(mid)
    expect(column(img('furn_teamsign_right'), 0).slice(0, 20)).toEqual(mid)
    // 세로 칸막이는 위아래로 이어진다
    const v = img('tile_partition_v_0')
    expect(Array.from({ length: 16 }, (_, x) => v.get(x, 0))).toEqual(
      Array.from({ length: 16 }, (_, x) => v.get(x, 15)),
    )
  })

  it('sign text area: panel inset and middle-piece count', () => {
    const left = img('furn_teamsign_left')
    const cream = left.get(SIGN.panelInsetX, SIGN.panelTop)
    expect(left.get(SIGN.panelInsetX - 1, SIGN.panelTop)).not.toBe(cream)
    expect(left.get(SIGN.panelInsetX, SIGN.panelTop - 1)).not.toBe(cream)
    expect(left.get(SIGN.panelInsetX, SIGN.panelTop + SIGN.panelHeight - 1)).toBe(cream)
    expect(left.get(SIGN.panelInsetX, SIGN.panelTop + SIGN.panelHeight)).not.toBe(cream)
    const right = img('furn_teamsign_right')
    expect(right.get(16 - SIGN.panelInsetX - 1, SIGN.panelTop)).toBe(cream)
    expect(right.get(16 - SIGN.panelInsetX, SIGN.panelTop)).not.toBe(cream)
    for (const tw of [10, 29, 40, 77, 120]) {
      const w = signWidth(signMidsFor(tw))
      expect(w - 2 * (SIGN.panelInsetX + SIGN.textPadX)).toBeGreaterThanOrEqual(tw)
    }
    expect(signMidsFor(1)).toBe(1)
  })
})

describe('room frames', () => {
  it('every animation frame exists and frames of one animation share a size', () => {
    for (const [key, names] of Object.entries(OFFICE_ANIMATIONS)) {
      expect(key).toMatch(/^furn_[a-z_]+$/)
      expect(names.length, key).toBeGreaterThanOrEqual(2)
      const sizes = new Set(
        names.map((n) => {
          const i = img(n)
          expect(i, `${key} -> ${n}`).toBeDefined()
          return `${i.width}x${i.height}`
        }),
      )
      expect(sizes.size, key).toBe(1)
      // 프레임끼리 실제로 달라야 깜빡임·움직임이 보인다
      for (let k = 1; k < names.length; k++)
        expect(img(names[k] as string).equals(img(names[k - 1] as string)), key).toBe(false)
    }
  })

  it('room-boundary tiles reuse the neighbouring floor at their edges', () => {
    // 세로 칸막이 왼쪽 열(x0) = 왼쪽 바닥 x0 열, 오른쪽 끝 열(x15) = 오른쪽 바닥 x15 열
    expect(column(img('tile_wall_v_wood_work_0'), 0)).toEqual(column(img('tile_floor_wood_0'), 0))
    expect(column(img('tile_wall_v_wood_work_0'), 15)).toEqual(column(img('tile_floor_0'), 15))
    expect(column(img('tile_doorway_work_metal_0'), 15)).toEqual(
      column(img('tile_floor_metal_0'), 15),
    )
    expect(column(img('tile_wall_v_tile_out_0'), 0)).toEqual(column(img('tile_floor_tile_0'), 0))
  })

  it('the whole floor plan from layout.ts maps to existing frames', () => {
    const map = floorTileMap({
      cols: COLS,
      rows: ROWS,
      rooms: ROOMS,
      isWall,
      doorways: DOORWAYS,
      doorOutside: DOOR_OUTSIDE,
    })
    expect(map.length).toBe(ROWS)
    for (const line of map) {
      expect(line.length).toBe(COLS)
      for (const n of line) expect(byName.has(n), n).toBe(true)
    }
  })
})

describe('office sheet', () => {
  it('packs deterministically, frames do not overlap, png round-trips', () => {
    const a = packOffice()
    const b = packOffice(buildOfficeFrames())
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

describe('boss seating', () => {
  it('type_down is seated: head at the same height as idle_sit_down', () => {
    const chars = new Map(buildCharacterSheet().frames.map((f) => [f.name, f.image]))
    const topRow = (n: string) => {
      const i = chars.get(n) as PixelImage
      for (let y = 0; y < i.height; y++) for (let x = 0; x < i.width; x++) if (i.get(x, y)) return y
      return -1
    }
    expect(topRow('char_0_type_down_0')).toBe(topRow('char_0_idle_sit_down_0'))
  })
})
