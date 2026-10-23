import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  forgetPermissionRequest,
  latestPermissionRequester,
  PENDING_MAX_AGE_MS,
  rememberPermissionRequest,
} from '../src/permission-state'

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

describe('permission-state', () => {
  it('가장 최근에 요청하고 안 끝난 에이전트를 고른다', () => {
    rememberPermissionRequest('s1', 'main', 1000)
    rememberPermissionRequest('s1', 'a1', 2000)
    expect(latestPermissionRequester('s1', 3000)).toBe('a1')
    // a1 의 도구가 끝나면(자동 허용 등) main 이 남는다
    forgetPermissionRequest('s1', 'a1', 3000)
    expect(latestPermissionRequester('s1', 3000)).toBe('main')
    forgetPermissionRequest('s1', 'main', 3000)
    expect(latestPermissionRequester('s1', 3000)).toBeUndefined()
    expect(existsSync(join(dir, 'perm-s1.json'))).toBe(false)
  })

  it('세션별로 분리, SessionEnd(agentId 없음)는 전부 지운다', () => {
    rememberPermissionRequest('s1', 'a1', 1000)
    rememberPermissionRequest('s2', 'a2', 1000)
    expect(latestPermissionRequester('s2', 1000)).toBe('a2')
    forgetPermissionRequest('s1', undefined, 1000)
    expect(latestPermissionRequester('s1', 1000)).toBeUndefined()
    expect(latestPermissionRequester('s2', 1000)).toBe('a2')
  })

  it('오래된 요청은 무시', () => {
    rememberPermissionRequest('s1', 'a1', 0)
    expect(latestPermissionRequester('s1', PENDING_MAX_AGE_MS + 1)).toBeUndefined()
  })

  it('이상한 session id·깨진 파일에도 throw 없음', () => {
    rememberPermissionRequest('../x', 'a1', 0)
    expect(latestPermissionRequester('../x', 0)).toBeUndefined()
    writeFileSync(join(dir, 'perm-s3.json'), 'not json')
    expect(latestPermissionRequester('s3', 0)).toBeUndefined()
    rememberPermissionRequest('s3', 'a1', 0)
    expect(latestPermissionRequester('s3', 0)).toBe('a1')
  })
})
