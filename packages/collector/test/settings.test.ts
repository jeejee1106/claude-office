import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addOurHooks,
  formatSettings,
  HOOK_EVENTS,
  HOOK_MARKER,
  hookCommand,
  lineDiff,
  removeOurHooks,
  type Settings,
} from '../src/settings'
import { CLI_BIN, HOOK_BIN } from './helpers'

/** 다른 도구의 훅이 이미 있는 settings.json */
const EXISTING: Settings = {
  model: 'sonnet',
  permissions: { allow: ['Bash(npm test)'] },
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: '/usr/local/bin/my-guard.sh', timeout: 10 }],
      },
    ],
    Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
    ConfigChange: [{ matcher: 'user_settings', hooks: [{ type: 'command', command: 'audit' }] }],
  },
}

const CMD = hookCommand('/opt/claude-office/packages/collector/dist/claude-office-hook.js')

const ours = (s: Settings): number =>
  Object.values((s.hooks ?? {}) as Record<string, { hooks: { command: string }[] }[]>)
    .flat()
    .flatMap((g) => g.hooks)
    .filter((h) => h.command.includes(HOOK_MARKER)).length

describe('settings (순수 함수)', () => {
  it('add: 기존 훅을 보존하고 모든 이벤트에 하나씩 추가', () => {
    const next = addOurHooks(EXISTING, CMD)
    expect(ours(next)).toBe(HOOK_EVENTS.length)
    const hooks = next.hooks as Record<string, unknown[]>
    expect(hooks.PreToolUse?.[0]).toEqual(
      (EXISTING.hooks as Record<string, unknown[]>).PreToolUse?.[0],
    )
    expect(hooks.ConfigChange).toEqual((EXISTING.hooks as Record<string, unknown[]>).ConfigChange)
    expect(next.model).toBe('sonnet')
    expect(hooks.SubagentStart).toEqual([
      { hooks: [{ type: 'command', command: CMD, timeout: 5 }] },
    ])
  })

  it('add 는 멱등: 두 번 해도 같다', () => {
    const once = addOurHooks(EXISTING, CMD)
    expect(addOurHooks(once, CMD)).toEqual(once)
  })

  it('add 는 경로가 바뀌면 갱신(중복 없음)', () => {
    const once = addOurHooks(EXISTING, CMD)
    const moved = addOurHooks(once, hookCommand('/new/place/claude-office-hook.js'))
    expect(ours(moved)).toBe(HOOK_EVENTS.length)
    expect(JSON.stringify(moved)).not.toContain('/opt/claude-office')
  })

  it('add → remove 왕복은 원본과 같다', () => {
    const round = removeOurHooks(addOurHooks(EXISTING, CMD))
    expect(round.removed).toBe(HOOK_EVENTS.length)
    expect(round.settings).toEqual(EXISTING)
  })

  it('훅이 없던 설정은 왕복 후 hooks 키도 사라진다', () => {
    const plain = { model: 'opus' }
    expect(removeOurHooks(addOurHooks(plain, CMD)).settings).toEqual(plain)
  })

  it('remove 는 같은 그룹 안의 남의 핸들러를 남긴다', () => {
    const mixed: Settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: '',
            hooks: [
              { type: 'command', command: 'other-tool' },
              { type: 'command', command: CMD },
            ],
          },
        ],
      },
    }
    expect(removeOurHooks(mixed).settings).toEqual({
      hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'other-tool' }] }] },
    })
  })

  it('remove: 우리 항목이 없으면 그대로', () => {
    expect(removeOurHooks(EXISTING)).toEqual({ settings: EXISTING, removed: 0 })
  })

  it('형식이 이상하면 throw (파일을 건드리지 않게)', () => {
    expect(() => addOurHooks({ hooks: [] }, CMD)).toThrow(/must be an object/)
    expect(() => addOurHooks({ hooks: { Stop: {} } }, CMD)).toThrow(/must be an array/)
  })

  it('hookCommand 는 표식이 없는 경로를 거부', () => {
    expect(() => hookCommand('/x/hook.js')).toThrow()
  })

  it('lineDiff 는 추가 줄을 + 로 보여 준다', () => {
    const d = lineDiff('{\n  "a": 1\n}\n', '{\n  "a": 1,\n  "b": 2\n}\n')
    expect(d).toContain('+   "b": 2')
    expect(d).toContain('-   "a": 1')
  })
})

describe('claude-office CLI (임시 settings.json)', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'claude-office-test-'))
    file = join(dir, '.claude', 'settings.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const cli = (...args: string[]) =>
    spawnSync(process.execPath, [CLI_BIN, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: dir },
    })

  it('install → install → uninstall 왕복: 원본 텍스트와 같고 .bak 이 남는다', () => {
    const original = formatSettings(EXISTING)
    execFileSync('mkdir', ['-p', join(dir, '.claude')])
    writeFileSync(file, original)

    const first = cli('install', '--settings', file)
    expect(first.status).toBe(0)
    expect(first.stdout).toMatch(/^\+ +"command": "node \\".*claude-office-hook\.js\\""/m)
    expect(first.stdout).toContain('backup:')
    expect(readFileSync(`${file}.bak`, 'utf8')).toBe(original)
    const installed = JSON.parse(readFileSync(file, 'utf8')) as Settings
    expect(ours(installed)).toBe(HOOK_EVENTS.length)
    expect(JSON.stringify(installed)).toContain(HOOK_BIN)

    const second = cli('install', '--settings', file)
    expect(second.status).toBe(0)
    expect(second.stdout).toContain('already installed')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(installed)

    const removed = cli('uninstall', '--settings', file)
    expect(removed.status).toBe(0)
    expect(readFileSync(file, 'utf8')).toBe(original)

    const again = cli('uninstall', '--settings', file)
    expect(again.stdout).toContain('Nothing changed')
  })

  it('--user 는 HOME/.claude/settings.json, 없으면 새로 만든다', () => {
    const r = cli('install', '--user')
    expect(r.status).toBe(0)
    expect(existsSync(file)).toBe(true)
    expect(existsSync(`${file}.bak`)).toBe(false)
    cli('uninstall', '--user')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({})
  })

  it('--dry-run 은 쓰지 않는다', () => {
    const r = cli('install', '--settings', file, '--dry-run')
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('[dry-run]')
    expect(existsSync(file)).toBe(false)
  })

  it('잘못된 JSON 은 건드리지 않고 exit 1', () => {
    execFileSync('mkdir', ['-p', join(dir, '.claude')])
    writeFileSync(file, '{ not json')
    const r = cli('install', '--settings', file)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('not valid JSON')
    expect(readFileSync(file, 'utf8')).toBe('{ not json')
  })

  it('대상 옵션은 하나만, 모르는 명령은 exit 1', () => {
    expect(cli('install', '--user', '--project').status).toBe(1)
    expect(cli('frobnicate').status).toBe(1)
    expect(cli('--help').status).toBe(0)
  })
})
