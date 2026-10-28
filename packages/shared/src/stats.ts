import { z } from 'zod'
import { MAIN_AGENT_ID, type OfficeEvent } from './event'
import type { OfficeState } from './state'

/*
 * 오늘 작업량 (기획서 7절 "오늘 작업량", 2026-10-28)
 *
 * - 서버(hub)만 센다. web 은 서버가 보낸 숫자를 보여 주기만 한다(reduce 로 세지 않는다).
 * - "같은 파일"·"같은 팀원" 판정용 키는 DailyStatsCounter 안(서버 메모리)에만 있고,
 *   WS 로 나가는 DailyStats 에는 숫자만 담는다(개인정보 원칙).
 * - 하루 = 서버가 도는 컴퓨터의 현지 날짜. 이벤트 ts 가 아니라 서버 시각(now)으로 정한다
 *   (시계가 어긋난 이벤트 하나가 날짜를 앞당겨 버리지 않게).
 */

/** 층 식별자: 'p:<project>' 또는 project 가 없는 세션은 's:<sessionId>'. web 층 탭과 같은 규칙. */
export type FloorKey = string

export function floorKeyFor(project: string | undefined, sessionId: string): FloorKey {
  return project !== undefined && project !== '' ? `p:${project}` : `s:${sessionId}`
}

/** epoch ms → 이 컴퓨터 현지 날짜 'YYYY-MM-DD' */
export function localDayKey(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const Count = z.number().int().nonnegative().catch(0)

/** 한 층의 오늘 숫자. 새 숫자는 optional 로만 추가한다. */
export const DailyCounts = z.object({
  /** 수정·작성에 성공한 서로 다른 파일 수 (tool.end ok, category edit|write) */
  filesEdited: Count,
  /** 실행한 명령 수 (도구 이름 Bash 의 tool.end, 성공·실패 모두) */
  commands: Count,
  /** 부른 서로 다른 팀원 수 (main 이 아닌 agent.spawn) */
  teammates: Count,
  /** 도구를 쓴 횟수 (모든 tool.end, 서브에이전트 포함) */
  toolUses: Count,
})
export type DailyCounts = z.infer<typeof DailyCounts>

export const DailyStats = z.object({
  /** 이 숫자의 날짜(서버 현지) 'YYYY-MM-DD'. web 은 오늘과 다르면 0으로 보여 준다. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 층별 숫자. 없는 층 = 모두 0 */
  floors: z.record(z.string(), DailyCounts),
})
export type DailyStats = z.infer<typeof DailyStats>

export const EMPTY_DAILY_COUNTS: Readonly<DailyCounts> = {
  filesEdited: 0,
  commands: 0,
  teammates: 0,
  toolUses: 0,
}

/** 층 하나가 기억하는 "같은 것" 키의 최대 수. 넘으면 새 키는 기억하지 않고 새것으로 센다. */
export const DAILY_KEYS_LIMIT = 10_000

interface FloorTally {
  counts: DailyCounts
  /** 파일 키(tool.target = basename). 서버 메모리 전용 */
  files: Set<string>
  /** 팀원 키(sessionId + agentId). 서버 메모리 전용 */
  agents: Set<string>
}

const EDIT_CATEGORIES = new Set(['edit', 'write'])

/**
 * 서버 hub 가 하나 들고 있는 오늘 작업량 카운터.
 *   hub.ingest:  if (counter.count(event, nowMs, state)) broadcast({ type: 'stats', stats: counter.toWire() })
 *   hub.sweep:   if (counter.rollover(nowMs)) broadcast(...)   // 자정 0 으로
 * 중복 이벤트(id 동일)는 거르지 않는다 — hub 가 count 전에 거른다(reduce 와 같은 규칙).
 * 어떤 입력에도 throw 하지 않는다.
 */
export class DailyStatsCounter {
  private day: string
  private floors = new Map<FloorKey, FloorTally>()
  private readonly dayKeyOf: (ms: number) => string

  constructor(nowMs: number, dayKeyOf: (ms: number) => string = localDayKey) {
    this.dayKeyOf = dayKeyOf
    this.day = dayKeyOf(nowMs)
  }

  /** 날짜가 바뀌었으면 모두 0 으로. 바뀌었으면 true */
  rollover(nowMs: number): boolean {
    const today = this.dayKeyOf(nowMs)
    if (today === this.day) return false
    this.day = today
    this.floors = new Map()
    return true
  }

  /**
   * 이벤트 하나를 센다. 숫자나 날짜가 바뀌었으면 true.
   * 층은 event.project, 없으면 state 의 세션 project, 그것도 없으면 세션 id 로 정한다.
   */
  count(e: OfficeEvent, nowMs: number, state?: OfficeState): boolean {
    try {
      const rolled = this.rollover(nowMs)
      return this.apply(e, state) || rolled
    } catch {
      return false
    }
  }

  toWire(): DailyStats {
    const floors: Record<FloorKey, DailyCounts> = {}
    for (const [key, t] of this.floors) floors[key] = { ...t.counts }
    return { day: this.day, floors }
  }

  private tally(key: FloorKey): FloorTally {
    let t = this.floors.get(key)
    if (t === undefined) {
      t = { counts: { ...EMPTY_DAILY_COUNTS }, files: new Set(), agents: new Set() }
      this.floors.set(key, t)
    }
    return t
  }

  private apply(e: OfficeEvent, state: OfficeState | undefined): boolean {
    if (e.kind !== 'tool.end' && e.kind !== 'agent.spawn') return false
    const project = e.project ?? state?.sessions[e.sessionId]?.project
    const t = this.tally(floorKeyFor(project, e.sessionId))

    if (e.kind === 'agent.spawn') {
      if (e.agentId === MAIN_AGENT_ID) return false
      return addUnique(t.agents, `${e.sessionId}\u0000${e.agentId}`, () => {
        t.counts.teammates++
      })
    }

    t.counts.toolUses++
    if (e.tool.name === 'Bash') t.counts.commands++
    const file = e.tool.target
    if (
      e.status === 'ok' &&
      EDIT_CATEGORIES.has(e.tool.category) &&
      file !== undefined &&
      file !== ''
    ) {
      addUnique(t.files, file, () => {
        t.counts.filesEdited++
      })
    }
    return true
  }
}

function addUnique(set: Set<string>, key: string, onNew: () => void): boolean {
  if (set.has(key)) return false
  if (set.size < DAILY_KEYS_LIMIT) set.add(key)
  onNew()
  return true
}
