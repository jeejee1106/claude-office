import type { OfficeState } from '@claude-office/shared'
import { currentFloor, type OfficeStore } from '../store/officeStore'
import { decideSound, type SoundId } from './soundRules'
import type { SoundPlayer } from './synth'

/*
 * store 이벤트 → 효과음. 씬 리스너로 붙어 실시간 event 만 본다.
 * onSnapshot(처음 접속·재접속·층 전환)은 "이전 상태"만 갱신하고 울리지 않는다.
 * 꺼져 있는 동안에도 이전 상태는 따라가므로, 켠 직후 첫 이벤트도 바르게 판단한다.
 */

export interface SoundControllerOptions {
  player: SoundPlayer
  isEnabled: () => boolean
  now?: () => number
}

export function attachSoundController(
  store: OfficeStore,
  opts: SoundControllerOptions,
): () => void {
  const now = opts.now ?? (() => Date.now())
  let prev: OfficeState = store.getState().office
  const lastPlayed: Partial<Record<SoundId, number>> = {}

  return store.addSceneListener({
    onSnapshot(state) {
      prev = state.office
    },
    onEvent(event, state) {
      const before = prev
      prev = state.office
      if (!opts.isEnabled()) return
      const t = now()
      const id = decideSound({
        event,
        prev: before,
        next: state.office,
        floor: currentFloor(state),
        lastPlayed,
        now: t,
      })
      if (id === null) return
      lastPlayed[id] = t
      opts.player.play(id)
    },
  })
}
