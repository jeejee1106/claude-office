import { useMemo } from 'react'
import { floorLabel, t } from '../i18n'
import { floorTabs } from '../store/floors'
import { currentFloor } from '../store/officeStore'
import { useLang } from './LangToggle'
import { useOfficeStore, useStoreSelector } from './useStore'

/**
 * 상단 층 탭(기획서 7절 "층(여러 프로젝트)"). 화면은 고른 층에 머문다.
 * 다른 층의 새 활동 → 탭이 잠깐 깜빡임, 확인 필요 → 빨간 점, 종료된 층 → 흐리게.
 */
export function FloorTabs() {
  const store = useOfficeStore()
  const lang = useLang()
  const office = useStoreSelector((s) => s.office)
  const order = useStoreSelector((s) => s.floorOrder)
  const pulse = useStoreSelector((s) => s.floorPulse)
  const current = useStoreSelector(currentFloor)

  const tabs = useMemo(
    () => floorTabs(office, order, current, pulse),
    [office, order, current, pulse],
  )

  if (tabs.length === 0) return <span className="session-empty">{t('noSession', lang)}</span>

  return (
    <div className="floor-tabs" role="tablist" aria-label={t('floors', lang)}>
      {tabs.map((f) => {
        const label = floorLabel(f.number, f.name, lang)
        const extra = [
          f.ended ? t('ended', lang) : '',
          f.attention ? t('waiting', lang) : '',
        ].filter((x) => x !== '')
        return (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={f.current}
            title={[label, ...extra].join(' ')}
            className={`floor-tab${f.current ? ' current' : ''}${f.ended ? ' ended' : ''}`}
            onClick={() => store.selectFloor(f.key)}
          >
            {/* pulse 가 바뀔 때마다 새로 마운트되어 깜빡임 애니메이션이 한 번 재생된다 */}
            {f.pulse > 0 && <span key={f.pulse} className="floor-flash" aria-hidden="true" />}
            <span className="floor-name">{label}</span>
            {f.attention && (
              <span className="floor-dot" role="img" aria-label={t('waiting', lang)} />
            )}
          </button>
        )
      })}
    </div>
  )
}
