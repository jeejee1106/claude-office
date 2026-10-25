import { describe, expect, it } from 'vitest'
import { describeEvent } from '../src/ui/describe'
import { ev } from './helpers'

describe('describeEvent (타임라인 문구)', () => {
  it('attention.clear → "확인 완료" / "Answered", reason 이 있으면 괄호로', () => {
    expect(describeEvent(ev({ kind: 'attention.clear', reason: 'permission' }), 'ko')).toBe(
      '확인 완료 (permission)',
    )
    expect(describeEvent(ev({ kind: 'attention.clear' }), 'ko')).toBe('확인 완료')
    expect(describeEvent(ev({ kind: 'attention.clear', reason: 'permission' }), 'en')).toBe(
      'Answered (permission)',
    )
    expect(describeEvent(ev({ kind: 'attention.clear' }), 'en')).toBe('Answered')
  })
})
