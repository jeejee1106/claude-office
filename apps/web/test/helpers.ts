import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { OfficeEvent } from '@claude-office/shared'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/sample-session.jsonl', import.meta.url))

/** fixtures/sample-session.jsonl → OfficeEvent[] (모든 줄을 계약으로 검증) */
export function loadSampleSession(): OfficeEvent[] {
  return readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('//'))
    .map((l) => OfficeEvent.parse(JSON.parse(l)))
}

let n = 0
/** 테스트용 이벤트 생성(계약 parse 를 거친다) */
export function ev(partial: Record<string, unknown>): OfficeEvent {
  n++
  return OfficeEvent.parse({
    v: 1,
    id: `t${n}`,
    ts: '2026-01-01T00:00:00.000Z',
    sessionId: 's',
    agentId: 'main',
    ...partial,
  })
}
