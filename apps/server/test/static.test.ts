import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app'

describe('static web serving', () => {
  it('serves index.html from webDistDir while API routes keep working', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'co-web-'))
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>office</title>')
    const app = await buildApp({ webDistDir: dir, sweepIntervalMs: 0, heartbeatMs: 0 })
    const root = await app.inject({ url: '/' })
    expect(root.statusCode).toBe(200)
    expect(root.body).toContain('<title>office</title>')
    expect((await app.inject({ url: '/healthz' })).json()).toMatchObject({ ok: true })
    expect((await app.inject({ url: '/api/state' })).json()).toEqual({ sessions: {} })
    await app.close()
  })
})
