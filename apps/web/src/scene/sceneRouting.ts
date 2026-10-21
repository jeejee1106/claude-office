import type { OfficeEvent, OfficeState } from '@claude-office/shared'
import { effectiveSessionId, type StoreState } from '../store/officeStore'
import type { DirectorOutput } from './commands'
import type { Director } from './director'

/*
 * store 이벤트 → director 호출 결정(순수, PixiJS 비의존). OfficeScene.onEvent 가 쓴다.
 *
 * 자동 선택 세션이 바뀌면 상태대로 다시 배치(syncAll)한 뒤 그 이벤트도 handle 한다.
 * 이벤트가 새 세션의 첫 이벤트(session.start 등)이면 syncAll 은 그 이벤트 "이전" 상태
 * (= 그 세션이 없는 상태)로 한다. 그래야 handle 이 spawn(문에서 등장)과 조명 켜짐을 낸다.
 * reduce 뒤 상태로 syncAll 하면 메인이 이미 책상에 배치되어 등장 애니메이션이 사라진다(QA B4-e).
 */
export interface RouteResult {
  /** 이 이벤트 처리 후 씬이 보여 주는 세션 */
  sessionId: string | null
  /** 세션 전환으로 syncAll 했는가(퇴장 중 캐릭터 정리 신호) */
  resynced: boolean
  outputs: DirectorOutput[]
}

export function routeSceneEvent(
  director: Director,
  currentSessionId: string | null,
  e: OfficeEvent,
  s: StoreState,
): RouteResult {
  const eff = effectiveSessionId(s)
  const outputs: DirectorOutput[] = []
  let resynced = false
  if (eff !== currentSessionId) {
    resynced = true
    const session = eff !== null ? s.office.sessions[eff] : undefined
    const firstEvent =
      session !== undefined &&
      e.sessionId === eff &&
      (e.kind === 'session.start' || session.startedAt === e.ts)
    outputs.push(...director.syncAll(firstEvent ? withoutSession(s.office, eff) : s.office, eff))
  }
  if (eff !== null && e.sessionId === eff) {
    outputs.push(...director.handle(e, s.office.sessions[eff]))
  }
  return { sessionId: eff, resynced, outputs }
}

function withoutSession(office: OfficeState, id: string | null): OfficeState {
  if (id === null) return office
  const { [id]: _omit, ...rest } = office.sessions
  return { ...office, sessions: rest }
}
