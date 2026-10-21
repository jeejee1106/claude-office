import { z } from 'zod'

export const TOOL_CATEGORIES = [
  'read',
  'edit',
  'write',
  'search',
  'bash',
  'web',
  'agent',
  'plan',
  'mcp',
  'other',
] as const

/**
 * 도구 분류. 수신 측에서 모르는 값(새 버전 collector가 추가한 분류)은 `other`로 떨어진다.
 * 그래서 새 분류 추가는 v 를 올리지 않는 하위 호환 변경이다.
 */
export const ToolCategory = z.enum(TOOL_CATEGORIES).catch('other')
export type ToolCategory = z.infer<typeof ToolCategory>

const TOOL_CATEGORY_BY_NAME: Readonly<Record<string, ToolCategory>> = {
  Read: 'read',
  NotebookRead: 'read',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'write',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  Bash: 'bash',
  BashOutput: 'bash',
  KillShell: 'bash',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent',
  TodoWrite: 'plan',
  TaskCreate: 'plan',
  ExitPlanMode: 'plan',
}

/**
 * Claude Code 도구 이름 → ToolCategory. 대소문자를 구분한다.
 * 모르는 이름(빈 문자열 포함)은 'other'. 절대 throw 하지 않는다.
 */
export function categorizeTool(name: string): ToolCategory {
  if (typeof name !== 'string') return 'other'
  if (name.startsWith('mcp__')) return 'mcp'
  return Object.hasOwn(TOOL_CATEGORY_BY_NAME, name)
    ? (TOOL_CATEGORY_BY_NAME[name] ?? 'other')
    : 'other'
}

/** `mcp__github__create_pr` → `github`. MCP 도구가 아니거나 형식이 다르면 undefined. */
export function mcpServerName(name: string): string | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const server = name.slice('mcp__'.length).split('__')[0]
  return server ? server : undefined
}
