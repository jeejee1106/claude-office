import type { AnimName, Mark } from './activityMap'
import type { SpotId } from './layout'

/*
 * director → 캐릭터 명령. 순수 데이터(PixiJS 비의존). director 가 만들고 Character 가 실행한다.
 * cause: 명령을 만든 이벤트 id(테스트·디버깅용). syncAll 이 만든 명령은 'sync'.
 */

interface Base {
  agentId: string
  cause: string
}

export type CharacterCommand =
  /** 문 밖에 캐릭터 생성(등장 애니메이션 시작). 뒤따르는 moveTo 로 자리까지 걸어간다. */
  | (Base & { type: 'spawn'; variant: number; label: string })
  /** 애니메이션 없이 즉시 배치(syncAll). 없으면 생성한다. */
  | (Base & {
      type: 'place'
      variant: number
      label: string
      spot: SpotId
      slot: number
      anim: AnimName
      bubble: string | null
      mark: Mark | null
    })
  /** 스팟까지 걸어가서 anim 재생. soft 는 뒤에 명령이 쌓여 있으면 건너뛴다. */
  | (Base & {
      type: 'moveTo'
      spot: SpotId
      slot: number
      anim: AnimName
      bubble: string | null
      effect: 'paper' | null
      soft: boolean
    })
  /** 제자리에서 anim. durationMs 가 있으면 그 시간 동안 머문 뒤 다음 명령 */
  | (Base & { type: 'act'; anim: AnimName; durationMs: number | null })
  /** 머리 위 표시(큐를 거치지 않고 즉시). durationMs 없으면 다음 mark 까지 유지 */
  | (Base & { type: 'mark'; mark: Mark | null; durationMs: number | null })
  /** 문으로 걸어가서 퇴장(제거) */
  | (Base & { type: 'leave' })
  /** 즉시 제거(syncAll) */
  | (Base & { type: 'remove' })

export type CharacterCommandType = CharacterCommand['type']

/** 씬 전역 명령 */
export interface SceneCommand {
  type: 'lights'
  on: boolean
  cause: string
}

export type DirectorOutput = CharacterCommand | SceneCommand

export function isCharacterCommand(c: DirectorOutput): c is CharacterCommand {
  return c.type !== 'lights'
}
