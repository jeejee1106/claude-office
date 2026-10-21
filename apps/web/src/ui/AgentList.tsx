import { type AgentState, isAsleep, MAIN_AGENT_ID } from '@claude-office/shared'
import { useEffect, useState } from 'react'
import { effectiveSessionId } from '../store/officeStore'
import { useOfficeStore, useStoreSelector } from './useStore'

const ACTIVITY_LABEL: Record<AgentState['activity'], string> = {
  idle: '대기',
  working: '작업 중',
  waiting: '확인 필요',
  gone: '퇴장',
}

export function AgentList() {
  const store = useOfficeStore()
  const office = useStoreSelector((s) => s.office)
  const sessionId = useStoreSelector(effectiveSessionId)
  const highlight = useStoreSelector((s) => s.highlightAgentId)
  // sleep 표시는 시간에 따라 바뀌므로 10초마다만 다시 그린다(프레임마다 X)
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10_000)
    return () => clearInterval(t)
  }, [])

  const session = sessionId !== null ? office.sessions[sessionId] : undefined
  const agents = session
    ? Object.values(session.agents).sort((a, b) =>
        a.id === MAIN_AGENT_ID ? -1 : b.id === MAIN_AGENT_ID ? 1 : a.id.localeCompare(b.id),
      )
    : []
  const now = store.serverNow()

  return (
    <section className="panel">
      <h2>에이전트 {session?.project ? `· ${session.project}` : ''}</h2>
      {agents.length === 0 && <p className="muted">아직 아무도 출근하지 않았습니다.</p>}
      <ul className="agents">
        {agents.map((a) => {
          const asleep = isAsleep(a, now)
          return (
            <li key={a.id} className={a.id === highlight ? 'selected' : ''}>
              <button
                type="button"
                onClick={() => store.setHighlight(a.id === highlight ? null : a.id)}
              >
                <span className={`dot dot-${asleep ? 'sleep' : a.activity}`} />
                <span className="agent-name">
                  {a.id === MAIN_AGENT_ID ? 'main' : (a.type ?? a.id)}
                </span>
                <span className="agent-state">
                  {asleep ? '잠듦 Zzz' : ACTIVITY_LABEL[a.activity]}
                  {a.currentTool ? ` · ${a.currentTool.name}` : ''}
                  {a.lastToolResult?.status === 'error' && a.activity !== 'gone' ? ' · ⚠ 오류' : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
