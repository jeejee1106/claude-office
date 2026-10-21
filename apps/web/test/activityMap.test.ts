import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { OFFICE_EVENT_KINDS, TOOL_CATEGORIES } from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import { LANGS, LINES, type LineKey, pickLine } from '../src/i18n'
import {
  ANIMATIONS,
  DEFAULT_ACTIVITY,
  ERROR_REACTION,
  ERROR_REACTION_MS,
  errorReaction,
  KIND_ACTIVITY,
  kindActivity,
  REPEATED_ERROR_REACTION,
  SLEEP_ACTIVITY,
  TOOL_ACTIVITY,
  toolActivity,
} from '../src/scene/activityMap'
import { FIXED_SPOTS } from '../src/scene/layout'

const MAPPING_DOC = fileURLToPath(
  new URL(
    '../../../.claude/skills/pixel-office-scene/references/activity-mapping.md',
    import.meta.url,
  ),
)

describe('activityMap', () => {
  it('모든 ToolCategory 에 매핑이 있고 스팟·애니메이션이 유효하다', () => {
    for (const c of TOOL_CATEGORIES) {
      const a = toolActivity(c)
      expect(a, c).toBe(TOOL_ACTIVITY[c])
      expect(a.spot === 'ownDesk' || (FIXED_SPOTS as readonly string[]).includes(a.spot)).toBe(true)
      expect(ANIMATIONS).toContain(a.anim)
    }
    expect(Object.keys(TOOL_ACTIVITY).sort()).toEqual([...TOOL_CATEGORIES].sort())
  })

  it('모든 OfficeEvent kind 에 매핑이 있다', () => {
    for (const k of OFFICE_EVENT_KINDS) {
      expect(kindActivity(k), k).toBe(KIND_ACTIVITY[k])
    }
    expect(Object.keys(KIND_ACTIVITY).sort()).toEqual([...OFFICE_EVENT_KINDS].sort())
  })

  it('모르는 kind/category 문자열에도 throw 없이 기본 매핑(자기 책상 idle_sit)', () => {
    for (const bad of ['', 'nope', 'tool.mystery', '__proto__', 'constructor', 'toString']) {
      expect(kindActivity(bad)).toBe(DEFAULT_ACTIVITY)
      expect(toolActivity(bad)).toBe(TOOL_ACTIVITY.other)
    }
    expect(DEFAULT_ACTIVITY.spot).toBe('ownDesk')
    expect(DEFAULT_ACTIVITY.anim).toBe('idle_sit')
  })

  it('말풍선은 target 을 표시한다', () => {
    expect(TOOL_ACTIVITY.read.bubble({ name: 'Read', target: 'server.ts' })).toBe('📄 server.ts')
    expect(TOOL_ACTIVITY.edit.bubble({ name: 'Edit', target: 'a.ts' })).toBe('✏️ a.ts')
    expect(TOOL_ACTIVITY.write.bubble({ name: 'Write', target: 'b.ts' })).toBe('🆕 b.ts')
    expect(TOOL_ACTIVITY.search.bubble({ name: 'Grep', target: 'login' })).toBe('🔍 login')
    expect(TOOL_ACTIVITY.bash.bubble({ name: 'Bash', target: 'pnpm test' })).toBe('>_ pnpm')
    expect(TOOL_ACTIVITY.web.bubble({ name: 'WebSearch' })).toBe('🌐')
    expect(TOOL_ACTIVITY.agent.bubble({ name: 'Agent', target: 'Explore' })).toBe('👋 Explore')
    expect(TOOL_ACTIVITY.plan.bubble({ name: 'TodoWrite' })).toBe('📋')
    expect(TOOL_ACTIVITY.mcp.bubble({ name: 'mcp__github__create_pr' })).toBe('☎️ github')
    expect(TOOL_ACTIVITY.other.bubble({ name: 'Mystery' })).toBeNull()
    expect(TOOL_ACTIVITY.write.effect).toBe('paper')
  })

  it('agent.idle + isAsleep 은 자기 책상 sleep + Zzz', () => {
    expect(KIND_ACTIVITY['agent.idle']).toMatchObject({ spot: 'ownDesk', anim: 'idle_sit' })
    expect(SLEEP_ACTIVITY).toMatchObject({ spot: 'ownDesk', anim: 'sleep', mark: 'sleep' })
  })
})

describe('activity-mapping.md 와 1:1', () => {
  const doc = readFileSync(MAPPING_DOC, 'utf8')
  const SPOT_BY_DOC: Record<string, string> = {
    '책장 앞': 'bookshelf',
    '자기 책상': 'ownDesk',
    '서류 캐비닛': 'cabinet',
    '서버실 터미널': 'serverTerminal',
    '창가 지구본': 'globe',
    '문 앞': 'door',
    화이트보드: 'whiteboard',
    전화기: 'phone',
  }

  it('도구 이벤트 표의 스팟·애니메이션이 코드와 같다', () => {
    const rows = [...doc.matchAll(/^\| `(\w+)` \| ([^|]+) \| `(\w+)`/gm)]
    const seen = new Set<string>()
    for (const [, category, spotText, anim] of rows) {
      if (category === undefined || !(TOOL_CATEGORIES as readonly string[]).includes(category))
        continue
      seen.add(category)
      const code = toolActivity(category)
      expect(SPOT_BY_DOC[(spotText ?? '').trim()], category).toBe(code.spot)
      expect(anim, category).toBe(code.anim)
    }
    expect([...seen].sort()).toEqual([...TOOL_CATEGORIES].sort())
  })

  it('생명주기 표에 모든 kind(tool.start 는 도구 표)가 있다', () => {
    for (const k of OFFICE_EVENT_KINDS) {
      if (k === 'tool.start') continue
      expect(doc, k).toContain(`| \`${k}\``)
    }
  })

  it('tool.end·모르는 kind 행이 코드와 같다', () => {
    const row = (head: string) => doc.split('\n').find((l) => l.startsWith(`| ${head} |`)) ?? ''
    const toolEnd = row('`tool.end`')
    expect(KIND_ACTIVITY['tool.end']).toMatchObject({
      motion: 'goto',
      spot: 'ownDesk',
      anim: 'idle_sit',
      soft: true,
    })
    expect(toolEnd).toContain('자기 책상')
    expect(toolEnd).toContain('`idle_sit`')
    expect(toolEnd).toContain('soft')
    expect(toolEnd).toContain('`flinch`')
    expect(toolEnd).toContain('`sweat`')
    expect(toolEnd).toContain('`head_hold`')
    expect(toolEnd).toContain('`sweat_heavy`')
    expect(toolEnd).toContain('3회 이상')
    expect(toolEnd).toContain('"앗…"')
    expect(ERROR_REACTION).toMatchObject({ anim: 'flinch', mark: 'sweat', line: 'error' })
    expect(REPEATED_ERROR_REACTION).toMatchObject({
      anim: 'head_hold',
      mark: 'sweat_heavy',
      line: 'errorRepeated',
    })
    expect(toolEnd).toContain(`${ERROR_REACTION_MS / 1000}초`)
    const unknown = row('(모르는 kind)')
    expect(DEFAULT_ACTIVITY).toMatchObject({ spot: 'ownDesk', anim: 'idle_sit', soft: true })
    expect(kindActivity('future.kind')).toBe(DEFAULT_ACTIVITY)
    expect(unknown).toContain('자기 책상 `idle_sit` (soft)')
  })

  it('필요한 애니메이션 목록이 ANIMATIONS 와 같다', () => {
    const section = doc.split('## 필요한 애니메이션 목록')[1] ?? ''
    const names = [...section.matchAll(/`(\w+)`/g)].map((m) => m[1])
    expect(names.sort()).toEqual([...ANIMATIONS].sort())
  })
})

describe('대사 사전 (기획서 5·6절)', () => {
  const SPEC_LINES: Record<LineKey, string> = {
    sessionStart: '출근했습니다!',
    promptSubmit: '네, 알겠습니다!',
    subSpawn: '부르셨어요?',
    subFinish: '다녀왔습니다!',
    error: '앗…',
    errorRepeated: '이상하다…',
    attention: '확인 부탁드려요!',
    turnEnd: '휴~',
    compact: '정리 좀 할게요',
    sessionEnd: '퇴근하겠습니다!',
  }

  it('한국어 첫 후보는 기획서 대사, 상황마다 후보가 여러 개, 영어 후보도 같은 수', () => {
    for (const [k, line] of Object.entries(SPEC_LINES) as [LineKey, string][]) {
      expect(LINES.ko[k][0], k).toBe(line)
      expect(LINES.ko[k].length, k).toBeGreaterThanOrEqual(2)
      expect(LINES.en[k].length, k).toBe(LINES.ko[k].length)
    }
    expect(Object.keys(LINES.ko).sort()).toEqual(Object.keys(SPEC_LINES).sort())
    expect(LANGS).toEqual(['ko', 'en'])
  })

  it('후보는 이벤트 id 로 결정적으로 고르고, id 가 달라지면 다른 후보도 나온다', () => {
    expect(pickLine('error', 'e21', 'ko')).toBe(pickLine('error', 'e21', 'ko'))
    const seen = new Set(Array.from({ length: 40 }, (_, i) => pickLine('error', `x${i}`, 'ko')))
    expect(seen.size).toBe(LINES.ko.error.length)
    expect(LINES.en.error).toContain(pickLine('error', 'e21', 'en'))
  })

  it('연속 에러 3회부터 머리 감싸기 반응', () => {
    expect(errorReaction(1)).toBe(ERROR_REACTION)
    expect(errorReaction(2)).toBe(ERROR_REACTION)
    expect(errorReaction(3)).toBe(REPEATED_ERROR_REACTION)
    expect(errorReaction(7)).toBe(REPEATED_ERROR_REACTION)
  })

  it('생명주기 매핑의 대사 키', () => {
    expect(KIND_ACTIVITY['session.start'].line).toBe('sessionStart')
    expect(KIND_ACTIVITY['session.end']).toMatchObject({ line: 'sessionEnd', leaveStyle: 'pack' })
    expect(KIND_ACTIVITY['agent.finish']).toMatchObject({
      line: 'subFinish',
      leaveStyle: 'report',
    })
    expect(KIND_ACTIVITY['turn.end']).toMatchObject({ spot: 'coffee', effect: 'steam' })
    expect(KIND_ACTIVITY['context.compact']).toMatchObject({ spot: 'shredder', effect: 'shreds' })
    expect(TOOL_ACTIVITY.bash.spot).toBe('serverTerminal')
  })
})
