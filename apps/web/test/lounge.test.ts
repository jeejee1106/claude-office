import {
  createInitialState,
  type OfficeEvent,
  type OfficeState,
  reduce,
} from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import { LINES } from '../src/i18n'
import {
  LOUNGE_REST,
  LOUNGE_RESTS,
  type LoungeRest,
  pickLoungeRest,
  SOFA_SIT_MAX,
  sofaAllows,
} from '../src/scene/activityMap'
import { Character } from '../src/scene/Character'
import { type DirectorOutput, isCharacterCommand } from '../src/scene/commands'
import { Director } from '../src/scene/director'
import {
  isWalkable,
  PROPS,
  roomAt,
  SOFA_ANCHOR,
  SOFA_SORT_Y,
  SPOTS,
  spotPosition,
} from '../src/scene/layout'
import { ANIM_FALLBACK, SOFA_POSES } from '../src/scene/render/characterSheet'
import { propAnchor } from '../src/scene/render/officeSheet'
import type { CharacterView } from '../src/scene/render/types'
import { ev } from './helpers'

/*
 * 2026-10-23 사용자 결정: 한 턴 끝 휴게실 쉬기(커피·소파 앉기·소파 눕기), 화이트보드 글씨 남기기.
 */

function run(events: OfficeEvent[], director = new Director({ now: () => 0 })) {
  let state: OfficeState = createInitialState()
  const out: DirectorOutput[][] = []
  for (const e of events) {
    state = reduce(state, e)
    out.push(director.handle(e, state.sessions[e.sessionId]))
  }
  return { state, out, director }
}

/** pickLoungeRest 가 rest 를 고르는 이벤트 id */
function idFor(rest: LoungeRest, prefix = 'id'): string {
  for (let i = 0; i < 500; i++) {
    const id = `${prefix}${i}`
    if (pickLoungeRest(id) === rest) return id
  }
  throw new Error(`no id for ${rest}`)
}

const moveOf = (cmds: DirectorOutput[] | undefined) =>
  (cmds ?? []).find((c) => c.type === 'moveTo') as
    | { spot: string; anim: string; effect: string | null; say?: string | null }
    | undefined

const boards = (out: DirectorOutput[][]) =>
  out.flat().filter((c): c is Extract<DirectorOutput, { type: 'board' }> => c.type === 'board')

describe('휴게실 쉬기 (turn.end)', () => {
  it('이벤트 id 로 결정적, 셋 다 나온다, 소파 자리가 없으면 커피', () => {
    expect(pickLoungeRest('e27')).toBe(pickLoungeRest('e27'))
    const seen = new Set(Array.from({ length: 60 }, (_, i) => pickLoungeRest(`x${i}`)))
    expect([...seen].sort()).toEqual([...LOUNGE_RESTS].sort())
    const lying = { sitting: 0, lying: 1 }
    for (let i = 0; i < 30; i++) expect(pickLoungeRest(`x${i}`, lying)).toBe('coffee')
  })

  it('소파 자리 규칙: 앉기 최대 2명, 누우면 좌석 전부, 앉은 사람이 있으면 못 누움', () => {
    expect(SOFA_SIT_MAX).toBe(2)
    expect(sofaAllows('sofaSit', { sitting: 1, lying: 0 })).toBe(true)
    expect(sofaAllows('sofaSit', { sitting: 2, lying: 0 })).toBe(false)
    expect(sofaAllows('sofaSit', { sitting: 0, lying: 1 })).toBe(false)
    expect(sofaAllows('sofaLie', { sitting: 1, lying: 0 })).toBe(false)
    expect(sofaAllows('sofaLie', { sitting: 0, lying: 0 })).toBe(true)
    expect(sofaAllows('coffee', { sitting: 2, lying: 1 })).toBe(true)
  })

  it('director: 둘이 나란히 앉고(왼쪽·오른쪽 슬롯), 셋째는 커피', () => {
    const { out } = run([
      ev({ kind: 'session.start' }),
      ev({ kind: 'agent.spawn', agentId: 'a', agentType: 'Explore' }),
      ev({ kind: 'agent.spawn', agentId: 'b', agentType: 'Plan' }),
      ev({ kind: 'turn.end', agentId: 'a', id: idFor('sofaSit', 'a') }),
      ev({ kind: 'turn.end', agentId: 'b', id: idFor('sofaSit', 'b') }),
      ev({ kind: 'turn.end', id: idFor('sofaSit', 'm') }),
    ])
    const m = (i: number) => moveOf(out[i]) as { spot: string; slot?: number } | undefined
    expect(m(3)).toMatchObject({ spot: 'sofaSit', slot: 0 })
    expect(m(4)).toMatchObject({ spot: 'sofaSit', slot: 1 })
    expect(m(5)?.spot).toBe('coffee')
  })

  it('세 동작의 스팟·애니메이션·대사·이펙트(김은 커피만)', () => {
    expect(LOUNGE_REST.coffee).toMatchObject({
      spot: 'coffee',
      anim: 'idle_drink',
      effect: 'steam',
      line: 'turnEnd',
    })
    expect(LOUNGE_REST.sofaSit).toMatchObject({
      spot: 'sofaSit',
      anim: 'sofa_sit',
      line: 'turnEnd',
    })
    expect(LOUNGE_REST.sofaLie).toMatchObject({
      spot: 'sofaLie',
      anim: 'sofa_lie',
      line: 'turnEnd',
    })
    expect(LOUNGE_REST.sofaSit.effect).toBeUndefined()
    expect(LOUNGE_REST.sofaLie.effect).toBeUndefined()
  })

  for (const rest of LOUNGE_RESTS) {
    it(`director: ${rest} 로 가서 "휴~" (도착할 때)`, () => {
      const { out } = run([
        ev({ kind: 'session.start' }),
        ev({ kind: 'turn.end', id: idFor(rest) }),
      ])
      const m = moveOf(out[1])
      expect(m).toMatchObject({
        spot: LOUNGE_REST[rest].spot,
        anim: LOUNGE_REST[rest].anim,
        effect: rest === 'coffee' ? 'steam' : null,
      })
      expect(LINES.ko.turnEnd).toContain(m?.say)
    })
  }

  it('소파에 다른 사람이 있으면 커피, 그 사람이 소파를 떠나면 다시 소파', () => {
    const { out } = run([
      ev({ kind: 'session.start' }),
      ev({ kind: 'agent.spawn', agentId: 'a', agentType: 'Explore' }),
      ev({ kind: 'turn.end', agentId: 'a', id: idFor('sofaSit', 'a') }),
      ev({ kind: 'turn.end', id: idFor('sofaLie', 'm') }),
      // a 가 일하러 가면 소파가 빈다 → main 의 다음 쉬기는 소파 가능
      ev({ kind: 'tool.start', agentId: 'a', tool: { name: 'Read', category: 'read' } }),
      ev({ kind: 'turn.end', id: idFor('sofaLie', 'n') }),
    ])
    expect(moveOf(out[2])?.spot).toBe('sofaSit')
    expect(moveOf(out[3])?.spot).toBe('coffee')
    expect(moveOf(out[4])?.spot).toBe('bookshelf')
    expect(moveOf(out[5])?.spot).toBe('sofaLie')
  })

  it('소파에 누워 오래 쉬면 그 자리에서 Zzz(책상으로 가지 않음), 앉기·커피는 책상에서 졺', () => {
    const t0 = Date.parse('2026-01-01T00:00:00.000Z')
    for (const rest of LOUNGE_RESTS) {
      let now = t0
      const d = new Director({ now: () => now })
      const r = run([ev({ kind: 'session.start' }), ev({ kind: 'turn.end', id: idFor(rest) })], d)
      now += 5 * 60_000
      const cmds = d.refreshSleep(r.state.sessions.s)
      expect(cmds, rest).toContainEqual(expect.objectContaining({ type: 'mark', mark: 'sleep' }))
      const move = cmds.find((c) => c.type === 'moveTo')
      if (rest === 'sofaLie') expect(move, rest).toBeUndefined()
      else expect(move, rest).toMatchObject({ spot: 'mainDesk', anim: 'sleep' })
      // 다음 이벤트가 오면 Zzz 를 지운다
      const wake = d.handle(ev({ kind: 'prompt.submit' }), r.state.sessions.s)
      expect(wake[0]).toMatchObject({ type: 'mark', mark: null })
    }
  })
})

describe('소파 스팟 (layout)', () => {
  it('휴게실, 걸을 수 있는 소파 앞 칸, 소파는 방 쪽(위)을 향해 앉음(뒷모습)', () => {
    for (const id of ['sofaSit', 'sofaLie'] as const) {
      const s = SPOTS[id]
      expect(roomAt(s.tile), id).toBe('lounge')
      expect(isWalkable(s.tile.col, s.tile.row), id).toBe(true)
      expect(s.face, id).toBe('up')
    }
    expect(SPOTS.sofaSit.slots).toHaveLength(2)
    expect(SPOTS.sofaLie.slots).toHaveLength(1)
  })

  it('캐릭터 앵커 = pixel-artist 배치 표(소파 앵커 (72,208) 기준): 앉기 (63,200)·(81,200), 눕기 (69,200)', () => {
    const sofa = PROPS.find((p) => p.kind === 'sofa')
    if (sofa === undefined) throw new Error('sofa')
    expect(propAnchor(sofa)).toEqual(SOFA_ANCHOR)
    expect(SOFA_ANCHOR).toEqual({ x: 72, y: 208 })
    expect(spotPosition('sofaSit', 0)).toEqual({ x: 63, y: 200 })
    expect(spotPosition('sofaSit', 1)).toEqual({ x: 81, y: 200 })
    expect(spotPosition('sofaLie', 0)).toEqual({ x: 69, y: 200 })
  })

  it('소파 위 캐릭터는 소파 바로 위 깊이(209)로 그린다', () => {
    expect(SOFA_SORT_Y).toBe(209)
    expect([...SOFA_POSES].sort()).toEqual(['sofa_lie', 'sofa_sit'])
  })

  it('대체 그림: sofa_sit → idle_sit, sofa_lie → sleep', () => {
    expect(ANIM_FALLBACK.sofa_sit?.anim).toBe('idle_sit')
    expect(ANIM_FALLBACK.sofa_lie?.anim).toBe('sleep')
  })

  it('Character: 소파 쉬기는 idle 상태(다음 명령이 오면 바로 일어남)', () => {
    const anims: string[] = []
    const view: CharacterView = {
      setPosition() {},
      setAnimation(a) {
        anims.push(a)
      },
      setMark() {},
      setBubble() {},
      setLabel() {},
      setHighlight() {},
      setEffect() {},
      setAlpha() {},
      tick() {},
      destroy() {},
    }
    const ch = new Character('main', view)
    ch.enqueue({
      type: 'place',
      agentId: 'main',
      cause: 'sync',
      variant: 0,
      label: 'main',
      spot: 'mainDesk',
      slot: 0,
      anim: 'idle_sit',
      bubble: null,
      mark: null,
    })
    ch.enqueue({
      type: 'moveTo',
      agentId: 'main',
      cause: 'c',
      spot: 'sofaLie',
      slot: 0,
      anim: 'sofa_lie',
      bubble: null,
      effect: null,
      soft: false,
    })
    for (let i = 0; i < 60; i++) ch.update(50)
    expect(ch.state).toBe('idle')
    expect(anims.at(-1)).toBe('sofa_lie')
    const p = spotPosition('sofaLie', 0)
    expect([ch.x, ch.y]).toEqual([p.x, p.y])
  })
})

describe('화이트보드 글씨 남기기', () => {
  const plan = () => ev({ kind: 'tool.start', tool: { name: 'TodoWrite', category: 'plan' } })
  const planEnd = () =>
    ev({ kind: 'tool.end', tool: { name: 'TodoWrite', category: 'plan' }, status: 'ok' })

  it('계획을 한 번 하면 세션이 끝날 때까지 written, 끝나면 지움', () => {
    const { out, director } = run([
      ev({ kind: 'session.start' }),
      plan(),
      planEnd(),
      ev({ kind: 'tool.start', tool: { name: 'Read', category: 'read' } }),
      plan(),
      ev({ kind: 'turn.end' }),
      ev({ kind: 'session.end' }),
    ])
    expect(boards(out).map((b) => b.written)).toEqual([true, false])
    expect(out[1]).toContainEqual(expect.objectContaining({ type: 'board', written: true }))
    expect(out[6]).toContainEqual(expect.objectContaining({ type: 'board', written: false }))
    expect(director.boardWrittenNow()).toBe(false)
  })

  it('계획 전에는 빈 보드(board 명령 없음)', () => {
    const { out } = run([
      ev({ kind: 'session.start' }),
      ev({ kind: 'tool.start', tool: { name: 'Read', category: 'read' } }),
    ])
    expect(boards(out)).toEqual([])
  })

  it('syncAll: 같은 세션은 기억, 다른 세션으로 바꾸면 그 세션 기준(계획 없으면 빈 보드), 진행 중 계획이면 글씨', () => {
    let state = createInitialState()
    const d = new Director({ now: () => 0 })
    const feed = (e: OfficeEvent) => {
      state = reduce(state, e)
      return d.handle(e, state.sessions[e.sessionId])
    }
    feed(ev({ kind: 'session.start' }))
    feed(plan())
    feed(planEnd())
    feed(ev({ kind: 'session.start', sessionId: 's2' }))
    const board = (cmds: DirectorOutput[]) =>
      cmds.find((c) => c.type === 'board') as { written: boolean } | undefined
    expect(board(d.syncAll(state, 's'))?.written).toBe(true)
    expect(board(d.syncAll(state, 's2'))?.written).toBe(false)
    expect(board(d.syncAll(state, 's'))?.written).toBe(true)
    // 처음 보는 director(새로고침) 라도 지금 계획 중이면 글씨
    state = reduce(
      state,
      ev({ kind: 'tool.start', sessionId: 's2', tool: { name: 'TodoWrite', category: 'plan' } }),
    )
    expect(board(new Director({ now: () => 0 }).syncAll(state, 's2'))?.written).toBe(true)
    // 끝난 세션은 빈 보드
    state = reduce(state, ev({ kind: 'session.end', ts: '2026-01-01T00:01:00.000Z' }))
    expect(board(d.syncAll(state, 's'))?.written).toBe(false)
    expect(board(d.syncAll(state, null))?.written).toBe(false)
  })

  it('board 는 씬 명령(캐릭터 명령 아님)', () => {
    expect(isCharacterCommand({ type: 'board', written: true, cause: 'x' })).toBe(false)
  })
})
