import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { OFFICE_EVENT_KINDS, TOOL_CATEGORIES } from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import {
  ANIMATIONS,
  DEFAULT_ACTIVITY,
  ERROR_MARK_MS,
  KIND_ACTIVITY,
  kindActivity,
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
    '서버 랙/터미널': 'serverRack',
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
    expect(toolEnd).toContain('빨간 "!" 1초')
    expect(toolEnd).toContain('`idle_stand`')
    expect(ERROR_MARK_MS).toBe(1000)
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
