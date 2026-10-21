/*
 * settings.json 의 hooks 항목 추가·제거 (순수 함수).
 * 형식(공식 문서 확인): { "hooks": { "<Event>": [ { "matcher"?: string, "hooks": [ { "type": "command", "command": string, "timeout"?: 초 } ] } ] } }
 *
 * - 다른 도구의 훅은 그대로 둔다.
 * - 우리 항목은 command 문자열에 HOOK_MARKER 가 들어 있는 것으로 식별한다.
 * - add 는 먼저 우리 항목을 지우고 다시 넣는다 → 몇 번 실행해도 중복이 생기지 않고, 경로가 바뀌면 갱신된다.
 */

export const HOOK_MARKER = 'claude-office-hook'

/** 등록하는 훅 이벤트 (normalize 가 처리하는 것만) */
export const HOOK_EVENTS = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Notification',
  'PermissionRequest',
  'PreCompact',
] as const

/** Claude Code 쪽 훅 timeout(초). 훅 자체는 2초 안에 스스로 끝난다 — 이 값은 안전망이다. */
export const HOOK_TIMEOUT_SECONDS = 5

export type Settings = Record<string, unknown>
type Json = Record<string, unknown>

export class SettingsFormatError extends Error {}

const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)

/** 훅 명령 문자열. 경로에 HOOK_MARKER 가 들어 있어야 uninstall 이 찾을 수 있다. */
export function hookCommand(hookScriptPath: string): string {
  if (!hookScriptPath.includes(HOOK_MARKER)) {
    throw new Error(`hook script path must contain "${HOOK_MARKER}": ${hookScriptPath}`)
  }
  return `node "${hookScriptPath.replaceAll('"', '\\"')}"`
}

const isOurs = (handler: unknown): boolean =>
  isObject(handler) && typeof handler.command === 'string' && handler.command.includes(HOOK_MARKER)

function hooksOf(settings: Settings): Json | undefined {
  const hooks = settings.hooks
  if (hooks === undefined) return undefined
  if (!isObject(hooks)) throw new SettingsFormatError('"hooks" must be an object')
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) throw new SettingsFormatError(`"hooks.${event}" must be an array`)
  }
  return hooks
}

/** 우리 항목만 지운다. 그 결과 비게 된 그룹·이벤트·hooks 객체도 지운다. */
export function removeOurHooks(settings: Settings): { settings: Settings; removed: number } {
  const hooks = hooksOf(settings)
  if (!hooks) return { settings, removed: 0 }

  let removed = 0
  const nextHooks: Json = {}
  for (const [event, groups] of Object.entries(hooks)) {
    let touched = false
    const nextGroups: unknown[] = []
    for (const group of groups as unknown[]) {
      if (!isObject(group) || !Array.isArray(group.hooks)) {
        nextGroups.push(group)
        continue
      }
      const kept = group.hooks.filter((h) => !isOurs(h))
      const n = group.hooks.length - kept.length
      if (n === 0) {
        nextGroups.push(group)
        continue
      }
      removed += n
      touched = true
      if (kept.length > 0) nextGroups.push({ ...group, hooks: kept })
    }
    if (touched && nextGroups.length === 0) continue
    nextHooks[event] = nextGroups
  }

  if (removed === 0) return { settings, removed: 0 }
  const next: Settings = { ...settings }
  if (Object.keys(nextHooks).length === 0) delete next.hooks
  else next.hooks = nextHooks
  return { settings: next, removed }
}

/** 우리 항목을 (다시) 넣는다. */
export function addOurHooks(settings: Settings, command: string): Settings {
  const base = removeOurHooks(settings).settings
  const hooks: Json = { ...(hooksOf(base) ?? {}) }
  for (const event of HOOK_EVENTS) {
    const groups = (hooks[event] as unknown[] | undefined) ?? []
    hooks[event] = [
      ...groups,
      { hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }] },
    ]
  }
  return { ...base, hooks }
}

export function formatSettings(settings: Settings): string {
  return `${JSON.stringify(settings, null, 2)}\n`
}

/**
 * 줄 단위 diff (LCS). 바뀐 줄 앞뒤 `context` 줄만 보여 준다.
 * settings.json 은 작아서 O(n·m) 으로 충분하다. 너무 크면 요약만.
 */
export function lineDiff(before: string, after: string, context = 2): string {
  const a = before === '' ? [] : before.replace(/\n$/, '').split('\n')
  const b = after === '' ? [] : after.replace(/\n$/, '').split('\n')
  if (a.length * b.length > 4_000_000) {
    return `(diff too large: ${a.length} → ${b.length} lines)`
  }
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    const row = lcs[i] as number[]
    const below = lcs[i + 1] as number[]
    for (let j = m - 1; j >= 0; j--) {
      row[j] =
        a[i] === b[j]
          ? (below[j + 1] as number) + 1
          : Math.max(below[j] as number, row[j + 1] as number)
    }
  }
  const ops: { op: ' ' | '-' | '+'; line: string }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: ' ', line: a[i] as string })
      i++
      j++
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      ops.push({ op: '-', line: a[i++] as string })
    } else {
      ops.push({ op: '+', line: b[j++] as string })
    }
  }
  while (i < n) ops.push({ op: '-', line: a[i++] as string })
  while (j < m) ops.push({ op: '+', line: b[j++] as string })

  const show = ops.map(
    (o, k) =>
      o.op !== ' ' ||
      ops.slice(Math.max(0, k - context), k + context + 1).some((x) => x.op !== ' '),
  )
  const out: string[] = []
  let skipped = false
  ops.forEach((o, k) => {
    if (show[k]) {
      out.push(`${o.op} ${o.line}`)
      skipped = false
    } else if (!skipped) {
      out.push('  …')
      skipped = true
    }
  })
  return out.join('\n')
}
