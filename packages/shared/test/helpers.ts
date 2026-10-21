import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SAMPLE = fileURLToPath(new URL('../../../fixtures/sample-session.jsonl', import.meta.url))

/** fixtures/sample-session.jsonl 의 각 줄(검증 전 원시 JSON) */
export function loadSample(): unknown[] {
  return readFileSync(SAMPLE, 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('//'))
    .map((l) => JSON.parse(l) as unknown)
}
