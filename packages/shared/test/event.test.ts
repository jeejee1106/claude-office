import { describe, expect, it } from 'vitest'
import {
  categorizeTool,
  mcpServerName,
  type OFFICE_EVENT_KINDS,
  OfficeEvent,
  type OfficeEventKind,
  ServerMessage,
  TOOL_CATEGORIES,
} from '../src/index'
import { loadSample } from './helpers'

// 컴파일 타임 검사: OFFICE_EVENT_KINDS 가 모든 kind 를 포함한다.
type MissingKinds = Exclude<OfficeEventKind, (typeof OFFICE_EVENT_KINDS)[number]>
const _allKindsListed: MissingKinds extends never ? true : false = true
void _allKindsListed

describe('OfficeEvent schema', () => {
  it('샘플 세션의 모든 줄이 OfficeEvent.parse 를 통과한다', () => {
    const lines = loadSample()
    expect(lines.length).toBe(29)
    for (const line of lines) {
      expect(() => OfficeEvent.parse(line)).not.toThrow()
    }
  })

  it('모르는 kind 는 safeParse 실패(소비자가 버린다)', () => {
    const r = OfficeEvent.safeParse({
      v: 1,
      id: 'x',
      ts: '2026-01-01T00:00:00.000Z',
      sessionId: 's',
      agentId: 'main',
      kind: 'future.kind',
    })
    expect(r.success).toBe(false)
  })

  it('v 가 1 이 아니면 거부한다', () => {
    const r = OfficeEvent.safeParse({
      v: 2,
      id: 'x',
      ts: '2026-01-01T00:00:00.000Z',
      sessionId: 's',
      agentId: 'main',
      kind: 'turn.end',
    })
    expect(r.success).toBe(false)
  })

  it('모르는 category·attention reason 은 other 로, 모르는 필드는 제거된다', () => {
    const tool = OfficeEvent.parse({
      v: 1,
      id: 'x',
      ts: '2026-01-01T00:00:00.000Z',
      sessionId: 's',
      agentId: 'main',
      kind: 'tool.start',
      tool: { name: 'Hologram', category: 'hologram' },
      futureField: 1,
    })
    expect(tool.kind === 'tool.start' && tool.tool.category).toBe('other')
    expect('futureField' in tool).toBe(false)

    const att = OfficeEvent.parse({
      v: 1,
      id: 'y',
      ts: '2026-01-01T00:00:00.000Z',
      sessionId: 's',
      agentId: 'main',
      kind: 'attention',
      reason: 'something-new',
    })
    expect(att.kind === 'attention' && att.reason).toBe('other')
  })

  it('attention.clear: reason 은 선택, 모르는 reason 은 other', () => {
    const base = {
      v: 1,
      id: 'c',
      ts: '2026-01-01T00:00:00.000Z',
      sessionId: 's',
      agentId: 'main',
      kind: 'attention.clear',
    }
    const plain = OfficeEvent.parse(base)
    expect(plain.kind).toBe('attention.clear')
    expect(plain.kind === 'attention.clear' && plain.reason).toBeUndefined()
    const perm = OfficeEvent.parse({ ...base, reason: 'permission' })
    expect(perm.kind === 'attention.clear' && perm.reason).toBe('permission')
    const odd = OfficeEvent.parse({ ...base, reason: 'something-new' })
    expect(odd.kind === 'attention.clear' && odd.reason).toBe('other')
  })

  it('target 60자 초과는 거부한다(collector 가 잘라 보내야 함)', () => {
    const r = OfficeEvent.safeParse({
      v: 1,
      id: 'x',
      ts: '2026-01-01T00:00:00.000Z',
      sessionId: 's',
      agentId: 'main',
      kind: 'tool.start',
      tool: { name: 'Read', category: 'read', target: 'a'.repeat(61) },
    })
    expect(r.success).toBe(false)
  })

  it('ts 는 ISO 8601 이어야 한다', () => {
    const r = OfficeEvent.safeParse({
      v: 1,
      id: 'x',
      ts: 'yesterday',
      sessionId: 's',
      agentId: 'main',
      kind: 'turn.end',
    })
    expect(r.success).toBe(false)
  })
})

describe('categorizeTool', () => {
  it.each([
    ['Read', 'read'],
    ['NotebookRead', 'read'],
    ['Edit', 'edit'],
    ['MultiEdit', 'edit'],
    ['NotebookEdit', 'edit'],
    ['Write', 'write'],
    ['Grep', 'search'],
    ['Glob', 'search'],
    ['LS', 'search'],
    ['Bash', 'bash'],
    ['BashOutput', 'bash'],
    ['KillShell', 'bash'],
    ['WebFetch', 'web'],
    ['WebSearch', 'web'],
    ['Agent', 'agent'],
    ['Task', 'agent'],
    ['TodoWrite', 'plan'],
    ['TaskCreate', 'plan'],
    ['ExitPlanMode', 'plan'],
  ])('%s → %s', (name, category) => {
    expect(categorizeTool(name)).toBe(category)
  })

  it('mcp__ 접두사는 mcp', () => {
    expect(categorizeTool('mcp__github__create_pr')).toBe('mcp')
    expect(categorizeTool('mcp__x')).toBe('mcp')
    expect(mcpServerName('mcp__github__create_pr')).toBe('github')
    expect(mcpServerName('Read')).toBeUndefined()
  })

  it('알 수 없는 이름은 other 이며 throw 하지 않는다', () => {
    expect(categorizeTool('SomeFutureTool')).toBe('other')
    expect(categorizeTool('')).toBe('other')
    expect(categorizeTool('read')).toBe('other') // 대소문자 구분
    expect(categorizeTool('toString')).toBe('other') // 프로토타입 키
    expect(categorizeTool('__proto__')).toBe('other')
    expect(categorizeTool(undefined as unknown as string)).toBe('other')
  })

  it('반환값은 항상 TOOL_CATEGORIES 중 하나', () => {
    for (const n of ['Read', 'x', 'mcp__a__b']) {
      expect(TOOL_CATEGORIES).toContain(categorizeTool(n))
    }
  })
})

describe('ServerMessage schema', () => {
  it('snapshot / event / heartbeat 를 파싱하고 모르는 type 은 실패한다', () => {
    const [first] = loadSample()
    const ts = '2026-01-01T00:00:00.000Z'
    expect(
      ServerMessage.safeParse({ type: 'snapshot', state: { sessions: {} }, recent: [first], ts })
        .success,
    ).toBe(true)
    expect(ServerMessage.safeParse({ type: 'event', event: first }).success).toBe(true)
    expect(ServerMessage.safeParse({ type: 'heartbeat', ts }).success).toBe(true)
    expect(ServerMessage.safeParse({ type: 'hello' }).success).toBe(false)
  })

  it('snapshot.recent 의 모르는 kind 는 그 항목만 빠지고 snapshot 은 살아남는다', () => {
    const [first] = loadSample()
    const ts = '2026-01-01T00:00:00.000Z'
    const future = {
      v: 1,
      id: 'f',
      ts,
      sessionId: 's',
      agentId: 'main',
      kind: 'future.kind',
    }
    const r = ServerMessage.safeParse({
      type: 'snapshot',
      state: { sessions: {} },
      recent: [first, future],
      ts,
    })
    expect(r.success).toBe(true)
    expect(r.success && r.data.type === 'snapshot' && r.data.recent).toHaveLength(1)
    // event 메시지는 그대로 실패(web 이 버린다)
    expect(ServerMessage.safeParse({ type: 'event', event: future }).success).toBe(false)
  })
})
