/*
 * 계절 장식 (기획서 3절 "계절 장식"). PixiJS 비의존 순수 데이터·함수 — 렌더러와 test/decor.test.ts 가 공유한다.
 *
 * - 계절 판정: 브라우저 현지 날짜(월/일)만 본다. 양 끝 날짜 포함.
 * - 고르기: 자동(날짜로) · 끄기 · 계절 하나(미리 보기). 고른 값이 날짜보다 우선.
 * - 배치: 모든 층 같은 고정 좌표(기준 해상도 px). 사람이 다니는 길·스팟·파트너 자리·가구·간판과
 *   겹치지 않는 빈 바닥과 벽에만 둔다(test/decor.test.ts 가 path·스팟·가구 그림 영역과 대조).
 *
 * 프레임 이름·크기·anchor 는 pixel-artist 의 decor.json(요약 _workspace/02_pixel-artist_summary.md)과 같다.
 * 시트가 없거나 프레임이 빠지면 렌더러가 그 장식만 코드 도형으로 그린다.
 */

export const DECOR_ATLAS_URL = 'assets/decor.json'

export const SEASONS = ['spring', 'summer', 'halloween', 'autumn', 'christmas'] as const
export type Season = (typeof SEASONS)[number]

/** 상단 바 "장식" 고르기 값. auto = 날짜로 판정(기본) */
export const DECOR_CHOICES = ['auto', 'off', ...SEASONS] as const
export type DecorChoice = (typeof DECOR_CHOICES)[number]

export function isDecorChoice(v: unknown): v is DecorChoice {
  return typeof v === 'string' && (DECOR_CHOICES as readonly string[]).includes(v)
}

/** 계절 기간(월·일, 양 끝 포함). 해를 넘는 기간은 없다 */
export const SEASON_RANGES: Readonly<
  Record<Season, { from: readonly [number, number]; to: readonly [number, number] }>
> = {
  spring: { from: [3, 25], to: [4, 15] },
  summer: { from: [7, 20], to: [8, 20] },
  halloween: { from: [10, 24], to: [10, 31] },
  autumn: { from: [11, 1], to: [11, 30] },
  christmas: { from: [12, 1], to: [12, 26] },
}

/** 이 날짜(현지 시각)의 계절. 기간 밖이면 null */
export function seasonOn(date: Date): Season | null {
  const md = (date.getMonth() + 1) * 100 + date.getDate()
  for (const s of SEASONS) {
    const r = SEASON_RANGES[s]
    if (md >= r.from[0] * 100 + r.from[1] && md <= r.to[0] * 100 + r.to[1]) return s
  }
  return null
}

/** 고르기 값 + 날짜 → 보여 줄 계절(null = 장식 없음). 고른 계절·끄기가 날짜보다 우선 */
export function resolveSeason(choice: DecorChoice, date: Date): Season | null {
  if (choice === 'off') return null
  if (choice === 'auto') return seasonOn(date)
  return choice
}

/** 자동일 때 날짜가 바뀌었는지(자정 넘김) 확인하는 간격 */
export const DECOR_RECHECK_MS = 60_000

// ---------------------------------------------------------------------------
// 장식 종류 (decor.json 프레임)
// ---------------------------------------------------------------------------

export type DecorKind =
  | 'blossomPot'
  | 'garland'
  | 'fan'
  | 'watermelon'
  | 'sunflowerPot'
  | 'pumpkin'
  | 'bat'
  | 'cobweb'
  | 'maplePot'
  | 'leaves'
  | 'mapleGarland'
  | 'tree'
  | 'gift'
  | 'wreath'

export interface DecorSpec {
  /** 프레임 이름(2개면 교대 애니메이션) */
  frames: readonly string[]
  /** decor.json animations 키(meta.frameMs 의 키). 1프레임이면 없음 */
  animKey?: string
  /** meta.frameMs 가 없을 때의 프레임 간격 */
  frameMs: number
  /** 프레임 크기(px) */
  w: number
  h: number
  /** anchor: 바닥 (0.5,1), 거는 것 (0.5,0) = 맨 윗줄 가운데, 모서리 (0,0) */
  ax: number
  ay: number
  /** 실제 그림이 있는 줄(겹침 검사용). 없으면 프레임 전체 */
  ink?: { top: number; bottom: number }
  /** wall = 벽에 걸림(가구 층, 늘 캐릭터 뒤) / floor = 바닥(캐릭터 층, anchor y 로 깊이 정렬) */
  layer: 'wall' | 'floor'
}

export const DECOR_SPECS: Readonly<Record<DecorKind, DecorSpec>> = {
  blossomPot: floor(['deco_spring_blossom_pot_0'], 16, 32),
  garland: {
    ...wall(['deco_spring_garland_0'], 32, 16),
    // 그림은 y 0..10(11줄) — 창문 위 띠(y 0..11)에 들어간다
    ink: { top: 0, bottom: 11 },
  },
  fan: floor(['deco_summer_fan_0', 'deco_summer_fan_1'], 16, 32, 'deco_summer_fan', 120),
  watermelon: floor(['deco_summer_watermelon_0'], 16, 16),
  sunflowerPot: floor(['deco_summer_sunflower_pot_0'], 16, 32),
  pumpkin: floor(
    ['deco_halloween_pumpkin_0', 'deco_halloween_pumpkin_1'],
    16,
    16,
    'deco_halloween_pumpkin',
    400,
  ),
  bat: {
    ...wall(['deco_halloween_bat_0', 'deco_halloween_bat_1'], 16, 16, 'deco_halloween_bat', 180),
    // y 0..5 실, 박쥐 y 4..13
    ink: { top: 0, bottom: 14 },
  },
  cobweb: { ...wall(['deco_halloween_cobweb_0'], 16, 16), ax: 0, ay: 0 },
  maplePot: floor(['deco_autumn_maple_pot_0'], 16, 32),
  leaves: floor(['deco_autumn_leaves_0'], 16, 16),
  mapleGarland: {
    ...wall(['deco_autumn_garland_0'], 32, 16),
    // 봄 가랜드와 같은 규격 — 창문 위 띠(y 0..11)에 들어간다
    ink: { top: 0, bottom: 11 },
  },
  tree: floor(
    ['deco_christmas_tree_0', 'deco_christmas_tree_1'],
    32,
    48,
    'deco_christmas_tree',
    600,
  ),
  gift: floor(['deco_christmas_gift_0'], 16, 16),
  wreath: wall(['deco_christmas_wreath_0'], 16, 16),
}

function floor(
  frames: readonly string[],
  w: number,
  h: number,
  animKey?: string,
  frameMs = 500,
): DecorSpec {
  return { frames, w, h, ax: 0.5, ay: 1, layer: 'floor', frameMs, ...(animKey ? { animKey } : {}) }
}

function wall(
  frames: readonly string[],
  w: number,
  h: number,
  animKey?: string,
  frameMs = 500,
): DecorSpec {
  return { frames, w, h, ax: 0.5, ay: 0, layer: 'wall', frameMs, ...(animKey ? { animKey } : {}) }
}

/** 씬이 쓰는 decor 프레임 전체(로드 직후 빠진 프레임 경고용) */
export const DECOR_FRAME_NAMES: readonly string[] = Object.values(DECOR_SPECS).flatMap(
  (s) => s.frames,
)

// ---------------------------------------------------------------------------
// 배치표 — 장식을 놓을 수 있는 자리(모든 층 공통)
// ---------------------------------------------------------------------------

/**
 * 바닥 자리: anchor = (x, 바닥 y). tall = 위쪽 32px 까지 비어 있음(16×32 화분·선풍기 가능).
 * 방 좌표는 layout.ts (24×14 타일), 가구 그림 영역은 office.json 크기 기준.
 */
export const FLOOR_SLOTS = {
  /** 업무 공간 뒤 벽 앞, 팀장 큰 책상 왼쪽(타일 9~10, 2) — 위에 창문이 있어 16px 높이까지 */
  workLeft: { x: 160, y: 46, tall: false },
  /** 업무 공간 뒤 벽 앞, 팀장 큰 책상 오른쪽(타일 13~14, 2) — 16px 높이까지 */
  workRight: { x: 224, y: 46, tall: false },
  /** 휴게실 위쪽 벽 앞(타일 3, 8) — 커피 스팟 오른쪽, 위가 칸막이 벽 */
  loungeA: { x: 56, y: 144, tall: true },
  /** 휴게실 위쪽 벽 앞(타일 4, 8) — 화분 왼쪽 */
  loungeB: { x: 72, y: 144, tall: true },
  /** 휴게실 왼쪽 아래 구석(타일 1, 11) — 커피머신 아래, 파트너 쉬는 자리(12행) 위 */
  loungeCorner: { x: 24, y: 192, tall: false },
  /** 회의실 오른쪽 위 구석(타일 21~22, 8) — 32px 폭, 위로 48px(트리 꼭대기가 칸막이 벽 너머 서버실 빈 바닥에 걸침) */
  meetingCorner: { x: 352, y: 144, tall: true },
  /** 회의실 왼쪽 아래 구석(타일 18, 12) */
  meetingLow: { x: 296, y: 208, tall: false },
  /** 자료실 아래쪽(타일 4, 6) */
  archive: { x: 72, y: 112, tall: false },
  /** 서버실 아래쪽(타일 21, 6) — 크리스마스엔 트리 꼭대기 자리라 비운다 */
  server: { x: 344, y: 112, tall: false },
} as const satisfies Record<string, { x: number; y: number; tall: boolean }>

/** 벽 자리: anchor 점. 거는 것은 맨 윗줄 가운데, 거미줄은 모서리 */
export const WALL_SLOTS = {
  /** 뒤 벽 창문(왼쪽) 위 띠 — 가랜드 */
  bandLeft: { x: 152, y: 0 },
  /** 뒤 벽 창문(오른쪽) 위 띠 — 가랜드 */
  bandRight: { x: 232, y: 0 },
  /** 뒤 벽, 왼쪽 창문과 게시판 사이(x 160..184) */
  gapLeft: { x: 172, y: 2 },
  /** 뒤 벽, 게시판과 오른쪽 창문 사이(x 200..224) */
  gapRight: { x: 212, y: 2 },
  /** 휴게실 위 칸막이 벽(커피머신 오른쪽) */
  lounge: { x: 40, y: 114 },
  /** 업무 공간 뒤 벽 왼쪽 위 모서리(화분 위) */
  cornerLeft: { x: 112, y: 0 },
  /** 업무 공간 뒤 벽 오른쪽 위 모서리(화분 위, 좌우 반전) */
  cornerRight: { x: 272, y: 0 },
  /** 휴게실 칸막이 벽 왼쪽 위 모서리(커피머신 위) */
  cornerLounge: { x: 16, y: 112 },
} as const satisfies Record<string, { x: number; y: number }>

export type FloorSlot = keyof typeof FLOOR_SLOTS
export type WallSlot = keyof typeof WALL_SLOTS

export interface DecorPlacement {
  kind: DecorKind
  /** anchor 점(기준 해상도 px) */
  x: number
  y: number
  /** 좌우 반전(scale.x = −1). anchor 는 반전된 그림 기준 — 거미줄은 x 가 오른쪽 끝 */
  flipX: boolean
  /** 같은 2프레임 장식이 똑같이 움직이지 않게 시작 프레임을 엇갈린다 */
  phase: number
}

type Entry = readonly [DecorKind, FloorSlot | WallSlot, { flipX?: boolean }?]

const SEASON_TABLE: Readonly<Record<Season, readonly Entry[]>> = {
  spring: [
    ['garland', 'bandLeft'],
    ['garland', 'bandRight'],
    ['garland', 'lounge'],
    ['blossomPot', 'loungeB'],
    ['blossomPot', 'meetingCorner'],
  ],
  summer: [
    ['fan', 'loungeA'],
    ['sunflowerPot', 'loungeB'],
    ['sunflowerPot', 'meetingCorner'],
    ['watermelon', 'workLeft'],
    ['watermelon', 'loungeCorner'],
    ['watermelon', 'meetingLow'],
  ],
  halloween: [
    ['cobweb', 'cornerLeft'],
    ['cobweb', 'cornerRight', { flipX: true }],
    ['cobweb', 'cornerLounge'],
    ['bat', 'gapLeft'],
    ['bat', 'gapRight'],
    ['bat', 'lounge'],
    ['pumpkin', 'workLeft'],
    ['pumpkin', 'workRight'],
    ['pumpkin', 'loungeA'],
    ['pumpkin', 'meetingLow'],
    ['pumpkin', 'archive'],
  ],
  autumn: [
    ['mapleGarland', 'bandLeft'],
    ['mapleGarland', 'bandRight'],
    ['mapleGarland', 'lounge'],
    ['maplePot', 'loungeB'],
    ['maplePot', 'meetingCorner'],
    ['leaves', 'workLeft'],
    ['leaves', 'workRight'],
    ['leaves', 'loungeCorner'],
    ['leaves', 'meetingLow'],
  ],
  christmas: [
    ['tree', 'meetingCorner'],
    ['wreath', 'gapLeft'],
    ['wreath', 'gapRight'],
    ['wreath', 'lounge'],
    ['gift', 'workLeft'],
    ['gift', 'workRight'],
    ['gift', 'loungeA'],
    ['gift', 'loungeCorner'],
    ['gift', 'meetingLow'],
  ],
}

function slotPoint(slot: FloorSlot | WallSlot): { x: number; y: number } {
  return slot in FLOOR_SLOTS ? FLOOR_SLOTS[slot as FloorSlot] : WALL_SLOTS[slot as WallSlot]
}

/** 계절 → 장식 배치(null = 없음) */
export function decorPlacements(season: Season | null): DecorPlacement[] {
  if (season === null) return []
  return SEASON_TABLE[season].map(([kind, slot, opt], i) => ({
    kind,
    ...slotPoint(slot),
    flipX: opt?.flipX === true,
    phase: i % 2,
  }))
}

/** 배치표의 자리 이름(테스트용: 바닥 장식은 바닥 자리, 벽 장식은 벽 자리, 높은 장식은 tall 자리) */
export function seasonEntries(season: Season): readonly Entry[] {
  return SEASON_TABLE[season]
}

export interface PxRect {
  x: number
  y: number
  w: number
  h: number
}

/** 장식 그림 영역(px, 반전 반영). ink 가 있으면 실제 그림 줄만 */
export function decorBounds(p: DecorPlacement): PxRect {
  const s = DECOR_SPECS[p.kind]
  const ax = p.flipX ? 1 - s.ax : s.ax
  const left = p.x - ax * s.w
  const top = p.y - s.ay * s.h
  const ink = s.ink ?? { top: 0, bottom: s.h }
  return { x: left, y: top + ink.top, w: s.w, h: ink.bottom - ink.top }
}

/** 로드한 decor 시트(프레임 텍스처 + meta.frameMs). 없으면 렌더러가 코드 도형으로 그린다 */
export interface DecorAtlas<T> {
  readonly textures: Readonly<Record<string, T | undefined>>
  readonly frameMs: Readonly<Record<string, number>>
}

/** 장식 하나의 프레임 간격: 시트 meta.frameMs[animKey] → 없으면 기본값 */
export function decorFrameMs(kind: DecorKind, meta: Readonly<Record<string, number>> = {}): number {
  const s = DECOR_SPECS[kind]
  return (s.animKey !== undefined ? meta[s.animKey] : undefined) ?? s.frameMs
}

/** 2프레임 장식의 지금 프레임 번호 */
export function decorFrameIndex(elapsedMs: number, frameMs: number, n: number, phase: number) {
  if (n < 2 || frameMs <= 0) return 0
  return (Math.floor(elapsedMs / frameMs) + phase) % n
}
