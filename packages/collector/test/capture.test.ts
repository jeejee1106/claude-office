import { describe, expect, it } from 'vitest'
import { captureRecord } from '../src/capture'
import { loadFixture } from './helpers'

describe('capture (디버그): 값은 남기지 않는다', () => {
  it('키 이름·식별자 앞 4자·열거형만 남긴다', () => {
    const input = {
      ...loadFixture('PermissionRequest.subagent.json'),
      tool_input: { command: 'TOP-SECRET-1234' },
      message: 'TOP-SECRET-1234',
      prompt: 'TOP-SECRET-1234',
    }
    const rec = captureRecord(input, new Date('2026-10-23T00:00:00Z'))
    const text = JSON.stringify(rec)
    expect(text).not.toContain('TOP-SECRET')
    expect(text).not.toContain('/Users/')
    expect(text).not.toContain('alice')
    expect(rec).toMatchObject({
      hook: 'PermissionRequest',
      agent_id: 'a4d1…',
      session: '0000…',
      agent_type: 'hook-integrator',
      permission_mode: 'auto',
      tool_name: 'Bash',
      has_tool_use_id: false,
    })
    expect(rec.keys).toContain('tool_input')
  })
})
