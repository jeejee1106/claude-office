import { useStoreSelector } from './useStore'

const LABEL = { open: '연결됨', connecting: '연결 중…', closed: '연결 끊김' } as const

export function ConnectionBadge() {
  const status = useStoreSelector((s) => s.connection)
  return (
    <span className={`badge badge-${status}`} role="status" aria-live="polite">
      {LABEL[status]}
    </span>
  )
}
