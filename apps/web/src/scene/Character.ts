import { type AnimName, type Mark, SPEECH_MS } from './activityMap'
import { CommandQueue, type QueuedCommand } from './commandQueue'
import type { CharacterCommand } from './commands'
import {
  COLS,
  type Dir,
  DOOR_OUTSIDE,
  ROWS,
  SPOTS,
  type SpotId,
  spotPosition,
  TILE,
  type TilePos,
  tileFoot,
} from './layout'
import { type Partner, type PartnerOwner, type Point, TRAIL_KEEP_PX, trimTrail } from './partner'
import { findPath } from './pathfinding'
import type { CharacterView } from './render/types'

/*
 * 캐릭터 상태 머신 (PixiJS 비의존 — 그리기는 CharacterView 에 위임).
 *
 *   spawning(문에서 등장) → walking(목표 스팟) → acting(행동 애니메이션 루프)
 *         ↑                    ↓ 새 명령                 ↓ 다음 명령 / 시간 경과
 *         └──────────────── idle(자기 책상 or 커피머신) ◀──┘
 *   leaving(문으로 이동 후 제거) → gone
 */

export type CharacterState = 'spawning' | 'walking' | 'acting' | 'idle' | 'leaving' | 'gone'

/*
 * 시간 규칙 — 씬은 서버 상태의 투영이므로 화면이 실제보다 몇 초 이상 뒤처지면 안 된다.
 * (activity-mapping.md "화면 지연 규칙"과 같은 값)
 * - 걷기 기본 속도는 WALK_SPEED 이지만 경로 하나는 MAX_WALK_MS 안에 끝나도록 속도를 올린다.
 * - 뒤에 명령이 쌓여 있으면 FAST_WALK_MULTIPLIER 배(= MAX_WALK_MS / 2 안에 도착).
 * - 가장 오래 기다린 명령이 MAX_LAG_MS 를 넘기면 현재 명령을 목적지로 순간이동시키고
 *   중간 명령을 버린다(마지막 목표·spawn·leave 는 보존).
 * - leave 는 LEAVE_MAX_MS 안에 반드시 gone. 예외: 서브 완료 보고(report)는 3초 머물기 때문에
 *   LEAVE_REPORT_MAX_MS(기획서 2절 "과장 수준" 예외). 머무는 중 조명이 꺼지면(세션 종료)
 *   hurryLeave() 로 머묾을 끊고 그때부터 LEAVE_MAX_MS 안에 gone.
 * - update(dt) 는 큰 dt(탭 백그라운드, 낮은 fps)도 STEP_MS 조각으로 나눠 그대로 소비한다
 *   (dt 를 잘라 버리면 화면이 슬로모션이 되어 계속 뒤처진다).
 */

/** 걷기 기본 속도(기준 해상도 px/s) */
export const WALK_SPEED = 64
export const FAST_WALK_MULTIPLIER = 2
/** 경로 하나를 걷는 최대 시간 */
export const MAX_WALK_MS = 1200
/** 대기 명령이 이 시간 넘게 밀리면 따라잡기(순간이동 + 중간 명령 스킵) */
export const MAX_LAG_MS = 1500
/** leave 시작 후 이 시간 안에 반드시 제거(report 제외) */
export const LEAVE_MAX_MS = 2000
/** 도착 후 다음 명령으로 넘어가기 전 최소 머무는 시간 — 행동이 한 번은 보이도록 */
export const MIN_DWELL_MS = 350
/**
 * style 있는 퇴장(세션 종료 "퇴근하겠습니다!", 서브 완료 퇴근 인사):
 * 준비 동작 LEAVE_PREP_MS → (report 만) 그 자리에 REPORT_LINGER_MS 머묾
 * → 정해진 시간 LEAVE_WALK_MS 동안 걸어 나감 → 페이드 FADE_MS.
 * - pack:   0.4 + 1.1 + 0.3 = 1.8초 < LEAVE_MAX_MS(2초)
 * - report: 0.4 + 3.0 + 1.1 + 0.3 = 4.8초 < LEAVE_REPORT_MAX_MS(5초)
 * 퇴장 대사는 사라질 때까지 유지(pack 약 1.8초, report 약 4.8초).
 */
export const LEAVE_PREP_MS = 400
/** 서브 완료 보고 뒤 문으로 나가기 전 그 자리에 머무는 시간(기획서 5절 "서브에이전트 완료") */
export const REPORT_LINGER_MS = 3000
/**
 * 대사를 띄우는 제자리 행동(멈칫·잠깐 일어남)이 뒤에 도구 명령이 와서 끊기기 전 최소 시간.
 * 도구 말풍선 우선(기획서 6절)이지만 "앗…" 이 읽히기는 해야 한다 — 도구 말풍선 지연은 이만큼(<2초 예산).
 */
export const DIALOG_MIN_MS = 600
export const LEAVE_WALK_MS = 1100
export const FADE_MS = 300
/** report 퇴장 시작 후 이 시간 안에 반드시 제거(4.8초 + 여유 0.2초) */
export const LEAVE_REPORT_MAX_MS = 5000
/** update 한 번에 진행하는 최대 시간 조각 */
const STEP_MS = 50

const IDLE_ANIMS: ReadonlySet<AnimName> = new Set([
  'idle_sit',
  'idle_stand',
  'idle_drink',
  'sofa_sit',
  'sofa_lie',
  'sleep',
])

export class Character implements PartnerOwner {
  readonly agentId: string
  state: CharacterState = 'idle'
  x = 0
  y = 0
  dir: Dir = 'down'

  private readonly view: CharacterView
  private readonly queue = new CommandQueue()
  private current: QueuedCommand | null = null
  private path: Point[] = []
  private waitMs = 0
  private fade = 1
  private fadeDir: 1 | -1 | 0 = 0
  private persistentMark: Mark | null = null
  private tempMarkMs = 0
  /** 이 캐릭터의 누적 시계(ms) — 큐 대기 시간 계산용 */
  private clock = 0
  /** 현재 경로의 걷기 속도(px/s) */
  private walkSpeed = WALK_SPEED
  private leaveDeadline = Number.POSITIVE_INFINITY
  private bubbleText: string | null = null
  /** 지금 말풍선이 대사인가(도구 말풍선이 아니라) — 대사는 speechMs 뒤 사라진다 */
  private speech = false
  private speechMs = 0
  /** 현재 act 가 진행된 시간(끊을 수 있는 act 용) */
  private actMs = 0
  /** style 있는 leave 의 단계 */
  private leavePhase: 'prep' | 'linger' | 'walk' | 'fade' | null = null
  private _lastCause: string | null = null
  /** 파트너 몬스터(PartnerOwner 로 이 캐릭터를 읽는다). 주인과 함께 등장·퇴장·제거 */
  private partner: Partner | null = null
  /** 걸어온 길(파트너가 따라 걷는다). 오래된 것 → 최근, 현재 위치 제외 */
  readonly trail: Point[] = []
  /** 스팟에 도착해 자리 잡았으면 그 스팟(걷는 중·퇴장 중 null) */
  settledAt: { spot: SpotId; slot: number } | null = null
  /** 순간이동(spawn·place·따라잡기) 횟수 */
  teleports = 0
  /** 걸은 거리 누계(px, 순간이동 제외) */
  odometer = 0

  constructor(agentId: string, view: CharacterView) {
    this.agentId = agentId
    this.view = view
  }

  /** 파트너 몬스터를 붙인다(Roster) */
  attachPartner(p: Partner): void {
    this.partner?.destroy()
    this.partner = p
  }

  /** 붙은 파트너(테스트용) */
  get partnerOf(): Partner | null {
    return this.partner
  }

  /** 머리 위 Zzz 가 떠 있는가(파트너도 같이 존다) */
  get asleep(): boolean {
    return this.persistentMark === 'sleep'
  }

  /** 등장·퇴장 페이드 값(0..1) */
  get alpha(): number {
    return this.fade
  }

  get queued(): number {
    return this.queue.length
  }

  get isGone(): boolean {
    return this.state === 'gone'
  }

  /** 마지막으로 시작한(화면에 반영되기 시작한) 명령의 cause — 테스트·디버깅용 */
  get lastCause(): string | null {
    return this._lastCause
  }

  /** 현재 말풍선 텍스트 */
  get bubble(): string | null {
    return this.bubbleText
  }

  setHighlight(on: boolean): void {
    this.view.setHighlight(on)
  }

  /** director 명령 수신. mark·label 은 즉시, 나머지는 큐로 */
  enqueue(cmd: CharacterCommand): void {
    if (cmd.type === 'mark') {
      this.applyMark(cmd.mark, cmd.durationMs)
      return
    }
    if (cmd.type === 'label') {
      this.view.setLabel(cmd.label)
      return
    }
    if (cmd.type === 'partner') {
      this.partner?.react(cmd.reaction)
      return
    }
    if (cmd.type === 'place' || cmd.type === 'remove') {
      // 즉시 명령: 큐를 비우고 바로 적용(syncAll)
      this.queue.clear()
      this.current = null
      this.path = []
      this.start(cmd)
      return
    }
    this.queue.push(cmd, this.clock)
  }

  /** dtMs = 실제 경과 시간. 크더라도 잘라 버리지 않고 STEP_MS 조각으로 모두 소비한다. */
  update(dtMs: number): void {
    if (this.state === 'gone') return
    let rest = Math.max(0, dtMs)
    do {
      const step = Math.min(rest, STEP_MS)
      rest -= step
      this.step(step)
    } while (rest > 0 && !this.isGone)
    if (this.isGone) return
    this.view.setPosition(this.x, this.y)
    this.view.tick(dtMs)
    this.partner?.update(dtMs, this)
  }

  private step(dtMs: number): void {
    this.clock += dtMs
    this.updateMark(dtMs)
    this.updateFade(dtMs)
    this.updateSpeech(dtMs)

    if (this.state === 'leaving' && this.clock >= this.leaveDeadline) {
      this.state = 'gone'
      this.view.setAlpha(0)
      return
    }

    // 밀렸으면 따라잡는다
    const oldest = this.queue.oldestAt()
    if (oldest !== null && this.clock - oldest > MAX_LAG_MS) {
      this.catchUp()
      if (this.isGone) return
    }

    if (this.path.length > 0) {
      this.walk(dtMs)
    } else if (this.waitMs > 0) {
      this.waitMs -= dtMs
      if (this.current?.type === 'act') {
        this.actMs += dtMs
        // 대사 행동(멈칫·잠깐 일어남)은 뒤에 진짜 명령이 오면 끊는다 — 도구 말풍선 우선
        if (
          this.current.interruptible === true &&
          this.actMs >= DIALOG_MIN_MS &&
          this.queue.peekAll().some((c) => !(c.type === 'moveTo' && c.soft))
        ) {
          this.waitMs = 0
        }
      }
    }

    // 현재 명령이 끝났으면 다음 명령
    if (this.ready() && this.current !== null) {
      this.finish(this.current)
      if (this.isGone) return
    }
    if (this.ready() && this.current === null) {
      const next = this.queue.shift()
      if (next !== undefined) this.start(next)
    }
  }

  /** 현재 명령을 즉시 끝내고(목적지로 순간이동) 중간 명령을 버린다 */
  private catchUp(): void {
    const cur = this.current
    const end = this.path.at(-1)
    if (end !== undefined) {
      this.x = end.x
      this.y = end.y
      this.teleport()
    }
    this.path = []
    this.waitMs = 0
    if (this.fadeDir !== 0) {
      this.fade = this.fadeDir > 0 ? 1 : 0
      this.fadeDir = 0
      this.view.setAlpha(this.fade)
    }
    if (cur !== null) {
      if (cur.type === 'leave') {
        this.state = 'gone'
        this.view.setAlpha(0)
        return
      }
      this.finish(cur)
    }
    this.waitMs = 0
    this.queue.compactToLast(this.clock)
  }

  /** 보고 후 머무는 중이면 머묾을 끊고 바로 문으로(세션 종료 — 조명 끄기가 기다리지 않도록) */
  hurryLeave(): void {
    if (this.state !== 'leaving') return
    this.leaveDeadline = Math.min(this.leaveDeadline, this.clock + LEAVE_MAX_MS)
    if (this.leavePhase === 'linger') this.waitMs = 0
  }

  destroy(): void {
    this.partner?.destroy()
    this.partner = null
    this.view.destroy()
  }

  /** 위치를 건너뛰었다 — 걸어온 길을 지우고 파트너도 옮기게 한다 */
  private teleport(): void {
    this.trail.length = 0
    this.teleports++
  }

  // -------------------------------------------------------------------------

  /** 이동·대기·페이드가 모두 끝났는가 */
  private ready(): boolean {
    return this.path.length === 0 && this.waitMs <= 0 && this.fadeDir === 0
  }

  private start(cmd: QueuedCommand): void {
    this.current = cmd
    this.waitMs = 0
    this._lastCause = cmd.cause
    switch (cmd.type) {
      case 'spawn': {
        const p = tileFoot(DOOR_OUTSIDE)
        this.x = p.x
        this.y = p.y
        this.teleport()
        this.settledAt = null
        this.dir = 'up'
        this.state = 'spawning'
        this.view.setLabel(cmd.label)
        this.view.setAnimation('walk', 'up')
        if (cmd.say) this.say(cmd.say, SPEECH_MS)
        this.fade = 0
        this.fadeDir = 1
        this.view.setAlpha(0)
        break
      }
      case 'place': {
        const p = spotPosition(cmd.spot, cmd.slot)
        this.x = p.x
        this.y = p.y
        this.teleport()
        this.settledAt = { spot: cmd.spot, slot: cmd.slot }
        this.dir = SPOTS[cmd.spot].face
        this.view.setLabel(cmd.label)
        this.speech = false
        this.setBubble(cmd.bubble)
        this.view.setEffect(null)
        this.view.setAnimation(cmd.anim, this.dir)
        this.fade = 1
        this.fadeDir = 0
        this.view.setAlpha(1)
        this.persistentMark = cmd.mark
        this.tempMarkMs = 0
        this.view.setMark(cmd.mark)
        this.state = IDLE_ANIMS.has(cmd.anim) ? 'idle' : 'acting'
        this.current = null
        break
      }
      case 'moveTo': {
        this.settledAt = null
        this.showTool(cmd.bubble)
        this.view.setEffect(null)
        this.setPathTo(SPOTS[cmd.spot].tile, spotPosition(cmd.spot, cmd.slot))
        this.state = 'walking'
        break
      }
      case 'act':
        // 제자리 행동(오류 직후·손 들기) 중에는 진행 중인 도구가 없다 → 도구 말풍선 끔.
        // brief 도구(전화 걸기)는 도구가 진행 중이므로 그 말풍선을 유지한다
        this.showTool(cmd.bubble ?? null)
        if (cmd.say) this.say(cmd.say, SPEECH_MS)
        this.view.setEffect(null)
        this.view.setAnimation(cmd.anim, this.dir)
        this.state = IDLE_ANIMS.has(cmd.anim) ? 'idle' : 'acting'
        this.waitMs = cmd.durationMs ?? 0
        this.actMs = 0
        break
      case 'leave':
        this.settledAt = null
        this.showTool(null)
        // 퇴장 대사는 사라질 때까지 유지
        if (cmd.say) this.say(cmd.say, null)
        this.view.setEffect(null)
        this.state = 'leaving'
        this.leaveDeadline =
          this.clock + (cmd.style === 'report' ? LEAVE_REPORT_MAX_MS : LEAVE_MAX_MS)
        if (cmd.style === 'pack' || cmd.style === 'report') {
          this.leavePhase = 'prep'
          if (cmd.style === 'report') this.dir = this.dirToward(SPOTS.mainDesk.tile)
          this.view.setAnimation(cmd.style, this.dir)
          this.waitMs = LEAVE_PREP_MS
        } else {
          this.leavePhase = null
          this.setPathTo(DOOR_OUTSIDE, tileFoot(DOOR_OUTSIDE))
        }
        break
      case 'remove':
        this.state = 'gone'
        this.current = null
        break
    }
  }

  /** 현재 명령 완료 처리(도착 등) */
  private finish(cmd: QueuedCommand): void {
    this.current = null
    switch (cmd.type) {
      case 'spawn':
        this.state = 'walking'
        break
      case 'moveTo':
        this.settledAt = { spot: cmd.spot, slot: cmd.slot }
        this.dir = SPOTS[cmd.spot].face
        this.view.setAnimation(cmd.anim, this.dir)
        this.view.setEffect(cmd.effect)
        if (cmd.say) this.say(cmd.say, SPEECH_MS)
        this.state = IDLE_ANIMS.has(cmd.anim) ? 'idle' : 'acting'
        // 다음 명령이 있으면 행동이 한 번은 보이도록 잠시 머문다
        if (this.queue.length > 0) this.waitMs = MIN_DWELL_MS
        break
      case 'leave':
        if (this.leavePhase === 'prep' && cmd.style === 'report') {
          // 보고 끝 → 그 자리에 서서(팀장 쪽을 본 채) 머문다. 대사는 계속 떠 있다.
          this.leavePhase = 'linger'
          this.view.setAnimation('idle_stand', this.dir)
          this.waitMs = REPORT_LINGER_MS
          this.current = cmd
          return
        }
        if (this.leavePhase === 'prep' || this.leavePhase === 'linger') {
          // 준비 동작(·머묾) 끝 → 정해진 시간 동안 문으로 (짐 챙긴 경우 가방을 들고)
          this.leavePhase = 'walk'
          if (cmd.style === 'pack') this.view.setEffect('bag')
          this.setPathTo(DOOR_OUTSIDE, tileFoot(DOOR_OUTSIDE), LEAVE_WALK_MS)
          this.current = cmd
          return
        }
        if (this.fadeDir === 0 && this.fade > 0) {
          this.fadeDir = -1
          this.current = cmd // 페이드 아웃 끝나면 다시 finish
          return
        }
        this.state = 'gone'
        break
      default:
        break
    }
  }

  /** fixedMs 가 있으면 경로 길이와 무관하게 정확히 그 시간 동안 걷는다(퇴장) */
  private setPathTo(goalTile: TilePos, final: Point, fixedMs?: number): void {
    const from: TilePos = {
      col: Math.min(Math.max(Math.floor(this.x / TILE), 0), COLS - 1),
      row: Math.min(Math.max(Math.floor(this.y / TILE), 0), ROWS - 1),
    }
    this.trail.push({ x: this.x, y: this.y })
    const tiles = findPath(from, goalTile)
    const pts = tiles.map(tileFoot)
    pts.pop()
    pts.push(final)
    this.path = pts
    // 경로 길이(맨해튼)와 무관하게 MAX_WALK_MS 안에 도착하도록 속도를 정한다
    let len = 0
    let px = this.x
    let py = this.y
    for (const p of pts) {
      len += Math.abs(p.x - px) + Math.abs(p.y - py)
      px = p.x
      py = p.y
    }
    this.walkSpeed =
      fixedMs !== undefined
        ? Math.max(1, (len * 1000) / fixedMs)
        : Math.max(WALK_SPEED, (len * 1000) / MAX_WALK_MS)
  }

  private dirToward(t: TilePos): Dir {
    const p = tileFoot(t)
    const dx = p.x - this.x
    const dy = p.y - this.y
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right'
    return dy < 0 ? 'up' : 'down'
  }

  private setBubble(text: string | null): void {
    this.bubbleText = text
    this.view.setBubble(text)
  }

  /**
   * 도구 말풍선(기획서 6절: 도구 말풍선이 대사보다 우선).
   * text 가 있으면 대사를 즉시 대체한다. null 이면 도구 말풍선만 지우고 진행 중인 대사는 둔다.
   */
  private showTool(text: string | null): void {
    if (text === null && this.speech) return
    this.speech = false
    this.setBubble(text)
  }

  /** 대사. 한 사람당 말풍선 하나 — 이전 말풍선을 즉시 대체. ms=null 이면 사라질 때까지 */
  private say(text: string, ms: number | null): void {
    this.speech = true
    this.speechMs = ms ?? Number.POSITIVE_INFINITY
    this.setBubble(text)
  }

  private updateSpeech(dtMs: number): void {
    if (!this.speech) return
    this.speechMs -= dtMs
    if (this.speechMs <= 0) {
      this.speech = false
      this.setBubble(null)
    }
  }

  private walk(dtMs: number): void {
    const speed = this.walkSpeed * (this.queue.length > 0 ? FAST_WALK_MULTIPLIER : 1)
    let budget = (speed * dtMs) / 1000
    while (budget > 0 && this.path.length > 0) {
      const target = this.path[0]
      if (target === undefined) break
      const dx = target.x - this.x
      const dy = target.y - this.y
      const dist = Math.abs(dx) + Math.abs(dy)
      const dir: Dir =
        Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'
      if (dist > 0 && dir !== this.dir) {
        this.dir = dir
      }
      this.view.setAnimation('walk', this.dir)
      if (dist <= budget) {
        // 모서리(x 먼저 → y)도 길에 남긴다 — 파트너가 가구 모서리를 가로지르지 않게
        if (dx !== 0 && dy !== 0) this.trail.push({ x: target.x, y: this.y })
        this.x = target.x
        this.y = target.y
        budget -= dist
        this.odometer += dist
        this.path.shift()
        this.trail.push({ x: this.x, y: this.y })
      } else {
        // 축 정렬 이동(먼저 큰 축)
        if (Math.abs(dx) > 0) {
          const step = Math.min(Math.abs(dx), budget)
          this.x += Math.sign(dx) * step
          budget -= step
          this.odometer += step
        }
        if (budget > 0 && Math.abs(dy) > 0) {
          this.trail.push({ x: this.x, y: this.y })
          const step = Math.min(Math.abs(dy), budget)
          this.y += Math.sign(dy) * step
          budget -= step
          this.odometer += step
        }
      }
    }
    trimTrail(this, this.trail, TRAIL_KEEP_PX)
  }

  private applyMark(mark: Mark | null, durationMs: number | null): void {
    if (durationMs === null) {
      this.persistentMark = mark
      if (this.tempMarkMs <= 0) this.view.setMark(mark)
      return
    }
    this.tempMarkMs = durationMs
    this.view.setMark(mark)
  }

  private updateMark(dtMs: number): void {
    if (this.tempMarkMs <= 0) return
    this.tempMarkMs -= dtMs
    if (this.tempMarkMs <= 0) this.view.setMark(this.persistentMark)
  }

  private updateFade(dtMs: number): void {
    if (this.fadeDir === 0) return
    this.fade = Math.min(1, Math.max(0, this.fade + (this.fadeDir * dtMs) / FADE_MS))
    this.view.setAlpha(this.fade)
    if (this.fade === 1 || this.fade === 0) this.fadeDir = 0
  }
}
