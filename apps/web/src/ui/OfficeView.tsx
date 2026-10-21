import { useEffect, useRef } from 'react'
import { OfficeScene } from '../scene/OfficeScene'
import { useOfficeStore, useStoreSelector } from './useStore'

/** PixiJS 씬을 마운트한다. 씬은 자체 ticker 로 돌고 여기서는 연결 상태(어둡게)만 반영한다 */
export function OfficeView() {
  const store = useOfficeStore()
  const host = useRef<HTMLDivElement>(null)
  const connection = useStoreSelector((s) => s.connection)

  useEffect(() => {
    const el = host.current
    if (el === null) return
    const scene = new OfficeScene(el, store)
    scene.init().catch((err: unknown) => console.error('[claude-office] 씬 초기화 실패', err))
    return () => scene.destroy()
  }, [store])

  return (
    <section className={`office ${connection === 'open' ? '' : 'office-offline'}`}>
      <div ref={host} className="office-host" />
      {connection !== 'open' && (
        <div className="office-offline-banner">서버에 연결되어 있지 않습니다 — 재접속 중</div>
      )}
    </section>
  )
}
