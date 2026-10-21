/** 이벤트 스키마 버전. 필수 필드 추가·의미 변경·삭제 시에만 올린다 (event-contract 스킬 3절). */
export const SCHEMA_VERSION = 1 as const

/** 서버 기본 포트. collector·web dev 프록시·문서가 모두 이 값을 참조한다. */
export const DEFAULT_PORT = 7333
/** 서버 기본 바인딩 호스트 (로컬 전용). */
export const DEFAULT_HOST = '127.0.0.1'

/** 서버 경로. web dev 서버 프록시와 collector가 같은 값을 쓰도록 여기서만 정의한다. */
export const PATHS = {
  events: '/events',
  ws: '/ws',
  state: '/api/state',
  health: '/healthz',
} as const

/** snapshot.recent 에 담는 최근 이벤트 수 (서버 링버퍼 크기). */
export const RECENT_EVENTS_LIMIT = 500

/** OfficeState 에 남겨 두는 종료된 세션 최대 수. 초과분은 reduce 가 오래된 것부터 지운다. */
export const MAX_ENDED_SESSIONS = 10

/** tool.target 최대 길이. collector 는 넘으면 잘라서 보낸다. */
export const TARGET_MAX = 60
