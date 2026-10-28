import type { DailyCounts } from '@claude-office/shared'
import { useEffect, useState } from 'react'
import { t, type UiKey } from '../i18n'
import { currentFloor, dailyCountsOn } from '../store/officeStore'
import { useLang } from './LangToggle'
import { useStoreSelector } from './useStore'

/*
 * 정보 패널 "오늘 작업량" (기획서 7절). 지금 보고 있는 층의 숫자 4개만 보여 준다.
 * 숫자는 서버가 센다(web 은 세지 않는다). 파일 이름·명령 내용은 받지도 보여 주지도 않는다.
 * 구버전 서버(stats 없음)면 칸 자체를 숨긴다.
 */

const ITEMS: readonly { key: keyof DailyCounts; label: UiKey }[] = [
  { key: 'filesEdited', label: 'statsFiles' },
  { key: 'commands', label: 'statsCommands' },
  { key: 'teammates', label: 'statsTeammates' },
  { key: 'toolUses', label: 'statsTools' },
]

export function DailyStatsPanel() {
  const lang = useLang()
  const stats = useStoreSelector((s) => s.dailyStats)
  const floor = useStoreSelector(currentFloor)
  // 자정이 지났는데 서버 stats 가 아직 안 왔을 때(연결 끊김 등) 0 으로 바뀌도록 1분마다만 다시 그린다
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const counts = dailyCountsOn(stats, floor)
  if (counts === null) return null

  return (
    <section className="panel daily-stats">
      <h2>{t('statsTitle', lang)}</h2>
      <dl className="stat-grid">
        {ITEMS.map((it) => (
          <div key={it.key} className="stat-cell">
            <dt>{t(it.label, lang)}</dt>
            <dd>{counts[it.key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
