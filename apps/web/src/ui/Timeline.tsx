import { useMemo } from 'react'
import { baseName, displayNames } from '../employeeSettings'
import { t } from '../i18n'
import { eventsOnFloor } from '../store/floors'
import { currentFloor } from '../store/officeStore'
import { describeEvent, formatTime } from './describe'
import { useEmployees } from './EmployeeSettings'
import { useLang } from './LangToggle'
import { useOfficeStore, useStoreSelector } from './useStore'

/** 최근 이벤트(최신이 위). 현재 층의 것만 보여 준다. 클릭하면 해당 캐릭터를 하이라이트한다 */
export function Timeline() {
  const store = useOfficeStore()
  const lang = useLang()
  const recent = useStoreSelector((s) => s.recent)
  const office = useStoreSelector((s) => s.office)
  const floor = useStoreSelector(currentFloor)
  const highlight = useStoreSelector((s) => s.highlightAgentId)
  const onFloor = useMemo(() => eventsOnFloor(office, recent, floor), [office, recent, floor])
  const items = [...onFloor].reverse()
  const employees = useEmployees()
  // 세션별 표시 이름(이름표·직원 목록과 같은 규칙)
  const names = useMemo(() => {
    const bySession = new Map<string, Map<string, string>>()
    for (const e of onFloor) {
      if (!bySession.has(e.sessionId))
        bySession.set(e.sessionId, displayNames(office.sessions[e.sessionId], employees))
    }
    return bySession
  }, [onFloor, office, employees])
  const who = (sessionId: string, agentId: string) =>
    names.get(sessionId)?.get(agentId) ??
    baseName(agentId, office.sessions[sessionId]?.agents[agentId]?.type, employees)

  return (
    <section className="panel timeline">
      <h2>
        {t('recent', lang)} ({onFloor.length})
      </h2>
      <ol>
        {items.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              className={`${e.agentId === highlight ? 'selected' : ''} kind-${e.kind.replace('.', '-')}${
                e.kind === 'tool.end' && e.status === 'error' ? ' error' : ''
              }`}
              onClick={() => store.setHighlight(e.agentId === highlight ? null : e.agentId)}
            >
              <time>{formatTime(e.ts, lang)}</time>
              <span className="who">{who(e.sessionId, e.agentId)}</span>
              <span className="what">{describeEvent(e, lang)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
