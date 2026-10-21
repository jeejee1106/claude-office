#!/usr/bin/env node
// 샘플 세션(JSONL)의 OfficeEvent를 실행 중인 Claude Office 서버로 전송하고 /api/state 요약을 출력한다.
// Claude Code 없이 server→web 흐름을 검증할 때 사용한다. Node 18+ (내장 fetch).
//
// 사용법:
//   node send-fixture-events.mjs [--file <jsonl>] [--url http://127.0.0.1:PORT] [--speed 4] [--instant]
//   --file     기본값: 이 스크립트 옆 ../assets/sample-session.jsonl
//   --url      기본값: $CLAUDE_OFFICE_URL 의 origin 또는 http://127.0.0.1:7333
//   --speed    ts 간격을 이 배속으로 재현 (기본 4)
//   --instant  간격 없이 바로 전송
// 종료 코드: 모든 이벤트가 2xx면 0, 하나라도 실패하면 1.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const file = opt('file', join(here, '../assets/sample-session.jsonl'))
const envOrigin = process.env.CLAUDE_OFFICE_URL ? new URL(process.env.CLAUDE_OFFICE_URL).origin : null
const base = opt('url', envOrigin ?? 'http://127.0.0.1:7333').replace(/\/$/, '')
const speed = Number(opt('speed', '4'))
const instant = argv.includes('--instant')

const events = readFileSync(file, 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !l.trim().startsWith('//'))
  .map((l) => JSON.parse(l))

// 실행마다 새 세션으로 보이도록 id와 sessionId를 새로 붙이고, ts는 원래 간격을 유지한 채 현재 시각으로 옮긴다.
const sessionSuffix = randomUUID().slice(0, 8)
const t0 = Date.parse(events[0].ts)
const now = Date.now()
const prepared = events.map((e) => ({
  ...e,
  id: randomUUID(),
  sessionId: `${e.sessionId}-${sessionSuffix}`,
  ts: new Date(now + (Date.parse(e.ts) - t0) / (instant ? Infinity : speed)).toISOString(),
}))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
for (let i = 0; i < prepared.length; i++) {
  const e = prepared[i]
  if (!instant && i > 0) {
    await sleep(Math.max(0, (Date.parse(events[i].ts) - Date.parse(events[i - 1].ts)) / speed))
  }
  try {
    const res = await fetch(`${base}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(e),
    })
    const tag = res.ok ? 'ok ' : 'ERR'
    if (!res.ok) failed++
    console.log(`${tag} ${res.status} ${e.kind.padEnd(16)} agent=${e.agentId}${e.tool ? ` tool=${e.tool.name}` : ''}`)
    if (!res.ok) console.log(`    ${(await res.text()).slice(0, 300)}`)
  } catch (err) {
    failed++
    console.log(`ERR --- ${e.kind} ${err.cause?.code ?? err.message}`)
    if (i === 0) {
      console.error(`서버(${base})에 연결할 수 없습니다. 서버를 먼저 실행하세요.`)
      process.exit(1)
    }
  }
}

try {
  const state = await (await fetch(`${base}/api/state`)).json()
  const session = Object.entries(state.sessions ?? {}).find(([id]) => id.endsWith(sessionSuffix))
  console.log('\n/api/state 요약 (이번 실행 세션):')
  console.log(JSON.stringify(session ? session[1] : '(세션 없음)', null, 2).slice(0, 2000))
} catch (err) {
  console.log(`\n/api/state 조회 실패: ${err.message}`)
}

console.log(`\n전송 ${prepared.length}건, 실패 ${failed}건`)
process.exit(failed ? 1 : 0)
