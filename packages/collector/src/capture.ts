import { appendFileSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/*
 * 훅 페이로드 "모양" 캡처 (디버그 기능).
 *
 * 켜기: `$HOME/.claude-office/capture` 파일을 만든다. 파일 내용이 절대경로면 그 파일에,
 *       비어 있으면 `$HOME/.claude-office/hook-capture.jsonl` 에 한 줄씩 덧붙인다.
 * 끄기: 플래그 파일을 지운다.
 *
 * 값은 기록하지 않는다. 남기는 것: 훅 이름, 최상위 키 이름 목록, agent_id/session_id 앞 4자,
 * agent_type, notification_type, permission_mode, tool_name, tool_use_id 유무, 시각.
 * tool_input·message·prompt·경로 등의 값은 절대 남기지 않는다.
 * 어떤 실패도 삼킨다(훅은 Claude Code 를 막지 않는다).
 */

const short = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? truncateId(v) : undefined

const truncateId = (v: string) => (v.length > 4 ? `${v.slice(0, 4)}…` : v)

/** 짧은 열거형 값만 통과(그 밖은 길이만) */
const enumish = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || v === '') return undefined
  return /^[A-Za-z0-9_:.-]{1,64}$/.test(v) ? v : `<${v.length} chars>`
}

export function captureRecord(input: Record<string, unknown>, now: Date): Record<string, unknown> {
  return {
    ts: now.toISOString(),
    hook: enumish(input.hook_event_name),
    keys: Object.keys(input).sort(),
    session: short(input.session_id),
    agent_id: short(input.agent_id),
    agent_type: enumish(input.agent_type),
    notification_type: enumish(input.notification_type),
    permission_mode: enumish(input.permission_mode),
    tool_name: enumish(input.tool_name),
    has_tool_use_id: typeof input.tool_use_id === 'string',
  }
}

export function maybeCapture(input: unknown): void {
  try {
    const home = process.env.HOME
    if (!home || input === null || typeof input !== 'object' || Array.isArray(input)) return
    let flag: string
    try {
      flag = readFileSync(join(home, '.claude-office', 'capture'), 'utf8').trim()
    } catch {
      return // 플래그 없음 = 꺼짐
    }
    const out =
      flag !== '' && isAbsolute(flag) ? flag : join(home, '.claude-office', 'hook-capture.jsonl')
    const rec = captureRecord(input as Record<string, unknown>, new Date())
    appendFileSync(out, `${JSON.stringify(rec)}\n`)
  } catch {
    // 무시
  }
}
