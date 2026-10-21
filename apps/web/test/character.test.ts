import { describe, expect, it } from 'vitest'
import type { AnimName, Mark } from '../src/scene/activityMap'
import { Character } from '../src/scene/Character'
import { CommandQueue, MAX_QUEUE, type QueuedCommand } from '../src/scene/commandQueue'
import type { CharacterCommand } from '../src/scene/commands'
import { DOOR_OUTSIDE, FIXED_SPOTS, isWalkable, SPOTS, spotPosition } from '../src/scene/layout'
import { findPath } from '../src/scene/pathfinding'
import type { CharacterView } from '../src/scene/render/types'

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
  setEffect() {}
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
    c.enqueue({ type: 'mark', agentId: 'main', cause: 'b', mark: 'error', durationMs: 1000 })
    expect(view.mark).toBe('error')
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

describe('layout · pathfinding', () => {
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
