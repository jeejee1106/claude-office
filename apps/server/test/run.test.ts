import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { DEFAULT_WEB_DIST, hasWebDist, resolveWebDist } from '../src/app'
import { runServer } from '../src/run'

class ExitCalled extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`)
  }
}

describe('runServer argument handling', () => {
  let exitSpy: MockInstance
  let logSpy: MockInstance
  let errSpy: MockInstance

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitCalled(code as number | undefined)
    })
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('--help prints usage with the hook install line and does not exit', async () => {
    await runServer(['--help'], { webDistDir: false })
    expect(exitSpy).not.toHaveBeenCalled()
    const out = String(logSpy.mock.calls[0]?.[0])
    expect(out).toContain('Usage: claude-office [options]')
    expect(out).toContain('claude-office install | uninstall')
  })

  it('-h works the same and ignores a leading "--"', async () => {
    await runServer(['--', '-h'])
    expect(exitSpy).not.toHaveBeenCalled()
    expect(String(logSpy.mock.calls[0]?.[0])).toContain('Usage:')
  })

  it('invalid port exits 1 with a message', async () => {
    await expect(runServer(['--port', 'abc'])).rejects.toBeInstanceOf(ExitCalled)
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(String(errSpy.mock.calls[0]?.[0])).toBe('claude-office: invalid port: abc')
  })

  it('out-of-range port exits 1', async () => {
    await expect(runServer(['--port', '70000'])).rejects.toBeInstanceOf(ExitCalled)
    expect(String(errSpy.mock.calls[0]?.[0])).toContain('invalid port: 70000')
  })

  it('unknown option exits 1 and shows help, prefixed with progName', async () => {
    await expect(runServer(['--nope'], { progName: 'co' })).rejects.toBeInstanceOf(ExitCalled)
    expect(exitSpy).toHaveBeenCalledWith(1)
    const msg = String(errSpy.mock.calls[0]?.[0])
    expect(msg.startsWith('co: ')).toBe(true)
    expect(msg).toContain('Usage: claude-office [options]')
  })

  it('positional argument is rejected', async () => {
    await expect(runServer(['serve'])).rejects.toBeInstanceOf(ExitCalled)
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('invalid speed exits 1', async () => {
    await expect(runServer(['--speed', '0'])).rejects.toBeInstanceOf(ExitCalled)
    expect(String(errSpy.mock.calls[0]?.[0])).toContain('invalid speed: 0')
  })
})

describe('web dist helpers', () => {
  it('resolveWebDist defaults to DEFAULT_WEB_DIST and keeps false', () => {
    expect(resolveWebDist(undefined)).toBe(DEFAULT_WEB_DIST)
    expect(resolveWebDist(false)).toBe(false)
    expect(resolveWebDist('/x')).toBe('/x')
  })

  it('hasWebDist is true only when index.html exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'co-web-'))
    expect(hasWebDist(dir)).toBe(false)
    expect(hasWebDist(false)).toBe(false)
    await writeFile(join(dir, 'index.html'), '<!doctype html>')
    expect(hasWebDist(dir)).toBe(true)
  })
})
