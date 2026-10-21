import { MAIN_AGENT_ID } from '@claude-office/shared'
import { describeEvent, formatTime } from './describe'
import { useOfficeStore, useStoreSelector } from './useStore'

/** 최근 이벤트(최신이 위). 클릭하면 해당 캐릭터를 하이라이트한다 */
export function Timeline() {
  const store = useOfficeStore()
  const recent = useStoreSelector((s) => s.recent)
  const highlight = useStoreSelector((s) => s.highlightAgentId)
  const items = [...recent].reverse()

  return (
    <section className="panel timeline">
      <h2>최근 이벤트 ({recent.length})</h2>
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
              <time>{formatTime(e.ts)}</time>
              <span className="who">{e.agentId === MAIN_AGENT_ID ? 'main' : e.agentId}</span>
              <span className="what">{describeEvent(e)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}
