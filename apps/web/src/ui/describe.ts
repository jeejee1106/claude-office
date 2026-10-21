import type { OfficeEvent } from '@claude-office/shared'
import { getLang, type Lang, t } from '../i18n'

/** 타임라인 한 줄 설명 (원문이 아닌 계약 필드만 사용) */
export function describeEvent(e: OfficeEvent, lang: Lang = getLang()): string {
  const s = (k: Parameters<typeof t>[0]) => t(k, lang)
  switch (e.kind) {
    case 'session.start':
      return `${s('evSessionStart')}${e.source ? ` (${e.source})` : ''}`
    case 'session.end':
      return `${s('evSessionEnd')}${e.reason ? ` (${e.reason})` : ''}`
    case 'prompt.submit':
      return s('evPrompt')
    case 'tool.start':
      return `${e.tool.name}${e.tool.target ? ` · ${e.tool.target}` : ''}`
    case 'tool.end':
      return `${e.tool.name} ${e.status === 'error' ? s('evToolFail') : s('evToolOk')}`
    case 'agent.spawn':
      return `${s('evSpawn')}${e.agentType ? ` · ${e.agentType}` : ''}`
    case 'agent.finish':
      return `${s('evFinish')}${e.status === 'error' ? s('evFinishErr') : ''}`
    case 'turn.end':
      return s('evTurnEnd')
    case 'attention':
      return `${s('evAttention')} (${e.reason})`
    case 'context.compact':
      return `${s('evCompact')}${e.trigger ? ` (${e.trigger})` : ''}`
    case 'agent.idle':
      return s('evIdle')
    default: {
      const _exhaustive: never = e
      void _exhaustive
      return s('evUnknown')
    }
  }
}

export function formatTime(iso: string, lang: Lang = getLang()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  return d.toLocaleTimeString(t('locale', lang), { hour12: false })
}
