/*
 * 효과음 켜기/끄기 — 기본 꺼짐, 뷰어별 편의 설정이라 localStorage 에만 둔다 (기획서 7절 "효과음").
 * 읽기·쓰기 실패(사생활 보호 창 등)해도 이번 화면에서는 적용된다.
 */

const STORAGE_KEY = 'claude-office.sound'
let enabled = readStored()
const listeners = new Set<() => void>()

function readStored(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

export function getSoundEnabled(): boolean {
  return enabled
}

export function setSoundEnabled(on: boolean): void {
  if (on === enabled) return
  enabled = on
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, on ? 'on' : 'off')
  } catch {
    // 저장 실패해도 이번 화면에서는 적용된다
  }
  for (const l of listeners) l()
}

export function subscribeSound(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
