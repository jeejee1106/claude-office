import { useEffect, useSyncExternalStore } from 'react'
import { t } from '../i18n'
import { attachSoundController } from '../sound/soundController'
import { getSoundEnabled, setSoundEnabled, subscribeSound } from '../sound/soundSettings'
import { createWebAudioSynth } from '../sound/synth'
import { useLang } from './LangToggle'
import { useOfficeStore } from './useStore'

/** 화면 하나에 AudioContext 하나 */
const player = createWebAudioSynth()

function useSoundEnabled(): boolean {
  return useSyncExternalStore(subscribeSound, getSoundEnabled)
}

/**
 * 상단 바의 소리 켜기/끄기 버튼 + store 이벤트 → 효과음 연결 (기획서 7절 "효과음").
 * 켜 둔 채 새로고침하면 브라우저가 첫 클릭·키 입력 전에는 소리를 막으므로, 그때 한 번 unlock 한다.
 */
export function SoundToggle() {
  const lang = useLang()
  const store = useOfficeStore()
  const on = useSoundEnabled()

  useEffect(() => attachSoundController(store, { player, isEnabled: getSoundEnabled }), [store])

  useEffect(() => {
    if (!on) return
    const unlock = () => player.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [on])

  return (
    <button
      type="button"
      className={on ? 'sound-toggle on' : 'sound-toggle'}
      aria-pressed={on}
      title={t(on ? 'soundOffHint' : 'soundOnHint', lang)}
      onClick={() => {
        if (!on) player.unlock()
        setSoundEnabled(!on)
      }}
    >
      {t(on ? 'soundOn' : 'soundOff', lang)}
    </button>
  )
}
