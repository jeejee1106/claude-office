import type { Accessory } from './accessory'
import type { AnimName, Effect, Mark } from './activityMap'
import type { SpotId } from './layout'
import type { PartnerKind, PartnerReaction } from './partner'

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
  /**
   * 문 밖에 캐릭터 생성(등장 애니메이션 시작). 뒤따르는 moveTo 로 자리까지 걸어간다.
   * partner: 같이 들어오는 파트너 몬스터 종류(없으면 파트너 없음 — 옛 테스트용)
   */
  | (Base & {
      type: 'spawn'
      variant: number
      label: string
      say?: string | null
      partner?: PartnerKind
      /** 외모 소품(직원 설정). 없으면 none */
      accessory?: Accessory
    })
  /** 애니메이션 없이 즉시 배치(syncAll). 없으면 생성한다. 파트너도 주인 옆 자리에 바로 놓인다 */
  | (Base & {
      type: 'place'
      variant: number
      label: string
      partner?: PartnerKind
      accessory?: Accessory
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
   * bubble: 행동 중 띄울 도구 말풍선(brief 도구 — 전화 걸기). 없으면 도구 말풍선을 끈다.
   */
  | (Base & {
      type: 'act'
      anim: AnimName
      durationMs: number | null
      say?: string | null
      interruptible?: boolean
      bubble?: string | null
    })
  /** 머리 위 표시(큐를 거치지 않고 즉시). durationMs 없으면 다음 mark 까지 유지 */
  | (Base & { type: 'mark'; mark: Mark | null; durationMs: number | null })
  /**
   * 파트너 몬스터 반응(큐를 거치지 않고 즉시): tool.end ok → hop, error → surprised.
   * 깡충 쿨다운·걷는 중 무시는 Partner 가 정한다.
   */
  | (Base & { type: 'partner'; reaction: PartnerReaction })
  /**
   * 이름표 바꾸기(큐를 거치지 않고 즉시). 같은 이름의 사람이 들어오거나 나가 번호("이름 2")가
   * 달라질 때 — 이름표는 상태로 정해지는 표시 이름(employeeSettings.displayNames)을 따른다.
   */
  | (Base & { type: 'label'; label: string })
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
 * - board: 회의실 화이트보드 글씨 남김. written = 보고 있는 세션에서 계획(plan 도구)을 한 번이라도 했음
 *   (세션이 끝나면 false). 쓰는 중의 글씨는 렌더러가 캐릭터 동작으로 따로 켠다.
 */
export type SceneCommand =
  | { type: 'lights'; on: boolean; cause: string }
  | { type: 'servers'; busy: boolean; cause: string }
  | { type: 'board'; written: boolean; cause: string }

export type DirectorOutput = CharacterCommand | SceneCommand

const SCENE_TYPES: ReadonlySet<string> = new Set<SceneCommand['type']>([
  'lights',
  'servers',
  'board',
])

export function isCharacterCommand(c: DirectorOutput): c is CharacterCommand {
  return !SCENE_TYPES.has(c.type)
}
