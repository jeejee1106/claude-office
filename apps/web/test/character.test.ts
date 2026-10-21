import { describe, expect, it } from 'vitest'
import {
  type AnimName,
  type Effect,
  type Mark,
  SPEECH_MS,
  toolActivity,
} from '../src/scene/activityMap'
import {
  Character,
  DIALOG_MIN_MS,
  FADE_MS,
  LEAVE_MAX_MS,
  LEAVE_PREP_MS,
  LEAVE_WALK_MS,
} from '../src/scene/Character'
import { CommandQueue, MAX_QUEUE, type QueuedCommand } from '../src/scene/commandQueue'
import type { CharacterCommand } from '../src/scene/commands'
import {
  COLS,
  DOOR_OUTSIDE,
  DOORWAYS,
  FIXED_SPOTS,
  isWalkable,
  isWall,
  PROPS,
  ROWS,
  roomAt,
  SPOTS,
  spotPosition,
  TILE,
} from '../src/scene/layout'
import { findPath } from '../src/scene/pathfinding'
import type { CharacterView } from '../src/scene/render/types'
import { Roster } from '../src/scene/roster'

type MoveCmd = Extract<QueuedCommand, { type: 'moveTo' }>

const move = (spot: (typeof FIXED_SPOTS)[number], cause: string, soft = false): MoveCmd => ({
  type: 'moveTo',
  agentId: 'main',
  cause,
  spot,
  slot: 0,
  anim: 'read',
  bubble: null,
  effect: null,
  soft,
})

describe('CommandQueue', () => {
  it('명령 5개를 연달아 넣어도 길이 ≤ 3, 마지막 목표 보존', () => {
    const q = new CommandQueue()
    const spots = ['bookshelf', 'cabinet', 'whiteboard', 'globe', 'phone'] as const
    spots.forEach((s, i) => {
      q.push(move(s, `c${i}`))
      expect(q.length).toBeLessThanOrEqual(MAX_QUEUE)
    })
    const items = q.peekAll()
    expect(items).toHaveLength(MAX_QUEUE)
    expect(items.at(-1)).toMatchObject({ spot: 'phone' })
  })

  it('leave·spawn 은 버리지 않는다', () => {
    const q = new CommandQueue()
    q.push({ type: 'spawn', agentId: 'a', cause: 's', variant: 1, label: 'a' })
    for (let i = 0; i < 5; i++) q.push(move('bookshelf', `m${i}`))
    q.push({ type: 'leave', agentId: 'a', cause: 'l' })
    const types = q.peekAll().map((c) => c.type)
    expect(types[0]).toBe('spawn')
    expect(types.at(-1)).toBe('leave')
    expect(q.length).toBeLessThanOrEqual(MAX_QUEUE)
  })

  it('soft 명령은 뒤에 명령이 있으면 건너뛴다', () => {
    const q = new CommandQueue()
    q.push(move('mainDesk', 'soft', true))
    q.push(move('bookshelf', 'next'))
    expect(q.shift()).toMatchObject({ cause: 'next' })
    q.push(move('mainDesk', 'soft2', true))
    expect(q.shift()).toMatchObject({ cause: 'soft2' })
  })
})

class FakeView implements CharacterView {
  pos = { x: 0, y: 0 }
  anim: AnimName | null = null
  mark: Mark | null = null
  bubble: string | null = null
  alpha = 1
  effect: Effect | null = null
  destroyed = false
  setPosition(x: number, y: number) {
    this.pos = { x, y }
  }
  setAnimation(a: AnimName) {
    this.anim = a
  }
  setMark(m: Mark | null) {
    this.mark = m
  }
  setBubble(t: string | null) {
    this.bubble = t
  }
  setLabel() {}
  setHighlight() {}
  setEffect(e: Effect | null) {
    this.effect = e
  }
  setAlpha(a: number) {
    this.alpha = a
  }
  tick() {}
  destroy() {
    this.destroyed = true
  }
}

function runFor(c: Character, ms: number, step = 16) {
  for (let t = 0; t < ms; t += step) c.update(step)
}

describe('Character 상태 머신', () => {
  it('spawning → walking → acting, 도착 위치와 애니메이션', () => {
    const view = new FakeView()
    const c = new Character('main', view)
    const cmds: CharacterCommand[] = [
      { type: 'spawn', agentId: 'main', cause: 'e1', variant: 0, label: 'main' },
      { ...move('bookshelf', 'e2'), bubble: '📄 a.ts' },
    ]
    for (const cmd of cmds) c.enqueue(cmd)
    c.update(16)
    expect(c.state).toBe('spawning')
    runFor(c, 20_000)
    expect(c.state).toBe('acting')
    expect(view.anim).toBe('read')
    expect(view.bubble).toBe('📄 a.ts')
    expect(view.pos).toEqual(spotPosition('bookshelf', 0))
  })

  it('mark 는 즉시, durationMs 후 유지 표시로 복귀', () => {
    const view = new FakeView()
    const c = new Character('main', view)
    c.enqueue({ type: 'mark', agentId: 'main', cause: 'a', mark: 'question', durationMs: null })
    c.enqueue({ type: 'mark', agentId: 'main', cause: 'b', mark: 'sweat', durationMs: 1000 })
    expect(view.mark).toBe('sweat')
    runFor(c, 1100)
    expect(view.mark).toBe('question')
  })

  it('leave → 문 밖으로 걸어가 gone', () => {
    const view = new FakeView()
    const c = new Character('a', view)
    c.enqueue({
      type: 'place',
      agentId: 'a',
      cause: 'sync',
      variant: 1,
      label: 'a',
      spot: 'desk1',
      slot: 0,
      anim: 'idle_sit',
      bubble: null,
      mark: null,
    })
    expect(c.state).toBe('idle')
    c.enqueue({ type: 'leave', agentId: 'a', cause: 'x' })
    runFor(c, 30_000)
    expect(c.isGone).toBe(true)
    expect(view.alpha).toBe(0)
  })
})

const place = (spot: (typeof FIXED_SPOTS)[number]): CharacterCommand => ({
  type: 'place',
  agentId: 'main',
  cause: 'sync',
  variant: 0,
  label: 'main',
  spot,
  slot: 0,
  anim: 'type',
  bubble: null,
  mark: null,
})

describe('말풍선 규칙 (기획서 6절)', () => {
  it('대사는 SPEECH_MS 뒤 사라지고, 도구 말풍선 없는 이동은 대사를 지우지 않는다', () => {
    const view = new FakeView()
    const c = new Character('main', view)
    c.enqueue(place('mainDesk'))
    c.enqueue({
      type: 'act',
      agentId: 'main',
      cause: 'a',
      anim: 'idle_stand',
      durationMs: null,
      say: '네, 알겠습니다!',
    })
    c.update(16)
    expect(view.bubble).toBe('네, 알겠습니다!')
    c.enqueue(move('mainDesk', 'b', true))
    runFor(c, 500)
    expect(view.bubble).toBe('네, 알겠습니다!')
    runFor(c, SPEECH_MS)
    expect(view.bubble).toBeNull()
  })

  it('도구 말풍선이 대사를 즉시 대체한다(한 사람당 하나)', () => {
    const view = new FakeView()
    const c = new Character('main', view)
    c.enqueue(place('serverTerminal'))
    c.enqueue({
      type: 'act',
      agentId: 'main',
      cause: 'err',
      anim: 'flinch',
      durationMs: 1200,
      say: '앗…',
      interruptible: true,
    })
    c.update(16)
    expect(view.bubble).toBe('앗…')
    expect(view.anim).toBe('flinch')
    c.enqueue(move('mainDesk', 'soft', true))
    c.enqueue({ ...move('globe', 'web'), bubble: '🌐' })
    // 끊을 수 있는 행동: 최소 시간(DIALOG_MIN_MS) 뒤 바로 다음 도구로 — 1.2초를 다 기다리지 않는다
    runFor(c, 400)
    expect(view.bubble).toBe('앗…')
    runFor(c, DIALOG_MIN_MS - 400 + 60)
    expect(view.bubble).toBe('🌐')
    expect(c.lastCause).toBe('web')
  })

  it('soft 명령만 뒤에 있으면 대사 행동은 끝까지 간다', () => {
    const view = new FakeView()
    const c = new Character('main', view)
    c.enqueue(place('serverTerminal'))
    c.enqueue({
      type: 'act',
      agentId: 'main',
      cause: 'err',
      anim: 'flinch',
      durationMs: 1200,
      say: '앗…',
      interruptible: true,
    })
    c.enqueue(move('mainDesk', 'soft', true))
    runFor(c, 1000)
    expect(view.anim).toBe('flinch')
    expect(c.lastCause).toBe('err')
  })
})

describe('퇴근(세션 종료) 퇴장', () => {
  it('짐 챙기기 → 가방 들고 문으로, "퇴근하겠습니다!" 가 1.5초 넘게 보이고 2초 안에 사라진다', () => {
    const view = new FakeView()
    const c = new Character('main', view)
    c.enqueue(place('mainDesk'))
    c.enqueue({
      type: 'leave',
      agentId: 'main',
      cause: 'end',
      say: '퇴근하겠습니다!',
      style: 'pack',
    })
    c.update(16)
    expect(view.anim).toBe('pack')
    expect(view.bubble).toBe('퇴근하겠습니다!')
    let shown = 0
    let t = 16
    let bag = false
    while (!c.isGone && t < 5000) {
      c.update(16)
      t += 16
      if (view.bubble === '퇴근하겠습니다!' && view.alpha > 0) shown += 16
      if (view.effect === 'bag') bag = true
    }
    expect(c.isGone).toBe(true)
    expect(bag).toBe(true)
    expect(t).toBeLessThanOrEqual(LEAVE_MAX_MS)
    expect(LEAVE_PREP_MS + LEAVE_WALK_MS + FADE_MS).toBeLessThan(LEAVE_MAX_MS)
    expect(shown).toBeGreaterThanOrEqual(1500)
  })

  it('보고(report) 퇴장은 팀장 책상 쪽을 본다', () => {
    const view = new FakeView()
    const c = new Character('a', view)
    c.enqueue({ ...place('cabinet'), agentId: 'a' })
    c.enqueue({ type: 'leave', agentId: 'a', cause: 'fin', say: '다녀왔습니다!', style: 'report' })
    c.update(16)
    expect(view.anim).toBe('report')
    expect(c.dir).toBe('right') // 자료실 캐비닛 → 업무 공간 창가 책상은 오른쪽
  })

  it('Roster: 조명 끄기는 퇴장 중인 마지막 사람이 사라질 때까지 미룬다', () => {
    const lights: boolean[] = []
    const roster = new Roster(
      () => new FakeView(),
      (cmd) => {
        if (cmd.type === 'lights') lights.push(cmd.on)
      },
    )
    roster.dispatch([{ type: 'lights', on: true, cause: 's' }, place('mainDesk')])
    roster.dispatch([
      { type: 'lights', on: false, cause: 'end' },
      { type: 'leave', agentId: 'main', cause: 'end', say: '퇴근하겠습니다!', style: 'pack' },
    ])
    expect(lights).toEqual([true])
    expect(roster.lightsOffDeferred).toBe(true)
    for (let i = 0; i < 100 && roster.visibleCount > 0; i++) {
      roster.update(50)
      if (roster.visibleCount > 0) expect(lights).toEqual([true])
    }
    expect(roster.visibleCount).toBe(0)
    expect(lights).toEqual([true, false])
  })
})

describe('layout · pathfinding', () => {
  it('방 배치: 스팟이 기획서의 방에 있다(서버실·자료실·회의실·휴게실)', () => {
    const room = (id: (typeof FIXED_SPOTS)[number]) => roomAt(SPOTS[id].tile)
    expect(room('serverTerminal')).toBe('server')
    expect(roomAt(SPOTS[toolActivity('bash').spot as 'serverTerminal'].tile)).toBe('server')
    expect(room('bookshelf')).toBe('archive')
    expect(room('cabinet')).toBe('archive')
    expect(room('whiteboard')).toBe('meeting')
    expect(room('coffee')).toBe('lounge')
    for (const id of ['mainDesk', 'desk1', 'desk2', 'desk3', 'desk4', 'globe', 'door'] as const)
      expect(room(id), id).toBe('work')
    // 서버실: 서버랙 여러 대, 터미널, 케이블
    const inServer = PROPS.filter((p) => roomAt({ col: p.col, row: p.row + p.h - 1 }) === 'server')
    expect(inServer.filter((p) => p.kind === 'serverRack').length).toBeGreaterThanOrEqual(3)
    expect(inServer.map((p) => p.kind)).toEqual(expect.arrayContaining(['terminal', 'cables']))
    // 휴게실: 커피머신 + 소파
    const inLounge = PROPS.filter((p) => roomAt({ col: p.col, row: p.row + p.h - 1 }) === 'lounge')
    expect(inLounge.map((p) => p.kind)).toEqual(expect.arrayContaining(['coffee', 'sofa']))
  })

  it('방은 벽으로 닫혀 있고 출입구로만 이어진다', () => {
    for (const d of DOORWAYS) expect(isWalkable(d.col, d.row)).toBe(true)
    // 방 경계 타일 중 벽이 아닌 것은 출입구뿐
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const here = roomAt({ col: c, row: r })
        for (const [dc, dr] of [
          [1, 0],
          [0, 1],
        ] as const) {
          const there = roomAt({ col: c + dc, row: r + dr })
          if (here !== null && there !== null && here !== there)
            throw new Error(`방 ${here}·${there} 가 벽 없이 맞닿음 (${c},${r})`)
        }
      }
  })

  it('모든 스팟 쌍의 경로가 벽·가구를 통과하지 않는다(대체 L자 경로 사용 안 함)', () => {
    const tiles = [DOOR_OUTSIDE, ...FIXED_SPOTS.map((id) => SPOTS[id].tile)]
    for (const a of tiles)
      for (const b of tiles) {
        if (a.col === b.col && a.row === b.row) continue
        const path = findPath(a, b)
        expect(path.at(-1)).toEqual(b)
        let prev = a
        for (const p of path) {
          expect(Math.abs(p.col - prev.col) + Math.abs(p.row - prev.row)).toBe(1)
          if (!(p.col === b.col && p.row === b.row))
            expect(
              isWalkable(p.col, p.row),
              `${a.col},${a.row}→${b.col},${b.row} via ${p.col},${p.row}`,
            ).toBe(true)
          expect(isWall(p.col, p.row)).toBe(false)
          prev = p
        }
      }
  })

  it('업무 공간 → 서버실 경로는 서버실 출입구를 지난다', () => {
    const path = findPath(SPOTS.mainDesk.tile, SPOTS.serverTerminal.tile)
    const door = DOORWAYS.find((d) => d.room === 'server')
    expect(path).toContainEqual({ col: door?.col, row: door?.row })
  })

  it('스팟의 대기 슬롯 위치가 벽 위에 놓이지 않는다', () => {
    for (const id of FIXED_SPOTS)
      for (let i = 0; i < SPOTS[id].slots.length; i++) {
        const p = spotPosition(id, i)
        const col = Math.floor(p.x / TILE)
        const row = Math.floor((p.y - 1) / TILE)
        expect(isWall(col, row), `${id} slot ${i}`).toBe(false)
      }
  })

  it('모든 스팟 타일은 걸을 수 있고 문에서 도달 가능하다', () => {
    for (const id of FIXED_SPOTS) {
      const t = SPOTS[id].tile
      expect(isWalkable(t.col, t.row), id).toBe(true)
      const path = findPath(DOOR_OUTSIDE, t)
      expect(path.at(-1), id).toEqual(t)
      for (const p of path)
        expect(isWalkable(p.col, p.row), `${id} via ${p.col},${p.row}`).toBe(true)
    }
  })
})
