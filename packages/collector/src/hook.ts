import { randomUUID } from 'node:crypto'
import { MAIN_AGENT_ID } from '@claude-office/shared'
import { maybeCapture } from './capture'
import { normalize } from './normalize'
import {
  forgetPermissionRequest,
  latestPermissionRequester,
  rememberPermissionRequest,
} from './permission-state'
import { DEFAULT_URL, postJson, SEND_TIMEOUT_MS } from './send'

/*
 * claude-office-hook — Claude Code 훅 진입점.
 * stdin JSON → normalize → POST CLAUDE_OFFICE_URL.
 *
 * 규칙 (claude-code-hooks 스킬 3절)
 * - 어떤 경우에도 exit 0, stdout 에는 아무것도 쓰지 않는다
 *   (PreToolUse 등의 출력·종료 코드는 Claude Code 동작에 영향을 줄 수 있다).
 * - 전송 타임아웃 500ms, 서버가 없으면 조용히 끝낸다.
 * - 진단은 CLAUDE_OFFICE_DEBUG=1 일 때만 stderr 로.
 * - CLAUDE_OFFICE_DISABLE=1 이면 아무것도 하지 않는다.
 */

/** 이 시간 안에 무조건 끝낸다(stdin 이 닫히지 않는 경우 등). */
const HARD_LIMIT_MS = 2000
/** 이보다 큰 입력은 파싱하지 않는다(Edit 의 tool_response 에 파일 전체가 들어올 수 있다). */
const MAX_INPUT_BYTES = 16 * 1024 * 1024

const debug = process.env.CLAUDE_OFFICE_DEBUG === '1'
const log = (msg: string) => {
  if (debug) process.stderr.write(`[claude-office-hook] ${msg}\n`)
}

const exit = () => process.exit(0)

function readStdin(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve(null)
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let tooBig = false
    process.stdin.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_INPUT_BYTES) tooBig = true
      // 크기를 넘으면 계속 읽어서 버린다(파이프를 막지 않기 위해).
      else chunks.push(c)
    })
    process.stdin.on('end', () => resolve(tooBig ? null : Buffer.concat(chunks).toString('utf8')))
    process.stdin.on('error', () => resolve(null))
  })
}

/**
 * 권한 요청자 추적(permission-state.ts 참고). Notification(permission_prompt) 이면
 * 귀속할 에이전트를 돌려준다.
 */
function trackPermission(input: unknown, nowMs: number): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const i = input as Record<string, unknown>
  const sessionId = typeof i.session_id === 'string' ? i.session_id : undefined
  if (!sessionId) return undefined
  const agentId = typeof i.agent_id === 'string' && i.agent_id !== '' ? i.agent_id : MAIN_AGENT_ID
  switch (i.hook_event_name) {
    case 'PermissionRequest':
      rememberPermissionRequest(sessionId, agentId, nowMs)
      return undefined
    case 'PostToolUse':
    case 'PostToolUseFailure':
      forgetPermissionRequest(sessionId, agentId, nowMs)
      return undefined
    case 'SessionEnd':
      forgetPermissionRequest(sessionId, undefined, nowMs)
      return undefined
    case 'Notification':
      return i.notification_type === 'permission_prompt'
        ? latestPermissionRequester(sessionId, nowMs)
        : undefined
    default:
      return undefined
  }
}

async function main(): Promise<void> {
  if (process.env.CLAUDE_OFFICE_DISABLE === '1') return
  const raw = await readStdin()
  if (raw === null || raw.trim() === '') {
    log('no input')
    return
  }
  let input: unknown
  try {
    input = JSON.parse(raw)
  } catch {
    log('stdin is not JSON')
    return
  }
  maybeCapture(input)
  const permissionRequester = trackPermission(input, Date.now())
  const event = normalize(input, {
    now: () => new Date(),
    newId: randomUUID,
    projectDir: process.env.CLAUDE_PROJECT_DIR || undefined,
    permissionRequester,
  })
  if (!event) {
    const name =
      input && typeof input === 'object' && 'hook_event_name' in input
        ? String(input.hook_event_name)
        : '?'
    log(`ignored hook ${name}`)
    return
  }
  const url = process.env.CLAUDE_OFFICE_URL || DEFAULT_URL
  const res = await postJson(url, JSON.stringify(event), SEND_TIMEOUT_MS)
  if (res.ok) log(`${event.kind} → ${res.status}`)
  else log(`${event.kind} not sent: ${res.error}`)
}

process.on('uncaughtException', (err) => {
  log(`error: ${err instanceof Error ? err.message : String(err)}`)
  exit()
})
process.on('unhandledRejection', (err) => {
  log(`error: ${err instanceof Error ? err.message : String(err)}`)
  exit()
})
setTimeout(() => {
  log(`hard limit ${HARD_LIMIT_MS}ms reached`)
  exit()
}, HARD_LIMIT_MS)

main().then(exit, (err) => {
  log(`error: ${err instanceof Error ? err.message : String(err)}`)
  exit()
})
