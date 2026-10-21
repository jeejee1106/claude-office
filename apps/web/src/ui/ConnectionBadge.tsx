import { t } from '../i18n'
import { useLang } from './LangToggle'
import { useStoreSelector } from './useStore'

const LABEL = { open: 'connOpen', connecting: 'connConnecting', closed: 'connClosed' } as const

export function ConnectionBadge() {
  const status = useStoreSelector((s) => s.connection)
  const lang = useLang()
  return (
    <span className={`badge badge-${status}`} role="status" aria-live="polite">
      {t(LABEL[status], lang)}
    </span>
  )
}
