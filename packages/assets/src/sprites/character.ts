import { grid, type Layer, merge, rect, shift } from './layers'

/*
 * 사무실 직원 캐릭터 (16×24 프레임, 발끝 앵커 0.5, 1).
 *
 * 비율: 머리 12px(외곽선 포함, y 0..11) + 몸 12px(y 12..23) = 2등신. 큰 머리·작은 몸·큰 눈(2×3)·
 * 동글동글한 얼굴. 스타일만 참고해 새로 디자인한 얼굴이며 특정 게임·만화 캐릭터를 본뜨지 않는다
 * (docs/product-spec.md 9절).
 *
 * 좌표계: 프레임 왼쪽 위 (0,0), 발바닥 외곽선이 y=23(맨 아래 줄).
 * 방향: down(정면)·up(뒷모습)·left(왼쪽 옆모습)를 그리고 right 는 left 를 좌우 반전(build 에서).
 * 그리는 순서: 뒤 소품 → 다리 → 몸통 → 머리 → 팔 → 앞 소품. 각 레이어는 자동 1px 외곽선.
 */

export const FRAME_W = 16
export const FRAME_H = 24

export type DrawDir = 'down' | 'up' | 'left'
export const DRAW_DIRS: readonly DrawDir[] = ['down', 'up', 'left']
export const ALL_DIRS = ['down', 'up', 'left', 'right'] as const
export type Dir = (typeof ALL_DIRS)[number]

type Expr = 'open' | 'closed' | 'squeeze' | 'wide' | 'down' | 'talk' | 'happy'
type Legs = 'stand' | 'walk0' | 'walk1' | 'walk2' | 'walk3' | 'sit'

interface Pose {
  /** 상체(머리·몸통·팔·소품) 세로 이동. 다리는 땅에 붙어 있고 바지가 늘어난다 */
  dy?: number
  /** 머리만 추가 이동 */
  hx?: number
  hy?: number
  expr?: Expr
  legs?: Legs
  /** 지정하면 기본 팔(차렷) 대신 사용. 좌표는 dy 적용 전 */
  arms?: Layer[]
  /** 몸 뒤에 그릴 소품 (dy 적용) */
  back?: Layer[]
  /** 맨 앞에 그릴 소품 (dy 적용) */
  front?: Layer[]
  /** 맨 앞 소품을 dy 와 무관하게 고정 위치에 */
  frontFixed?: Layer[]
}

// ---------------------------------------------------------------------------
// 머리 (채움 12×11, x 2..13, y 1..11 → 외곽선 포함 14×13)
// ---------------------------------------------------------------------------

const HEAD_TOP = ['...hhhhhh...', '.hhhhhhhhhh.', 'hhhhhhhhhhhH', 'hhhhhhhhhhHH', 'hhhhhhhhhhHH']

/** 정면: 앞머리(6) + 눈 2×3(7..9) + 입(10) + 턱(11) */
const FRONT_FACE: Record<Expr, readonly string[]> = {
  open: ['hhsshssssshH', 'hsswosswossH', 'hssoossoossH', 'hbsoossoosbH', '.ssssmmssss.'],
  closed: ['hhsshssssshH', 'hssssssssssH', 'hssoossoossH', 'hbssssssssbH', '.sssssmssss.'],
  happy: ['hhsshssssshH', 'hssssssssssH', 'hssoossoossH', 'hbssssssssbH', '.ssssmmssss.'],
  squeeze: ['hhsshssssshH', 'hssossssossH', 'hsssossosssH', 'hbsossssosbH', '.ssssmmssss.'],
  wide: ['hhsshssssshH', 'hsswosswossH', 'hssoossoossH', 'hbsoossoosbH', '.ssssoossss.'],
  down: ['hhsshssssshH', 'hssssssssssH', 'hssoossoossH', 'hbsoossoosbH', '.ssssmmssss.'],
  talk: ['hhsshssssshH', 'hsswosswossH', 'hssoossoossH', 'hbsoossoosbH', '.sssssossss.'],
}
const FRONT_CHIN = '..ssssssss..'

/** 왼쪽 옆모습: 얼굴이 왼쪽(x 2), 귀(S)는 가운데, 뒷머리는 오른쪽 */
const SIDE_FACE: Record<Expr, readonly string[]> = {
  open: ['hsssshhhhhHH', 'swosssShhhHH', 'soosssShhhHH', 'soobsshhhhHH', 'msssssshhHH.'],
  closed: ['hsssshhhhhHH', 'ssssssShhhHH', 'soosssShhhHH', 'ssbssshhhhHH', 'msssssshhHH.'],
  happy: ['hsssshhhhhHH', 'ssssssShhhHH', 'soosssShhhHH', 'ssbssshhhhHH', 'msssssshhHH.'],
  squeeze: ['hsssshhhhhHH', 'sossssShhhHH', 'ssosssShhhHH', 'sosbsshhhhHH', 'msssssshhHH.'],
  wide: ['hsssshhhhhHH', 'swosssShhhHH', 'soosssShhhHH', 'soobsshhhhHH', 'osssssshhHH.'],
  down: ['hsssshhhhhHH', 'ssssssShhhHH', 'soosssShhhHH', 'soobsshhhhHH', 'msssssshhHH.'],
  talk: ['hsssshhhhhHH', 'swosssShhhHH', 'soosssShhhHH', 'soobsshhhhHH', 'osssssshhHH.'],
}
const SIDE_CHIN = '.sssssshHH..'

const BACK_HEAD = [
  ...HEAD_TOP,
  'hhhhhhhhhhHH',
  'hhhhhhhhhhHH',
  'hhhhhhhhhhHH',
  'hHhhhhhhhHHH',
  '.HHHHHHHHHH.',
  '..SSSSSSSS..',
]

function head(dir: DrawDir, expr: Expr, dx: number, dy: number): Layer {
  const rows =
    dir === 'up'
      ? BACK_HEAD
      : dir === 'down'
        ? [...HEAD_TOP, ...FRONT_FACE[expr], FRONT_CHIN]
        : [...HEAD_TOP, ...SIDE_FACE[expr], SIDE_CHIN]
  return grid(rows, 2 + dx, 1 + dy)
}

// ---------------------------------------------------------------------------
// 몸통 (셔츠 y 13..15). 팔 레이어의 외곽선이 몸통 가장자리를 덮어 팔과 몸통 경계가 된다
// ---------------------------------------------------------------------------

function torso(dir: DrawDir): Layer {
  if (dir === 'down') return grid(['cwccwc', 'ccccCc', 'ccccCc'], 5, 13)
  if (dir === 'up') return grid(['cccccc', 'ccccCc', 'ccccCc'], 5, 13)
  return grid(['wcccC', 'ccccC', 'ccccC'], 6, 13)
}

// ---------------------------------------------------------------------------
// 팔 도우미 (1px 팔, 끝에 손). 어깨 높이 y 13
// ---------------------------------------------------------------------------

/** 세로 팔: x 열, y0..y1(포함) 소매, hand 쪽 끝 한 칸은 손 */
function vArm(x: number, y0: number, y1: number, k: 'c' | 'C', hand: 'top' | 'bottom' | 'none') {
  const rows: Layer[] = [rect(x, y0, 1, y1 - y0 + 1, k)]
  if (hand === 'bottom') rows.push(rect(x, y1 + 1, 1, 1, 's'))
  if (hand === 'top') rows.push(rect(x, y0 - 1, 1, 1, 's'))
  return merge(...rows)
}

function restArms(dir: DrawDir): Layer[] {
  if (dir === 'left') return [vArm(10, 13, 14, 'C', 'bottom')]
  return [vArm(4, 13, 14, 'c', 'bottom'), vArm(11, 13, 14, 'C', 'bottom')]
}

/** 옆모습에서 앞으로 굽힌 팔: 어깨(x10)에서 elbowY 까지 내려와 handX 까지 뻗음 */
function sideReach(elbowY: number, handX: number, handY = elbowY): Layer {
  return merge(
    rect(10, 13, 1, elbowY - 13 + 1, 'C'),
    rect(handX + 1, elbowY, 10 - handX - 1, 1, 'C'),
    rect(handX, handY, 1, 1, 's'),
  )
}

/** 정면·뒷모습에서 오른쪽(화면 기준) 팔을 머리 옆으로 든다(어깨 x11 → x14 → 위) */
function raisedArm(handY: number, handX = 14): Layer {
  return merge(
    rect(11, 13, 3, 1, 'C'),
    rect(14, handY + 1, 1, 13 - handY, 'C'),
    rect(handX, handY, 1, 1, 's'),
  )
}

/** 옆모습에서 팔을 얼굴 앞으로 세운다(어깨 x10 → 앞으로 → 위로) */
function sideRaised(handY: number, handX = 1): Layer {
  return merge(
    rect(1, handY + 1, 1, 13 - handY, 'C'),
    rect(2, 13, 8, 1, 'C'),
    rect(handX, handY, 1, 1, 's'),
  )
}

// ---------------------------------------------------------------------------
// 다리 (바지 + 신발). top = 바지 윗줄(상체 dy 에 따라 늘어남). 몸통 외곽선이 윗줄을 덮어 허리선이 된다
// ---------------------------------------------------------------------------

function legs(dir: DrawDir, kind: Legs, top: number): Layer {
  if (kind === 'sit') {
    if (dir === 'down')
      return merge(
        rect(4, top, 8, 21 - top, 'p'),
        rect(5, 21, 2, 1, 'p'),
        rect(9, 21, 2, 1, 'p'),
        rect(4, 22, 3, 1, 'k'),
        rect(9, 22, 3, 1, 'k'),
      )
    if (dir === 'up') return rect(5, top, 6, 23 - top, 'p')
    return merge(
      rect(6, top, 5, 21 - top, 'p'),
      rect(3, 19, 3, 2, 'p'),
      rect(3, 21, 2, 1, 'p'),
      rect(1, 22, 4, 1, 'k'),
    )
  }
  if (dir === 'left') {
    const pants = rect(6, top, 5, 20 - top, 'p')
    if (kind === 'walk0' || kind === 'walk2') {
      const backUp = kind === 'walk2' ? 1 : 0
      return merge(
        pants,
        rect(5, 20, 2, 2, 'p'),
        rect(4, 22, 3, 1, 'k'),
        rect(9, 20, 2, 2 - backUp, 'p'),
        rect(9, 22 - backUp, 3, 1, 'k'),
      )
    }
    return merge(pants, rect(6, 20, 4, 2, 'p'), rect(5, 22, 5, 1, 'k'))
  }
  // 정면·뒷모습
  const leftUp = kind === 'walk0' ? 1 : 0
  const rightUp = kind === 'walk2' ? 1 : 0
  return merge(
    rect(5, top, 6, 20 - top, 'p'),
    rect(5, 20, 2, 2 - leftUp, 'p'),
    rect(4, 22 - leftUp, 3, 1, 'k'),
    rect(9, 20, 2, 2 - rightUp, 'p'),
    rect(9, 22 - rightUp, 3, 1, 'k'),
  )
}

// ---------------------------------------------------------------------------
// 소품
// ---------------------------------------------------------------------------

const BOOK_BACK = (x: number, y: number) => grid(['uuuuuU', 'uggguU', 'uuuuuU'], x, y)
const BOOK_SIDE = (x: number, y: number, flip: boolean) =>
  grid(flip ? ['.ww.', 'wwgu'] : ['wwww', 'uuuu'], x, y)
const PAPER = (x: number, y: number) => grid(['wwww', 'wggw', 'wgww', 'wwww'], x, y)
const CUP = (x: number, y: number) => grid(['ww', 'gg'], x, y)
const PHONE = (x: number, y: number) => grid(['r', 'r', 'r', 'r'], x, y)
const MARKER = (x: number, y: number) => grid(['u'], x, y)
const BAG = (x: number, y: number) => grid(['.NN.', 'nnnn', 'nnnn', 'NNNN'], x, y)
const ITEM = (x: number, y: number) => grid(['ww', 'ww'], x, y)

// ---------------------------------------------------------------------------
// 행동 정의 — 이름은 apps/web/src/scene/activityMap.ts 의 ANIMATIONS 와 같다
// ---------------------------------------------------------------------------

export interface ActionDef {
  name: string
  /** 권장 프레임 간격(ms). 아틀라스 meta.frameMs 에도 들어간다 */
  frameMs: number
  frames: (dir: DrawDir) => Pose[]
}

/** 앉으면 상체가 2px 내려간다 */
const SEAT_DY = 2
const REST_L = vArm(4, 13, 14, 'c', 'bottom')
const REST_R = vArm(11, 13, 14, 'C', 'bottom')

export const ACTIONS: readonly ActionDef[] = [
  {
    // 서 있기: 숨쉬기(머리 1px) + 눈 깜빡임
    name: 'idle_stand',
    frameMs: 260,
    frames: () => [{}, {}, { hy: 1 }, { expr: 'closed' }],
  },
  {
    name: 'idle_sit',
    frameMs: 260,
    frames: () => [
      { legs: 'sit', dy: SEAT_DY },
      { legs: 'sit', dy: SEAT_DY },
      { legs: 'sit', dy: SEAT_DY, hy: 1 },
      { legs: 'sit', dy: SEAT_DY, expr: 'closed' },
    ],
  },
  {
    // 4프레임: 한 발 듦(몸 1px 내려감) → 모음 → 다른 발 → 모음
    name: 'walk',
    frameMs: 140,
    frames: (dir) => {
      if (dir === 'left')
        return [
          { legs: 'walk0', dy: 1, arms: [vArm(11, 13, 14, 'C', 'bottom')] },
          { legs: 'walk1' },
          {
            legs: 'walk2',
            dy: 1,
            arms: [merge(rect(10, 13, 1, 1, 'C'), rect(9, 14, 1, 1, 'C'), rect(9, 15, 1, 1, 's'))],
          },
          { legs: 'walk3' },
        ]
      return [
        { legs: 'walk0', dy: 1, arms: [vArm(4, 13, 13, 'c', 'bottom'), REST_R] },
        { legs: 'walk1' },
        { legs: 'walk2', dy: 1, arms: [REST_L, vArm(11, 13, 13, 'C', 'bottom')] },
        { legs: 'walk3' },
      ]
    },
  },
  {
    // 타이핑(책상·서버 터미널 공용, 서서 친다)
    name: 'type',
    frameMs: 120,
    frames: (dir) => {
      if (dir === 'up')
        return [
          { arms: [vArm(4, 13, 14, 'c', 'none'), vArm(11, 13, 15, 'C', 'none')] },
          { arms: [vArm(4, 13, 15, 'c', 'none'), vArm(11, 13, 14, 'C', 'none')] },
        ]
      if (dir === 'left')
        return [
          { expr: 'down', arms: [sideReach(15, 3)] },
          { expr: 'down', arms: [sideReach(15, 3, 14)] },
        ]
      const armL = (handY: number) => merge(rect(4, 13, 1, 2, 'c'), rect(5, handY, 2, 1, 's'))
      const armR = (handY: number) => merge(rect(11, 13, 1, 2, 'C'), rect(9, handY, 2, 1, 's'))
      return [
        { expr: 'down', arms: [armL(15), armR(16)] },
        { expr: 'down', arms: [armL(16), armR(15)] },
      ]
    },
  },
  {
    // 책 펼치기: 정면은 책 뒤표지가 보이고, 뒷모습은 고개를 숙임
    name: 'read',
    frameMs: 400,
    frames: (dir) => {
      if (dir === 'up')
        return [
          { hy: 1, arms: [vArm(4, 13, 14, 'c', 'none'), vArm(11, 13, 14, 'C', 'none')] },
          { hy: 1, arms: [vArm(4, 13, 15, 'c', 'none'), vArm(11, 13, 14, 'C', 'none')] },
        ]
      if (dir === 'left')
        return [
          { expr: 'down', arms: [sideReach(15, 5)], front: [BOOK_SIDE(2, 13, false)] },
          { expr: 'down', arms: [sideReach(15, 5)], front: [BOOK_SIDE(2, 13, true)] },
        ]
      const holding = (d: number): Pose => ({
        expr: 'down',
        arms: [vArm(4, 13, 14 + d, 'c', 'bottom'), vArm(11, 13, 14 + d, 'C', 'bottom')],
        front: [BOOK_BACK(5, 14 + d)],
      })
      return [holding(0), holding(1)]
    },
  },
  {
    // 서랍 뒤지기: 몸을 숙이고 양손을 번갈아 아래로
    name: 'search',
    frameMs: 160,
    frames: (dir) => {
      if (dir === 'left')
        return [
          { dy: 1, expr: 'down', arms: [sideReach(15, 3)] },
          { dy: 1, expr: 'down', arms: [sideReach(15, 3, 16)] },
        ]
      return [
        {
          dy: 1,
          expr: 'down',
          arms: [vArm(4, 13, 15, 'c', 'bottom'), vArm(11, 13, 13, 'C', 'bottom')],
        },
        {
          dy: 1,
          expr: 'down',
          arms: [vArm(4, 13, 13, 'c', 'bottom'), vArm(11, 13, 15, 'C', 'bottom')],
        },
      ]
    },
  },
  {
    // 지구본 바라보기: 턱 괴고 고개를 갸웃
    name: 'look',
    frameMs: 500,
    frames: (dir) => {
      if (dir === 'up') return [{ hx: 0 }, { hx: 1 }, { hx: 0 }, { hx: -1 }]
      if (dir === 'left') {
        const chin = [merge(rect(4, 13, 7, 1, 'C'), rect(3, 12, 1, 1, 's'))]
        return [{ arms: chin }, { arms: chin, hy: 1 }]
      }
      const chin = [REST_L, merge(rect(11, 13, 1, 1, 'C'), rect(10, 12, 1, 1, 's'))]
      return [{ arms: chin }, { arms: chin, hx: 1 }]
    },
  },
  {
    // 손짓(새 직원 맞이): 손을 들고 흔듦
    name: 'wave',
    frameMs: 200,
    frames: (dir) => {
      if (dir === 'left')
        return [
          { expr: 'happy', arms: [sideRaised(4)] },
          { expr: 'happy', arms: [sideRaised(4, 2)] },
        ]
      return [
        { expr: 'happy', arms: [REST_L, raisedArm(4)] },
        { expr: 'happy', arms: [REST_L, raisedArm(4, 13)] },
      ]
    },
  },
  {
    // 화이트보드에 쓰기: 마커 든 손이 위아래로
    name: 'write_board',
    frameMs: 220,
    frames: (dir) => {
      if (dir === 'left')
        return [
          { arms: [sideRaised(6)], front: [MARKER(1, 5)] },
          { arms: [sideRaised(8)], front: [MARKER(1, 7)] },
        ]
      return [
        { arms: [REST_L, raisedArm(6)], front: [MARKER(14, 5)] },
        { arms: [REST_L, raisedArm(8)], front: [MARKER(14, 7)] },
      ]
    },
  },
  {
    // 전화: 수화기를 귀에 대고 말함(입 모양 번갈아)
    name: 'phone',
    frameMs: 300,
    frames: (dir) => {
      if (dir === 'left') {
        const arm = [merge(rect(10, 11, 1, 3, 'C'), rect(9, 10, 2, 1, 's'))]
        return [
          { expr: 'talk', arms: arm, front: [PHONE(8, 6)] },
          { expr: 'open', arms: arm, front: [PHONE(8, 6)] },
        ]
      }
      const arm = [
        REST_L,
        merge(rect(11, 13, 3, 1, 'C'), rect(14, 10, 1, 3, 'C'), rect(14, 9, 1, 1, 's')),
      ]
      return [
        { expr: 'talk', arms: arm, front: [PHONE(14, 5)] },
        { expr: 'open', arms: arm, front: [PHONE(14, 5)] },
      ]
    },
  },
  {
    // 커피: 컵을 들고 있다가 한 모금
    name: 'idle_drink',
    frameMs: 500,
    frames: (dir) => {
      if (dir === 'left')
        return [
          { arms: [sideReach(15, 4)], front: [CUP(3, 13)] },
          {
            expr: 'closed',
            arms: [merge(rect(10, 13, 1, 1, 'C'), rect(4, 12, 7, 1, 'C'), rect(3, 11, 1, 1, 's'))],
            front: [CUP(1, 9)],
          },
        ]
      if (dir === 'up')
        return [
          { arms: [REST_L, vArm(11, 13, 14, 'C', 'none')] },
          { arms: [REST_L, vArm(12, 11, 13, 'C', 'none')] },
        ]
      return [
        {
          arms: [REST_L, merge(rect(11, 13, 1, 2, 'C'), rect(11, 15, 1, 1, 's'))],
          front: [CUP(9, 14)],
        },
        {
          expr: 'closed',
          arms: [REST_L, merge(rect(10, 13, 2, 1, 'C'), rect(9, 12, 1, 1, 's'))],
          front: [CUP(7, 11)],
        },
      ]
    },
  },
  {
    // 손들기(사용자 확인 필요): 손을 높이 들고 살짝 들썩
    name: 'raise_hand',
    frameMs: 300,
    frames: (dir) => {
      if (dir === 'left') return [{ arms: [sideRaised(3)] }, { arms: [sideRaised(4)] }]
      return [{ arms: [REST_L, raisedArm(3)] }, { arms: [REST_L, raisedArm(4)] }]
    },
  },
  {
    // 파쇄: 서류를 앞으로 밀어 넣음
    name: 'shred',
    frameMs: 300,
    frames: (dir) => {
      if (dir === 'left')
        return [
          { expr: 'down', arms: [sideReach(15, 5)], front: [PAPER(1, 13)] },
          { expr: 'down', arms: [sideReach(16, 5)], front: [PAPER(1, 15)] },
        ]
      if (dir === 'up') {
        const arms = [vArm(4, 13, 14, 'c', 'none'), vArm(11, 13, 14, 'C', 'none')]
        return [{ arms }, { dy: 1, arms }]
      }
      const hold = (y: number): Pose => ({
        expr: 'down',
        arms: [vArm(4, 13, y, 'c', 'bottom'), vArm(11, 13, y, 'C', 'bottom')],
        front: [grid(['wwwwww', 'wggggw', 'wgggww', 'wwwwww'], 5, y)],
      })
      return [hold(14), hold(15)]
    },
  },
  {
    // 졸기(5분 무활동): 앉아서 고개를 떨굼
    name: 'sleep',
    frameMs: 700,
    frames: (dir) => {
      const hx = dir === 'left' ? -1 : 0
      return [
        { legs: 'sit', dy: SEAT_DY, expr: 'closed', hx, hy: 2 },
        { legs: 'sit', dy: SEAT_DY, expr: 'closed', hx, hy: 1 },
      ]
    },
  },
  {
    // 멈칫(에러): 놀라서 팔을 움츠리고 굳음
    name: 'flinch',
    frameMs: 200,
    frames: (dir) => {
      const arms =
        dir === 'left'
          ? [vArm(10, 13, 13, 'C', 'bottom')]
          : [vArm(4, 13, 13, 'c', 'bottom'), vArm(11, 13, 13, 'C', 'bottom')]
      return [
        { expr: 'wide', arms },
        { dy: 1, expr: 'wide', arms },
      ]
    },
  },
  {
    // 머리 감싸기(연속 에러): 두 손으로 머리를 쥐고 끄덕끄덕
    name: 'head_hold',
    frameMs: 200,
    frames: (dir) => {
      if (dir === 'left') {
        const arm = (d: number) =>
          merge(rect(10, 13, 1, 1, 'C'), rect(11, 7 + d, 1, 7 - d, 'C'), rect(10, 5 + d, 2, 2, 's'))
        return [
          { expr: 'squeeze', arms: [arm(0)] },
          { expr: 'squeeze', hy: 1, arms: [arm(1)] },
        ]
      }
      const arms = (d: number) => [
        merge(rect(2, 13, 2, 1, 'c'), rect(1, 7 + d, 1, 7 - d, 'c'), rect(1, 5 + d, 2, 2, 's')),
        merge(rect(12, 13, 2, 1, 'C'), rect(14, 7 + d, 1, 7 - d, 'C'), rect(13, 5 + d, 2, 2, 's')),
      ]
      return [
        { expr: 'squeeze', arms: arms(0) },
        { expr: 'squeeze', hy: 1, arms: arms(1) },
      ]
    },
  },
  {
    // 짐 챙기기(퇴근): 물건을 가방에 넣음
    name: 'pack',
    frameMs: 220,
    frames: (dir) => {
      if (dir === 'left')
        return [
          { expr: 'down', arms: [sideReach(15, 4)], frontFixed: [ITEM(3, 13), BAG(1, 17)] },
          { expr: 'down', arms: [sideReach(16, 4)], frontFixed: [ITEM(3, 15), BAG(1, 17)] },
        ]
      if (dir === 'up')
        return [
          {
            dy: 1,
            arms: [vArm(4, 13, 14, 'c', 'none'), vArm(11, 13, 14, 'C', 'bottom')],
            frontFixed: [BAG(11, 17)],
          },
          {
            dy: 1,
            arms: [vArm(4, 13, 15, 'c', 'none'), vArm(11, 13, 15, 'C', 'bottom')],
            frontFixed: [BAG(11, 17)],
          },
        ]
      return [
        {
          expr: 'down',
          arms: [
            vArm(4, 13, 15, 'c', 'bottom'),
            merge(rect(11, 13, 1, 2, 'C'), rect(10, 15, 1, 1, 's')),
          ],
          frontFixed: [ITEM(8, 13), BAG(1, 17)],
        },
        {
          expr: 'down',
          arms: [
            vArm(4, 13, 15, 'c', 'bottom'),
            merge(rect(11, 13, 1, 3, 'C'), rect(10, 16, 1, 1, 's')),
          ],
          frontFixed: [ITEM(5, 15), BAG(1, 17)],
        },
      ]
    },
  },
  {
    // 보고(서브 완료): 서류를 내밀고 꾸벅
    name: 'report',
    frameMs: 200,
    frames: (dir) => {
      if (dir === 'left')
        return [
          { expr: 'happy', arms: [sideReach(15, 5)], front: [PAPER(1, 12)] },
          { expr: 'happy', hx: -1, hy: 1, arms: [sideReach(15, 5)], front: [PAPER(1, 12)] },
        ]
      if (dir === 'up') {
        const arms = [vArm(4, 13, 14, 'c', 'none'), vArm(11, 13, 14, 'C', 'none')]
        return [{ arms }, { hy: 1, arms }]
      }
      const hold = (hy: number): Pose => ({
        expr: 'happy',
        hy,
        arms: [
          merge(rect(4, 13, 1, 2, 'c'), rect(5, 15, 1, 1, 's')),
          merge(rect(11, 13, 1, 2, 'C'), rect(10, 15, 1, 1, 's')),
        ],
        front: [PAPER(6, 13)],
      })
      return [hold(0), hold(1)]
    },
  },
]

/** 한 포즈 → 그리기 순서대로 정렬된 레이어 */
export function poseLayers(dir: DrawDir, pose: Pose): Layer[] {
  const dy = pose.dy ?? 0
  const legKind = pose.legs ?? 'stand'
  const out: Layer[] = []
  for (const l of pose.back ?? []) out.push(shift(l, 0, dy))
  out.push(legs(dir, legKind, 16 + dy))
  out.push(shift(torso(dir), 0, dy))
  out.push(
    head(dir, dir === 'up' ? 'open' : (pose.expr ?? 'open'), pose.hx ?? 0, dy + (pose.hy ?? 0)),
  )
  for (const l of pose.arms ?? restArms(dir)) out.push(shift(l, 0, dy))
  for (const l of pose.front ?? []) out.push(shift(l, 0, dy))
  for (const l of pose.frontFixed ?? []) out.push(l)
  return out
}
