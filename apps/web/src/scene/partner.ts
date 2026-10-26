import { MAIN_AGENT_ID } from '@claude-office/shared'
import { type Dir, isWalkable, SPOTS, type SpotId, SUB_DESKS, spotPosition, TILE } from './layout'
import type { PartnerView } from './render/types'
import { DEFAULT_TEAM_CONFIG, type TeamConfig, type TeamId, teamOf } from './teams'

/*
 * 파트너 몬스터(기획서 4절 "파트너 몬스터"). PixiJS 비의존 — 그리기는 PartnerView 에 위임.
 *
 * 캐릭터마다 한 마리. 팀장 → boss, 팀원 → 자기 팀(책상 배정과 같은 팀 규칙: 직원 설정 + teams.ts).
 * 주인(Character)의 상태를 매 프레임 읽어 따라간다. 서버 상태와 따로 쌓는 것이 없다 —
 * 주인이 순간이동(syncAll·따라잡기)하면 같이 그 자리 옆으로 옮겨진다.
 *
 *  follow : 주인이 걸어온 길(trail)을 TRAIL_PX 만큼 뒤에서 따라 걷는다(가구를 뚫지 않는다).
 *  rest   : 주인이 스팟에 자리 잡으면 그 스팟의 "파트너 자리"(partnerRestSpot)로 가서
 *           앉거나(책상·소파·회의 테이블) 서 있는다. 주인이 졸면 sleep.
 *           주인이 FOLLOW_START_PX 넘게 멀어질 때까지는 rest 를 유지한다(같은 책상으로 다시 앉는
 *           몇 px 짜리 움직임에 일어나지 않게).
 *  반응   : tool.end ok → hop(HOP_COOLDOWN_MS 에 한 번), error → surprised. 멈춰 있을 때만 한 번 재생.
 */

export type PartnerKind = TeamId | 'boss'
export const PARTNER_KINDS: readonly PartnerKind[] = [
  'research',
  'planning',
  'design',
  'dev',
  'boss',
]

/** 파트너 시트(partners.json)의 애니메이션 이름 — pixel-artist 요약 "애니메이션" 표 */
export const PARTNER_ANIMS = ['walk', 'idle', 'sit', 'hop', 'surprised', 'sleep'] as const
export type PartnerAnim = (typeof PARTNER_ANIMS)[number]
export type PartnerReaction = 'hop' | 'surprised'

/** 주인 뒤 거리(주인이 걸어온 길 위, px). 캐릭터 한 걸음 ≈ 한 타일 → 한 걸음 남짓 */
export const TRAIL_PX = 14
/** 주인이 쉬던 자리에서 이만큼 넘게 멀어지면 따라나선다 */
export const FOLLOW_START_PX = 12
/** 깡충은 이 간격에 한 번만(도구가 몇 초에 여러 번 끝나도 산만하지 않게) */
export const HOP_COOLDOWN_MS = 3000
/** 한 번 재생 동작 길이 = 프레임 수 × meta.frameMs (test/partner.test.ts 가 partners.json 과 대조) */
export const REACTION_MS: Readonly<Record<PartnerReaction, number>> = {
  hop: 4 * 110,
  surprised: 2 * 160,
}
/** 쫓아가는 속도: max(최소, 남은 거리 × 배수) px/s — 멀면 빨리, 가까우면 천천히 붙는다 */
export const CHASE_MIN_SPEED = 80
export const CHASE_GAIN = 12
/** 주인 trail 을 이만큼(px)만 기억한다(파트너가 이보다 더 뒤처지면 그만큼 건너뛴다) */
export const TRAIL_KEEP_PX = 200

const STEP_MS = 50

export interface Point {
  x: number
  y: number
}

/** 팀장 → boss, 팀원 → 자기 팀 생물 (assignDesk 와 같은 teamOf + 팀 구성) */
export function partnerKindOf(
  agentId: string,
  agentType: string | undefined,
  teams: TeamConfig = DEFAULT_TEAM_CONFIG,
): PartnerKind {
  return agentId === MAIN_AGENT_ID ? 'boss' : teamOf(agentType, teams)
}

/** 깡충 쿨다운 */
export function canHop(lastHopAt: number | null, now: number): boolean {
  return lastHopAt === null || now - lastHopAt >= HOP_COOLDOWN_MS
}

export interface PartnerRest {
  x: number
  y: number
  pose: 'sit' | 'idle'
  dir: Dir
}

/** 업무 공간 가운데 통로의 x (11~12열 경계) */
const AISLE_X = 12 * TILE
/** 팀장 자리 오른쪽(큰 책상 48px 밖, 지구본 앞 빈 바닥) */
const BOSS_SIDE_DX = 30

/**
 * 주인이 spot(slot)에 자리 잡았을 때 파트너 자리. 순수 함수 — test/partner.test.ts 가
 * 가구·벽·다른 파트너와 겹치지 않는지 확인한다.
 * - 팀 책상: 의자 옆 바닥, 통로 쪽. 1번 자리(통로 쪽)는 의자 바로 옆(12px), 2번 자리는 두 의자 사이(16px).
 * - 팀장 자리: 큰 책상 오른쪽 바닥.
 * - 회의 테이블: 주인 오른쪽 아래(테이블 반대편 바닥).
 * - 소파: 소파 왼쪽 바닥(앉은 사람 2명이면 하나 더 왼쪽).
 * - 그 밖(서서 하는 일): 주인 옆 12px(슬롯이 왼쪽이면 왼쪽, 그 자리가 막혀 있으면 반대쪽)에 같은 방향으로 선다.
 */
export function partnerRestSpot(spot: SpotId, slot: number): PartnerRest {
  const p = spotPosition(spot, slot)
  if (SUB_DESKS.includes(spot)) {
    const toward = p.x < AISLE_X ? 1 : -1
    const dx = spot.endsWith('1') ? 12 : 16
    return { x: p.x + toward * dx, y: p.y, pose: 'sit', dir: 'down' }
  }
  switch (spot) {
    case 'mainDesk':
      return { x: p.x + BOSS_SIDE_DX, y: p.y, pose: 'sit', dir: 'down' }
    case 'commonTable':
      return { x: p.x + 7, y: p.y + 14, pose: 'sit', dir: 'down' }
    case 'sofaSit':
    case 'sofaLie': {
      const row = 12
      const col = spot === 'sofaSit' && slot > 0 ? 1 : 2
      return { x: col * TILE + TILE / 2, y: row * TILE + TILE - 2, pose: 'sit', dir: 'down' }
    }
    default: {
      const off = SPOTS[spot].slots[Math.min(Math.max(slot, 0), SPOTS[spot].slots.length - 1)]
      const first = (off?.[0] ?? 0) < 0 ? -1 : 1
      // 1px 아래 = 주인보다 살짝 앞(깊이 정렬). 스팟 타일 행 밖(door 아래 벽)으로는 넘어가지 않는다
      const y = Math.min(p.y + 1, SPOTS[spot].tile.row * TILE + TILE - 1)
      const free = (x: number) => isWalkable(Math.floor(x / TILE), Math.floor(y / TILE))
      const side = free(p.x + first * 12) ? first : -first
      return { x: p.x + side * 12, y, pose: 'idle', dir: SPOTS[spot].face }
    }
  }
}

/**
 * 주인이 걸어온 길(trail: 오래된 것 → 최근, 마지막 다음이 head=주인 현재 위치)에서
 * head 로부터 dist 만큼 뒤의 점. 길이 짧으면 가장 오래된 점.
 */
export function trailPoint(head: Point, trail: readonly Point[], dist: number): Point {
  let rest = dist
  let cur = head
  for (let i = trail.length - 1; i >= 0; i--) {
    const prev = trail[i] as Point
    const len = Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y)
    if (len >= rest && len > 0) {
      const t = rest / len
      return { x: cur.x + (prev.x - cur.x) * t, y: cur.y + (prev.y - cur.y) * t }
    }
    rest -= len
    cur = prev
  }
  return { x: cur.x, y: cur.y }
}

/** head 로부터 keep px 보다 오래된 점을 버린다(제자리에서 잘라 낸다) */
export function trimTrail(head: Point, trail: Point[], keep: number): void {
  let total = 0
  let cur = head
  for (let i = trail.length - 1; i >= 0; i--) {
    const prev = trail[i] as Point
    total += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y)
    if (total > keep) {
      trail.splice(0, i)
      return
    }
    cur = prev
  }
}

/** Partner 가 주인에게서 읽는 것(Character 가 구현) */
export interface PartnerOwner {
  readonly x: number
  readonly y: number
  /** 주인이 걸어온 길(오래된 것 → 최근). 현재 위치는 포함하지 않는다 */
  readonly trail: readonly Point[]
  /** 스팟에 도착해 자리 잡았으면 그 스팟, 걷는 중·퇴장 중이면 null */
  readonly settledAt: { spot: SpotId; slot: number } | null
  /** 머리 위 Zzz */
  readonly asleep: boolean
  /** 등장·퇴장 페이드(0..1) */
  readonly alpha: number
  /** 순간이동(배치·따라잡기·등장) 횟수 — 바뀌면 파트너도 즉시 옮긴다 */
  readonly teleports: number
  /** 지금까지 걸은 거리(px, 순간이동 제외) — 파트너가 길 위에서 얼마나 뒤에 있는지 센다 */
  readonly odometer: number
}

export class Partner {
  readonly kind: PartnerKind
  x = Number.NaN
  y = Number.NaN
  dir: Dir = 'down'
  anim: PartnerAnim = 'idle'
  mode: 'follow' | 'rest' = 'follow'

  private readonly view: PartnerView
  private clock = 0
  private seenTeleports = -1
  /** rest 로 들어갈 때 주인 위치 */
  private anchor: Point = { x: 0, y: 0 }
  private lastSettled: { spot: SpotId; slot: number } | null = null
  private reaction: { kind: PartnerReaction; until: number } | null = null
  private lastHopAt: number | null = null
  private alpha = -1
  /** 주인 odometer (지난 조각) */
  private lastOdo = 0
  /** rest 로 들어갈 때 주인 odometer */
  private anchorOdo = 0
  /** follow: 주인 길 위에서 뒤처진 거리(px) */
  private lag = TRAIL_PX
  /** follow: 길 위에 올라탔는가(아니면 길의 그 점까지 곧장 간다) */
  private onTrail = true

  constructor(kind: PartnerKind, view: PartnerView) {
    this.kind = kind
    this.view = view
    view.setAnimation(this.anim, this.dir)
  }

  /** 지금 재생 중인 반응(테스트용) */
  get reacting(): PartnerReaction | null {
    return this.reaction?.kind ?? null
  }

  /** tool.end 반응. 걷는 중이면 버리고, 깡충은 쿨다운 안이면 버린다 */
  react(r: PartnerReaction): void {
    if (Number.isNaN(this.x) || this.anim === 'walk') return
    if (r === 'hop') {
      if (!canHop(this.lastHopAt, this.clock)) return
      this.lastHopAt = this.clock
    }
    this.reaction = { kind: r, until: this.clock + REACTION_MS[r] }
    this.setAnim(r, 'down')
  }

  update(dtMs: number, owner: PartnerOwner): void {
    let rest = Math.max(0, dtMs)
    do {
      const step = Math.min(rest, STEP_MS)
      rest -= step
      this.step(step, owner)
    } while (rest > 0)
    if (this.alpha !== owner.alpha) {
      this.alpha = owner.alpha
      this.view.setAlpha(owner.alpha)
    }
    this.view.setPosition(this.x, this.y)
    this.view.tick(dtMs)
  }

  destroy(): void {
    this.view.destroy()
  }

  // -------------------------------------------------------------------------

  /** 한 조각 진행. 움직였으면 true */
  private step(dtMs: number, owner: PartnerOwner): boolean {
    this.clock += dtMs
    if (this.reaction !== null && this.clock >= this.reaction.until) this.reaction = null
    if (owner.settledAt !== null) this.lastSettled = owner.settledAt
    const walked = Math.max(0, owner.odometer - this.lastOdo)
    this.lastOdo = owner.odometer

    if (owner.teleports !== this.seenTeleports) {
      this.seenTeleports = owner.teleports
      this.snap(owner)
      return false
    }
    if (this.mode === 'rest') {
      if (owner.settledAt !== null) {
        // 자리 잡은 동안은 기준점을 갱신(같은 책상에 다시 앉는 몇 px 움직임을 흡수)
        this.anchor = { x: owner.x, y: owner.y }
        this.anchorOdo = owner.odometer
      } else if (dist(owner, this.anchor) > FOLLOW_START_PX) {
        // 따라나선다: 먼저 주인이 떠난 자리(길의 시작)까지 가서 길에 올라탄다
        this.mode = 'follow'
        this.onTrail = false
        this.lag = Math.min(owner.odometer - this.anchorOdo, TRAIL_KEEP_PX - 1)
      }
    } else if (owner.settledAt !== null) {
      this.mode = 'rest'
      this.anchor = { x: owner.x, y: owner.y }
      this.anchorOdo = owner.odometer
    }

    let moved: boolean
    let restAt: PartnerRest | null = null
    if (this.mode === 'rest') {
      restAt = this.restSpot()
      moved = restAt !== null && this.chase(restAt, dtMs)
    } else {
      moved = this.follow(owner, walked, dtMs)
    }
    if (moved) {
      this.reaction = null
      return true
    }
    if (this.reaction !== null) return false
    if (restAt !== null) {
      if (owner.asleep) this.setAnim('sleep', 'down')
      else this.setAnim(restAt.pose, restAt.dir)
    } else if (this.anim === 'walk') {
      this.setAnim('idle', this.dir)
    }
    return false
  }

  /**
   * 주인이 걸어온 길 위에서 lag px 뒤를 걷는다. 주인이 걸은 만큼 lag 가 늘고, 파트너는
   * 쫓아가는 속도로 lag 를 TRAIL_PX 까지 줄인다. 길에 오르기 전(따라나선 직후)에는 길의 그 점까지 곧장 간다.
   */
  private follow(owner: PartnerOwner, walked: number, dtMs: number): boolean {
    this.lag = Math.min(this.lag + walked, TRAIL_KEEP_PX - 1)
    if (!this.onTrail) {
      const goal = trailPoint(owner, owner.trail, this.lag)
      if (this.chase(goal, dtMs)) return true
      this.onTrail = true
    }
    const over = this.lag - TRAIL_PX
    if (over > 0) {
      const advance = (Math.max(CHASE_MIN_SPEED, over * CHASE_GAIN) * dtMs) / 1000
      this.lag = Math.max(TRAIL_PX, this.lag - advance)
    }
    const p = trailPoint(owner, owner.trail, this.lag)
    const dx = p.x - this.x
    const dy = p.y - this.y
    this.x = p.x
    this.y = p.y
    if (Math.abs(dx) + Math.abs(dy) < 1e-3) return false
    const dir: Dir =
      Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'
    this.setAnim('walk', dir)
    return true
  }

  private restSpot(): PartnerRest | null {
    const s = this.lastSettled
    return s === null ? null : partnerRestSpot(s.spot, s.slot)
  }

  /** 순간이동한 주인 옆으로 즉시 */
  private snap(owner: PartnerOwner): void {
    this.reaction = null
    if (owner.settledAt !== null) {
      this.mode = 'rest'
      this.anchor = { x: owner.x, y: owner.y }
      this.anchorOdo = owner.odometer
      const r = partnerRestSpot(owner.settledAt.spot, owner.settledAt.slot)
      this.x = r.x
      this.y = r.y
      if (owner.asleep) this.setAnim('sleep', 'down')
      else this.setAnim(r.pose, r.dir)
      return
    }
    this.mode = 'follow'
    this.onTrail = true
    this.lag = TRAIL_PX
    this.x = owner.x
    this.y = owner.y
    this.setAnim('idle', this.dir)
  }

  /**
   * goal 쪽으로 축 정렬 이동. 두 모서리 중 걸을 수 있는 쪽으로 돈다(가구 모서리를 가로지르지 않게).
   * 움직였으면 true
   */
  private chase(goal: Point, dtMs: number): boolean {
    const d = dist(this, goal)
    if (d < 0.5) {
      this.x = goal.x
      this.y = goal.y
      return false
    }
    let budget = (Math.max(CHASE_MIN_SPEED, d * CHASE_GAIN) * dtMs) / 1000
    let dir = this.dir
    const xFirst = walkableAt(goal.x, this.y) || !walkableAt(this.x, goal.y)
    while (budget > 0) {
      const dx = goal.x - this.x
      const dy = goal.y - this.y
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) break
      if (Math.abs(dy) < 1e-6 || (xFirst && Math.abs(dx) >= 1e-6)) {
        const s = Math.min(Math.abs(dx), budget)
        this.x += Math.sign(dx) * s
        budget -= s
        dir = dx < 0 ? 'left' : 'right'
      } else {
        const s = Math.min(Math.abs(dy), budget)
        this.y += Math.sign(dy) * s
        budget -= s
        dir = dy < 0 ? 'up' : 'down'
      }
    }
    this.setAnim('walk', dir)
    return true
  }

  private setAnim(anim: PartnerAnim, dir: Dir): void {
    if (anim === this.anim && dir === this.dir) return
    this.anim = anim
    this.dir = dir
    this.view.setAnimation(anim, dir)
  }
}

function dist(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function walkableAt(x: number, y: number): boolean {
  return isWalkable(Math.floor(x / TILE), Math.floor(y / TILE))
}
