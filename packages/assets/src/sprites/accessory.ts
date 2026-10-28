import type { DrawDir, HeadExtra } from './character'
import { grid, type Layer } from './layers'

/*
 * 외모 소품(docs/product-spec.md 4절 "외모 소품"): 캐릭터 위에 겹쳐 그리는 오버레이.
 * 좌표는 머리 그리드 기준(character.ts head(): 채움 12×11, (0,0) = 머리 그리드 왼쪽 위).
 *   정면 머리: 줄 0..4 머리 윗부분, 5 앞머리, 6..8 눈(열 3..4, 7..8), 9 입(열 5..6), 10 턱
 *   옆모습(왼쪽 보기): 얼굴이 열 0 쪽, 눈 열 1..2(줄 6..8), 귀 열 6(줄 6..7), 뒷머리 열 7..11
 * 실제 프레임 위치는 character.ts 가 자세마다 넘겨 주는 머리 원점(HeadExtra 의 x, y)으로 정해진다
 * (손으로 프레임마다 맞추지 않음). 색은 변형과 무관한 고정 색만 쓴다(c/C/h/H 금지).
 * 모두 이 프로젝트용 새 디자인(단순한 도형).
 */

export const ACC_KINDS = ['glasses', 'sunglasses', 'cap', 'headphones', 'ribbon'] as const
export type AccKind = (typeof ACC_KINDS)[number]

/** 이 방향(그리는 방향)에서는 보이지 않는 소품 — 빈 프레임을 낸다 */
export const ACC_HIDDEN: Record<AccKind, readonly DrawDir[]> = {
  glasses: ['up'],
  sunglasses: ['up'],
  cap: [],
  headphones: [],
  ribbon: [],
}

/** 머리 그리드 기준 그리드 → 프레임 좌표 레이어 */
const at =
  (x: number, y: number) =>
  (rows: readonly string[], cx: number, cy: number, outline = true) =>
    grid(rows, x + cx, y + cy, outline)

// ---------------------------------------------------------------------------
// 동그란 안경: 회색 테 두 개(눈 2×3 을 둘러쌈), 외곽선 없음
// ---------------------------------------------------------------------------
function glasses(dir: DrawDir, x: number, y: number): Layer[] {
  const g = at(x, y)
  if (dir === 'down')
    return [
      g(
        [
          '.GG..GG.', // 5 (앞머리)
          'G..GG..G', // 6..8 눈
          'G..GG..G',
          'G..GG..G',
          '.GG..GG.', // 9 (입은 가운데 열 5..6 이라 보인다)
        ],
        2,
        5,
        false,
      ),
    ]
  // 옆모습: 앞쪽 알 하나 + 귀까지 다리
  return [g(['.GG...', 'G..GGG', 'G..G..', 'G..G..', '.GG...'], 0, 5, false)]
}

// ---------------------------------------------------------------------------
// 선글라스: 짙은 알(외곽선 색) + 흰 반사광 1px
// ---------------------------------------------------------------------------
function sunglasses(dir: DrawDir, x: number, y: number): Layer[] {
  const g = at(x, y)
  if (dir === 'down') return [g(['oowooowooo', '.oooooooo.', '..oo..oo..'], 1, 6, false)]
  return [g(['owoooo', 'oooo..', '.oo...'], 0, 6, false)]
}

// ---------------------------------------------------------------------------
// 야구 모자: 산호색 크라운(외곽선) + 짙은 챙. 옆모습은 챙이 얼굴 쪽(왼쪽)으로 튀어나온다
// ---------------------------------------------------------------------------
const CAP_CROWN = ['...rrrrrr...', '.rrrrwwrrrr.', 'rrrrrrrrrrrR', 'rrrrrrrrrrRR']
const CAP_CROWN_SIDE = ['...rrrrrr...', '.rrrrrrrrrr.', 'rrrrrrrrrrrR', 'rrrrrrrrrrRR']

function cap(dir: DrawDir, x: number, y: number): Layer[] {
  const g = at(x, y)
  if (dir === 'down')
    return [
      g(CAP_CROWN, 0, 0),
      // 챙: 머리보다 1px 넓은 띠(정면에서 보면 납작), 양끝 외곽선
      g(['oRRRRRRRRRRRRRRo'], -2, 4, false),
    ]
  if (dir === 'up')
    return [
      g(CAP_CROWN_SIDE, 0, 0),
      // 뒤 조절 끈
      g(['GGGG'], 4, 4, false),
    ]
  return [
    g(CAP_CROWN_SIDE, 0, 0),
    // 챙이 앞(왼쪽)으로 3px
    g(['oRRRRRR', '.o.....'], -2, 4, false),
  ]
}

// ---------------------------------------------------------------------------
// 헤드폰: 회색 머리띠 + 파란 귀덮개
// ---------------------------------------------------------------------------
function headphones(dir: DrawDir, x: number, y: number): Layer[] {
  const g = at(x, y)
  if (dir === 'left')
    return [g(['G', 'G', 'G', 'G', 'G'], 6, 0, false), g(['uuu', 'uuU', 'uuU', 'UUU'], 5, 5)]
  return [
    g(
      ['...GGGGGG...', '.GG......GG.', 'G..........G', 'G..........G', 'G..........G'],
      0,
      0,
      false,
    ),
    g(['uu', 'uU', 'uU', 'UU'], -1, 5),
    g(['uu', 'uU', 'uU', 'UU'], 11, 5),
  ]
}

// ---------------------------------------------------------------------------
// 리본: 분홍 나비 리본(가운데 매듭 진분홍). 정면은 머리 오른쪽 위, 뒷모습은 왼쪽 위, 옆모습은 뒤통수 위
// ---------------------------------------------------------------------------
const BOW = ['PP.PP', 'PPmPP', 'PP.PP']

function ribbon(dir: DrawDir, x: number, y: number): Layer[] {
  const g = at(x, y)
  if (dir === 'down') return [g(BOW, 8, 0)]
  if (dir === 'up') return [g(BOW, -1, 0)]
  return [g(BOW, 7, 0)]
}

const DRAW: Record<AccKind, (dir: DrawDir, x: number, y: number) => Layer[]> = {
  glasses,
  sunglasses,
  cap,
  headphones,
  ribbon,
}

/** character.ts actionFrames(…, extra) 에 넘길 머리 소품 */
export function accessoryExtra(kind: AccKind): HeadExtra {
  return (dir, x, y) => (ACC_HIDDEN[kind].includes(dir) ? [] : DRAW[kind](dir, x, y))
}
