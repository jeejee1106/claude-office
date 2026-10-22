import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NormalizeContext } from '../src/normalize'

export const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url))
export const FIXTURE_DIR = join(PKG_ROOT, 'test', 'fixtures')
export const HOOK_BIN = join(PKG_ROOT, 'dist', 'claude-office-hook.js')
export const CLI_BIN = join(PKG_ROOT, 'dist', 'claude-office.js')

export function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
}

export function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as Record<string, unknown>
}

/** 결정적 컨텍스트: 고정 시각 + 순번 ID */
export function fixedContext(overrides: Partial<NormalizeContext> = {}): NormalizeContext {
  let n = 0
  return {
    now: () => new Date('2026-10-22T00:00:00.000Z'),
    newId: () => `id-${++n}`,
    ...overrides,
  }
}
