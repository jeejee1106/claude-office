import { MAIN_AGENT_ID } from '@claude-office/shared'
import { t } from '../i18n'
import { describeEvent, formatTime } from './describe'
import { useLang } from './LangToggle'
import { useOfficeStore, useStoreSelector } from './useStore'

/** 최근 이벤트(최신이 위). 클릭하면 해당 캐릭터를 하이라이트한다 */
export function Timeline() {
  const store = useOfficeStore()
  const lang = useLang()
  const recent = useStoreSelector((s) => s.recent)
  const highlight = useStoreSelector((s) => s.highlightAgentId)
  const items = [...recent].reverse()

  return (
    <section className="panel timeline">
      <h2>
        {t('recent', lang)} ({recent.length})
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
