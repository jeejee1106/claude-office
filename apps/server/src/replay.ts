import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { OfficeEvent } from '@claude-office/shared'
import type { Hub } from './hub'

export interface ParsedReplay {
  events: OfficeEvent[]
  /** 건너뛴 줄 (1부터 시작하는 줄 번호와 사유) */
  skipped: { line: number; error: string }[]
}

/** JSONL 텍스트를 파싱한다. 빈 줄·`//` 주석은 무시, 잘못된 줄은 skipped 에 담고 건너뛴다. */
export function parseJsonl(text: string): ParsedReplay {
  const events: OfficeEvent[] = []
  const skipped: ParsedReplay['skipped'] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] ?? '').trim()
    if (raw === '' || raw.startsWith('//')) continue
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      skipped.push({ line: i + 1, error: 'invalid JSON' })
      continue
    }
    const parsed = OfficeEvent.safeParse(json)
    if (parsed.success) events.push(parsed.data)
    else skipped.push({ line: i + 1, error: firstIssue(parsed.error.issues) })
  }
  return { events, skipped }
}

export function loadReplayFile(file: string): ParsedReplay {
  return parseJsonl(readFileSync(file, 'utf8'))
}

export function firstIssue(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const issue = issues[0]
  if (!issue) return 'invalid event'
  const path = issue.path.map(String).join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

export interface ScheduledEvent {
  /** 리플레이 시작 후 이 이벤트를 주입할 시각(ms) */
  offsetMs: number
  event: OfficeEvent
}

export interface PrepareOptions {
  /** 리플레이 시작 시각(epoch ms). 첫 이벤트의 ts 가 된다. */
  startAt: number
  /** 배속. 기록된 간격 / speed 로 재생한다. */
  speed: number
  /** 실행마다 다른 접미사. sessionId·id 에 붙어 매 실행이 새 세션이 된다. */
  suffix: string
}

const MAX_ID = 128

function withSuffix(value: string, suffix: string): string {
  const tail = `-${suffix}`
  return `${value.slice(0, MAX_ID - tail.length)}${tail}`
}

/**
 * 기록된 이벤트를 "지금" 일어나는 것처럼 바꾼다. 순수 함수.
 * - ts: 첫 이벤트 = startAt, 이후는 기록된 간격 / speed 만큼 뒤(재생 타이밍과 일치)
 *   → 과거 ts 때문에 idleSweep 이 세션을 즉시 만료시키지 않는다.
 * - sessionId: 원래 값 + `-suffix` → 두 번째 리플레이가 종료된 세션의 늦은 이벤트로 무시되지 않는다.
 * - id: `r-suffix-순번` 으로 새로 생성 → hub 의 중복 제거에 걸리지 않는다.
 * - 기록 순서는 유지하고, ts 가 거꾸로 간 줄은 간격 0 으로 본다.
 */
export function prepareReplay(
  events: readonly OfficeEvent[],
  opts: PrepareOptions,
): ScheduledEvent[] {
  const speed = opts.speed > 0 ? opts.speed : 1
  const first = events[0]
  if (!first) return []
  let prevOrig = Date.parse(first.ts)
  let offset = 0
  const out: ScheduledEvent[] = []
  events.forEach((e, i) => {
    const orig = Date.parse(e.ts)
    const gap = Number.isFinite(orig) && orig > prevOrig ? orig - prevOrig : 0
    if (Number.isFinite(orig)) prevOrig = Math.max(prevOrig, orig)
    offset += gap / speed
    const moved = {
      ...e,
      id: withSuffix(`r-${i}`, opts.suffix),
      sessionId: withSuffix(e.sessionId, opts.suffix),
      ts: new Date(opts.startAt + offset).toISOString(),
    }
    const parsed = OfficeEvent.safeParse(moved)
    if (parsed.success) out.push({ offsetMs: Math.round(offset), event: parsed.data })
  })
  return out
}

export interface ReplayOptions {
  speed: number
  loop?: boolean
  /** loop 시 한 바퀴 끝나고 다음 바퀴까지 대기(ms) */
  loopGapMs?: number
  now?: () => number
  /** 접미사 생성기 (테스트용) */
  makeSuffix?: () => string
  onRunStart?: (run: number, suffix: string, count: number) => void
  onRunEnd?: (run: number) => void
}

export interface ReplayHandle {
  /** 마지막 바퀴가 끝나거나 stop() 되면 resolve */
  done: Promise<void>
  stop(): void
}

/** hub 에 기록된 이벤트를 배속으로 주입한다. 바퀴마다 새 세션(새 suffix·현재 시각 기준 ts). */
export function startReplay(
  hub: Hub,
  events: readonly OfficeEvent[],
  opts: ReplayOptions,
): ReplayHandle {
  const now = opts.now ?? Date.now
  const makeSuffix = opts.makeSuffix ?? (() => randomUUID().slice(0, 8))
  const loopGapMs = opts.loopGapMs ?? 2000
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let wake: (() => void) | undefined

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (stopped) return resolve()
      wake = resolve
      timer = setTimeout(resolve, Math.max(0, ms))
    })

  const run = async () => {
    for (let n = 1; !stopped; n++) {
      const suffix = makeSuffix()
      const startAt = now()
      const schedule = prepareReplay(events, { startAt, speed: opts.speed, suffix })
      opts.onRunStart?.(n, suffix, schedule.length)
      let elapsed = 0
      for (const item of schedule) {
        if (item.offsetMs > elapsed) await sleep(item.offsetMs - elapsed)
        if (stopped) return
        elapsed = item.offsetMs
        hub.ingest(item.event, 'replay')
      }
      opts.onRunEnd?.(n)
      if (!opts.loop) return
      await sleep(loopGapMs)
    }
  }

  const done = run()
  return {
    done,
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      wake?.()
    },
  }
}
