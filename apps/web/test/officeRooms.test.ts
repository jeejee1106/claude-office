import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COLS, PROPS, ROWS, SPOTS, type SpotId, spotPosition } from '../src/scene/layout'
import {
  OFFICE_FRAME_NAMES,
  OFFSET,
  officeTiles,
  placementOf,
  propAnchor,
  ROOM_FRAMES,
  rackFrameIndex,
  roomActivity,
  roomExtras,
  roomPropSprite,
  stepDoor,
} from '../src/scene/render/officeSheet'

/*
 * 다른 방(자료실·서버실·회의실·휴게실·창가·로비·방 경계)의 시트 배치.
 * 숫자는 pixel-artist 요약(_workspace/02_pixel-artist_summary.md) 3·5절 표 그대로.
 */

const json = JSON.parse(
  readFileSync(fileURLToPath(new URL('../public/assets/office.json', import.meta.url)), 'utf8'),
) as { frames: Record<string, unknown>; animations?: Record<string, string[]> }

const at = (c: number, r: number) => officeTiles().find((t) => t.col === c && t.row === r)?.frame

describe('층 전체 타일 지도', () => {
  it('칸마다 정확히 하나, 모두 시트에 있는 프레임', () => {
    const tiles = officeTiles()
    expect(tiles).toHaveLength(COLS * ROWS)
    expect(new Set(tiles.map((t) => `${t.col},${t.row}`)).size).toBe(COLS * ROWS)
    for (const t of tiles)
      expect(json.frames[t.frame], `${t.col},${t.row} ${t.frame}`).toBeDefined()
    for (const n of OFFICE_FRAME_NAMES) expect(json.frames[n], n).toBeDefined()
  })

  it('요약 2절 표와 같다(방 경계·바깥 벽·모서리·출입구)', () => {
    expect(at(0, 0)).toBe('tile_wall_top_edge_left_0')
    expect(at(23, 1)).toBe('tile_wall_edge_right_0')
    expect(at(0, 3)).toBe('tile_wall_v_out_wood_0')
    expect(at(0, 7)).toBe('tile_wall_tee_right_out_carpet_0')
    expect(at(0, 9)).toBe('tile_wall_v_out_carpet_0')
    expect(at(23, 3)).toBe('tile_wall_v_metal_out_0')
    expect(at(23, 7)).toBe('tile_wall_tee_left_tile_out_0')
    expect(at(23, 9)).toBe('tile_wall_v_tile_out_0')
    // 6열: 2·6행 이어짐, 3행 끝, 4행 출입구, 5행 시작, 7행 T자, 9·10·11행
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((r) => at(6, r))).toEqual([
      'tile_wall_v_wood_work_0',
      'tile_wall_v_end_wood_work_0',
      'tile_doorway_wood_work_0',
      'tile_wall_v_top_wood_work_0',
      'tile_wall_v_wood_work_0',
      'tile_wall_tee_left_carpet_work_0',
      'tile_wall_v_carpet_work_0',
      'tile_wall_v_end_carpet_work_0',
      'tile_doorway_carpet_work_0',
      'tile_wall_v_top_carpet_work_0',
      'tile_wall_v_carpet_work_0',
    ])
    expect(at(17, 4)).toBe('tile_doorway_work_metal_0')
    expect(at(17, 7)).toBe('tile_wall_tee_right_work_tile_0')
    expect(at(17, 10)).toBe('tile_doorway_work_tile_0')
    expect(at(3, 7)).toBe('tile_wall_h_carpet_0')
    expect(at(20, 7)).toBe('tile_wall_h_tile_0')
    expect([0, 6, 10, 13, 17, 23].map((c) => at(c, 13))).toEqual([
      'tile_wall_corner_left_0',
      'tile_partition_h_join_0',
      'tile_partition_h_right_0',
      'tile_partition_h_left_0',
      'tile_partition_h_join_0',
      'tile_wall_corner_right_0',
    ])
    // 문 자리(11·12열)는 열린 출입구 = 업무 공간 바닥
    expect(at(11, 13)).toMatch(/^tile_floor_\d$/)
    expect(at(12, 13)).toMatch(/^tile_floor_\d$/)
  })

  it('방 바닥은 방마다 다른 무늬(_0, 다섯 칸에 하나꼴 _1)', () => {
    expect(at(2, 3)).toMatch(/^tile_floor_wood_[01]$/)
    expect(at(2, 10)).toMatch(/^tile_floor_carpet_[01]$/)
    expect(at(20, 4)).toMatch(/^tile_floor_metal_[01]$/)
    expect(at(20, 10)).toMatch(/^tile_floor_tile_[01]$/)
    expect(at(2, 2)).toBe('tile_floor_wood_1') // (2·7 + 2·13) % 5 === 0
  })

  // pixel-artist 확인 그림의 타일 지도가 있으면 칸마다 대조한다(없으면 건너뜀 — _workspace 는 작업 폴더)
  const mapFile = fileURLToPath(
    new URL('../../../_workspace/samples-rooms/floor-map.txt', import.meta.url),
  )
  it.skipIf(!existsSync(mapFile))('pixel-artist floorTileMap 결과와 칸마다 같다', () => {
    const lines = readFileSync(mapFile, 'utf8').split('\n')
    for (let r = 0; r < ROWS; r++) {
      const line = lines.find((l) => l.startsWith(`row ${r}:`)) ?? ''
      const cells = line
        .replace(/^row \d+:\s*/, '')
        .split(/\s+/)
        .filter(Boolean)
        .map((s) => s.split(':')[1])
      expect(cells.length, `row ${r}`).toBe(COLS)
      for (let c = 0; c < COLS; c++) expect(at(c, r), `${c},${r}`).toBe(cells[c])
    }
  })
})

describe('다른 방 가구 배치 (요약 3절 앵커)', () => {
  const sprite = (kind: string, col?: number, row?: number) => {
    const p = PROPS.find(
      (q) => q.kind === kind && (col === undefined || (q.col === col && q.row === row)),
    )
    return p && roomPropSprite(p)
  }

  it('앵커 = (col·16 + w·8, (row+h)·16), 층은 바닥 장식 / 캐릭터 아래 / 깊이 정렬', () => {
    expect(sprite('bookshelf')).toEqual({ frame: 'furn_bookshelf', x: 40, y: 48, layer: 'depth' })
    expect(sprite('cabinet')).toMatchObject({ x: 80, y: 48 })
    expect(sprite('shredder')).toMatchObject({ x: 24, y: 96 })
    expect(sprite('serverRack', 20, 1)).toMatchObject({ x: 328, y: 48 })
    expect(sprite('serverRack', 22, 4)).toMatchObject({ x: 360, y: 96 })
    expect(sprite('terminal')).toMatchObject({ x: 304, y: 48 })
    expect(sprite('cables')).toEqual({ frame: 'furn_cables', x: 336, y: 96, layer: 'floor' })
    expect(sprite('whiteboard')).toMatchObject({ x: 312, y: 144 })
    expect(sprite('commonTable')).toMatchObject({ frame: 'furn_table_meeting', x: 336, y: 176 })
    expect(sprite('coffee')).toMatchObject({ x: 24, y: 160 })
    expect(sprite('sofa')).toMatchObject({ x: 72, y: 208 })
    expect(sprite('globe')).toMatchObject({ x: 248, y: 48 })
    expect(sprite('phone')).toMatchObject({ x: 136, y: 48 })
    expect(sprite('door')).toEqual({ frame: 'furn_door', x: 192, y: 224, layer: 'under' })
    expect(sprite('plant', 5, 7)).toMatchObject({ frame: 'furn_plant', x: 88, y: 144 })
    // 업무 공간 책상류·창문은 이 규칙 대상이 아니다
    for (const kind of ['desk', 'chair', 'mainDesk', 'mainChair', 'teamSign', 'window'])
      expect(sprite(kind), kind).toBeNull()
    for (const p of PROPS) {
      const s = roomPropSprite(p)
      if (s !== null) expect(json.frames[s.frame], s.frame).toBeDefined()
    }
  })

  it('스팟 발끝은 가구 앞(앵커보다 아래) — 캐릭터가 가구 앞에 그려진다', () => {
    const cases: [SpotId, string, number, number][] = [
      ['bookshelf', 'bookshelf', 0, 14],
      ['cabinet', 'cabinet', -8, 14],
      ['serverTerminal', 'terminal', 8, 14],
      ['whiteboard', 'whiteboard', 0, 14],
      ['globe', 'globe', 0, 14],
      ['phone', 'phone', 0, 14],
      ['commonTable', 'commonTable', -8, 14],
    ]
    for (const [spot, kind, dx, dy] of cases) {
      const s = sprite(kind)
      const f = spotPosition(spot, 0)
      expect([f.x - (s?.x ?? 0), f.y - (s?.y ?? 0)], spot).toEqual([dx, dy])
    }
    // 옆에 서는 기계: 파쇄기·커피머신 오른쪽에서 왼쪽을 봄(+16, −2)
    for (const [spot, kind] of [
      ['shredder', 'shredder'],
      ['coffee', 'coffee'],
    ] as const) {
      const s = sprite(kind)
      const f = spotPosition(spot, 0)
      expect([f.x - (s?.x ?? 0), f.y - (s?.y ?? 0)], spot).toEqual([16, -2])
      expect(SPOTS[spot].face).toBe('left')
    }
  })

  it('장식: 회의 의자 3개·터미널 의자 = 발끝 + 3(앉은 사람 앞), 매트·러그는 바닥', () => {
    const ex = roomExtras()
    const chairs = ex.filter((e) => e.frame === ROOM_FRAMES.meetingChair)
    expect(chairs.map((c) => [c.x, c.y])).toEqual([
      [328, 193],
      [314, 193],
      [342, 193],
    ])
    for (const [i, c] of chairs.entries())
      expect(c.y - spotPosition('commonTable', i).y).toBe(OFFSET.seatChair)
    expect(ex.find((e) => e.frame === 'furn_chair')).toMatchObject({ x: 312, y: 65 })
    expect(ex.find((e) => e.frame === ROOM_FRAMES.doormat)).toEqual({
      frame: 'furn_doormat',
      x: 192,
      y: 208,
      layer: 'floor',
    })
    expect(ex.find((e) => e.frame === ROOM_FRAMES.rug)).toMatchObject({ x: 72, y: 194 })
    for (const e of ex) expect(json.frames[e.frame], e.frame).toBeDefined()
  })

  it('placementOf(업무 공간 규칙)와 propAnchor(방 규칙)는 화분에서 같은 점', () => {
    const plant = PROPS.find((p) => p.kind === 'plant' && p.col === 7)
    expect(plant && placementOf(plant)).toEqual(plant && propAnchor(plant))
  })
})

describe('방 가구 애니메이션 트리거', () => {
  it('애니메이션 프레임 순서는 office.json animations 와 같다', () => {
    expect(json.animations?.furn_server_rack).toEqual([...ROOM_FRAMES.serverRack])
    expect(json.animations?.furn_terminal_busy).toEqual([...ROOM_FRAMES.terminalBusy])
    expect(json.animations?.furn_shredder_on).toEqual([...ROOM_FRAMES.shredderOn])
    expect(json.animations?.furn_coffee_brew).toEqual([...ROOM_FRAMES.coffeeBrew])
    expect(json.animations?.furn_door_open).toEqual([...ROOM_FRAMES.door])
  })

  it('스팟에서 그 동작 중일 때만 켜진다(걸어가는 중·다른 곳에서는 꺼짐)', () => {
    const atSpot = (id: SpotId, anim: string) => ({ ...spotPosition(id, 0), anim })
    expect(roomActivity([])).toEqual({
      doorOpen: false,
      cabinet: false,
      whiteboard: false,
      shredder: false,
      coffee: false,
    })
    const a = roomActivity([
      atSpot('cabinet', 'search'),
      atSpot('whiteboard', 'write_board'),
      atSpot('shredder', 'shred'),
      atSpot('coffee', 'idle_drink'),
    ])
    expect(a).toEqual({
      doorOpen: false,
      cabinet: true,
      whiteboard: true,
      shredder: true,
      coffee: true,
    })
    // 도착 전(walk) 또는 다른 스팟
    expect(roomActivity([atSpot('cabinet', 'walk')]).cabinet).toBe(false)
    expect(roomActivity([atSpot('bookshelf', 'search')]).cabinet).toBe(false)
    // 슬롯 오프셋(옆으로 9px)에 선 두 번째 사람도 켠다
    const s1 = spotPosition('whiteboard', 1)
    expect(roomActivity([{ ...s1, anim: 'write_board' }]).whiteboard).toBe(true)
  })

  it('문: door 스팟·문 밖(등장·퇴장 지점)에 누가 있으면 열림, 로비 위쪽은 닫힘', () => {
    expect(roomActivity([{ ...spotPosition('door', 0), anim: 'walk' }]).doorOpen).toBe(true)
    expect(roomActivity([{ x: 184, y: 222, anim: 'walk' }]).doorOpen).toBe(true)
    expect(roomActivity([{ x: 184, y: 190, anim: 'walk' }]).doorOpen).toBe(false)
    expect(roomActivity([{ x: 136, y: 206, anim: 'walk' }]).doorOpen).toBe(false)
    // 문 프레임은 한 칸씩 열리고(0→1→2) 거꾸로 닫힌다
    expect([0, 1, 2, 2].map((s) => stepDoor(s, true, 3))).toEqual([1, 2, 2, 2])
    expect([2, 1, 0].map((s) => stepDoor(s, false, 3))).toEqual([1, 0, 0])
  })

  it('서버랙 4대는 시작 프레임이 엇갈린다(i % 3)', () => {
    expect([0, 1, 2, 3].map((i) => rackFrameIndex(i, 0, 3))).toEqual([0, 1, 2, 0])
    expect([0, 1, 2, 3].map((i) => rackFrameIndex(i, 1, 3))).toEqual([1, 2, 0, 1])
    expect(rackFrameIndex(2, 5, 0)).toBe(0)
  })
})
