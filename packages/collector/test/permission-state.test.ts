import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  loadPending,
  PENDING_MAX_AGE_MS,
  type Pending,
  PRE_TOOL_GRACE_MS,
  parsePending,
  permissionStep,
  savePending,
  trackPermission,
} from '../src/permission-state'
import { loadFixture } from './helpers'

let dir: string
const prev = process.env.CLAUDE_OFFICE_STATE_DIR

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'co-perm-'))
  process.env.CLAUDE_OFFICE_STATE_DIR = dir
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  if (prev === undefined) delete process.env.CLAUDE_OFFICE_STATE_DIR
  else process.env.CLAUDE_OFFICE_STATE_DIR = prev
})

const S = '00000000-0000-4000-8000-000000000001'
const SUB = 'a4d1b0553338ecf74'
const permMain = loadFixture('PermissionRequest.json') // main, Bash
const permSub = loadFixture('PermissionRequest.subagent.json') // SUB, Bash
const prompt = loadFixture('Notification.permission_prompt.json')
const postBash = loadFixture('PostToolUse.Bash.json')
const postRead = loadFixture('PostToolUse.Read.json')
const subStart = loadFixture('SubagentStart.json')
const permAgent = { ...permMain, tool_name: 'Agent', tool_input: { subagent_type: 'Explore' } }

/** 훅 입력을 차례로 흘려 보내고 각 단계의 requester/clear 를 모은다(순수 함수만 사용). */
function run(inputs: [unknown, number][], start: Pending = {}) {
  let pending = start
  const out: ReturnType<typeof permissionStep>[] = []
  for (const [input, ms] of inputs) {
    const step = permissionStep(input, pending, ms)
    if (step.next) pending = step.next
    out.push(step)
  }
  return { pending, out }
}

describe('C1 기록 형식', () => {
  it('옛 형식(number)은 tool 없음, 새 형식은 tool·notified 를 읽는다', () => {
    expect(
      parsePending({ main: 1000, a1: { ts: 2000, tool: 'Bash', notified: true } }, 3000),
    ).toEqual({
      main: { ts: 1000 },
      a1: { ts: 2000, tool: 'Bash', notified: true },
    })
  })

  it('이상한 항목·도구 이름이 아닌 값은 버린다, 오래된 요청은 잊는다', () => {
    expect(
      parsePending(
        {
          '../x': 1,
          a1: { ts: 'x' },
          a2: { ts: 10, tool: '/Users/alice/secret file', notified: 'yes' },
          a3: [1],
          old: 0,
        },
        PENDING_MAX_AGE_MS + 1,
      ),
    ).toEqual({ a2: { ts: 10 } })
    expect(parsePending('nope', 0)).toEqual({})
    expect(parsePending([1], 0)).toEqual({})
  })

  it('파일 왕복: 옛 형식 파일도 읽고, 새 형식으로 쓴다. 비면 파일 삭제', () => {
    const file = join(dir, `perm-${S}.json`)
    writeFileSync(file, JSON.stringify({ main: 1000 }))
    expect(loadPending(S, 2000)).toEqual({ main: { ts: 1000 } })
    savePending(S, { main: { ts: 1000, tool: 'Bash', notified: true } })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      main: { ts: 1000, tool: 'Bash', notified: true },
    })
    savePending(S, {})
    expect(existsSync(file)).toBe(false)
  })

  it('PermissionRequest 는 도구 이름만 저장한다(입력·경로 없음)', () => {
    const { pending } = run([[permMain, 1000]])
    expect(pending).toEqual({ main: { ts: 1000, tool: 'Bash' } })
    expect(JSON.stringify(pending)).not.toContain('command')
  })

  it('이상한 session id·깨진 파일에도 throw 없음', () => {
    expect(trackPermission({ ...permMain, session_id: '../x' }, 0)).toEqual({})
    writeFileSync(join(dir, 'perm-s3.json'), 'not json')
    expect(loadPending('s3', 0)).toEqual({})
    expect(trackPermission(null, 0)).toEqual({})
  })
})

describe('C2 Notification(permission_prompt) → notified', () => {
  it('가장 최근 요청에 귀속하고 notified 표시', () => {
    const { pending, out } = run([
      [permMain, 1000],
      [permSub, 2000],
      [prompt, 8000],
    ])
    expect(out[2]?.requester).toBe(SUB)
    expect(pending[SUB]).toEqual({ ts: 2000, tool: 'Bash', notified: true })
    expect(pending.main?.notified).toBeUndefined()
  })

  it('이미 확인 창이 귀속된 요청보다 아직 안 된 요청을 고른다', () => {
    const { out } = run([
      [permMain, 1000],
      [permSub, 2000],
      [prompt, 3000],
      [prompt, 4000],
    ])
    expect(out[2]?.requester).toBe(SUB)
    expect(out[3]?.requester).toBe('main')
  })

  it('기록이 없으면 귀속 없음, idle_prompt 는 무시', () => {
    expect(permissionStep(prompt, {}, 0)).toEqual({})
    const idle = loadFixture('Notification.idle_prompt.json')
    expect(permissionStep(idle, { main: { ts: 0 } }, 0)).toEqual({})
  })
})

describe('C3 clear 판단', () => {
  it('메인 Bash 허락: 같은 도구의 PostToolUse 에서 clear + 기록 삭제', () => {
    const { pending, out } = run([
      [permMain, 1000],
      [prompt, 7000],
      [postBash, 9000],
    ])
    expect(out[2]?.clear).toEqual({ agentId: 'main', key: postBash.tool_use_id })
    expect(pending).toEqual({})
  })

  it('확인 창이 12분 떠 있다가 허락돼도 clear (2026-10-25 캡처)', () => {
    const fail = loadFixture('PostToolUseFailure.Bash-fail.json')
    const { out } = run([
      [permMain, 0],
      [prompt, 6000],
      [fail, 12 * 60 * 1000],
    ])
    expect(out[2]?.clear).toMatchObject({ agentId: 'main' })
  })

  it('PostToolUseFailure 도 허락 뒤 끝난 것', () => {
    const fail = loadFixture('PostToolUseFailure.Bash-fail.json')
    const { out } = run([
      [permMain, 1000],
      [prompt, 7000],
      [fail, 9000],
    ])
    expect(out[2]?.clear).toMatchObject({ agentId: 'main' })
  })

  it('메인 Agent 허락: SubagentStart 에서 요청자(main)에 clear, 키는 새 서브에이전트 id', () => {
    const { pending, out } = run([
      [permAgent, 1000],
      [prompt, 7000],
      [subStart, 9000],
    ])
    expect(out[2]?.clear).toEqual({ agentId: 'main', key: subStart.agent_id })
    expect(pending).toEqual({})
    // 나중의 PostToolUse(Agent) 는 clear 를 다시 만들지 않는다
    const postAgent = loadFixture('PostToolUse.Agent.json')
    expect(permissionStep(postAgent, pending, 60_000).clear).toBeUndefined()
  })

  it('서브에이전트 요청 허락: 그 서브에이전트의 PostToolUse 에서 그 에이전트에 clear', () => {
    const postSub = {
      hook_event_name: 'PostToolUse',
      session_id: S,
      agent_id: SUB,
      agent_type: 'hook-integrator',
      tool_name: 'Bash',
      tool_use_id: 'toolu_sub',
    }
    // 메인의 Bash 가 끝나도 서브의 요청은 그대로
    const { pending, out } = run([
      [permSub, 1000],
      [prompt, 7000],
      [postBash, 8000],
      [postSub, 9000],
    ])
    expect(out[2]?.clear).toBeUndefined()
    expect(out[3]?.clear).toEqual({ agentId: SUB, key: 'toolu_sub' })
    expect(pending).toEqual({})
  })

  it('자동 허용(확인 창 없음): 기록은 지우지만 clear 는 보내지 않는다', () => {
    const { pending, out } = run([
      [permMain, 1000],
      [postBash, 3000],
    ])
    expect(out[1]?.clear).toBeUndefined()
    expect(out[1]?.next).toEqual({})
    expect(pending).toEqual({})
    // Agent 자동 허용 + SubagentStart 도 마찬가지
    const r2 = run([
      [permAgent, 1000],
      [subStart, 2000],
    ])
    expect(r2.out[1]?.clear).toBeUndefined()
    expect(r2.pending).toEqual({})
  })

  it('확인 창 중 병렬 Read 의 PreToolUse·PostToolUse 는 clear 하지 않고 기록도 남긴다', () => {
    const preRead = loadFixture('PreToolUse.Read.json')
    const { pending, out } = run([
      [permMain, 1000],
      [preRead, 1100], // 같은 배치로 함께 시작(유예 시간 안)
      [prompt, 7000],
      [postRead, 7500],
      [postBash, 9000],
    ])
    expect(out[1]?.next).toBeUndefined()
    expect(out[3]?.clear).toBeUndefined()
    expect(out[3]?.next).toBeUndefined()
    expect(out[4]?.clear).toMatchObject({ agentId: 'main' })
    expect(pending).toEqual({})
  })

  it('옛 형식 기록(tool 없음)은 도구 이름을 보지 않는다', () => {
    const { out } = run([[postRead, 2000]], { main: { ts: 1000, notified: true } })
    expect(out[0]?.clear).toMatchObject({ agentId: 'main' })
  })

  it('유령 SubagentStart(agent_type 없음)는 Agent 요청을 건드리지 않는다', () => {
    const start: Pending = { main: { ts: 1000, tool: 'Agent', notified: true } }
    const ghost = { ...subStart, agent_type: '' }
    expect(permissionStep(ghost, start, 2000)).toEqual({})
  })

  it('메인 거절 실제 순서(2026-10-25 캡처): 거절 뒤 훅 없음 → 다음 UserPromptSubmit 에서 정리, clear 없음', () => {
    const preBash = loadFixture('PreToolUse.Bash.json')
    const subPre = loadFixture('PreToolUse.subagent-Read.json')
    const { pending, out } = run([
      [preBash, 0],
      [permMain, 98],
      [subPre, 1700], // 다른 에이전트(서브)의 행동은 main 기록을 건드리지 않는다
      [prompt, 6140],
      [loadFixture('UserPromptSubmit.json'), 109_000],
    ])
    expect(out[3]?.requester).toBe('main')
    expect(out.every((s) => s.clear === undefined)).toBe(true)
    expect(pending).toEqual({})
  })

  describe('정리만(이벤트 없음) — 거절 뒤', () => {
    const denied: Pending = {
      main: { ts: 1000, tool: 'Bash', notified: true },
      [SUB]: { ts: 1000, tool: 'Bash', notified: true },
    }

    it('그 에이전트의 다음 PreToolUse(유예 시간 뒤)에서 기록 삭제', () => {
      const preRead = loadFixture('PreToolUse.Read.json')
      const step = permissionStep(preRead, denied, 1000 + PRE_TOOL_GRACE_MS)
      expect(step.clear).toBeUndefined()
      expect(step.next).toEqual({ [SUB]: denied[SUB] })
    })

    it('그 서브에이전트의 SubagentStop 에서 삭제', () => {
      const stop = { ...loadFixture('SubagentStop.json'), agent_id: SUB }
      const step = permissionStep(stop, denied, 20_000)
      expect(step.clear).toBeUndefined()
      expect(step.next).toEqual({ main: denied.main })
    })

    it('메인의 UserPromptSubmit·Stop 에서 main 기록 삭제', () => {
      for (const name of ['UserPromptSubmit.json', 'Stop.json']) {
        const step = permissionStep(loadFixture(name), denied, 20_000)
        expect(step.clear, name).toBeUndefined()
        expect(step.next, name).toEqual({ [SUB]: denied[SUB] })
      }
    })

    it('SessionEnd 는 전부 지운다(파일 삭제)', () => {
      savePending(S, denied)
      expect(trackPermission(loadFixture('SessionEnd.json'), 20_000)).toEqual({})
      expect(existsSync(join(dir, `perm-${S}.json`))).toBe(false)
    })
  })

  it('trackPermission: 파일을 거쳐 같은 결과(프로세스 사이 공유)', () => {
    expect(trackPermission(permAgent, 1000)).toEqual({})
    expect(trackPermission(prompt, 7000)).toEqual({ requester: 'main' })
    expect(trackPermission(subStart, 9000)).toEqual({
      clear: { agentId: 'main', key: subStart.agent_id },
    })
    expect(existsSync(join(dir, `perm-${S}.json`))).toBe(false)
  })
})
