import { OfficeEvent } from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import { normalize } from '../src/normalize'
import { fixedContext, fixtureNames, loadFixture } from './helpers'

/** normalize 결과가 null 이어야 하는 fixture (매핑하지 않는 알림 종류) */
const EXPECT_NULL = new Set(['Notification.auth_success.json'])

describe('normalize: 모든 fixture', () => {
  const names = fixtureNames()

  it('fixture 가 충분히 있다 (실제 캡처 + 문서 기반)', () => {
    expect(names.length).toBeGreaterThanOrEqual(25)
    const sources = names.map((n) => String(loadFixture(n)._fixture_source))
    expect(sources.filter((s) => s.startsWith('capture')).length).toBeGreaterThanOrEqual(20)
  })

  for (const name of names) {
    it(name, () => {
      const event = normalize(loadFixture(name), fixedContext())
      if (EXPECT_NULL.has(name)) {
        expect(event).toBeNull()
        return
      }
      expect(event).not.toBeNull()
      // 계약 검증: 다시 parse 해도 그대로여야 한다.
      expect(OfficeEvent.parse(event)).toEqual(event)
      expect(event).toMatchSnapshot()
    })
  }
})

describe('normalize: 개인정보 (B8)', () => {
  for (const name of fixtureNames()) {
    it(`${name} 의 이벤트에 경로·원문이 없다`, () => {
      const event = normalize(loadFixture(name), fixedContext())
      const text = JSON.stringify(event)
      expect(text).not.toContain('/Users/')
      expect(text).not.toContain('alice')
      expect(text).not.toContain('redacted')
      expect(text).not.toContain('.jsonl')
      expect(text).not.toContain('rm -rf')
    })
  }

  it('파일 내용·프롬프트·출력·명령 인자를 싣지 않는다', () => {
    const secret = 'TOP-SECRET-1234'
    const inputs = [
      {
        hook_event_name: 'UserPromptSubmit',
        session_id: 's',
        cwd: '/home/bob/p',
        prompt: secret,
      },
      {
        hook_event_name: 'PreToolUse',
        session_id: 's',
        cwd: '/home/bob/p',
        tool_name: 'Bash',
        tool_input: {
          command: `curl -H "Authorization: ${secret}" https://x`,
          description: secret,
        },
        tool_use_id: 't1',
      },
      {
        hook_event_name: 'PostToolUse',
        session_id: 's',
        cwd: '/home/bob/p',
        tool_name: 'Edit',
        tool_input: { file_path: '/home/bob/p/a.ts', old_string: secret, new_string: secret },
        tool_response: { originalFile: secret, stdout: secret },
        tool_use_id: 't2',
      },
      {
        hook_event_name: 'PreToolUse',
        session_id: 's',
        cwd: '/home/bob/p',
        tool_name: 'WebSearch',
        tool_input: { query: secret },
        tool_use_id: 't3',
      },
      {
        hook_event_name: 'PreToolUse',
        session_id: 's',
        cwd: '/home/bob/p',
        tool_name: 'Agent',
        tool_input: { subagent_type: 'Explore', prompt: secret, description: secret },
        tool_use_id: 't4',
      },
      {
        hook_event_name: 'SubagentStop',
        session_id: 's',
        cwd: '/home/bob/p',
        agent_id: 'a1',
        agent_type: 'Explore',
        last_assistant_message: secret,
      },
    ]
    for (const input of inputs) {
      const event = normalize(input, fixedContext())
      expect(event).not.toBeNull()
      const text = JSON.stringify(event)
      expect(text).not.toContain(secret)
      expect(text).not.toContain('/home/bob')
    }
    const prompt = normalize(inputs[0], fixedContext())
    expect(prompt).toMatchObject({ kind: 'prompt.submit', length: secret.length })
  })
})

describe('normalize: 서브에이전트 귀속 (B1)', () => {
  it('메인 에이전트의 도구 호출은 main', () => {
    for (const name of [
      'PreToolUse.Read.json',
      'PreToolUse.Edit.json',
      'PreToolUse.Bash.json',
      'PreToolUse.Agent.json',
    ]) {
      const e = normalize(loadFixture(name), fixedContext())
      expect(e?.agentId, name).toBe('main')
    }
  })

  it('서브에이전트 안의 도구 호출은 그 agent_id 로 간다', () => {
    const start = normalize(loadFixture('SubagentStart.json'), fixedContext())
    expect(start).toMatchObject({
      kind: 'agent.spawn',
      agentId: 'a9d6fcc6fccdd5788',
      agentType: 'Explore',
    })
    for (const name of [
      'PreToolUse.subagent-Read.json',
      'PostToolUse.subagent-Read.json',
      'PreToolUse.subagent-Grep.json',
      'PostToolUse.subagent-Grep.json',
    ]) {
      const e = normalize(loadFixture(name), fixedContext())
      expect(e?.agentId, name).toBe('a9d6fcc6fccdd5788')
    }
    const stop = normalize(loadFixture('SubagentStop.json'), fixedContext())
    expect(stop).toMatchObject({ kind: 'agent.finish', agentId: 'a9d6fcc6fccdd5788' })
  })

  it('중첩 서브에이전트: 자식은 자기 agent_id, 부모 안의 Agent 호출은 부모 agent_id', () => {
    const spawnInParent = normalize(loadFixture('PreToolUse.subagent-Agent.json'), fixedContext())
    expect(spawnInParent).toMatchObject({
      kind: 'tool.start',
      agentId: 'a2622b7efa90f6e33',
      tool: { name: 'Agent', category: 'agent', target: 'Explore' },
    })
    const child = normalize(loadFixture('SubagentStart.nested.json'), fixedContext())
    expect(child).toMatchObject({ kind: 'agent.spawn', agentId: 'a473c5664f8a7266d' })
    const childTool = normalize(loadFixture('PreToolUse.nested-Glob.json'), fixedContext())
    expect(childTool?.agentId).toBe('a473c5664f8a7266d')
  })

  it('훅 입력에 부모 정보가 없으므로 parentAgentId 를 추측하지 않는다', () => {
    for (const name of fixtureNames()) {
      const e = normalize(loadFixture(name), fixedContext())
      expect(e?.parentAgentId, name).toBeUndefined()
    }
  })

  it('agent_type 만 있고 agent_id 가 없으면(--agent 세션 메인) main', () => {
    const input = { ...loadFixture('PreToolUse.Read.json'), agent_type: 'my-agent' }
    expect(normalize(input, fixedContext())?.agentId).toBe('main')
  })
})

describe('normalize: 매핑 세부', () => {
  it('Pre/Post 짝은 같은 useId, 결정적 id 는 kind 별로 다르다', () => {
    const pre = normalize(loadFixture('PreToolUse.Read.json'), fixedContext())
    const post = normalize(loadFixture('PostToolUse.Read.json'), fixedContext())
    if (pre?.kind !== 'tool.start' || post?.kind !== 'tool.end') throw new Error('kind')
    expect(pre.tool.useId).toBe(post.tool.useId)
    expect(pre.id).not.toBe(post.id)
    // 같은 훅이 두 번 실행돼도(user + project 중복 설치 등) 같은 id → 서버가 중복 제거
    expect(normalize(loadFixture('PreToolUse.Read.json'), fixedContext())?.id).toBe(pre.id)
  })

  it('PostToolUseFailure → tool.end error', () => {
    const e = normalize(loadFixture('PostToolUseFailure.Bash-fail.json'), fixedContext())
    expect(e).toMatchObject({
      kind: 'tool.end',
      status: 'error',
      tool: { name: 'Bash', target: 'false' },
    })
  })

  it('Notification 종류별 attention reason', () => {
    expect(
      normalize(loadFixture('Notification.permission_prompt.json'), fixedContext()),
    ).toMatchObject({
      kind: 'attention',
      reason: 'permission',
    })
    expect(normalize(loadFixture('Notification.idle_prompt.json'), fixedContext())).toMatchObject({
      kind: 'attention',
      reason: 'idle',
    })
    const base = loadFixture('Notification.idle_prompt.json')
    expect(
      normalize({ ...base, notification_type: 'agent_needs_input' }, fixedContext()),
    ).toMatchObject({
      reason: 'other',
    })
    expect(
      normalize({ ...base, notification_type: 'quota_auto_resume_fired' }, fixedContext()),
    ).toBeNull()
    expect(normalize({ ...base, notification_type: undefined }, fixedContext())).toBeNull()
  })

  it('project 는 CLAUDE_PROJECT_DIR(ctx.projectDir) 가 있으면 그 basename', () => {
    const e = normalize(loadFixture('Stop.json'), fixedContext({ projectDir: '/srv/x/my-repo/' }))
    expect(e?.project).toBe('my-repo')
    expect(normalize(loadFixture('Stop.json'), fixedContext())?.project).toBe('demo-app')
  })

  it('SessionStart source: 계약에 없는 값(fork)은 빠진다', () => {
    const e = normalize({ ...loadFixture('SessionStart.json'), source: 'fork' }, fixedContext())
    expect(e).toMatchObject({ kind: 'session.start' })
    expect(e && 'source' in e ? e.source : undefined).toBeUndefined()
  })

  it('SessionEnd reason 은 40자로 자른다', () => {
    const e = normalize(
      { ...loadFixture('SessionEnd.json'), reason: 'x'.repeat(100) },
      fixedContext(),
    )
    expect(e && e.kind === 'session.end' ? e.reason?.length : 0).toBe(40)
  })

  it('MCP 도구는 mcp 분류 + 서버 이름', () => {
    const e = normalize(
      {
        hook_event_name: 'PreToolUse',
        session_id: 's',
        tool_name: 'mcp__github__create_pr',
        tool_input: { title: 'secret title' },
        tool_use_id: 't',
      },
      fixedContext(),
    )
    expect(e).toMatchObject({ tool: { category: 'mcp', target: 'github' } })
  })

  it('모르는 도구는 other, throw 없음', () => {
    const e = normalize(
      { hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'BrandNewTool', tool_input: 42 },
      fixedContext(),
    )
    expect(e).toMatchObject({
      kind: 'tool.start',
      tool: { name: 'BrandNewTool', category: 'other' },
    })
  })
})

describe('normalize: 버리는 입력', () => {
  const base = loadFixture('Stop.json')
  it.each([
    ['모르는 훅', { ...base, hook_event_name: 'PostToolBatch' }],
    ['ConfigChange', { ...base, hook_event_name: 'ConfigChange' }],
    ['hook_event_name 없음', { ...base, hook_event_name: undefined }],
    ['session_id 없음', { ...base, session_id: undefined }],
    ['session_id 너무 김', { ...base, session_id: 'x'.repeat(200) }],
    ['agent_id 없는 SubagentStart', { ...loadFixture('SubagentStart.json'), agent_id: undefined }],
    ['tool_name 없는 PreToolUse', { ...loadFixture('PreToolUse.Read.json'), tool_name: undefined }],
    ['배열', [base]],
    ['null', null],
    ['문자열', 'Stop'],
  ])('%s → null', (_label, input) => {
    expect(normalize(input, fixedContext())).toBeNull()
  })
})
