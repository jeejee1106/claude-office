import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createInitialState, type OfficeEvent, reduce } from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EMPLOYEE_SETTINGS,
  type EmployeeSettings,
  toTeamConfig,
} from '../src/employeeSettings'
import type { AnimName, Mark } from '../src/scene/activityMap'
import { Director } from '../src/scene/director'
import {
  type Dir,
  DOOR_OUTSIDE,
  FIXED_SPOTS,
  isWalkable,
  SPOTS,
  type SpotId,
  SUB_DESKS,
  spotPosition,
  TILE,
} from '../src/scene/layout'
import {
  canHop,
  HOP_COOLDOWN_MS,
  Partner,
  type PartnerAnim,
  type PartnerKind,
  type PartnerOwner,
  partnerKindOf,
  partnerRestSpot,
  REACTION_MS,
  TRAIL_PX,
  trailPoint,
  trimTrail,
} from '../src/scene/partner'
import {
  missingPartnerKeys,
  PARTNER_DOWN_ONLY,
  PARTNER_FRAME_MS,
  PARTNER_ONCE,
  partnerAnimKey,
  pickPartnerFrame,
} from '../src/scene/render/partnerSheet'
import type { CharacterView, PartnerView } from '../src/scene/render/types'
import { Roster } from '../src/scene/roster'
import { routeSceneEvent } from '../src/scene/sceneRouting'
import { createOfficeStore } from '../src/store/officeStore'
import { ev, loadSampleSession } from './helpers'

/*
 * 파트너 몬스터(기획서 4절 "파트너 몬스터"): 종류 고르기, 책상 옆 자리, 깡충 쿨다운,
 * 따라 걷기·앉기·잠·퇴장, 시트 이름 대조.
 */

class FakePartnerView implements PartnerView {
  x = Number.NaN
  y = Number.NaN
  anim: PartnerAnim | null = null
  dir: Dir | null = null
  alpha = 1
  destroyed = false
  calls = 0
  anims: PartnerAnim[] = []
  setPosition(x: number, y: number) {
    this.x = x
    this.y = y
  }
  setAnimation(a: PartnerAnim, d: Dir) {
    this.calls++
    this.anim = a
    this.dir = d
    this.anims.push(a)
  }
  setAlpha(a: number) {
    this.alpha = a
  }
  tick() {}
  destroy() {
    this.destroyed = true
  }
}

class NullView implements CharacterView {
  anim: AnimName | null = null
  setPosition() {}
  setAnimation(a: AnimName) {
    this.anim = a
  }
  setMark(_m: Mark | null) {}
  setBubble() {}
  setLabel() {}
  setHighlight() {}
  setEffect() {}
  setAlpha() {}
  tick() {}
  destroy() {}
}

/** 손으로 움직이는 주인 */
function stubOwner(over: Partial<Omit<PartnerOwner, 'trail'>> = {}): PartnerOwner & {
  x: number
  y: number
  trail: { x: number; y: number }[]
  settledAt: PartnerOwner['settledAt']
  asleep: boolean
  alpha: number
  teleports: number
  odometer: number
} {
  return {
    x: 0,
    y: 0,
    trail: [],
    settledAt: null,
    asleep: false,
    alpha: 1,
    teleports: 0,
    odometer: 0,
    ...over,
  }
}

const tileOf = (p: { x: number; y: number }) => ({
  col: Math.floor(p.x / TILE),
  row: Math.floor(p.y / TILE),
})
const walkable = (p: { x: number; y: number }) => {
  const t = tileOf(p)
  return isWalkable(t.col, t.row)
}

describe('파트너 종류: 팀장 boss, 팀원은 책상과 같은 팀 규칙', () => {
  it('기본 팀(teams.ts)', () => {
    expect(partnerKindOf('main', undefined)).toBe('boss')
    expect(partnerKindOf('a', 'Explore')).toBe('research')
    expect(partnerKindOf('a', 'Plan')).toBe('planning')
    expect(partnerKindOf('a', 'pixel-artist')).toBe('design')
    expect(partnerKindOf('a', 'general-purpose')).toBe('dev')
    expect(partnerKindOf('a', 'plugin:Explore')).toBe('research')
    expect(partnerKindOf('a', 'unknown-kind')).toBe('dev')
    expect(partnerKindOf('a', undefined)).toBe('dev')
  })

  it('직원 설정에서 팀을 바꾸면 파트너도 그 팀 생물(설정 변경 → syncAll 로 다시 배치)', () => {
    let emp: EmployeeSettings = DEFAULT_EMPLOYEE_SETTINGS
    const d = new Director({ now: () => 0, employees: () => emp })
    let state = createInitialState()
    for (const e of [
      ev({ kind: 'session.start' }),
      ev({ kind: 'agent.spawn', agentId: 'x', agentType: 'Explore' }),
    ])
      state = reduce(state, e)
    const kindOf = (out: ReturnType<Director['syncAll']>, id: string) =>
      out.find((c) => c.type === 'place' && c.agentId === id) as { partner?: PartnerKind }
    expect(kindOf(d.syncAll(state, 's'), 'main').partner).toBe('boss')
    expect(kindOf(d.syncAll(state, 's'), 'x').partner).toBe('research')
    emp = { ...DEFAULT_EMPLOYEE_SETTINGS, types: { Explore: { team: 'design' } } }
    expect(toTeamConfig(emp).members.Explore).toBe('design')
    expect(kindOf(d.syncAll(state, 's'), 'x').partner).toBe('design')
  })

  it('등장(spawn) 명령에도 파트너 종류가 실린다', () => {
    const d = new Director({ now: () => 0 })
    let state = createInitialState()
    const spawnOf = (e: OfficeEvent) => {
      state = reduce(state, e)
      return d.handle(e, state.sessions.s).find((c) => c.type === 'spawn')
    }
    expect(spawnOf(ev({ kind: 'session.start' }))).toMatchObject({ partner: 'boss' })
    expect(spawnOf(ev({ kind: 'agent.spawn', agentId: 'p', agentType: 'Plan' }))).toMatchObject({
      partner: 'planning',
    })
  })

  it('tool.end ok → hop, error → surprised (즉시 명령)', () => {
    const d = new Director({ now: () => 0 })
    let state = createInitialState()
    const tool = { name: 'Edit', category: 'edit', useId: 'u' }
    const run = (e: OfficeEvent) => {
      state = reduce(state, e)
      return d.handle(e, state.sessions.s)
    }
    run(ev({ kind: 'session.start' }))
    run(ev({ kind: 'tool.start', tool }))
    expect(run(ev({ kind: 'tool.end', tool, status: 'ok' }))).toContainEqual(
      expect.objectContaining({ type: 'partner', agentId: 'main', reaction: 'hop' }),
    )
    run(ev({ kind: 'tool.start', tool }))
    expect(run(ev({ kind: 'tool.end', tool, status: 'error' }))).toContainEqual(
      expect.objectContaining({ type: 'partner', agentId: 'main', reaction: 'surprised' }),
    )
  })
})

describe('파트너 자리(partnerRestSpot)', () => {
  const seated: SpotId[] = [...SUB_DESKS, 'mainDesk']

  it('책상·팀장 자리: 걸을 수 있는 바닥에 앉고, 주인·다른 주인·가운데 통로와 겹치지 않는다', () => {
    const owners = seated.map((s) => spotPosition(s, 0))
    const rests = seated.map((s) => partnerRestSpot(s, 0))
    for (const [i, r] of rests.entries()) {
      const spot = seated[i] as SpotId
      expect(r.pose, spot).toBe('sit')
      expect(walkable(r), spot).toBe(true)
      // 파트너 몸(폭 8~10px)이 어느 주인(몸 폭 ~12px)과도 겹치지 않는다
      for (const o of owners) {
        if (o.y !== r.y) continue
        expect(Math.abs(o.x - r.x), `${spot} vs owner ${o.x}`).toBeGreaterThanOrEqual(12)
      }
      // 다른 파트너와 겹치지 않는다
      for (const [j, q] of rests.entries()) {
        if (i === j || q.y !== r.y) continue
        expect(Math.abs(q.x - r.x), `${spot} vs ${seated[j]}`).toBeGreaterThanOrEqual(10)
      }
      // 가운데 통로(11~12열) 안쪽으로 4px 넘게 들어가지 않는다(통로를 막지 않음)
      if (spot !== 'mainDesk') {
        expect(r.x + 4 <= 11 * TILE + 4 || r.x - 4 >= 13 * TILE - 4, spot).toBe(true)
      }
    }
  })

  it('팀 책상: 통로 쪽(1번은 의자 바로 옆, 2번은 두 의자 사이)', () => {
    expect(partnerRestSpot('research1', 0).x).toBe(spotPosition('research1', 0).x + 12)
    expect(partnerRestSpot('research2', 0).x).toBe(spotPosition('research2', 0).x + 16)
    expect(partnerRestSpot('planning1', 0).x).toBe(spotPosition('planning1', 0).x - 12)
    expect(partnerRestSpot('planning2', 0).x).toBe(spotPosition('planning2', 0).x - 16)
  })

  it('모든 스팟·슬롯: 파트너 자리가 걸을 수 있는 바닥이다(가구·벽 안이 아님)', () => {
    for (const s of FIXED_SPOTS) {
      for (let slot = 0; slot < SPOTS[s].slots.length; slot++) {
        expect(walkable(partnerRestSpot(s, slot)), `${s}#${slot}`).toBe(true)
      }
    }
  })

  it('소파·회의 테이블은 앉고, 서서 하는 일은 주인 옆에 같은 방향으로 선다', () => {
    expect(partnerRestSpot('sofaSit', 0).pose).toBe('sit')
    expect(partnerRestSpot('sofaLie', 0).pose).toBe('sit')
    expect(partnerRestSpot('sofaSit', 1)).not.toEqual(partnerRestSpot('sofaSit', 0))
    expect(partnerRestSpot('commonTable', 2).pose).toBe('sit')
    const shelf = partnerRestSpot('bookshelf', 0)
    expect(shelf).toMatchObject({ pose: 'idle', dir: SPOTS.bookshelf.face })
    expect(Math.abs(shelf.x - spotPosition('bookshelf', 0).x)).toBe(12)
  })
})

describe('trail', () => {
  it('trailPoint: 주인이 걸어온 길 위에서 dist 뒤', () => {
    const trail = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]
    expect(trailPoint({ x: 20, y: 10 }, trail, 4)).toEqual({ x: 20, y: 6 })
    // 모서리를 돌아서
    expect(trailPoint({ x: 20, y: 10 }, trail, 14)).toEqual({ x: 16, y: 0 })
    // 길이 짧으면 가장 오래된 점
    expect(trailPoint({ x: 20, y: 10 }, trail, 100)).toEqual({ x: 0, y: 0 })
    expect(trailPoint({ x: 5, y: 5 }, [], 14)).toEqual({ x: 5, y: 5 })
  })

  it('trimTrail: keep 보다 오래된 점을 버린다', () => {
    const trail = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 60, y: 0 },
    ]
    // 70 → 60 → 50 = 20px 로 keep(15)을 넘는다 → 50 앞(0)은 버린다. 50 은 남겨야 그 구간을 짚을 수 있다
    trimTrail({ x: 70, y: 0 }, trail, 15)
    expect(trail).toEqual([
      { x: 50, y: 0 },
      { x: 60, y: 0 },
    ])
  })
})

describe('Partner 상태 머신', () => {
  it('canHop: 쿨다운', () => {
    expect(canHop(null, 0)).toBe(true)
    expect(canHop(0, HOP_COOLDOWN_MS - 1)).toBe(false)
    expect(canHop(0, HOP_COOLDOWN_MS)).toBe(true)
  })

  it('배치(place)되면 즉시 책상 옆에 앉고, 깡충은 몇 초에 한 번, 놀람은 매번', () => {
    const v = new FakePartnerView()
    const p = new Partner('research', v)
    const owner = stubOwner({
      ...spotPosition('research1', 0),
      settledAt: { spot: 'research1', slot: 0 },
      teleports: 1,
    })
    p.update(0, owner)
    const r = partnerRestSpot('research1', 0)
    expect([v.x, v.y, v.anim]).toEqual([r.x, r.y, 'sit'])

    p.react('hop')
    expect(p.reacting).toBe('hop')
    p.update(REACTION_MS.hop, owner)
    expect(v.anim).toBe('sit') // 한 번 재생 후 원래 자세
    p.react('hop') // 쿨다운 안 → 무시
    expect(p.reacting).toBeNull()
    p.react('surprised') // 놀람은 쿨다운 없음
    expect(p.reacting).toBe('surprised')
    p.update(HOP_COOLDOWN_MS, owner)
    p.react('hop')
    expect(p.reacting).toBe('hop')
    expect(v.anims.filter((a) => a === 'hop')).toHaveLength(2)
  })

  it('주인이 걸으면 길을 따라 한두 걸음 뒤에서 걷고, 자리 잡으면 파트너 자리로 가서 앉고, 졸면 같이 존다', () => {
    const v = new FakePartnerView()
    const p = new Partner('dev', v)
    const owner = stubOwner({ x: 100, y: 100, teleports: 1 })
    p.update(0, owner) // 등장: 주인 자리(문 밖)
    // 주인이 오른쪽으로 64px/s 로 1초 걷는다
    owner.trail.push({ x: 100, y: 100 })
    const walk = (dx: number, dy: number) => {
      owner.x += dx
      owner.y += dy
      owner.odometer += Math.abs(dx) + Math.abs(dy)
    }
    for (let t = 0; t < 1000; t += 16) {
      walk((64 * 16) / 1000, 0)
      p.update(16, owner)
      if (owner.x - 100 <= TRAIL_PX + 2) continue // 한 걸음 남짓 떨어질 때까지는 제자리
      expect(v.anim).toBe('walk')
      expect(v.dir).toBe('right')
      expect(v.y).toBe(100) // 주인이 걸은 길 위
    }
    const behind = owner.x - (v.x as number)
    expect(behind).toBeCloseTo(TRAIL_PX, 5)

    // 모퉁이를 돌아 아래로: 파트너도 모퉁이까지 간 뒤 아래로(대각선으로 가로지르지 않음)
    owner.trail.push({ x: owner.x, y: owner.y })
    const corner = owner.x
    for (let t = 0; t < 500; t += 16) {
      walk(0, (64 * 16) / 1000)
      p.update(16, owner)
      expect(v.x === corner || v.y === 100, `(${v.x},${v.y})`).toBe(true)
    }

    // dev1 에 도착해 앉음(순간이동 아님 — 파트너가 걸어서 자리로)
    const seat = spotPosition('dev1', 0)
    owner.trail.push({ x: owner.x, y: owner.y })
    walk(seat.x - owner.x, 0)
    owner.trail.push({ x: owner.x, y: owner.y })
    walk(0, seat.y - owner.y)
    owner.settledAt = { spot: 'dev1', slot: 0 }
    for (let t = 0; t < 2000; t += 16) p.update(16, owner)
    const r = partnerRestSpot('dev1', 0)
    expect([v.x, v.y, v.anim]).toEqual([r.x, r.y, 'sit'])

    // 같은 책상에 다시 앉는 몇 px 움직임에는 일어나지 않는다
    owner.settledAt = null
    owner.x = seat.x + 8
    p.update(16, owner)
    expect(v.anim).toBe('sit')
    owner.x = seat.x
    owner.settledAt = { spot: 'dev1', slot: 0 }

    owner.asleep = true
    p.update(16, owner)
    expect(v.anim).toBe('sleep')
  })

  it('주인이 순간이동(따라잡기·다시 배치)하면 같이 옮겨진다', () => {
    const v = new FakePartnerView()
    const p = new Partner('boss', v)
    const owner = stubOwner({ x: 10, y: 10, teleports: 1 })
    p.update(0, owner)
    const at = spotPosition('mainDesk', 0)
    owner.x = at.x
    owner.y = at.y
    owner.settledAt = { spot: 'mainDesk', slot: 0 }
    owner.teleports = 2
    p.update(16, owner)
    const r = partnerRestSpot('mainDesk', 0)
    expect([v.x, v.y, v.anim]).toEqual([r.x, r.y, 'sit'])
  })

  it('주인의 페이드(등장·퇴장)를 따른다', () => {
    const v = new FakePartnerView()
    const p = new Partner('design', v)
    const owner = stubOwner({ alpha: 0, teleports: 1 })
    p.update(0, owner)
    expect(v.alpha).toBe(0)
    owner.alpha = 0.5
    p.update(16, owner)
    expect(v.alpha).toBe(0.5)
  })
})

describe('Roster: 파트너는 주인과 함께 등장·퇴장·제거된다', () => {
  function setup() {
    const partners: FakePartnerView[] = []
    const roster = new Roster(
      () => new NullView(),
      () => {},
      () => {
        const v = new FakePartnerView()
        partners.push(v)
        return v
      },
    )
    return { roster, partners }
  }

  it('syncAll(place) → 파트너가 바로 주인 옆에 맞는 자세로', () => {
    const { roster, partners } = setup()
    let state = createInitialState()
    for (const e of [
      ev({ kind: 'session.start' }),
      ev({ kind: 'agent.spawn', agentId: 'x', agentType: 'Plan' }),
    ])
      state = reduce(state, e)
    const d = new Director({ now: () => 0 })
    roster.dispatch(d.syncAll(state, 's'))
    roster.update(0)
    expect(partners).toHaveLength(2)
    const boss = partnerRestSpot('mainDesk', 0)
    const plan = partnerRestSpot('planning1', 0)
    expect(partners.map((v) => [v.x, v.y, v.anim])).toEqual([
      [boss.x, boss.y, 'sit'],
      [plan.x, plan.y, 'sit'],
    ])
    // 다시 배치하면 옛 파트너는 지워지고 새로 놓인다
    roster.dispatch(d.syncAll(state, 's'))
    expect(partners.slice(0, 2).every((v) => v.destroyed)).toBe(true)
    expect(partners).toHaveLength(4)
  })

  it('퇴근(session.end): 주인을 따라 문으로 나가고 같이 제거된다', () => {
    const { roster, partners } = setup()
    const d = new Director({ now: () => 0 })
    let state = createInitialState()
    const send = (e: OfficeEvent) => {
      state = reduce(state, e)
      roster.dispatch(d.handle(e, state.sessions.s))
    }
    send(ev({ kind: 'session.start' }))
    for (let t = 0; t < 3000; t += 16) roster.update(16)
    const v = partners[0] as FakePartnerView
    expect(v.anim).toBe('sit')
    send(ev({ kind: 'session.end' }))
    let walked = false
    let minDoorDist = Number.POSITIVE_INFINITY
    const door = { x: DOOR_OUTSIDE.col * TILE + TILE / 2, y: DOOR_OUTSIDE.row * TILE + TILE - 2 }
    for (let t = 0; t < 3000 && roster.visibleCount > 0; t += 16) {
      roster.update(16)
      if (v.anim === 'walk') walked = true
      minDoorDist = Math.min(minDoorDist, Math.abs(v.x - door.x) + Math.abs(v.y - door.y))
    }
    expect(roster.visibleCount).toBe(0)
    expect(walked).toBe(true)
    expect(minDoorDist).toBeLessThanOrEqual(TRAIL_PX + 16)
    expect(v.destroyed).toBe(true)
  })
})

describe('샘플 세션: 파트너가 가구·벽 안에 들어가지 않고, 끝나면 모두 제거', () => {
  for (const frameMs of [16, 1000]) {
    it(`${frameMs}ms 프레임`, () => {
      const events = loadSampleSession()
      const t0 = Date.parse(events[0]?.ts ?? '')
      let simNow = 0
      const director = new Director({ now: () => t0 + simNow })
      const partners: FakePartnerView[] = []
      const roster = new Roster(
        () => new NullView(),
        () => {},
        () => {
          const v = new FakePartnerView()
          partners.push(v)
          return v
        },
      )
      const store = createOfficeStore()
      let sessionId: string | null = null
      store.addSceneListener({
        onSnapshot: (s) => roster.dispatch(director.syncAll(s.office, null)),
        onEvent: (e, s) => {
          const r = routeSceneEvent(director, sessionId, e, s)
          sessionId = r.sessionId
          if (r.resynced) roster.clearDeparting()
          roster.dispatch(r.outputs)
        },
      })
      store.applyMessage({
        type: 'snapshot',
        ts: new Date(t0).toISOString(),
        state: createInitialState(),
        recent: [],
      })
      const endAt = Date.parse(events.at(-1)?.ts ?? '') - t0
      const bad: string[] = []
      let next = 0
      for (let t = frameMs; t <= endAt + 4000; t += frameMs) {
        while (next < events.length && Date.parse(events[next]?.ts ?? '') - t0 <= t) {
          const e = events[next++] as OfficeEvent
          simNow = Date.parse(e.ts) - t0
          store.applyMessage({ type: 'event', event: e })
        }
        simNow = t
        roster.update(frameMs)
        for (const v of partners) {
          if (v.destroyed || Number.isNaN(v.x)) continue
          const tile = tileOf(v)
          const outside = tile.col === DOOR_OUTSIDE.col && tile.row >= DOOR_OUTSIDE.row
          // 소파는 주인이 앉는 막힌 타일 — 주인이 소파에서 일어나 걸어가면 그 길(소파 위에서 시작)을 따른다
          const sofa = tile.row === 12 && tile.col >= 3 && tile.col <= 5
          if (!outside && !sofa && !isWalkable(tile.col, tile.row))
            bad.push(`t=${t} (${v.x},${v.y}) tile ${tile.col},${tile.row}`)
        }
      }
      expect(bad.slice(0, 5)).toEqual([])
      expect(partners.length).toBeGreaterThanOrEqual(2)
      expect(partners.every((v) => v.destroyed)).toBe(true)
      // 자세 변경은 상태가 바뀔 때만(프레임마다 다시 그리지 않음)
      const calls = partners.reduce((n, v) => n + v.calls, 0)
      expect(calls).toBeLessThan(400)
    })
  }
})

describe('partners.json 대조', () => {
  const path = fileURLToPath(new URL('../public/assets/partners.json', import.meta.url))
  const json = JSON.parse(readFileSync(path, 'utf8')) as {
    animations: Record<string, string[]>
    meta: {
      kinds: string[]
      frameMs: Record<string, number>
      once: string[]
      downOnly: string[]
    }
  }

  it('씬이 쓰는 모든 키가 시트에 있다', () => {
    expect(missingPartnerKeys(json.animations)).toEqual([])
    expect([...json.meta.kinds].sort()).toEqual(
      ['boss', 'design', 'dev', 'planning', 'research'].sort(),
    )
  })

  it('meta(once·downOnly·frameMs)와 코드 상수가 같다', () => {
    expect([...json.meta.once].sort()).toEqual([...PARTNER_ONCE].sort())
    expect([...json.meta.downOnly].sort()).toEqual([...PARTNER_DOWN_ONLY].sort())
    expect(json.meta.frameMs).toEqual(PARTNER_FRAME_MS)
    for (const r of ['hop', 'surprised'] as const) {
      const frames = json.animations[partnerAnimKey('boss', r, 'down')]?.length ?? 0
      expect(REACTION_MS[r], r).toBe(frames * (json.meta.frameMs[r] ?? 0))
    }
  })

  it('한 번 재생 동작은 마지막 프레임에서 멈추고, 반복 동작은 돈다', () => {
    const atlas = { animations: json.animations, frameMs: json.meta.frameMs }
    const hop = json.animations.pet_dev_hop_down ?? []
    expect(pickPartnerFrame(atlas, 'dev', 'hop', 'left', 99_999)).toBe(hop.at(-1))
    const walk = json.animations.pet_dev_walk_left ?? []
    expect(pickPartnerFrame(atlas, 'dev', 'walk', 'left', 140 * walk.length)).toBe(walk[0])
    // down 만 있는 동작은 방향과 무관하게 _down
    expect(partnerAnimKey('boss', 'sit', 'up')).toBe('pet_boss_sit_down')
  })
})
