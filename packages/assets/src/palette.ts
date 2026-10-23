/*
 * 고정 팔레트 (pixel-art-pipeline 3절: 32색 이내, 이 표 밖의 색이 나오면 build 실패).
 * 화풍: 밝고 따뜻한 색, 외곽선은 순검정 대신 짙은 남색(outline), 광원은 좌상단(오른쪽·아래가 그림자).
 *
 * 색을 추가할 때는 기존 색으로 대신할 수 없는지 먼저 본다(가구·바닥이 다음 작업에서 이 표를 함께 쓴다).
 */
export const PALETTE = {
  // 공통
  outline: '#1b1f3b',
  white: '#ffffff',
  skin: '#ffdcc0',
  skinShade: '#f0b48e',
  blush: '#f79a8e',
  pants: '#3f4a7d',
  grayLight: '#c5c9d6',
  gray: '#8a8fa8',
  // 머리색 램프 (기본, 그림자) — brown 은 신발·가방, chestnut 은 가방·나무색에도 쓴다
  brown: '#6b4430',
  brownDark: '#4a2c20',
  chestnut: '#b5703f',
  chestnutDark: '#8a4f2c',
  yellow: '#f5c84c',
  yellowDark: '#d49a2f',
  ink: '#3b3656',
  inkDark: '#27233d',
  // 셔츠색 램프 (기본, 그림자)
  coral: '#e8735a',
  coralDark: '#c0503f',
  blue: '#4f8ff0',
  blueDark: '#3567c2',
  green: '#6cc46a',
  greenDark: '#48994f',
  purple: '#a283e0',
  purpleDark: '#7a5cb8',
  teal: '#45bfb0',
  tealDark: '#2f9488',
  pink: '#f59ab5',
  pinkDark: '#d9708f',
  // 사무실(office 시트): 바닥 타일·간판 판 크림색, 창문 하늘색 (2026-10-23 그림체 샘플 A에서 확정)
  cream: '#fbefd5',
  creamShade: '#ecd3a8',
  sky: '#a9dcf5',
} as const satisfies Record<string, `#${string}`>

export type ColorName = keyof typeof PALETTE

export const MAX_PALETTE_SIZE = 32

/** '#rrggbb' → 0xRRGGBBAA(불투명) */
export function rgba(name: ColorName): number {
  return ((Number.parseInt(PALETTE[name].slice(1), 16) << 8) | 0xff) >>> 0
}

/** 팔레트 색의 RGBA 정수 집합 (검증용) */
export function paletteRgbaSet(): Set<number> {
  return new Set((Object.keys(PALETTE) as ColorName[]).map(rgba))
}

/**
 * 캐릭터 색 변형 (pixel-art-pipeline 5절). 변형마다 셔츠·머리 색 쌍만 바꾼다.
 * 개수는 apps/web/src/scene/variant.ts 의 VARIANT_COUNT(8)와 같아야 한다.
 * variant 0 = 메인(팀장) 전용. 1..7 은 서브에이전트 agentType 해시로 정해진다(web 의 variantFor).
 */
export interface CharacterVariant {
  id: number
  label: string
  shirt: ColorName
  shirtShade: ColorName
  hair: ColorName
  hairShade: ColorName
}

export const VARIANTS: readonly CharacterVariant[] = [
  {
    id: 0,
    label: 'main (팀장)',
    shirt: 'coral',
    shirtShade: 'coralDark',
    hair: 'brown',
    hairShade: 'brownDark',
  },
  {
    id: 1,
    label: 'sub blue',
    shirt: 'blue',
    shirtShade: 'blueDark',
    hair: 'ink',
    hairShade: 'inkDark',
  },
  {
    id: 2,
    label: 'sub green',
    shirt: 'green',
    shirtShade: 'greenDark',
    hair: 'chestnut',
    hairShade: 'chestnutDark',
  },
  {
    id: 3,
    label: 'sub purple',
    shirt: 'purple',
    shirtShade: 'purpleDark',
    hair: 'brown',
    hairShade: 'brownDark',
  },
  {
    id: 4,
    label: 'sub yellow',
    shirt: 'yellow',
    shirtShade: 'yellowDark',
    hair: 'chestnut',
    hairShade: 'chestnutDark',
  },
  {
    id: 5,
    label: 'sub teal',
    shirt: 'teal',
    shirtShade: 'tealDark',
    hair: 'yellow',
    hairShade: 'yellowDark',
  },
  {
    id: 6,
    label: 'sub pink',
    shirt: 'pink',
    shirtShade: 'pinkDark',
    hair: 'ink',
    hairShade: 'inkDark',
  },
  {
    id: 7,
    label: 'sub gray',
    shirt: 'grayLight',
    shirtShade: 'gray',
    hair: 'yellow',
    hairShade: 'yellowDark',
  },
]

export const VARIANT_COUNT = VARIANTS.length
