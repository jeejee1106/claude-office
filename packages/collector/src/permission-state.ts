import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * 권한 요청자 기억 (훅 프로세스 사이에 공유하는 아주 작은 상태).
 *
 * 왜 필요한가 (2026-10-23 실제 캡처, Claude Code 2.1.306, hook-notes.md):
 * - `PermissionRequest` 는 사용자에게 묻지 않고 자동 허용될 때(auto mode 분류기)도 온다.
 *   서브에이전트가 요청하면 `agent_id` 가 붙는다.
 * - 실제 확인 창이 뜰 때만 `Notification(permission_prompt)` 이 오는데, 여기에는
 *   `agent_id` 도 `tool_name` 도 없다.
 * → PermissionRequest 때 "세션 S 의 에이전트 X 가 방금 권한을 요청했다"를 적어 두고,
 *   Notification(permission_prompt) 때 가장 최근에 요청하고 아직 끝나지 않은 에이전트를 고른다.
 *   그 에이전트의 PostToolUse/PostToolUseFailure 가 오면(허용·자동 허용 후 실행 완료) 지운다.
 *
 * 저장 위치: $CLAUDE_OFFICE_STATE_DIR 또는 $HOME/.claude-office/state/perm-<session>.json
 * 내용: { "<agentId>": <요청 시각 ms> } — 값·경로·명령은 담지 않는다.
 * 모든 실패는 삼킨다(최악의 경우 귀속이 main 으로 돌아갈 뿐).
 */

/** 이보다 오래된 요청은 잊는다 */
export const PENDING_MAX_AGE_MS = 10 * 60 * 1000

type Pending = Record<string, number>

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

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

function read(file: string, nowMs: number): Pending {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Pending = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && nowMs - v <= PENDING_MAX_AGE_MS && SAFE_ID.test(k)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function write(file: string, dir: string, pending: Pending): void {
  if (Object.keys(pending).length === 0) {
    rmSync(file, { force: true })
    return
  }
  mkdirSync(dir, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(pending))
  renameSync(tmp, file)
}

/** PermissionRequest: 요청한 에이전트를 기억한다 */
export function rememberPermissionRequest(sessionId: string, agentId: string, nowMs: number): void {
  try {
    const file = fileFor(sessionId)
    const dir = stateDir()
    if (!file || !dir || !SAFE_ID.test(agentId)) return
    const pending = read(file, nowMs)
    pending[agentId] = nowMs
    write(file, dir, pending)
  } catch {
    // 무시
  }
}

/** Notification(permission_prompt): 가장 최근에 요청하고 아직 안 끝난 에이전트 */
export function latestPermissionRequester(sessionId: string, nowMs: number): string | undefined {
  try {
    const file = fileFor(sessionId)
    if (!file) return undefined
    let best: string | undefined
    let bestTs = -1
    for (const [agentId, ts] of Object.entries(read(file, nowMs))) {
      if (ts > bestTs) {
        best = agentId
        bestTs = ts
      }
    }
    return best
  } catch {
    return undefined
  }
}

/** PostToolUse/PostToolUseFailure: 그 에이전트의 요청은 끝났다. SessionEnd: agentId 없이 전부 지운다. */
export function forgetPermissionRequest(
  sessionId: string,
  agentId: string | undefined,
  nowMs: number,
): void {
  try {
    const file = fileFor(sessionId)
    const dir = stateDir()
    if (!file || !dir) return
    if (agentId === undefined) {
      rmSync(file, { force: true })
      return
    }
    const pending = read(file, nowMs)
    if (!(agentId in pending)) return
    delete pending[agentId]
    write(file, dir, pending)
  } catch {
    // 무시
  }
}
