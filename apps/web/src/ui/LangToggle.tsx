import { useSyncExternalStore } from 'react'
import { getLang, LANGS, type Lang, setLang, subscribeLang, t } from '../i18n'

/** 현재 언어 구독(바뀌면 다시 그림) */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang)
}

const NAME: Record<Lang, string> = { ko: '한국어', en: 'EN' }

/** 언어 토글 — 한국어 기본, 영어 옵션 (기획서 2절). 대사는 다음 말풍선부터 바뀐다 */
export function LangToggle() {
  const lang = useLang()
  return (
    <fieldset className="lang-toggle" aria-label={t('language', lang)}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          className={l === lang ? 'lang-btn selected' : 'lang-btn'}
          aria-pressed={l === lang}
          onClick={() => setLang(l)}
        >
          {NAME[l]}
        </button>
      ))}
    </fieldset>
  )
}
