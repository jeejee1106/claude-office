import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getDecorChoice, setDecorChoice, subscribeDecor } from '../src/decorSettings'
import {
  DECOR_CHOICES,
  DECOR_FRAME_NAMES,
  DECOR_SPECS,
  type DecorPlacement,
  decorBounds,
  decorFrameIndex,
  decorFrameMs,
  decorPlacements,
  FLOOR_SLOTS,
  isDecorChoice,
  type PxRect,
  resolveSeason,
  SEASONS,
  seasonEntries,
  seasonOn,
  WALL_SLOTS,
} from '../src/scene/decor'
import {
  BASE_HEIGHT,
  BASE_WIDTH,
  DOOR_OUTSIDE,
  DOORWAYS,
  FIXED_SPOTS,
  isWall,
  PROPS,
  roomAt,
  SPOTS,
  spotPosition,
  TILE,
  type TilePos,
} from '../src/scene/layout'
import { partnerRestSpot } from '../src/scene/partner'
import { findPath } from '../src/scene/pathfinding'
import {
  DEFAULT_SIGN,
  OFFICE_FRAMES,
  placementOf,
  roomExtras,
  roomPropSprite,
  signMids,
  wallDecor,
} from '../src/scene/render/officeSheet'

/*
 * 계절 장식 (기획서 3절 "계절 장식", 2026-10-30).
 * 판정: 현지 날짜, 양 끝 포함. 고르기(끄기·계절)가 날짜보다 우선.
 * 배치: 길·스팟·파트너 자리·가구·간판과 겹치지 않는다.
 */

const day = (m: number, d: number, h = 12) => new Date(2026, m - 1, d, h, 0, 0)

describe('계절 판정 (현지 날짜, 양 끝 포함)', () => {
  const cases: [number, number, string | null][] = [
    [3, 24, null],
    [3, 25, 'spring'],
    [4, 15, 'spring'],
    [4, 16, null],
    [7, 19, null],
    [7, 20, 'summer'],
    [8, 20, 'summer'],
    [8, 21, null],
    [10, 23, null],
    [10, 24, 'halloween'],
    [10, 31, 'halloween'],
    [11, 1, null],
    [11, 30, null],
    [12, 1, 'christmas'],
    [12, 26, 'christmas'],
    [12, 27, null],
    [1, 1, null],
  ]
  for (const [m, d, want] of cases) {
    it(`${m}/${d} → ${want ?? '없음'}`, () => {
      expect(seasonOn(day(m, d))).toBe(want)
      // 하루 안 어느 시각이든 같다(자정 직후·직전)
      expect(seasonOn(day(m, d, 0))).toBe(want)
      expect(new Date(2026, m - 1, d, 23, 59, 59).getDate()).toBe(d)
      expect(seasonOn(new Date(2026, m - 1, d, 23, 59, 59))).toBe(want)
    })
  }

  it('자정이 지나면 바뀐다: 10/31 23:59 할로윈 → 11/1 00:00 없음', () => {
    expect(seasonOn(new Date(2026, 9, 31, 23, 59))).toBe('halloween')
    expect(seasonOn(new Date(2026, 10, 1, 0, 0))).toBe(null)
  })
})

describe('고르기 (자동·끄기·계절)', () => {
  it('값 목록과 순서: 자동(기본)·끄기·봄·여름·할로윈·크리스마스', () => {
    expect(DECOR_CHOICES).toEqual(['auto', 'off', 'spring', 'summer', 'halloween', 'christmas'])
    expect(isDecorChoice('auto')).toBe(true)
    expect(isDecorChoice('winter')).toBe(false)
    expect(isDecorChoice(null)).toBe(false)
  })

  it('자동 = 날짜, 끄기 = 늘 없음, 계절 = 날짜와 상관없이 그 계절', () => {
    expect(resolveSeason('auto', day(10, 30))).toBe('halloween')
    expect(resolveSeason('auto', day(11, 1))).toBe(null)
    expect(resolveSeason('off', day(10, 30))).toBe(null)
    expect(resolveSeason('off', day(12, 25))).toBe(null)
    expect(resolveSeason('christmas', day(10, 30))).toBe('christmas')
    expect(resolveSeason('spring', day(11, 1))).toBe('spring')
    expect(resolveSeason('summer', day(7, 19))).toBe('summer')
  })

  it('저장된 값이 없으면 자동, 바꾸면 구독자에게 알림(저장소가 없어도 이번 화면에 적용)', () => {
    expect(getDecorChoice()).toBe('auto')
    let calls = 0
    const off = subscribeDecor(() => calls++)
    setDecorChoice('christmas')
    setDecorChoice('christmas')
    expect(getDecorChoice()).toBe('christmas')
    expect(calls).toBe(1)
    setDecorChoice('auto')
    off()
    expect(calls).toBe(2)
  })

  it('계절 없음이면 장식 없음', () => {
    expect(decorPlacements(null)).toEqual([])
    for (const s of SEASONS) expect(decorPlacements(s).length).toBeGreaterThan(0)
  })
})

describe('장식 프레임 (decor.json 이름 고정)', () => {
  it('브리프의 프레임 이름 그대로', () => {
    expect([...DECOR_FRAME_NAMES].sort()).toEqual(
      [
        'deco_spring_blossom_pot_0',
        'deco_spring_garland_0',
        'deco_summer_fan_0',
        'deco_summer_fan_1',
        'deco_summer_watermelon_0',
        'deco_summer_sunflower_pot_0',
        'deco_halloween_pumpkin_0',
        'deco_halloween_pumpkin_1',
        'deco_halloween_bat_0',
        'deco_halloween_bat_1',
        'deco_halloween_cobweb_0',
        'deco_christmas_tree_0',
        'deco_christmas_tree_1',
        'deco_christmas_gift_0',
        'deco_christmas_wreath_0',
      ].sort(),
    )
  })

  it('2프레임은 교대, 시트 meta.frameMs 가 있으면 그 값', () => {
    expect(decorFrameIndex(0, 400, 2, 0)).toBe(0)
    expect(decorFrameIndex(399, 400, 2, 0)).toBe(0)
    expect(decorFrameIndex(400, 400, 2, 0)).toBe(1)
    expect(decorFrameIndex(800, 400, 2, 0)).toBe(0)
    expect(decorFrameIndex(0, 400, 2, 1)).toBe(1)
    expect(decorFrameIndex(5000, 400, 1, 1)).toBe(0)
    expect(decorFrameMs('pumpkin')).toBe(400)
    expect(decorFrameMs('pumpkin', { deco_halloween_pumpkin: 250 })).toBe(250)
    expect(decorFrameMs('gift', { deco_halloween_pumpkin: 250 })).toBe(500)
  })

  it('decor.json(그림 담당 시트)과 크기·anchor·애니메이션 키가 같다', () => {
    const url = new URL('../public/assets/decor.json', import.meta.url)
    if (!existsSync(url)) return // 시트가 없으면 코드 도형으로 그린다
    const sheet = JSON.parse(readFileSync(url, 'utf8')) as {
      frames: Record<string, { frame: { w: number; h: number }; anchor?: { x: number; y: number } }>
      animations?: Record<string, string[]>
    }
    for (const [kind, s] of Object.entries(DECOR_SPECS)) {
      for (const n of s.frames) {
        const f = sheet.frames[n]
        expect(f, n).toBeDefined()
        expect([f?.frame.w, f?.frame.h], `${kind} ${n}`).toEqual([s.w, s.h])
        expect([f?.anchor?.x, f?.anchor?.y], `${kind} ${n}`).toEqual([s.ax, s.ay])
      }
      if (s.animKey !== undefined) expect(sheet.animations?.[s.animKey], kind).toEqual(s.frames)
    }
  })

  it('anchor: 바닥 (0.5,1), 거는 것 (0.5,0), 거미줄 (0,0)', () => {
    for (const [k, s] of Object.entries(DECOR_SPECS)) {
      if (k === 'cobweb') expect([s.ax, s.ay]).toEqual([0, 0])
      else if (s.layer === 'floor') expect([s.ax, s.ay], k).toEqual([0.5, 1])
      else expect([s.ax, s.ay], k).toEqual([0.5, 0])
    }
  })
})

// ---------------------------------------------------------------------------
// 배치 겹침 검사
// ---------------------------------------------------------------------------

interface Frame {
  frame: { w: number; h: number }
}
const officeJson = JSON.parse(
  readFileSync(new URL('../public/assets/office.json', import.meta.url), 'utf8'),
) as { frames: Record<string, Frame> }
const size = (name: string) => {
  const f = officeJson.frames[name]
  if (f === undefined) throw new Error(`office.json 에 ${name} 없음`)
  return f.frame
}
const bottomCenter = (name: string, x: number, y: number): PxRect => {
  const { w, h } = size(name)
  return { x: x - w / 2, y: y - h, w, h }
}

const overlaps = (a: PxRect, b: PxRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** 가구·간판·벽 장식(창문·게시판)·바닥 장식(러그·매트·의자)의 그림 영역 */
function furnitureRects(): { name: string; r: PxRect }[] {
  const out: { name: string; r: PxRect }[] = []
  const workFrame: Partial<Record<string, string>> = {
    desk: OFFICE_FRAMES.desk,
    chair: OFFICE_FRAMES.chair,
    mainDesk: OFFICE_FRAMES.bossDesk,
    mainChair: OFFICE_FRAMES.bossChair,
    plant: OFFICE_FRAMES.plant,
  }
  for (const p of PROPS) {
    const at = placementOf(p)
    if (at !== null) {
      if (p.kind === 'teamSign') {
        const w = DEFAULT_SIGN.pieceW * (2 + signMids(p, DEFAULT_SIGN))
        out.push({ name: `sign ${p.team}`, r: { x: at.x, y: at.y - 32, w, h: 32 } })
      } else {
        const f = workFrame[p.kind]
        if (f !== undefined) out.push({ name: p.kind, r: bottomCenter(f, at.x, at.y) })
      }
      continue
    }
    if (p.kind === 'window') {
      for (const d of wallDecor(p)) out.push({ name: d.frame, r: bottomCenter(d.frame, d.x, d.y) })
      continue
    }
    const rs = roomPropSprite(p)
    if (rs !== null) out.push({ name: p.kind, r: bottomCenter(rs.frame, rs.x, rs.y) })
  }
  for (const e of roomExtras()) out.push({ name: e.frame, r: bottomCenter(e.frame, e.x, e.y) })
  return out
}

/** 사람이 다니는 길(모든 스팟·문 사이 A* 경로)의 타일 */
function pathTiles(): TilePos[] {
  const pts: TilePos[] = [
    ...FIXED_SPOTS.map((s) => SPOTS[s].tile),
    DOOR_OUTSIDE,
    ...DOORWAYS.map((d) => ({ col: d.col, row: d.row })),
  ]
  const out: TilePos[] = [...pts]
  for (const a of pts) for (const b of pts) out.push(...findPath(a, b))
  return out
}

/** 캐릭터(16×24 발끝)·파트너(16×16) 그림 영역 + 깊이(발끝 y) */
function figures(): { name: string; r: PxRect; sortY: number }[] {
  const out: { name: string; r: PxRect; sortY: number }[] = []
  const body = (name: string, x: number, y: number, h = 24) =>
    out.push({ name, r: { x: x - 8, y: y - h, w: 16, h }, sortY: y })
  for (const t of pathTiles()) body(`path ${t.col},${t.row}`, t.col * TILE + 8, t.row * TILE + 14)
  for (const s of FIXED_SPOTS) {
    for (let i = 0; i < SPOTS[s].slots.length; i++) {
      const p = spotPosition(s, i)
      body(`${s}#${i}`, p.x, p.y)
      const pr = partnerRestSpot(s, i)
      body(`partner ${s}#${i}`, pr.x, pr.y, 16)
    }
  }
  return out
}

const tileKey = (c: number, r: number) => `${c},${r}`

describe('배치표', () => {
  const furniture = furnitureRects()
  const figs = figures()
  const busy = new Set<string>()
  for (const t of pathTiles()) busy.add(tileKey(t.col, t.row))
  for (const s of FIXED_SPOTS) {
    for (let i = 0; i < SPOTS[s].slots.length; i++) {
      const p = spotPosition(s, i)
      busy.add(tileKey(Math.floor(p.x / TILE), Math.floor(p.y / TILE)))
      const pr = partnerRestSpot(s, i)
      busy.add(tileKey(Math.floor(pr.x / TILE), Math.floor(pr.y / TILE)))
    }
  }

  it('검사 자체가 겹침을 잡는다(일부러 나쁜 자리: 팀장 책상 앞·가운데 통로·창문)', () => {
    const bad = (kind: DecorPlacement['kind'], x: number, y: number): DecorPlacement => ({
      kind,
      x,
      y,
      flipX: false,
      phase: 0,
    })
    const hitsFurniture = (p: DecorPlacement) =>
      furniture.some((f) => overlaps(decorBounds(p), f.r))
    expect(hitsFurniture(bad('pumpkin', 192, 76))).toBe(true)
    expect(hitsFurniture(bad('wreath', 152, 12))).toBe(true)
    expect(busy.has(tileKey(11, 8))).toBe(true)
    // 통로 위 바닥 장식은 그 뒤(위)를 걷는 사람을 가린다
    const aisle = bad('blossomPot', 184, 144)
    expect(figs.some((f) => overlaps(decorBounds(aisle), f.r) && f.sortY <= aisle.y)).toBe(true)
  })

  it('바닥 장식은 바닥 자리, 벽 장식은 벽 자리, 높은(32px+) 장식은 tall 자리에만', () => {
    for (const s of SEASONS) {
      for (const [kind, slot] of seasonEntries(s)) {
        const spec = DECOR_SPECS[kind]
        if (spec.layer === 'floor') {
          expect(slot in FLOOR_SLOTS, `${s} ${kind}@${slot}`).toBe(true)
          const fs = FLOOR_SLOTS[slot as keyof typeof FLOOR_SLOTS]
          if (spec.h > 16) expect(fs.tall, `${s} ${kind}@${slot}`).toBe(true)
        } else expect(slot in WALL_SLOTS, `${s} ${kind}@${slot}`).toBe(true)
      }
    }
  })

  it('바닥 장식의 anchor 는 방 안 빈 바닥 타일(벽·가구 칸 아님)', () => {
    for (const s of SEASONS) {
      for (const p of decorPlacements(s)) {
        if (DECOR_SPECS[p.kind].layer !== 'floor') continue
        const t = { col: Math.floor(p.x / TILE), row: Math.floor((p.y - 1) / TILE) }
        expect(roomAt(t), `${s} ${p.kind}`).not.toBeNull()
        expect(isWall(t.col, t.row), `${s} ${p.kind}`).toBe(false)
      }
    }
  })

  for (const s of SEASONS) {
    describe(s, () => {
      const placed = decorPlacements(s)
      const label = (p: DecorPlacement) => `${p.kind}@(${p.x},${p.y})`

      it('화면 안', () => {
        for (const p of placed) {
          const b = decorBounds(p)
          expect(b.x >= 0 && b.y >= 0, label(p)).toBe(true)
          expect(b.x + b.w <= BASE_WIDTH && b.y + b.h <= BASE_HEIGHT, label(p)).toBe(true)
        }
      })

      it('가구·간판·창문·게시판·러그·의자 그림과 겹치지 않는다', () => {
        for (const p of placed) {
          const b = decorBounds(p)
          for (const f of furniture) expect(overlaps(b, f.r), `${label(p)} × ${f.name}`).toBe(false)
        }
      })

      it('장식끼리 겹치지 않는다', () => {
        for (const [i, a] of placed.entries()) {
          for (const b of placed.slice(i + 1)) {
            expect(overlaps(decorBounds(a), decorBounds(b)), `${label(a)} × ${label(b)}`).toBe(
              false,
            )
          }
        }
      })

      it('바닥 장식이 덮는 바닥 타일은 길·스팟·파트너 자리가 아니다', () => {
        for (const p of placed) {
          if (DECOR_SPECS[p.kind].layer !== 'floor') continue
          const b = decorBounds(p)
          for (let r = Math.floor(b.y / TILE); r <= Math.floor((b.y + b.h - 1) / TILE); r++) {
            for (let c = Math.floor(b.x / TILE); c <= Math.floor((b.x + b.w - 1) / TILE); c++) {
              if (isWall(c, r)) continue
              expect(busy.has(tileKey(c, r)), `${label(p)} 타일 ${c},${r}`).toBe(false)
            }
          }
        }
      })

      it('캐릭터·파트너를 가리지 않는다(겹치면 사람이 앞 = 발끝 y 가 장식 바닥보다 아래)', () => {
        for (const p of placed) {
          if (DECOR_SPECS[p.kind].layer !== 'floor') continue // 벽 장식은 늘 캐릭터 뒤
          const b = decorBounds(p)
          for (const f of figs) {
            if (!overlaps(b, f.r)) continue
            expect(f.sortY > p.y, `${label(p)} 가 ${f.name} 를 가림`).toBe(true)
          }
        }
      })
    })
  }
})
