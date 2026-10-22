import { MAIN_AGENT_ID } from '@claude-office/shared'
import { useMemo } from 'react'
import { t } from '../i18n'
import { eventsOnFloor } from '../store/floors'
import { currentFloor } from '../store/officeStore'
import { describeEvent, formatTime } from './describe'
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
              <span className="who">{e.agentId === MAIN_AGENT_ID ? 'main' : e.agentId}</span>
              <span className="what">{describeEvent(e, lang)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
