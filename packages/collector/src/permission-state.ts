import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { categorizeTool, MAIN_AGENT_ID } from '@claude-office/shared'

/*
 * 권한 요청 기록 (훅 프로세스 사이에 공유하는 아주 작은 상태).
 *
 * 왜 필요한가 (실제 캡처, Claude Code 2.1.306, hook-notes.md):
 * - `PermissionRequest` 는 사용자에게 묻지 않고 자동 허용될 때(auto mode 분류기)도 온다.
 *   서브에이전트가 요청하면 `agent_id` 가 붙는다. `tool_use_id` 는 없다.
 * - 실제 확인 창이 뜰 때만 `Notification(permission_prompt)` 이 오는데, 여기에는
 *   `agent_id` 도 `tool_name` 도 없다.
 * - 허락·거절을 알려 주는 훅은 없다. 허락 뒤 처음 오는 신호는 그 도구의
 *   `PostToolUse`/`PostToolUseFailure`, 요청 도구가 Agent 면 `SubagentStart` 다.
 *
 * 그래서
 * 1. PermissionRequest: "세션 S 의 에이전트 X 가 도구 T 로 권한을 요청했다"를 적는다.
 * 2. Notification(permission_prompt): 가장 최근 요청에 귀속하고 `notified` 표시(확인 창이 실제로 뜸).
 * 3. 허락 신호(같은 에이전트·같은 도구의 Post*, Agent 요청이면 SubagentStart)에서 기록을 지우고,
 *    `notified` 였으면 `attention.clear` 를 보낸다(ADR 0002).
 * 4. 거절은 신호가 없으니 그 에이전트의 다음 행동(PreToolUse·SubagentStop), 메인의
 *    UserPromptSubmit·Stop 에서 기록만 지운다(다음 확인 창을 잘못 귀속하지 않게).
 *
 * 저장 위치: $CLAUDE_OFFICE_STATE_DIR 또는 $HOME/.claude-office/state/perm-<session>.json
 * 내용: { "<agentId>": { ts, tool?, notified? } } — 도구 이름 외의 값(입력·경로·명령)은 담지 않는다.
 * 옛 형식 { "<agentId>": <ts> } 도 읽는다(tool 없음으로 취급).
 * 모든 실패는 삼킨다(최악의 경우 귀속이 main 으로 돌아가거나 "?"가 예전처럼 남을 뿐).
 */

/**
 * 이보다 오래된 요청은 잊는다.
 * 확인 창은 오래 떠 있을 수 있다: 2026-10-25 캡처에서 요청 12분 뒤에 허락된 사례가 있었다
 * (예전 값 10분이면 그 허락의 clear 를 못 보냄). 거절로 남은 기록은 다음 행동·턴 경계에서 지워지므로
 * 길게 잡아도 잘못 귀속할 위험이 작다.
 */
export const PENDING_MAX_AGE_MS = 60 * 60 * 1000

/**
 * PreToolUse 로 기록을 지울 때, 요청 직후 이 시간 안의 PreToolUse 는 무시한다.
 * 같은 배치로 함께 시작한 병렬 도구(예 확인 창이 뜬 Read 옆의 다른 Read)의 PreToolUse 가
 * PermissionRequest 바로 뒤에 올 수 있어서다. 거절 뒤의 다음 행동은 확인 창(요청 ~6초 뒤, 캡처)과
 * 사람의 응답을 거치므로 이보다 늦다.
 */
export const PRE_TOOL_GRACE_MS = 2000

export interface PendingRequest {
  /** 요청 시각(ms) */
  ts: number
  /** 요청한 도구 이름. 없으면(옛 형식) 도구 이름으로 짝을 맞추지 않는다. */
  tool?: string
  /** Notification(permission_prompt) 이 이 요청에 귀속됨 = 확인 창이 실제로 떴다 */
  notified?: true
}

export type Pending = Record<string, PendingRequest>

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/
/** 도구 이름만(MCP `mcp__server__tool` 포함). 그 밖의 문자열은 저장하지 않는다. */
const SAFE_TOOL = /^[A-Za-z0-9_.:-]{1,128}$/

function stateDir(): string | undefined {
  const dir = process.env.CLAUDE_OFFICE_STATE_DIR
  if (dir) return dir
  const home = process.env.HOME
  return home ? join(home, '.claude-office', 'state') : undefined
}

function fileFor(sessionId: string): string | undefined {
  if (!SAFE_ID.test(sessionId)) return undefined
  const dir = stateDir()
  return dir ? join(dir, `perm-${sessionId}.json`) : undefined
}

/** 파일 내용(JSON 값) → 기록. 옛 형식(number)·새 형식 모두. 이상한 항목은 버린다. */
export function parsePending(parsed: unknown, nowMs: number): Pending {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Pending = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (!SAFE_ID.test(k)) continue
    let entry: PendingRequest | undefined
    if (typeof v === 'number') entry = { ts: v }
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      if (typeof o.ts === 'number') {
        entry = { ts: o.ts }
        if (typeof o.tool === 'string' && SAFE_TOOL.test(o.tool)) entry.tool = o.tool
        if (o.notified === true) entry.notified = true
      }
    }
    if (entry && Number.isFinite(entry.ts) && nowMs - entry.ts <= PENDING_MAX_AGE_MS) out[k] = entry
  }
  return out
}

export function loadPending(sessionId: string, nowMs: number): Pending {
  try {
    const file = fileFor(sessionId)
    if (!file) return {}
    return parsePending(JSON.parse(readFileSync(file, 'utf8')), nowMs)
  } catch {
    return {}
  }
}

export function savePending(sessionId: string, pending: Pending): void {
  try {
    const file = fileFor(sessionId)
    const dir = stateDir()
    if (!file || !dir) return
    if (Object.keys(pending).length === 0) {
      rmSync(file, { force: true })
      return
    }
    mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(pending))
    renameSync(tmp, file)
  } catch {
    // 무시
  }
}

/** 허락으로 판단해 `attention.clear` 를 보낼 대상 */
export interface PermissionClear {
  /** "?"를 지울 에이전트(요청자) */
  agentId: string
  /** 결정적 id 재료: PostToolUse 면 tool_use_id, SubagentStart 면 새 서브에이전트의 agent_id */
  key?: string
}

export interface PermissionStep {
  /** 바뀐 기록. 바뀌지 않았으면 undefined(쓰지 않음). */
  next?: Pending
  /** Notification(permission_prompt) 을 귀속할 에이전트 */
  requester?: string
  /** 보낼 attention.clear */
  clear?: PermissionClear
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

function latest(pending: Pending, filter: (r: PendingRequest) => boolean): string | undefined {
  let best: string | undefined
  let bestTs = -Infinity
  for (const [agentId, r] of Object.entries(pending)) {
    if (filter(r) && r.ts > bestTs) {
      best = agentId
      bestTs = r.ts
    }
  }
  return best
}

function without(pending: Pending, agentId: string): Pending {
  const next = { ...pending }
  delete next[agentId]
  return next
}

/**
 * 훅 입력 하나가 권한 요청 기록에 주는 영향(순수 함수).
 * 규칙: 계획 C1~C3(_workspace/01_architect_plan.md), ADR 0002.
 */
export function permissionStep(input: unknown, pending: Pending, nowMs: number): PermissionStep {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const i = input as Record<string, unknown>
  const agentId = str(i.agent_id) ?? MAIN_AGENT_ID
  const own = Object.hasOwn(pending, agentId) ? pending[agentId] : undefined

  switch (i.hook_event_name) {
    case 'PermissionRequest': {
      if (!SAFE_ID.test(agentId)) return {}
      // 내부 서브에이전트(agent_type 없음)는 사무실에 없으므로 "?"를 귀속하지 않는다(normalize 와 같은 규칙).
      if (str(i.agent_id) && !str(i.agent_type)) return {}
      const tool = str(i.tool_name)
      const entry: PendingRequest = { ts: nowMs }
      if (tool && SAFE_TOOL.test(tool)) entry.tool = tool
      return { next: { ...pending, [agentId]: entry } }
    }

    case 'Notification': {
      if (i.notification_type !== 'permission_prompt') return {}
      // 캡처상 agent_id 는 없다. 있다면 그 에이전트의 요청을 쓴다.
      const requester = str(i.agent_id)
        ? own
          ? agentId
          : undefined
        : // 아직 확인 창이 귀속되지 않은 가장 최근 요청, 없으면 가장 최근 요청
          (latest(pending, (r) => !r.notified) ?? latest(pending, () => true))
      if (!requester) return {}
      const req = pending[requester]
      if (!req) return {}
      return {
        requester,
        next: req.notified ? undefined : { ...pending, [requester]: { ...req, notified: true } },
      }
    }

    case 'PostToolUse':
    case 'PostToolUseFailure': {
      if (!own) return {}
      // 다른 도구(확인 창이 떠 있는 동안 병렬로 끝난 Read 등)는 그 요청의 끝이 아니다.
      if (own.tool !== undefined && own.tool !== str(i.tool_name)) return {}
      const key = str(i.tool_use_id)
      return {
        next: without(pending, agentId),
        ...(own.notified ? { clear: { agentId, ...(key ? { key } : {}) } } : {}),
      }
    }

    case 'SubagentStart': {
      const child = str(i.agent_id)
      // 유령 SubagentStart/Stop(agent_type 없음)은 무시한다(C5).
      if (!child || !str(i.agent_type)) return {}
      const requester = latest(
        pending,
        (r) => r.tool !== undefined && categorizeTool(r.tool) === 'agent',
      )
      if (!requester) return {}
      const req = pending[requester]
      return {
        next: without(pending, requester),
        ...(req?.notified ? { clear: { agentId: requester, key: child } } : {}),
      }
    }

    case 'PreToolUse':
      // 거절 뒤 그 에이전트의 다음 행동 → 기록만 지운다(clear 없음: reduce 의 tool.start 가 "?"를 지운다).
      if (!own || nowMs - own.ts < PRE_TOOL_GRACE_MS) return {}
      return { next: without(pending, agentId) }

    case 'SubagentStop':
      return own ? { next: without(pending, agentId) } : {}

    case 'UserPromptSubmit':
    case 'Stop': {
      // 메인의 턴 경계. 서브에이전트 안에서 온 것은 무시(캡처상 없음).
      if (str(i.agent_id)) return {}
      const main = Object.hasOwn(pending, MAIN_AGENT_ID) ? pending[MAIN_AGENT_ID] : undefined
      return main ? { next: without(pending, MAIN_AGENT_ID) } : {}
    }

    case 'SessionEnd':
      // 오래돼 읽히지 않은 항목이 파일에 남아 있을 수 있으니 항상 파일을 지운다.
      return { next: {} }

    default:
      return {}
  }
}

/** 훅 하나 처리: 기록을 읽고 → permissionStep → 바뀌었으면 쓴다. 실패는 삼킨다. */
export function trackPermission(
  input: unknown,
  nowMs: number,
): Pick<PermissionStep, 'requester' | 'clear'> {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
    const sessionId = str((input as Record<string, unknown>).session_id)
    if (!sessionId || !SAFE_ID.test(sessionId)) return {}
    const step = permissionStep(input, loadPending(sessionId, nowMs), nowMs)
    if (step.next) savePending(sessionId, step.next)
    return {
      ...(step.requester ? { requester: step.requester } : {}),
      ...(step.clear ? { clear: step.clear } : {}),
    }
  } catch {
    return {}
  }
}
