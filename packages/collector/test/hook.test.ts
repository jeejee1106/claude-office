import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OfficeEvent, PATHS } from '@claude-office/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { FIXTURE_DIR, HOOK_BIN } from './helpers'

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  ms: number
}

function runHook(stdin: string, env: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const child = spawn(process.execPath, [HOOK_BIN], {
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += c))
    child.stderr.on('data', (c) => (stderr += c))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: performance.now() - started }))
    child.stdin.end(stdin)
  })
}

const fixture = (name: string) => readFileSync(join(FIXTURE_DIR, name), 'utf8')

/** 아무도 듣지 않는 포트: 서버를 열었다 닫아 얻는다. */
async function closedPortUrl(): Promise<string> {
  const s = createServer()
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  const { port } = s.address() as AddressInfo
  await new Promise<void>((r) => s.close(() => r()))
  return `http://127.0.0.1:${port}${PATHS.events}`
}

let server: Server | undefined
afterEach(async () => {
  if (server) await new Promise<void>((r) => server?.close(() => r()))
  server = undefined
})

interface Captured {
  method: string | undefined
  url: string | undefined
  headers: IncomingMessage['headers']
  body: string
}

async function startCapture(respond: boolean): Promise<{ url: string; got: Promise<Captured> }> {
  let resolveGot: (c: Captured) => void = () => {}
  const got = new Promise<Captured>((r) => (resolveGot = r))
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      resolveGot({ method: req.method, url: req.url, headers: req.headers, body })
      if (respond) {
        res.writeHead(202, { 'content-type': 'application/json' })
        res.end('{"accepted":1,"duplicates":0,"rejected":[]}')
      }
      // respond=false: 응답하지 않음 → 훅 타임아웃 경로
    })
  })
  await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}${PATHS.events}`, got }
}

describe('claude-office-hook 프로세스', () => {
  it('서버가 없으면 300ms 안에 exit 0, stdout·stderr 없음', async () => {
    const url = await closedPortUrl()
    // 첫 실행은 디스크 캐시 영향이 있어 한 번 데운다.
    await runHook(fixture('PreToolUse.Read.json'), { CLAUDE_OFFICE_URL: url })
    const runs: RunResult[] = []
    for (let i = 0; i < 3; i++) {
      runs.push(await runHook(fixture('PreToolUse.Read.json'), { CLAUDE_OFFICE_URL: url }))
    }
    for (const r of runs) {
      expect(r.code).toBe(0)
      expect(r.stdout).toBe('')
      expect(r.stderr).toBe('')
    }
    const best = Math.min(...runs.map((r) => r.ms))
    console.log(`hook latency without server: ${runs.map((r) => r.ms.toFixed(0)).join(', ')} ms`)
    expect(best).toBeLessThan(300)
  })

  it('기본 URL(127.0.0.1:7333)로도 서버 없이 exit 0', async () => {
    // 7333 에 실제 서버가 떠 있으면 이벤트가 하나 들어갈 뿐이고 결과는 같다.
    const r = await runHook(fixture('Stop.json'))
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('POST /events, JSON 단일 객체, Origin 없음 — 서버 계약과 일치 (B2)', async () => {
    const { url, got } = await startCapture(true)
    const r = await runHook(fixture('PreToolUse.subagent-Read.json'), { CLAUDE_OFFICE_URL: url })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
    const req = await got
    expect(req.method).toBe('POST')
    expect(req.url).toBe(PATHS.events)
    expect(req.headers['content-type']).toBe('application/json')
    expect(req.headers.origin).toBeUndefined()
    const body: unknown = JSON.parse(req.body)
    expect(Array.isArray(body)).toBe(false)
    const event = OfficeEvent.parse(body)
    expect(event).toMatchObject({
      kind: 'tool.start',
      agentId: 'a9d6fcc6fccdd5788',
      tool: { name: 'Read', category: 'read', target: 'notes.txt' },
    })
  })

  it('서버가 응답하지 않으면 타임아웃(500ms) 후 exit 0', async () => {
    const { url } = await startCapture(false)
    const r = await runHook(fixture('PreToolUse.Bash.json'), { CLAUDE_OFFICE_URL: url })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.ms).toBeGreaterThanOrEqual(450)
    expect(r.ms).toBeLessThan(1500)
  })

  it.each([
    ['빈 입력', ''],
    ['JSON 아님', 'not json {'],
    ['모르는 훅', JSON.stringify({ hook_event_name: 'ConfigChange', session_id: 's' })],
  ])('%s → 아무것도 보내지 않고 exit 0', async (_label, stdin) => {
    let hits = 0
    server = createServer((_req, res) => {
      hits++
      res.end()
    })
    await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r))
    const { port } = server.address() as AddressInfo
    const res = await runHook(stdin, { CLAUDE_OFFICE_URL: `http://127.0.0.1:${port}/events` })
    expect(res.code).toBe(0)
    expect(res.stdout).toBe('')
    expect(hits).toBe(0)
  })

  it('CLAUDE_OFFICE_DEBUG=1 이면 stderr 에만 진단을 쓴다', async () => {
    const url = await closedPortUrl()
    const r = await runHook(fixture('Stop.json'), {
      CLAUDE_OFFICE_URL: url,
      CLAUDE_OFFICE_DEBUG: '1',
    })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('turn.end not sent')
  })

  it('CLAUDE_OFFICE_DISABLE=1 이면 보내지 않는다', async () => {
    const { url } = await startCapture(true)
    let sent = false
    server?.on('request', () => (sent = true))
    const r = await runHook(fixture('Stop.json'), {
      CLAUDE_OFFICE_URL: url,
      CLAUDE_OFFICE_DISABLE: '1',
    })
    expect(r.code).toBe(0)
    expect(sent).toBe(false)
  })

  it('잘못된 CLAUDE_OFFICE_URL 에도 exit 0', async () => {
    const r = await runHook(fixture('Stop.json'), { CLAUDE_OFFICE_URL: 'ftp://nope' })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
  })

  it('PermissionRequest 는 보내지 않고, 이어진 Notification(permission_prompt)을 요청한 서브에이전트에 귀속', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'co-hook-perm-'))
    const bodies: unknown[] = []
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        bodies.push(JSON.parse(body))
        res.writeHead(202)
        res.end()
      })
    })
    await new Promise<void>((r) => server?.listen(0, '127.0.0.1', r))
    const { port } = server.address() as AddressInfo
    const env = {
      CLAUDE_OFFICE_URL: `http://127.0.0.1:${port}/events`,
      CLAUDE_OFFICE_STATE_DIR: stateDir,
    }
    try {
      const sub = JSON.parse(fixture('PermissionRequest.subagent.json')) as Record<string, unknown>
      expect((await runHook(JSON.stringify(sub), env)).code).toBe(0)
      expect(bodies).toHaveLength(0)
      await runHook(fixture('Notification.permission_prompt.json'), env)
      expect(bodies.at(-1)).toMatchObject({
        kind: 'attention',
        reason: 'permission',
        agentId: 'a4d1b0553338ecf74',
      })
      // 그 서브에이전트의 도구가 끝나면 요청은 지워지고, 다음 확인 창은 main 으로 간다
      const post = {
        hook_event_name: 'PostToolUse',
        session_id: sub.session_id,
        agent_id: sub.agent_id,
        tool_name: 'Bash',
        tool_use_id: 't-perm',
      }
      await runHook(JSON.stringify(post), env)
      await runHook(fixture('Notification.permission_prompt.json'), env)
      expect(bodies.at(-1)).toMatchObject({ kind: 'attention', agentId: 'main' })
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})
