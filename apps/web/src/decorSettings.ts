import { type DecorChoice, isDecorChoice } from './scene/decor'

/*
 * 계절 장식 고르기(기획서 3절 "계절 장식") — 기본 자동. 뷰어별 편의 설정이라 localStorage 에만 둔다.
 * 읽기·쓰기 실패(사생활 보호 창 등)해도 이번 화면에서는 적용된다.
 */

const STORAGE_KEY = 'claude-office.decor'
let choice: DecorChoice = readStored()
const listeners = new Set<() => void>()

function readStored(): DecorChoice {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY)
    return isDecorChoice(v) ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function getDecorChoice(): DecorChoice {
  return choice
}

export function setDecorChoice(next: DecorChoice): void {
  if (next === choice) return
  choice = next
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next)
  } catch {
    // 저장 실패해도 이번 화면에서는 적용된다
  }
  for (const l of listeners) l()
}

export function subscribeDecor(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
