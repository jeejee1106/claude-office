import { randomUUID } from 'node:crypto'
import type { OfficeEvent } from '@claude-office/shared'
import { maybeCapture } from './capture'
import { attentionClear, normalize } from './normalize'
import { trackPermission } from './permission-state'
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
  const now = new Date()
  const permission = trackPermission(input, now.getTime())
  const ctx = {
    now: () => now,
    newId: randomUUID,
    projectDir: process.env.CLAUDE_PROJECT_DIR || undefined,
    permissionRequester: permission.requester,
  }
  // 허락으로 판단되면 [attention.clear, 원래 이벤트] 를 POST 한 번에 배열로(ADR 0002).
  const events: OfficeEvent[] = []
  if (permission.clear) {
    const clear = attentionClear(input, permission.clear, ctx)
    if (clear) events.push(clear)
  }
  const event = normalize(input, ctx)
  if (event) events.push(event)
  if (events.length === 0) {
    const name =
      input && typeof input === 'object' && 'hook_event_name' in input
        ? String(input.hook_event_name)
        : '?'
    log(`ignored hook ${name}`)
    return
  }
  const kinds = events.map((e) => e.kind).join('+')
  const body = JSON.stringify(events.length === 1 ? events[0] : events)
  const url = process.env.CLAUDE_OFFICE_URL || DEFAULT_URL
  const res = await postJson(url, body, SEND_TIMEOUT_MS)
  if (res.ok) log(`${kinds} → ${res.status}`)
  else log(`${kinds} not sent: ${res.error}`)
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
