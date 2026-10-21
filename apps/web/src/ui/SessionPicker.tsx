import { useMemo } from 'react'
import { t } from '../i18n'
import { effectiveSessionId } from '../store/officeStore'
import { useLang } from './LangToggle'
import { useOfficeStore, useStoreSelector } from './useStore'

const AUTO = '__auto__'

export function SessionPicker() {
  const store = useOfficeStore()
  const lang = useLang()
  const office = useStoreSelector((s) => s.office)
  const selected = useStoreSelector((s) => s.selectedSessionId)
  const effective = useStoreSelector(effectiveSessionId)

  const sessions = useMemo(
    () =>
      Object.values(office.sessions).sort(
        (a, b) => Date.parse(b.lastEventAt) - Date.parse(a.lastEventAt),
      ),
    [office],
  )

  if (sessions.length === 0) return <span className="session-empty">{t('noSession', lang)}</span>

  return (
    <label className="session-picker">
      {t('session', lang)}
      <select
        value={selected ?? AUTO}
        onChange={(ev) => store.selectSession(ev.target.value === AUTO ? null : ev.target.value)}
      >
        <option value={AUTO}>
          {t('auto', lang)}
          {effective ? `: ${short(effective)}` : ''})
        </option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.project ?? short(s.id)} · {short(s.id)}
            {s.endedAt ? ` ${t('ended', lang)}` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

const short = (id: string) => (id.length > 10 ? `${id.slice(0, 10)}…` : id)
