import { useSyncExternalStore } from 'react'
import { getDecorChoice, setDecorChoice, subscribeDecor } from '../decorSettings'
import { t, type UiKey } from '../i18n'
import { DECOR_CHOICES, type DecorChoice, isDecorChoice } from '../scene/decor'
import { useLang } from './LangToggle'

const LABEL: Readonly<Record<DecorChoice, UiKey>> = {
  auto: 'decorAuto',
  off: 'decorOff',
  spring: 'decorSpring',
  summer: 'decorSummer',
  halloween: 'decorHalloween',
  autumn: 'decorAutumn',
  christmas: 'decorChristmas',
}

/** 상단 바 "장식" 고르기 (기획서 3절 "계절 장식"). 자동(기본)·끄기·계절 미리 보기, 브라우저에 기억 */
export function DecorPicker() {
  const lang = useLang()
  const choice = useSyncExternalStore(subscribeDecor, getDecorChoice)
  return (
    <label className="session-picker decor-picker" title={t('decorHint', lang)}>
      {t('decor', lang)}
      <select
        value={choice}
        onChange={(ev) => {
          if (isDecorChoice(ev.target.value)) setDecorChoice(ev.target.value)
        }}
      >
        {DECOR_CHOICES.map((c) => (
          <option key={c} value={c}>
            {t(LABEL[c], lang)}
          </option>
        ))}
      </select>
    </label>
  )
}
