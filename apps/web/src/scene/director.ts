import {
  type AgentState,
  isAsleep,
  MAIN_AGENT_ID,
  type OfficeEvent,
  type OfficeState,
  type SessionState,
} from '@claude-office/shared'
import { getLang, type Lang, type LineKey, pickLine } from '../i18n'
import {
  type AnimName,
  type Effect,
  errorReaction,
  type KindActivity,
  kindActivity,
  type Mark,
  SLEEP_ACTIVITY,
  SPEECH_MS,
  type SpotRef,
  toolActivity,
} from './activityMap'
import type { CharacterCommand, DirectorOutput } from './commands'
import { SPOTS, type SpotId, SUB_DESKS } from './layout'
import { variantFor } from './variant'

/*
 * OfficeEvent → 캐릭터 명령 변환기. PixiJS 비의존 순수 로직(시계만 주입).
 *
 * - handle(event, session): 이벤트 하나 → 명령 열(애니메이션 큐에 들어갈 것).
 *   session 은 그 이벤트를 reduce 한 "뒤"의 세션 상태 — 씬은 서버 상태의 투영이므로
 *   상태가 gone 이면 캐릭터를 새로 만들지 않는 등 상태를 기준으로 판단한다.
 * - syncAll(state, sessionId): 상태대로 즉시 배치(애니메이션 없음). snapshot·세션 전환·재접속 시.
 * - refreshSleep(session): 주기 호출. idle 이 오래된(isAsleep) 캐릭터를 sleep 으로 바꾼다.
 *
 * 매핑은 activityMap.ts 한 곳에서만 읽는다.
 */

export interface DirectorOptions {
  /** 서버 시계 기준 현재 시각(epoch ms). isAsleep 계산용 */
  now?: () => number
  /** 대사 언어(기본: 사용자가 고른 언어) */
  lang?: () => Lang
}

interface CharInfo {
  agentId: string
  variant: number
  label: string
  /** 자기 책상 */
  desk: SpotId
  /** 현재(마지막으로 명령한) 스팟과 슬롯 */
  spot: SpotId | null
  slot: number
  /** 다음 이벤트까지 유지되는 표시(question/sleep) */
  persistentMark: Mark | null
  asleep: boolean
  /** 사이에 ok 없이 연달아 실패한 tool.end 수(웹이 이벤트 열로 계산 — 상태에는 없다) */
  consecutiveErrors: number
  /** 지금 실행 중인 도구가 bash 인가(서버실 LED) */
  bash: boolean
}

export class Director {
  private readonly now: () => number
  private readonly chars = new Map<string, CharInfo>()
  /** 서브 책상 점유자 */
  private readonly deskOwner = new Map<SpotId, string>()
  /** 스팟별 슬롯 점유: spot → (agentId → slot) */
  private readonly occupancy = new Map<SpotId, Map<string, number>>()
  private lights = false
  private serversBusy = false
  private readonly lang: () => Lang

  constructor(opts: DirectorOptions = {}) {
    this.now = opts.now ?? Date.now
    this.lang = opts.lang ?? getLang
  }

  serversBusyNow(): boolean {
    return this.serversBusy
  }

  /** 화면에 있는(있어야 하는) 캐릭터 ID */
  characterIds(): string[] {
    return [...this.chars.keys()]
  }

  deskOf(agentId: string): SpotId | undefined {
    return this.chars.get(agentId)?.desk
  }

  lightsOn(): boolean {
    return this.lights
  }

  /** 상태대로 즉시 배치한다. 기존 캐릭터는 모두 제거 후 다시 만든다. */
  syncAll(state: OfficeState, sessionId: string | null): DirectorOutput[] {
    const out: DirectorOutput[] = []
    for (const id of this.chars.keys()) out.push({ type: 'remove', agentId: id, cause: 'sync' })
    this.chars.clear()
    this.deskOwner.clear()
    this.occupancy.clear()

    const session = sessionId !== null ? state.sessions[sessionId] : undefined
    const open = session !== undefined && session.endedAt === undefined
    this.lights = open
    out.push({ type: 'lights', on: open, cause: 'sync' })
    if (!open || session === undefined) {
      this.serversBusy = false
      out.push({ type: 'servers', busy: false, cause: 'sync' })
      return out
    }

    const agents = Object.values(session.agents).filter((a) => a.activity !== 'gone')
    agents.sort((a, b) => (a.id === MAIN_AGENT_ID ? -1 : b.id === MAIN_AGENT_ID ? 1 : 0))
    for (const agent of agents) {
      const info = this.createChar(agent.id, agent.type)
      const p = this.placementFor(agent)
      const spot = this.resolve(info, p.spot)
      const slot = this.occupy(info, spot)
      info.persistentMark = p.mark
      info.asleep = p.mark === 'sleep'
      info.bash = agent.currentTool?.category === 'bash'
      out.push({
        type: 'place',
        agentId: agent.id,
        cause: 'sync',
        variant: info.variant,
        label: info.label,
        spot,
        slot,
        anim: p.anim,
        bubble: p.bubble,
        mark: p.mark,
      })
    }
    this.serversBusy = [...this.chars.values()].some((c) => c.bash)
    out.push({ type: 'servers', busy: this.serversBusy, cause: 'sync' })
    return out
  }

  /** 이벤트 하나 → 명령 열. session 은 이 이벤트를 reduce 한 뒤의 세션 상태(없어도 동작). */
  handle(e: OfficeEvent, session?: SessionState): DirectorOutput[] {
    const act = kindActivity(e.kind)
    const out: DirectorOutput[] = []
    const cause = e.id

    if (act.lights !== undefined) {
      const on = act.lights === 'on'
      if (on !== this.lights) {
        this.lights = on
        out.push({ type: 'lights', on, cause })
      }
    }

    if (act.subject === 'all') {
      // session.end: 전원 짐을 챙겨 퇴장(각자 대사)
      for (const info of this.chars.values()) {
        if (info.persistentMark !== null) out.push(this.markCmd(info, null, null, cause))
        out.push(this.leaveCmd(info, act, cause))
      }
      this.chars.clear()
      this.deskOwner.clear()
      this.occupancy.clear()
      this.updateServers(out, cause)
      return out
    }

    if (act.motion === 'leave') {
      const info = this.chars.get(e.agentId)
      if (info === undefined) return out
      if (info.persistentMark !== null) out.push(this.markCmd(info, null, null, cause))
      out.push(this.leaveCmd(info, act, cause))
      this.release(info)
      this.updateServers(out, cause)
      return out
    }

    const agent = session?.agents[e.agentId]
    // 상태상 퇴장한 에이전트(늦게 도착한 이벤트)는 다시 만들지 않는다.
    if (agent?.activity === 'gone') return out
    if (session?.endedAt !== undefined) return out

    let info = this.chars.get(e.agentId)
    if (info === undefined) {
      const type = e.kind === 'agent.spawn' ? e.agentType : agent?.type
      info = this.createChar(e.agentId, type)
      out.push({
        type: 'spawn',
        agentId: info.agentId,
        cause,
        variant: info.variant,
        label: info.label,
        // 등장 대사(출근·"부르셨어요?")는 문에서 들어올 때
        say: act.motion === 'enter' ? this.line(act.line, cause) : null,
      })
    }

    // 이 이벤트로 결정되는 행동
    let effective: KindActivity = act
    if (e.kind === 'agent.idle' && agent !== undefined && isAsleep(agent, this.now())) {
      effective = SLEEP_ACTIVITY
    }

    // 유지 표시(?, Zzz)는 새 이벤트가 오면 지운다(같은 표시를 다시 거는 경우 제외).
    if (info.persistentMark !== null && info.persistentMark !== effective.mark) {
      out.push(this.markCmd(info, null, null, cause))
      info.persistentMark = null
    }
    info.asleep = effective === SLEEP_ACTIVITY

    // 서버실 LED: 지금 bash 를 실행 중인가(이 에이전트의 다른 이벤트가 오면 끝난 것으로 본다)
    info.bash = e.kind === 'tool.start' && e.tool.category === 'bash'

    switch (effective.motion) {
      case 'tool': {
        if (e.kind !== 'tool.start') break
        const ta = toolActivity(e.tool.category)
        out.push(
          this.moveCmd(info, ta.spot, ta.anim, cause, {
            bubble: ta.bubble(e.tool),
            effect: ta.effect ?? null,
          }),
        )
        break
      }
      case 'enter':
      case 'goto': {
        if (e.kind === 'tool.end') {
          if (e.status === 'error') {
            // 그 자리에서 멈칫 + "앗…" + 식은땀 (연속 3회 이상: 머리 감싸기 + "이상하다…" + 땀 증가)
            info.consecutiveErrors++
            const r = errorReaction(info.consecutiveErrors)
            out.push(this.markCmd(info, r.mark, r.ms, cause))
            out.push({
              type: 'act',
              agentId: info.agentId,
              cause,
              anim: r.anim,
              durationMs: r.ms,
              say: this.line(r.line, cause),
              interruptible: true,
            })
          } else {
            info.consecutiveErrors = 0
          }
        }
        out.push(
          this.moveCmd(info, effective.spot ?? 'ownDesk', effective.anim ?? 'idle_sit', cause, {
            soft: effective.soft === true,
            effect: effective.effect ?? null,
            // enter 의 대사는 spawn 이 이미 말했다
            say: effective.motion === 'goto' ? this.line(effective.line, cause) : null,
          }),
        )
        break
      }
      case 'stay':
        out.push({
          type: 'act',
          agentId: info.agentId,
          cause,
          anim: effective.anim ?? 'idle_stand',
          durationMs: effective.brief === true ? SPEECH_MS : null,
          say: this.line(effective.line, cause),
          interruptible: effective.brief === true,
        })
        // brief: 잠깐 일어났다가 자기 책상으로(soft — 다음 도구가 오면 생략)
        if (effective.brief === true) {
          out.push(this.moveCmd(info, 'ownDesk', 'idle_sit', cause, { soft: true }))
        }
        break
      case 'none':
      case 'leave':
        break
    }

    if (effective.mark !== undefined && effective.mark !== info.persistentMark) {
      const ms = effective.markMs ?? null
      out.push(this.markCmd(info, effective.mark, ms, cause))
      if (ms === null) info.persistentMark = effective.mark
    }
    this.updateServers(out, cause)
    return out
  }

  /**
   * 주기 호출(예: 5초마다). idle 상태가 sleepMs 를 넘긴 캐릭터를 sleep(Zzz)으로 바꾼다.
   * 새 이벤트 없이 시간만 흘러 바뀌는 표시이므로 이벤트 경로와 별도로 둔다.
   */
  refreshSleep(session: SessionState | undefined): DirectorOutput[] {
    if (session === undefined || session.endedAt !== undefined) return []
    const out: DirectorOutput[] = []
    const now = this.now()
    for (const info of this.chars.values()) {
      const agent = session.agents[info.agentId]
      if (agent === undefined || info.asleep || !isAsleep(agent, now)) continue
      info.asleep = true
      out.push(this.moveCmd(info, 'ownDesk', 'sleep', 'sleep', {}))
      out.push(this.markCmd(info, 'sleep', null, 'sleep'))
      info.persistentMark = 'sleep'
    }
    return out
  }

  // -------------------------------------------------------------------------

  private placementFor(agent: AgentState): {
    spot: SpotRef
    anim: AnimName
    bubble: string | null
    mark: Mark | null
  } {
    if (agent.activity === 'waiting') {
      return { spot: 'ownDesk', anim: 'raise_hand', bubble: null, mark: 'question' }
    }
    if (agent.currentTool !== undefined) {
      const ta = toolActivity(agent.currentTool.category)
      return { spot: ta.spot, anim: ta.anim, bubble: ta.bubble(agent.currentTool), mark: null }
    }
    if (agent.activity === 'idle' && isAsleep(agent, this.now())) {
      return { spot: 'ownDesk', anim: 'sleep', bubble: null, mark: 'sleep' }
    }
    // idle 또는 working(도구 사이) = 자기 책상
    return { spot: 'ownDesk', anim: 'idle_sit', bubble: null, mark: null }
  }

  private createChar(agentId: string, agentType: string | undefined): CharInfo {
    const info: CharInfo = {
      agentId,
      variant: variantFor(agentId, agentType),
      label: agentId === MAIN_AGENT_ID ? 'main' : (agentType ?? agentId.slice(0, 8)),
      desk: this.assignDesk(agentId),
      spot: null,
      slot: 0,
      persistentMark: null,
      asleep: false,
      consecutiveErrors: 0,
      bash: false,
    }
    this.chars.set(agentId, info)
    return info
  }

  /** 메인은 창가 큰 책상, 서브는 빈 책상을 순서대로, 모자라면 공용 테이블 */
  private assignDesk(agentId: string): SpotId {
    if (agentId === MAIN_AGENT_ID) return 'mainDesk'
    for (const d of SUB_DESKS) {
      if (!this.deskOwner.has(d)) {
        this.deskOwner.set(d, agentId)
        return d
      }
    }
    return 'commonTable'
  }

  private resolve(info: CharInfo, ref: SpotRef): SpotId {
    return ref === 'ownDesk' ? info.desk : ref
  }

  /** 스팟의 빈 슬롯을 잡는다(이전 스팟 슬롯은 반납) */
  private occupy(info: CharInfo, spot: SpotId): number {
    if (info.spot === spot) return info.slot
    this.vacate(info)
    let occ = this.occupancy.get(spot)
    if (occ === undefined) {
      occ = new Map()
      this.occupancy.set(spot, occ)
    }
    const used = new Set(occ.values())
    const max = SPOTS[spot].slots.length
    let slot = 0
    while (used.has(slot) && slot < max - 1) slot++
    occ.set(info.agentId, slot)
    info.spot = spot
    info.slot = slot
    return slot
  }

  private vacate(info: CharInfo): void {
    if (info.spot !== null) this.occupancy.get(info.spot)?.delete(info.agentId)
    info.spot = null
  }

  private release(info: CharInfo): void {
    this.vacate(info)
    if (this.deskOwner.get(info.desk) === info.agentId) this.deskOwner.delete(info.desk)
    this.chars.delete(info.agentId)
  }

  private moveCmd(
    info: CharInfo,
    ref: SpotRef,
    anim: AnimName,
    cause: string,
    o: { bubble?: string | null; effect?: Effect | null; soft?: boolean; say?: string | null },
  ): CharacterCommand {
    const spot = this.resolve(info, ref)
    const slot = this.occupy(info, spot)
    return {
      type: 'moveTo',
      agentId: info.agentId,
      cause,
      spot,
      slot,
      anim,
      bubble: o.bubble ?? null,
      effect: o.effect ?? null,
      soft: o.soft ?? false,
      say: o.say ?? null,
    }
  }

  private leaveCmd(info: CharInfo, act: KindActivity, cause: string): CharacterCommand {
    return {
      type: 'leave',
      agentId: info.agentId,
      cause,
      say: this.line(act.line, `${cause}:${info.agentId}`),
      style: act.leaveStyle ?? null,
    }
  }

  /** 대사 후보 중 하나(이벤트 id 로 결정적) */
  private line(key: LineKey | undefined, seed: string): string | null {
    return key === undefined ? null : pickLine(key, seed, this.lang())
  }

  private updateServers(out: DirectorOutput[], cause: string): void {
    const busy = [...this.chars.values()].some((c) => c.bash)
    if (busy === this.serversBusy) return
    this.serversBusy = busy
    out.push({ type: 'servers', busy, cause })
  }

  private markCmd(
    info: CharInfo,
    mark: Mark | null,
    durationMs: number | null,
    cause: string,
  ): CharacterCommand {
    return { type: 'mark', agentId: info.agentId, cause, mark, durationMs }
  }
}
