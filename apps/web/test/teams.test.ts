import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { teamName } from '../src/i18n'
import {
  isWalkable,
  PROPS,
  roomAt,
  SPOTS,
  SUB_DESKS,
  spotPosition,
  TEAM_ZONES,
  teamDesks,
} from '../src/scene/layout'
import {
  missingOfficeFrames,
  OFFICE_FRAME_NAMES,
  OFFSET,
  parseSignMeta,
  placementOf,
  signTextBox,
  workAreaTiles,
} from '../src/scene/render/officeSheet'
import { DEFAULT_TEAM_CONFIG, TEAM_IDS, teamOf } from '../src/scene/teams'

describe('팀 매핑 (기획서 3절 팀 구역)', () => {
  it('기본: Explore→조사팀, Plan→기획팀, pixel-artist→디자인팀, 나머지→개발팀', () => {
    expect(teamOf('Explore')).toBe('research')
    expect(teamOf('Plan')).toBe('planning')
    expect(teamOf('pixel-artist')).toBe('design')
    for (const t of ['general-purpose', 'office-scene-dev', 'realtime-backend', 'hook-integrator'])
      expect(teamOf(t), t).toBe('dev')
    expect(teamOf('anything-else')).toBe('dev')
    expect(teamOf(undefined)).toBe('dev')
  })

  it('대소문자·플러그인 접두사를 무시한다', () => {
    expect(teamOf('explore')).toBe('research')
    expect(teamOf('harness:pixel-artist')).toBe('design')
  })

  it('구성을 바꾸면 그대로 따른다(직원 설정 화면 대비)', () => {
    const cfg = { members: { Explore: 'dev' as const }, fallback: 'design' as const }
    expect(teamOf('Explore', cfg)).toBe('dev')
    expect(teamOf('Plan', cfg)).toBe('design')
    expect(DEFAULT_TEAM_CONFIG.fallback).toBe('dev')
  })

  it('간판 이름(한/영)', () => {
    expect(TEAM_IDS.map((t) => teamName(t, 'ko'))).toEqual([
      '조사팀',
      '기획팀',
      '디자인팀',
      '개발팀',
    ])
    expect(TEAM_IDS.map((t) => teamName(t, 'en'))).toEqual([
      'Research',
      'Planning',
      'Design',
      'Dev Team',
    ])
  })
})

describe('팀 구역 배치', () => {
  it('팀마다 간판 하나 + 책상, 모두 업무 공간 안(팀원이 없어도 가구로 항상 그린다)', () => {
    expect(TEAM_ZONES.map((z) => z.team).sort()).toEqual([...TEAM_IDS].sort())
    for (const z of TEAM_ZONES) {
      expect(roomAt(z.sign), z.team).toBe('work')
      expect(PROPS.filter((p) => p.kind === 'teamSign' && p.team === z.team)).toHaveLength(1)
      expect(teamDesks(z.team).length).toBeGreaterThanOrEqual(2)
      for (const id of z.desks) {
        const t = SPOTS[id].tile
        expect(roomAt(t), id).toBe('work')
        // 자리 바로 위 칸에 책상(막힘), 자리에 의자
        expect(PROPS.some((p) => p.kind === 'desk' && p.col === t.col && p.row === t.row - 1)).toBe(
          true,
        )
        expect(PROPS.some((p) => p.kind === 'chair' && p.col === t.col && p.row === t.row)).toBe(
          true,
        )
        expect(isWalkable(t.col, t.row - 1)).toBe(false)
      }
    }
    expect(new Set(SUB_DESKS).size).toBe(SUB_DESKS.length)
  })

  it('팀장은 직원들보다 앞(위)에 앉아 직원 쪽(아래)을 본다 — 얼굴이 보인다', () => {
    const boss = SPOTS.mainDesk
    expect(boss.face).toBe('down')
    expect(roomAt(boss.tile)).toBe('work')
    for (const id of SUB_DESKS) {
      expect(SPOTS[id].face, id).toBe('up')
      expect(SPOTS[id].tile.row, id).toBeGreaterThan(boss.tile.row)
    }
  })
})

describe('office 시트 배치 (pixel-artist 요약의 오프셋)', () => {
  const json = JSON.parse(
    readFileSync(fileURLToPath(new URL('../public/assets/office.json', import.meta.url)), 'utf8'),
  ) as { frames: Record<string, unknown>; meta: unknown }

  it('씬이 쓰는 프레임은 모두 시트에 있다', () => {
    expect(missingOfficeFrames((n) => n in json.frames)).toEqual([])
    expect(OFFICE_FRAME_NAMES.length).toBeGreaterThan(10)
  })

  it('meta.sign 을 읽는다(형식이 틀리면 기본값)', () => {
    expect(parseSignMeta(json.meta)).toMatchObject({ panelInsetX: 6, panelTop: 4, pieceW: 16 })
    expect(parseSignMeta(null).pieceH).toBe(32)
  })

  it('직원: 책상 < 발끝(+8) < 의자(+11) / 팀장: 의자(−15) < 발끝(−14) < 큰 책상', () => {
    for (const id of SUB_DESKS) {
      const t = SPOTS[id].tile
      const feet = spotPosition(id, 0)
      const desk = PROPS.find((p) => p.kind === 'desk' && p.col === t.col && p.row === t.row - 1)
      const chair = PROPS.find((p) => p.kind === 'chair' && p.col === t.col && p.row === t.row)
      const d = desk && placementOf(desk)
      const c = chair && placementOf(chair)
      expect(d).toEqual({ x: feet.x, y: feet.y - OFFSET.staffFeet })
      expect(c).toEqual({ x: feet.x, y: feet.y - OFFSET.staffFeet + OFFSET.staffChair })
    }
    const feet = spotPosition('mainDesk', 0)
    const desk = PROPS.find((p) => p.kind === 'mainDesk')
    const chair = PROPS.find((p) => p.kind === 'mainChair')
    const d = desk && placementOf(desk)
    const c = chair && placementOf(chair)
    expect(d).toEqual({ x: feet.x, y: feet.y - OFFSET.bossFeet })
    expect(c?.y).toBeLessThan(feet.y)
    expect(d?.y).toBeGreaterThan(feet.y)
  })

  it('간판 글자 영역은 글자판 안(폭 W − 16), 다른 방 가구는 깊이 정렬 대상이 아니다', () => {
    const sign = PROPS.find((p) => p.kind === 'teamSign')
    expect(sign).toBeDefined()
    if (sign === undefined) return
    const box = signTextBox(sign)
    expect(box.w).toBe(sign.w * 16 - 16)
    expect(box.x).toBe(sign.col * 16 + 8)
    expect(box.y).toBe((sign.row + sign.h) * 16 - 32 + 4)
    const shelf = PROPS.find((p) => p.kind === 'bookshelf')
    expect(shelf && placementOf(shelf)).toBeNull()
  })

  it('업무 공간 타일: 업무 공간 안은 모두 바닥, 출입구는 칸막이로 막지 않는다', () => {
    const tiles = workAreaTiles()
    const at = (c: number, r: number) => tiles.filter((t) => t.col === c && t.row === r)
    for (let r = 2; r <= 12; r++)
      for (let c = 7; c <= 16; c++)
        expect(at(c, r).map((t) => t.frame.startsWith('tile_floor'))).toEqual([true])
    for (const [c, r] of [
      [6, 4],
      [6, 10],
      [17, 4],
      [17, 10],
    ] as const)
      expect(at(c, r).some((t) => t.frame.startsWith('tile_partition'))).toBe(false)
    expect(at(6, 3).at(-1)?.frame).toBe('tile_partition_v_end_0')
    expect(new Set(tiles.map((t) => t.frame)).size).toBeGreaterThan(5)
    for (const t of tiles) expect(json.frames[t.frame], t.frame).toBeDefined()
  })
})
