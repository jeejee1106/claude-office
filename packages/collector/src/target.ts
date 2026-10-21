import { mcpServerName, TARGET_MAX } from '@claude-office/shared'

/*
 * tool.target 만들기 — 화면 표시용 짧은 요약. 원문을 싣지 않는다.
 * - 파일 경로 도구: basename
 * - Bash: 명령의 첫 토큰(파이프·&&·; 앞, 환경변수 대입 건너뜀, 경로면 basename)
 * - 검색(Grep/Glob): 패턴 앞 30자 (절대경로로 시작하면 마지막 조각만)
 * - WebFetch: 호스트 이름 / Agent·Task: subagent_type / MCP: 서버 이름
 * - 그 밖(WebSearch 질의, TodoWrite 내용 등): 없음
 * 결과는 항상 TARGET_MAX(60)자 이하.
 */

const PATTERN_MAX = 30

type Input = Record<string, unknown>

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined

/** 길이 제한. UTF-16 서로게이트 쌍이 반쯤 잘리지 않게 한다. */
export function truncate(s: string, max: number = TARGET_MAX): string {
  if (s.length <= max) return s
  let out = s.slice(0, max)
  const last = out.charCodeAt(out.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1)
  return out
}

/** `/a/b/c.ts` → `c.ts`, `C:\\x\\y.md` → `y.md`, 끝 슬래시 무시. */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]+/).filter((x) => x !== '')
  return parts[parts.length - 1] ?? ''
}

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

/** `cd /x && npm test` → `cd`, `FOO=1 ./bin/run.sh a` → `run.sh`, `"git" log` → `git`. */
export function firstCommandToken(command: string): string | undefined {
  const firstSegment = command.trim().split(/\|\||&&|[|;&\n]/)[0] ?? ''
  for (const raw of firstSegment.trim().split(/\s+/)) {
    if (raw === '' || ENV_ASSIGN.test(raw)) continue
    const token = raw.replace(/^[('"`{]+/, '').replace(/['"`)}]+$/, '')
    if (token === '') continue
    const name = /[\\/]/.test(token) ? baseName(token) : token
    return name === '' ? undefined : name
  }
  return undefined
}

const ABSOLUTE = /^(\/|~|[A-Za-z]:[\\/])/
const HOME_SEGMENT = /[\\/](Users|home)[\\/][^\\/\s]+/g

/** 검색 패턴 요약. 절대경로로 시작하면 마지막 조각만, 홈 디렉터리 이름은 `~` 로 가린다. */
export function shortPattern(pattern: string): string | undefined {
  let s = pattern.trim()
  if (ABSOLUTE.test(s)) s = baseName(s)
  s = s.replace(HOME_SEGMENT, '~')
  s = truncate(s, PATTERN_MAX)
  return s === '' ? undefined : s
}

function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname
    return host === '' ? undefined : host
  } catch {
    return undefined
  }
}

const FILE_KEYS = ['file_path', 'notebook_path'] as const

/** tool_name + tool_input → target. 알 수 없으면 undefined. */
export function toolTarget(toolName: string, toolInput: unknown): string | undefined {
  const input: Input =
    toolInput !== null && typeof toolInput === 'object' && !Array.isArray(toolInput)
      ? (toolInput as Input)
      : {}

  let target: string | undefined
  if (toolName.startsWith('mcp__')) {
    target = mcpServerName(toolName)
  } else {
    switch (toolName) {
      case 'Bash': {
        const cmd = str(input.command)
        target = cmd ? firstCommandToken(cmd) : undefined
        break
      }
      case 'Grep':
      case 'Glob': {
        const p = str(input.pattern)
        target = p ? shortPattern(p) : undefined
        break
      }
      case 'LS': {
        const p = str(input.path)
        target = p ? baseName(p) : undefined
        break
      }
      case 'WebFetch': {
        const u = str(input.url)
        target = u ? hostOf(u) : undefined
        break
      }
      case 'Agent':
      case 'Task':
        target = str(input.subagent_type)
        break
      default: {
        // Read, Edit, Write, MultiEdit, NotebookEdit … 그리고 경로 입력을 가진 모르는 도구
        for (const key of FILE_KEYS) {
          const p = str(input[key])
          if (p) {
            target = baseName(p)
            break
          }
        }
      }
    }
  }
  if (target === undefined || target === '') return undefined
  return truncate(target)
}
