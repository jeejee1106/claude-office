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
  BRIEF_TOOL_MS,
  type Effect,
  errorReaction,
  type KindActivity,
  kindActivity,
  LOUNGE_REST,
  type Mark,
  pickLoungeRest,
  SLEEP_ACTIVITY,
  SOFA_SLEEP_ACTIVITY,
  type SofaUse,
  SPEECH_MS,
  type SpotRef,
  toolActivity,
} from './activityMap'
import { LEAVE_REPORT_MAX_MS } from './Character'
import type { CharacterCommand, DirectorOutput } from './commands'
import { SPOTS, type SpotId, teamDesks } from './layout'
import { DEFAULT_TEAM_CONFIG, type TeamConfig, teamOf } from './teams'
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
  /** 팀 구성(기본: teams.ts 의 DEFAULT_TEAM_CONFIG). 나중에 "직원 설정" 화면이 넘긴다 */
  teams?: () => TeamConfig
}

/** 화이트보드 글씨를 기억하는 세션 수 상한 */
const MAX_PLANNED_SESSIONS = 64

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
  /**
   * 보고 후 머무는(report 퇴장) 서브가 비운 책상 → 비운 시각. 새 서브는 이 책상을
   * LEAVE_REPORT_MAX_MS 동안 피한다(머무는 사람과 겹치지 않도록). 빈 책상이 이것뿐이면 쓴다.
   */
  private readonly deskFreedAt = new Map<SpotId, number>()
  private lights = false
  private serversBusy = false
  /**
   * 계획(plan 도구)을 한 번이라도 한 세션(끝나면 지움). 상태(계약)에 없는 정보라 이벤트 열로 센다.
   * 세션을 바꿨다 돌아와도 그 세션의 화이트보드는 다시 글씨가 보인다. 페이지를 새로 열면 모른다(빈 보드).
   */
  private readonly plannedSessions = new Set<string>()
  private boardWritten = false
  private readonly lang: () => Lang
  private readonly teams: () => TeamConfig

  constructor(opts: DirectorOptions = {}) {
    this.now = opts.now ?? Date.now
    this.lang = opts.lang ?? getLang
    this.teams = opts.teams ?? (() => DEFAULT_TEAM_CONFIG)
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

  boardWrittenNow(): boolean {
    return this.boardWritten
  }

  /** 상태대로 즉시 배치한다. 기존 캐릭터는 모두 제거 후 다시 만든다. */
  syncAll(state: OfficeState, sessionId: string | null): DirectorOutput[] {
    const out: DirectorOutput[] = []
    for (const id of this.chars.keys()) out.push({ type: 'remove', agentId: id, cause: 'sync' })
    this.chars.clear()
    this.deskOwner.clear()
    this.occupancy.clear()
    this.deskFreedAt.clear()

    const session = sessionId !== null ? state.sessions[sessionId] : undefined
    const open = session !== undefined && session.endedAt === undefined
    this.lights = open
    out.push({ type: 'lights', on: open, cause: 'sync' })
    if (!open || session === undefined) {
      this.serversBusy = false
      out.push({ type: 'servers', busy: false, cause: 'sync' })
      this.boardWritten = false
      out.push({ type: 'board', written: false, cause: 'sync' })
      return out
    }

    const agents = Object.values(session.agents).filter((a) => a.activity !== 'gone')
    // 화이트보드: 이 세션에서 계획을 했던 것을 기억하거나, 지금 누가 계획 중이면 글씨
    if (agents.some((a) => a.currentTool?.category === 'plan')) this.rememberPlan(session.id)
    this.boardWritten = this.plannedSessions.has(session.id)
    out.push({ type: 'board', written: this.boardWritten, cause: 'sync' })
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

    // 화이트보드 글씨: 계획을 한 번 하면 세션이 끝날 때까지 남는다
    if (e.kind === 'session.end') {
      this.plannedSessions.delete(e.sessionId)
      this.setBoard(false, out, cause)
    } else if (
      e.kind === 'tool.start' &&
      e.tool.category === 'plan' &&
      session?.endedAt === undefined
    ) {
      this.rememberPlan(e.sessionId)
      this.setBoard(true, out, cause)
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
      this.deskFreedAt.clear()
      this.updateServers(out, cause)
      return out
    }

    if (act.motion === 'leave') {
      const info = this.chars.get(e.agentId)
      if (info === undefined) return out
      if (info.persistentMark !== null) out.push(this.markCmd(info, null, null, cause))
      out.push(this.leaveCmd(info, act, cause))
      if (act.leaveStyle === 'report' && info.desk !== 'commonTable') {
        this.deskFreedAt.set(info.desk, this.now())
      }
      this.release(info)
      this.updateServers(out, cause)
      return out
    }

    const agent = session?.agents[e.agentId]
    // 상태상 퇴장한 에이전트(늦게 도착한 이벤트)는 다시 만들지 않는다.
    if (agent?.activity === 'gone') return out
    if (session?.endedAt !== undefined) return out

    if (act.motion === 'resume') {
      // attention.clear: 정리용 이벤트라 캐릭터를 새로 만들지 않는다(상태도 유령 에이전트를 만들지 않음)
      const known = this.chars.get(e.agentId)
      if (known !== undefined) this.resume(known, agent, act, out, cause)
      return out
    }

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
      // 소파에 누워 있으면 그 자리에서 Zzz(SOFA_SLEEP_ACTIVITY 주석), 아니면 책상에서 졺
      effective = info.spot === 'sofaLie' ? SOFA_SLEEP_ACTIVITY : SLEEP_ACTIVITY
    } else if (e.kind === 'turn.end') {
      // 한 턴 끝: 커피·소파 앉기·소파 눕기 중 하나(이벤트 id 로 결정, 소파 자리가 없으면 커피)
      effective = LOUNGE_REST[pickLoungeRest(e.id, this.sofaUse(info))]
    }

    // 유지 표시(?, Zzz)는 새 이벤트가 오면 지운다(같은 표시를 다시 거는 경우 제외).
    if (info.persistentMark !== null && info.persistentMark !== effective.mark) {
      out.push(this.markCmd(info, null, null, cause))
      info.persistentMark = null
    }
    info.asleep = effective === SLEEP_ACTIVITY || effective === SOFA_SLEEP_ACTIVITY

    // 서버실 LED: 지금 bash 를 실행 중인가(이 에이전트의 다른 이벤트가 오면 끝난 것으로 본다)
    info.bash = e.kind === 'tool.start' && e.tool.category === 'bash'

    switch (effective.motion) {
      case 'tool': {
        if (e.kind !== 'tool.start') break
        const ta = toolActivity(e.tool.category)
        const bubble = ta.bubble(e.tool)
        out.push(this.moveCmd(info, ta.spot, ta.anim, cause, { bubble, effect: ta.effect ?? null }))
        if (ta.brief === true) {
          // 잠깐 행동(전화 걸기): 그 자리에서 BRIEF_TOOL_MS 동안 → 자기 책상 idle_sit(soft).
          // 도구는 서버에서 아직 진행 중(Agent 는 서브가 끝나야 tool.end)이므로 말풍선은 tool.end 까지 유지.
          // 뒤에 다른 도구 명령이 오면 바로 끊긴다(interruptible).
          out.push({
            type: 'act',
            agentId: info.agentId,
            cause,
            anim: ta.anim,
            durationMs: BRIEF_TOOL_MS,
            bubble,
            interruptible: true,
          })
          out.push(this.moveCmd(info, 'ownDesk', 'idle_sit', cause, { bubble, soft: true }))
        }
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
      case 'resume':
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
      // 소파에 누워 있으면 그대로 Zzz 만(SOFA_SLEEP_ACTIVITY), 아니면 책상으로 가서 졺
      if (info.spot !== 'sofaLie') out.push(this.moveCmd(info, 'ownDesk', 'sleep', 'sleep', {}))
      out.push(this.markCmd(info, 'sleep', null, 'sleep'))
      info.persistentMark = 'sleep'
    }
    return out
  }

  // -------------------------------------------------------------------------

  /**
   * 사용자가 확인에 답함(attention.clear): "?"와 손들기를 거두고 하던 일로 돌아간다.
   * - "?"가 없으면(이미 다른 이벤트가 지움) 아무것도 하지 않는다.
   * - reduce 뒤에도 attention 이 남아 있으면(reason 불일치 등) 서버 상태를 따라 그대로 둔다.
   * - currentTool 이 있으면 그 도구의 자리·동작(말풍선 복원). brief 도구(전화)는 다시 걸지 않고
   *   자기 책상 idle_sit + 말풍선 — syncAll 의 placementFor 와 같은 최종 모습. 없으면 자기 책상 idle_sit.
   * - 새 대사 없음. soft: 같은 POST 로 tool.end 가 바로 뒤따르면(일반 도구) 큐에서 건너뛴다.
   */
  private resume(
    info: CharInfo,
    agent: AgentState | undefined,
    act: KindActivity,
    out: DirectorOutput[],
    cause: string,
  ): void {
    if (info.persistentMark !== 'question') return
    if (agent?.attention !== undefined) return

    out.push(this.markCmd(info, null, null, cause))
    info.persistentMark = null
    info.asleep = false

    const tool = agent?.currentTool
    const soft = act.soft === true
    if (tool === undefined) {
      info.bash = false
      out.push(this.moveCmd(info, act.spot ?? 'ownDesk', act.anim ?? 'idle_sit', cause, { soft }))
    } else {
      const ta = toolActivity(tool.category)
      info.bash = tool.category === 'bash'
      const bubble = ta.bubble(tool)
      out.push(
        ta.brief === true
          ? this.moveCmd(info, 'ownDesk', 'idle_sit', cause, { bubble, soft })
          : this.moveCmd(info, ta.spot, ta.anim, cause, {
              bubble,
              effect: ta.effect ?? null,
              soft,
            }),
      )
    }
    this.updateServers(out, cause)
  }

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
      // brief 도구(전화 걸기)는 이벤트 경로에서도 잠깐 뒤 자기 책상 idle_sit(말풍선 유지)로 끝나므로 그 최종 모습으로 둔다
      if (ta.brief === true) {
        return {
          spot: 'ownDesk',
          anim: 'idle_sit',
          bubble: ta.bubble(agent.currentTool),
          mark: null,
        }
      }
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
      desk: this.assignDesk(agentId, agentType),
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

  /**
   * 메인은 팀장 큰 책상, 서브는 자기 팀(agentType → teams.ts) 책상의 빈자리를 순서대로,
   * 팀 책상이 다 차면 공용 테이블(회의실)
   */
  private assignDesk(agentId: string, agentType: string | undefined): SpotId {
    if (agentId === MAIN_AGENT_ID) return 'mainDesk'
    const now = this.now()
    const lingering = (d: SpotId) => {
      const t = this.deskFreedAt.get(d)
      return t !== undefined && now - t < LEAVE_REPORT_MAX_MS
    }
    const free = teamDesks(teamOf(agentType, this.teams())).filter((d) => !this.deskOwner.has(d))
    const d = free.find((d) => !lingering(d)) ?? free[0]
    if (d === undefined) return 'commonTable'
    this.deskOwner.set(d, agentId)
    this.deskFreedAt.delete(d)
    return d
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

  /** 나를 뺀 소파 사용 현황(앉은 수·누운 수) */
  private sofaUse(info: CharInfo): SofaUse {
    const others = (s: SpotId) => {
      let n = 0
      for (const id of this.occupancy.get(s)?.keys() ?? []) if (id !== info.agentId) n++
      return n
    }
    return { sitting: others('sofaSit'), lying: others('sofaLie') }
  }

  private rememberPlan(sessionId: string): void {
    this.plannedSessions.delete(sessionId)
    this.plannedSessions.add(sessionId)
    // 끝나지 않고 버려진 세션이 쌓이지 않게(오래된 것부터)
    while (this.plannedSessions.size > MAX_PLANNED_SESSIONS) {
      const oldest = this.plannedSessions.values().next().value
      if (oldest === undefined) break
      this.plannedSessions.delete(oldest)
    }
  }

  private setBoard(written: boolean, out: DirectorOutput[], cause: string): void {
    if (written === this.boardWritten) return
    this.boardWritten = written
    out.push({ type: 'board', written, cause })
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
