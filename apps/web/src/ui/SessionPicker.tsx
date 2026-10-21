import { useMemo } from 'react'
import { effectiveSessionId } from '../store/officeStore'
import { useOfficeStore, useStoreSelector } from './useStore'

const AUTO = '__auto__'

export function SessionPicker() {
  const store = useOfficeStore()
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

  if (sessions.length === 0) return <span className="session-empty">세션 없음</span>

  return (
    <label className="session-picker">
      세션
      <select
        value={selected ?? AUTO}
        onChange={(ev) => store.selectSession(ev.target.value === AUTO ? null : ev.target.value)}
      >
        <option value={AUTO}>
          자동 (가장 최근 활성{effective ? `: ${short(effective)}` : ''})
        </option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.project ?? short(s.id)} · {short(s.id)}
            {s.endedAt ? ' (종료)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

const short = (id: string) => (id.length > 10 ? `${id.slice(0, 10)}…` : id)
