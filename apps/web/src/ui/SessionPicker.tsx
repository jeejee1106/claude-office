import { useMemo } from 'react'
import { t } from '../i18n'
import { floorKeyOf, shortId } from '../store/floors'
import { currentFloor, effectiveSessionId } from '../store/officeStore'
import { useLang } from './LangToggle'
import { useOfficeStore, useStoreSelector } from './useStore'

const AUTO = '__auto__'

/**
 * 같은 층(프로젝트) 안의 세션 고르기. 층에 세션이 2개 이상일 때만 보인다.
 * 기본 "자동" = 그 층의 가장 최근 활동 세션. 다른 층으로는 넘어가지 않는다.
 */
export function SessionPicker() {
  const store = useOfficeStore()
  const lang = useLang()
  const office = useStoreSelector((s) => s.office)
  const floor = useStoreSelector(currentFloor)
  const pinned = useStoreSelector((s) => s.pinnedSessionId)
  const effective = useStoreSelector(effectiveSessionId)

  const sessions = useMemo(
    () =>
      Object.values(office.sessions)
        .filter((s) => floor !== null && floorKeyOf(s) === floor)
        .sort((a, b) => Date.parse(b.lastEventAt) - Date.parse(a.lastEventAt)),
    [office, floor],
  )

  if (sessions.length < 2) return null
  const value = pinned !== null && sessions.some((s) => s.id === pinned) ? pinned : AUTO

  return (
    <label className="session-picker">
      {t('session', lang)}
      <select
        value={value}
        onChange={(ev) => store.selectSession(ev.target.value === AUTO ? null : ev.target.value)}
      >
        <option value={AUTO}>
          {t('auto', lang)}
          {effective ? `: ${shortId(effective)}` : ''})
        </option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {shortId(s.id)}
            {s.endedAt ? ` ${t('ended', lang)}` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
