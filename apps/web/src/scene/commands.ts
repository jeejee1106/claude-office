import type { AnimName, Effect, Mark } from './activityMap'
import type { SpotId } from './layout'

/*
 * director → 캐릭터 명령. 순수 데이터(PixiJS 비의존). director 가 만들고 Character 가 실행한다.
 * cause: 명령을 만든 이벤트 id(테스트·디버깅용). syncAll 이 만든 명령은 'sync'.
 *
 * say: 대사(기획서 5·6절). 도구 말풍선(bubble)과 같은 자리(한 사람당 말풍선 하나)를 쓰며
 *   SPEECH_MS 뒤 사라진다. 새 도구 말풍선이 오면 즉시 대체된다. 표시 시점은 명령마다 다르다:
 *   spawn·act·leave = 시작할 때, moveTo = 도착했을 때.
 */

interface Base {
  agentId: string
  cause: string
}

export type CharacterCommand =
  /** 문 밖에 캐릭터 생성(등장 애니메이션 시작). 뒤따르는 moveTo 로 자리까지 걸어간다. */
  | (Base & { type: 'spawn'; variant: number; label: string; say?: string | null })
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
      effect: Effect | null
      soft: boolean
      say?: string | null
    })
  /**
   * 제자리에서 anim. durationMs 가 있으면 그 시간 동안 머문 뒤 다음 명령.
   * interruptible: 뒤에 soft 가 아닌 명령이 오면 MIN_DWELL_MS 뒤 바로 끝낸다(대사 < 도구).
   */
  | (Base & {
      type: 'act'
      anim: AnimName
      durationMs: number | null
      say?: string | null
      interruptible?: boolean
    })
  /** 머리 위 표시(큐를 거치지 않고 즉시). durationMs 없으면 다음 mark 까지 유지 */
  | (Base & { type: 'mark'; mark: Mark | null; durationMs: number | null })
  /**
   * 문으로 걸어가서 퇴장(제거). style 이 있으면 짧은 준비 동작(pack: 짐 챙기기 → 가방 들고,
   * report: 팀장 책상 쪽을 보고 보고 → 3초 머묾) 후 정해진 시간에 걸어 나간다
   * — pack 은 LEAVE_MAX_MS, report 는 LEAVE_REPORT_MAX_MS 안.
   */
  | (Base & { type: 'leave'; say?: string | null; style?: 'pack' | 'report' | null })
  /** 즉시 제거(syncAll) */
  | (Base & { type: 'remove' })

export type CharacterCommandType = CharacterCommand['type']

/**
 * 씬 전역 명령.
 * - lights: 사무실 조명. off 는 Roster 가 "마지막 사람이 나갈 때"까지 미룬다.
 * - servers: 서버실 LED. busy = 지금 명령(bash)을 실행 중인 에이전트가 있음 → 빠르게 깜빡임
 */
export type SceneCommand =
  | { type: 'lights'; on: boolean; cause: string }
  | { type: 'servers'; busy: boolean; cause: string }

export type DirectorOutput = CharacterCommand | SceneCommand

export function isCharacterCommand(c: DirectorOutput): c is CharacterCommand {
  return c.type !== 'lights' && c.type !== 'servers'
}
