import {
  categorizeTool,
  MAIN_AGENT_ID,
  OfficeEvent,
  SCHEMA_VERSION,
  type ToolInfo,
} from '@claude-office/shared'
import { baseName, toolTarget, truncate } from './target'

/*
 * Claude Code 훅 stdin JSON(snake_case) → OfficeEvent(camelCase). 순수 함수.
 * 사용하는 필드는 모두 공식 문서 + 실제 캡처로 확인했다:
 * .claude/skills/claude-code-hooks/references/hook-notes.md, test/fixtures/*.json
 *
 * 매핑
 *   SessionStart        → session.start  (source)
 *   SessionEnd          → session.end    (reason)
 *   UserPromptSubmit    → prompt.submit  (length 만, 원문 없음)
 *   PreToolUse          → tool.start
 *   PostToolUse         → tool.end ok
 *   PostToolUseFailure  → tool.end error
 *   SubagentStart       → agent.spawn    (agentId = agent_id, agentType = agent_type)
 *   SubagentStop        → agent.finish   (agentId = agent_id)
 *                         둘 다 agent_type 이 없거나 비면 null(유령 서브에이전트, 2026-10-23 캡처)
 *   Stop                → turn.end
 *   Notification        → attention      (permission_prompt/입력 요청만. idle_prompt 는 보내지 않음)
 *   PermissionRequest   → null. auto mode 분류기가 묻지 않고 허용할 때도 오므로(2026-10-23 캡처)
 *                         확인 창의 근거로 쓰지 않는다. hook.ts 가 요청한 에이전트만 기억한다.
 *   PreCompact          → context.compact (trigger)
 *   그 밖               → null (보내지 않음)
 *
 * agentId: 훅 입력에 `agent_id` 가 있으면 그 값(서브에이전트 안에서 실행된 훅), 없으면 "main".
 *   `agent_type` 은 `--agent` 세션의 메인에도 붙을 수 있어 판별에 쓰지 않는다.
 * parentAgentId: 훅 입력에 부모를 가리키는 필드가 없고 서브에이전트는 중첩될 수 있으므로
 *   (캡처로 확인) 추측해 채우지 않는다.
 */

export interface NormalizeContext {
  /** 이벤트 시각 */
  now: () => Date
  /** 결정적 ID 를 만들 수 없는 이벤트에 쓸 고유 ID */
  newId: () => string
  /** 프로젝트 디렉터리(CLAUDE_PROJECT_DIR). 없으면 훅 입력의 cwd. basename 만 쓴다. */
  projectDir?: string | undefined
  /**
   * Notification(permission_prompt) 에는 agent_id 가 없다(2026-10-23 캡처). 같은 세션에서 가장
   * 최근에 PermissionRequest 를 보내고 아직 끝나지 않은 에이전트(hook.ts 가 기억)를 넘기면
   * 그 에이전트에 귀속한다. 없으면 main.
   */
  permissionRequester?: string | undefined
}

type HookInput = Record<string, unknown>

const ID_MAX = 128

const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)

/** id 길이 제한을 넘으면 결정적 ID 대신 새 ID */
function stableId(parts: string[], ctx: NormalizeContext): string {
  const id = parts.join('/')
  return id.length <= ID_MAX ? id : ctx.newId()
}

/**
 * idle_prompt("다음 입력을 기다림")는 보내지 않는다: 턴이 끝난 뒤 오는 알림이라 turn.end 와 같은 뜻이고,
 * attention 으로 보내면 휴게실에서 쉬는 팀장 머리 위에 "?"가 뜬다(2026-10-23 사용자 관찰).
 */
const NOTIFICATION_REASON: Readonly<Record<string, 'permission' | 'idle' | 'other'>> = {
  permission_prompt: 'permission',
  elicitation_dialog: 'other',
  elicitation_url_dialog: 'other',
  agent_needs_input: 'other',
}

export function normalize(hookInput: unknown, ctx: NormalizeContext): OfficeEvent | null {
  if (hookInput === null || typeof hookInput !== 'object' || Array.isArray(hookInput)) return null
  const input = hookInput as HookInput

  const hook = str(input.hook_event_name)
  const sessionId = str(input.session_id)
  if (!hook || !sessionId) return null

  const subagentId = str(input.agent_id)
  const agentId = subagentId ?? MAIN_AGENT_ID
  const projectSource = ctx.projectDir ?? str(input.cwd)
  const project = projectSource ? truncate(baseName(projectSource), 120) : ''

  const base = {
    v: SCHEMA_VERSION,
    ts: ctx.now().toISOString(),
    sessionId,
    agentId,
    ...(project !== '' ? { project } : {}),
  }

  const toolInfo = (): ToolInfo | null => {
    const name = str(input.tool_name)
    if (!name) return null
    const target = toolTarget(name, input.tool_input)
    const useId = str(input.tool_use_id)
    return {
      name,
      category: categorizeTool(name),
      ...(target !== undefined ? { target } : {}),
      ...(useId !== undefined ? { useId } : {}),
    }
  }

  const toolId = (kind: string, tool: ToolInfo): string =>
    tool.useId ? stableId([sessionId, kind, tool.useId], ctx) : ctx.newId()

  let candidate: Record<string, unknown> | null = null

  switch (hook) {
    case 'SessionStart': {
      const source = str(input.source)
      candidate = {
        ...base,
        id: ctx.newId(),
        kind: 'session.start',
        ...(source ? { source } : {}),
      }
      break
    }
    case 'SessionEnd': {
      const reason = str(input.reason)
      candidate = {
        ...base,
        id: ctx.newId(),
        kind: 'session.end',
        ...(reason ? { reason: truncate(reason, 40) } : {}),
      }
      break
    }
    case 'UserPromptSubmit': {
      const prompt = input.prompt
      candidate = {
        ...base,
        id: ctx.newId(),
        kind: 'prompt.submit',
        ...(typeof prompt === 'string' ? { length: prompt.length } : {}),
      }
      break
    }
    case 'PreToolUse': {
      const tool = toolInfo()
      if (!tool) return null
      candidate = { ...base, id: toolId('tool.start', tool), kind: 'tool.start', tool }
      break
    }
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const tool = toolInfo()
      if (!tool) return null
      candidate = {
        ...base,
        id: toolId('tool.end', tool),
        kind: 'tool.end',
        tool,
        status: hook === 'PostToolUse' ? 'ok' : 'error',
      }
      break
    }
    case 'SubagentStart': {
      const agentType = str(input.agent_type)
      // agent_type 이 비면 유령(내부 에이전트, hook-notes 2026-10-23) → 보내지 않는다.
      if (!subagentId || !agentType) return null
      // 끝난 서브에이전트에게 SendMessage 를 보내면 같은 agent_id 로 Start/Stop 이 다시 온다
      // (hook-notes 2026-10-25). 결정적 ID 면 서버가 두 번째를 중복으로 버려, 다시 온 팀원이
      // 퇴근하지 못하고 책상에서 졸게 된다 → 매번 새 ID.
      candidate = {
        ...base,
        id: ctx.newId(),
        kind: 'agent.spawn',
        agentType: truncate(agentType, 60),
      }
      break
    }
    case 'SubagentStop': {
      // SubagentStart 없이 agent_type 빈 값으로만 오는 유령 SubagentStop(2026-10-23 캡처 20건)은 버린다.
      if (!subagentId || !str(input.agent_type)) return null
      candidate = {
        ...base,
        id: ctx.newId(), // SubagentStart 와 같은 이유로 매번 새 ID
        kind: 'agent.finish',
      }
      break
    }
    case 'Stop':
      candidate = { ...base, id: ctx.newId(), kind: 'turn.end' }
      break
    case 'Notification': {
      const type = str(input.notification_type)
      const reason =
        type && Object.hasOwn(NOTIFICATION_REASON, type) ? NOTIFICATION_REASON[type] : undefined
      if (!reason) return null
      const requester =
        reason === 'permission' && !subagentId ? str(ctx.permissionRequester) : undefined
      candidate = {
        ...base,
        ...(requester ? { agentId: requester } : {}),
        id: ctx.newId(),
        kind: 'attention',
        reason,
      }
      break
    }
    case 'PreCompact': {
      const trigger = str(input.trigger)
      candidate = {
        ...base,
        id: ctx.newId(),
        kind: 'context.compact',
        ...(trigger ? { trigger } : {}),
      }
      break
    }
    default:
      return null
  }

  // 계약 검증. 실패하면 잘못된 이벤트를 보내는 대신 버린다.
  const parsed = OfficeEvent.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/**
 * 확인 창에 허락으로 답한 것으로 판단될 때(permission-state.ts permissionStep 의 clear)
 * 그 요청자의 "?"를 지우는 `attention.clear{reason:'permission'}`.
 * id: `<sessionId>/attention.clear/<key>` (key = tool_use_id 또는 새 서브에이전트 agent_id),
 * 128자를 넘거나 key 가 없으면 새 ID. 계약 검증에 실패하면 null.
 */
export function attentionClear(
  hookInput: unknown,
  clear: { agentId: string; key?: string | undefined },
  ctx: NormalizeContext,
): OfficeEvent | null {
  if (hookInput === null || typeof hookInput !== 'object' || Array.isArray(hookInput)) return null
  const input = hookInput as HookInput
  const sessionId = str(input.session_id)
  if (!sessionId || !str(clear.agentId)) return null
  const projectSource = ctx.projectDir ?? str(input.cwd)
  const project = projectSource ? truncate(baseName(projectSource), 120) : ''
  const parsed = OfficeEvent.safeParse({
    v: SCHEMA_VERSION,
    id: clear.key ? stableId([sessionId, 'attention.clear', clear.key], ctx) : ctx.newId(),
    ts: ctx.now().toISOString(),
    sessionId,
    agentId: clear.agentId,
    ...(project !== '' ? { project } : {}),
    kind: 'attention.clear',
    reason: 'permission',
  })
  return parsed.success ? parsed.data : null
}
