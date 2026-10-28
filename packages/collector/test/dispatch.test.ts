import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { dispatch, webDistDir } from '../src/dispatch'
import { CLI_BIN, HOOK_BIN, PKG_ROOT } from './helpers'

describe('dispatch (claude-office 첫 인자 판정)', () => {
  it('인자가 없으면 서버 실행', () => {
    expect(dispatch([])).toEqual({ kind: 'server', args: [] })
  })

  it('- 로 시작하면 서버 옵션으로 보고 argv 전체를 서버에 넘긴다', () => {
    expect(dispatch(['--port', '7444'])).toEqual({ kind: 'server', args: ['--port', '7444'] })
    expect(dispatch(['--replay', 'a.jsonl', '--loop'])).toEqual({
      kind: 'server',
      args: ['--replay', 'a.jsonl', '--loop'],
    })
    expect(dispatch(['--', '--port', '1'])).toEqual({ kind: 'server', args: ['--', '--port', '1'] })
  })

  it('help / --help / -h 는 전체 도움말', () => {
    for (const a of ['help', '--help', '-h']) expect(dispatch([a])).toEqual({ kind: 'help' })
  })

  it('install / uninstall 은 나머지 인자를 그대로 넘긴다', () => {
    expect(dispatch(['install', '--project', '--dry-run'])).toEqual({
      kind: 'install',
      args: ['--project', '--dry-run'],
    })
    expect(dispatch(['uninstall'])).toEqual({ kind: 'uninstall', args: [] })
  })

  it('그 밖의 단어는 unknown', () => {
    expect(dispatch(['frobnicate'])).toEqual({ kind: 'unknown', command: 'frobnicate' })
    expect(dispatch(['start', '--port', '1'])).toEqual({ kind: 'unknown', command: 'start' })
  })
})

describe('webDistDir', () => {
  const repo = resolve(PKG_ROOT, '..', '..')
  const expected = join(repo, 'apps', 'web', 'dist')

  it('번들(dist/claude-office.js)과 소스(src/cli.ts) 모두 저장소의 apps/web/dist 를 가리킨다', () => {
    expect(webDistDir(pathToFileURL(CLI_BIN).href)).toBe(expected)
    expect(
      webDistDir(pathToFileURL(join(repo, 'packages', 'collector', 'src', 'cli.ts')).href),
    ).toBe(expected)
  })
})

describe('claude-office 번들 프로세스', () => {
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      timeout: 10_000,
    })

  it('help 는 서버 실행과 install/uninstall 을 함께 설명하고 exit 0', () => {
    const r = cli('help')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('--port')
    expect(r.stdout).toContain('claude-office install')
    expect(r.stdout).toContain('claude-office uninstall')
  })

  it('서버 옵션 경로는 번들 안의 서버로 간다(잘못된 포트 → 리슨 없이 exit 1)', () => {
    const r = cli('--port', 'abc')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('invalid port')
  })

  it('훅 번들에는 서버 코드가 들어가지 않는다', () => {
    const hook = readFileSync(HOOK_BIN, 'utf8')
    expect(hook).not.toContain('fastify')
  })
})
