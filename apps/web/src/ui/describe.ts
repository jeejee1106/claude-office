import type { OfficeEvent } from '@claude-office/shared'

/** 타임라인 한 줄 설명 (원문이 아닌 계약 필드만 사용) */
export function describeEvent(e: OfficeEvent): string {
  switch (e.kind) {
    case 'session.start':
      return `세션 시작${e.source ? ` (${e.source})` : ''}`
    case 'session.end':
      return `세션 종료${e.reason ? ` (${e.reason})` : ''}`
    case 'prompt.submit':
      return '프롬프트 입력'
    case 'tool.start':
      return `${e.tool.name}${e.tool.target ? ` · ${e.tool.target}` : ''}`
    case 'tool.end':
      return `${e.tool.name} ${e.status === 'error' ? '실패' : '완료'}`
    case 'agent.spawn':
      return `서브에이전트 입장${e.agentType ? ` · ${e.agentType}` : ''}`
    case 'agent.finish':
      return `서브에이전트 퇴장${e.status === 'error' ? ' (오류)' : ''}`
    case 'turn.end':
      return '턴 종료'
    case 'attention':
      return `확인 필요 (${e.reason})`
    case 'context.compact':
      return `컨텍스트 정리${e.trigger ? ` (${e.trigger})` : ''}`
    case 'agent.idle':
      return '쉬는 중'
    default: {
      const _exhaustive: never = e
      void _exhaustive
      return '알 수 없는 이벤트'
    }
  }
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  return d.toLocaleTimeString('ko-KR', { hour12: false })
}
