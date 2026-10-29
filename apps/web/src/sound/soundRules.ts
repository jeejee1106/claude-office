import { MAIN_AGENT_ID, type OfficeEvent, type OfficeState } from '@claude-office/shared'
import { type FloorKey, floorKeyOf } from '../store/floors'

/*
 * 효과음 판단 — 순수 함수, PixiJS·React·Web Audio 비의존 (기획서 7절 "효과음").
 *
 * 실시간 event 메시지에서만 부른다(snapshot 으로는 부르지 않는다 — 호출하는 쪽 책임).
 * 리플레이 이벤트도 같은 경로라 실제와 똑같이 판단한다.
 *
 * - spawn     직원 출근: 지금 보는 층의 서브에이전트 agent.spawn (처음 나타났거나 퇴장 후 다시 나타남)
 * - attention 확인 요청: attention 으로 "?"가 새로 뜰 때(이미 "?"면 아님). 다른 층이어도 울림
 * - turnEnd   팀장 일 끝: 지금 보는 층의 main turn.end
 * 같은 소리는 SOUND_COOLDOWN_MS 에 한 번까지. 상태가 바뀌지 않은 이벤트(종료 후 늦게 온 것 등)는 무시.
 */

export type SoundId = 'spawn' | 'attention' | 'turnEnd'
export const SOUND_IDS: readonly SoundId[] = ['spawn', 'attention', 'turnEnd']

export const SOUND_COOLDOWN_MS = 2000

export interface SoundInput {
  event: OfficeEvent
  /** 이 이벤트를 reduce 하기 전 상태 */
  prev: OfficeState
  /** reduce 한 뒤 상태 */
  next: OfficeState
  /** 이 이벤트 처리 후 화면이 보여 주는 층 */
  floor: FloorKey | null
  /** 소리별 마지막 재생 시각(ms) */
  lastPlayed: Readonly<Partial<Record<SoundId, number>>>
  now: number
}

/** 이 이벤트로 낼 소리. 없으면 null */
export function decideSound(input: SoundInput): SoundId | null {
  const id = soundFor(input)
  if (id === null) return null
  const last = input.lastPlayed[id]
  if (last !== undefined && input.now - last < SOUND_COOLDOWN_MS) return null
  return id
}

function soundFor({ event: e, prev, next, floor }: SoundInput): SoundId | null {
  // reduce 가 무시한 이벤트(종료된 세션에 늦게 도착 등)로는 울리지 않는다
  if (next === prev) return null
  const session = next.sessions[e.sessionId]
  if (session === undefined) return null
  const before = prev.sessions[e.sessionId]?.agents[e.agentId]
  const after = session.agents[e.agentId]
  const onFloor = floor !== null && floorKeyOf(session) === floor

  switch (e.kind) {
    case 'agent.spawn': {
      if (e.agentId === MAIN_AGENT_ID || !onFloor) return null
      if (after === undefined || after.activity === 'gone') return null
      const isNew = before === undefined || before.activity === 'gone'
      return isNew ? 'spawn' : null
    }
    case 'attention': {
      if (after?.attention === undefined) return null
      return before?.attention === undefined ? 'attention' : null
    }
    case 'turn.end':
      return e.agentId === MAIN_AGENT_ID && onFloor ? 'turnEnd' : null
    default:
      return null
  }
}
