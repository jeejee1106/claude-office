import { compose, grid, type KeyFrame, type Layer, merge, rect, shift } from './layers'

/*
 * 파트너 몬스터 (docs/product-spec.md 4절 "파트너 몬스터"). 팀마다 한 종 + 팀장 전용 한 종 = 5종.
 *
 * 프레임 16×16, 발끝 앵커 (0.5, 1) — 캐릭터(16×24)와 같은 앵커라 같은 바닥 y 에 세우면 된다.
 * 몸통은 외곽선 포함 높이 9px(캐릭터 발끝~허리 8px 근처), 머리 장식(새싹·귀·베레모·안테나·왕관)까지
 * 12px 이하. 16×16 칸의 남는 위쪽은 깡충(최대 3px 뜀) 여유다.
 *
 * 생김새는 이 프로젝트용으로 새로 만든 동글동글한 덩어리 생물이다. 디지몬·포켓몬·메이플스토리 등
 * 기존 작품의 캐릭터를 본뜨지 않는다(docs/product-spec.md 9절). 구분은 몸 색 + 머리 장식 + 든 소품.
 *
 * 색 기호는 캐릭터와 같은 Key 를 쓴다: c/C = 몸(종마다), h/H = 장식 색(종마다), 나머지는 고정 색.
 * 방향: down·up·left 를 그리고 right 는 left 반전(build). 방향 무관 행동은 down 만(pixel-art-pipeline 4절).
 */

export const PET_W = 16
export const PET_H = 16

export type PetKind = 'research' | 'planning' | 'design' | 'dev' | 'boss'
export const PET_KINDS: readonly PetKind[] = ['research', 'planning', 'design', 'dev', 'boss']

type DrawDir = 'down' | 'up' | 'left'
type Expr = 'open' | 'closed' | 'happy' | 'wide'
type Feet = 'stand' | 'stepA' | 'stepB' | 'sit'

interface PetPose {
  /** 몸 높이 증감(눌림 −1, 늘어남 +1) */
  dH?: number
  /** 전체를 위로 띄움(깡충·놀람). 띄우면 바닥에 그림자 */
  lift?: number
  feet?: Feet
  expr?: Expr
  /** 소품을 내려놓음(잠) */
  noProp?: boolean
  /** 땀방울(놀람) */
  sweat?: boolean
}

interface KindDef {
  /** 몸 채움 폭(외곽선 제외) */
  w: number
  /** 둥근 몸(위 모서리 깎음) 또는 네모난 몸 */
  shape: 'round' | 'box'
  /** 머리 장식: 몸 윗줄 y = top, 몸 왼쪽 x = x0 */
  deco: (dir: DrawDir, x0: number, top: number, w: number) => Layer[]
  /** 앞(정면 기준 화면 오른쪽) 손에 든 소품. 손 = (x0+w-1, top+3). null = 소품 없음 */
  prop: { rows: readonly string[]; dx: number; dy: number } | null
  /** 몸과 따로 외곽선을 두르는 모자(베레모·왕관). 위로 3줄까지 */
  hat?: (dir: DrawDir, x0: number, top: number) => Layer[]
  /** 몸 앞에 붙는 장식(넥타이 등). outline 없음 */
  chest?: (dir: DrawDir, x0: number, top: number) => Layer[]
}

const BASE_H = 7
/** 서 있을 때 몸 아랫줄 y(발은 14, 바닥 외곽선 15) */
const STAND_BOTTOM = 13
/** 앉으면 발을 접고 몸이 바닥에 닿는다 */
const SIT_BOTTOM = 14

export const KINDS: Record<PetKind, KindDef> = {
  // 조사팀: 청록 새싹 동그리. 머리에 새싹 두 잎, 돋보기를 든다
  research: {
    w: 8,
    shape: 'round',
    deco: (_dir, _x0, top) => [grid(['hh..hh', '.hHHh.'], 5, top - 2)],
    // 렌즈 3×3(하늘색 + 반짝임) + 손잡이. 뺨 앞에 들고 있다
    prop: { rows: ['.wyy', '.yyy', '.yyy', 'n...', 'n...'], dx: -1, dy: -2 },
  },
  // 기획팀: 보라 뾰족귀. 귀 안쪽 분홍, 클립보드를 든다
  planning: {
    w: 8,
    shape: 'box',
    deco: (dir, x0, top, w) => {
      if (dir === 'left') return [grid(['c..c.', 'ch.cC'], x0 + 2, top - 2)]
      const inner = dir === 'up' ? 'c' : 'h'
      return [grid(['c', `c${inner}`], x0, top - 2), grid(['.C', `${inner}C`], x0 + w - 2, top - 2)]
    },
    // 클립(회색) + 갈색 판 + 흰 종이에 줄
    prop: { rows: ['.GG.', 'nwwn', 'nggn', 'nwwn', 'nggn', 'nnnn'], dx: 0, dy: -2 },
  },
  // 디자인팀: 분홍 말랑이. 보라 베레모를 비스듬히 쓰고 붓을 든다
  design: {
    w: 8,
    shape: 'round',
    deco: () => [],
    // 머리카락처럼 보이지 않게 몸과 따로 외곽선을 둘러 모자 경계를 만든다. 옆모습은 뒤로 기운다
    hat: (dir, x0, top) => [
      grid(dir === 'left' ? ['..hhhhh.', 'hhhhhhhH'] : ['.hhhhh..', 'hhhhhhhH'], x0, top - 2),
    ],
    // 붓: 산호색 붓끝 + 회색 쇠 + 갈색 자루
    prop: { rows: ['.r', 'rr', 'g.', 'n.', 'n.', 'n.'], dx: 0, dy: -5 },
  },
  // 개발팀: 파란 네모 로봇. 노란 전구 안테나, 작은 노트북(하늘색 화면 + 파란 코드 줄 + 회색 자판)을 든다
  dev: {
    w: 8,
    shape: 'box',
    deco: (dir, x0, top) => {
      const x = dir === 'left' ? x0 + 4 : x0 + 3
      return [grid(['hh', '.G'], x, top - 2)]
    },
    prop: { rows: ['yyyy', 'yuuy', 'yyyy', 'gggg'], dx: 0, dy: -1 },
  },
  // 팀장: 산호색 통통이(몸 2px 더 넓음). 노란 왕관 + 파란 넥타이, 소품 없음
  boss: {
    w: 10,
    shape: 'round',
    deco: () => [],
    hat: (dir, x0, top) => {
      const x = dir === 'left' ? x0 + 1 : x0 + 2
      return [grid(['h.hh.h', 'hhhhhH'], x, top - 2)]
    },
    prop: null,
    chest: (dir, x0, top) => {
      if (dir === 'up') return []
      const x = dir === 'left' ? x0 + 2 : x0 + 4
      return [grid(['uu', 'UU'], x, top + 5, false)]
    },
  },
}

// ---------------------------------------------------------------------------
// 부위
// ---------------------------------------------------------------------------

function bodyRows(w: number, h: number, shape: 'round' | 'box'): string[] {
  const rows: string[] = []
  for (let j = 0; j < h; j++) {
    if (j === 0) rows.push(shape === 'round' ? `.${'c'.repeat(w - 2)}.` : `${'c'.repeat(w - 1)}C`)
    else if (j === h - 1) rows.push(`.${'C'.repeat(w - 2)}.`)
    else rows.push(`${'c'.repeat(w - 1)}C`)
  }
  return rows
}

function feet(dir: DrawDir, kind: Feet, x0: number, w: number, y: number): Layer[] {
  if (kind === 'sit') return []
  const foot = (x: number) => rect(x, y, 2, 1, 'C')
  if (dir === 'left') {
    if (kind === 'stepA') return [foot(x0), foot(x0 + w - 2)]
    if (kind === 'stepB') return [foot(x0 + 2), foot(x0 + w - 4)]
    return [foot(x0 + 1), foot(x0 + w - 3)]
  }
  // 정면·뒷모습: 걸음마다 한 발만 보인다(다른 발은 몸 밑으로 들림)
  const left = foot(x0 + 1)
  const right = foot(x0 + w - 3)
  if (kind === 'stepA') return [left]
  if (kind === 'stepB') return [right]
  return [left, right]
}

function face(dir: DrawDir, expr: Expr, x0: number, w: number, top: number): Layer[] {
  if (dir === 'up') return []
  const ey = top + 2
  const px = (x: number, y: number, k: 'o' | 'w' | 'b') => rect(x, y, 1, 1, k, false)
  const out: Layer[] = []
  const eye = (x: number, mirror: boolean) => {
    const s = mirror ? -1 : 1
    if (expr === 'open') out.push(px(x, ey, 'o'), px(x, ey + 1, 'o'))
    else if (expr === 'closed') out.push(px(x, ey + 1, 'o'), px(x - s, ey + 1, 'o'))
    else if (expr === 'happy')
      out.push(px(x, ey, 'o'), px(x - 1, ey + 1, 'o'), px(x + 1, ey + 1, 'o'))
    else
      out.push(
        px(x - (mirror ? 0 : 1), ey, 'w'),
        px(x + (mirror ? 1 : 0), ey, 'o'),
        px(x - (mirror ? 0 : 1), ey + 1, 'o'),
        px(x + (mirror ? 1 : 0), ey + 1, 'o'),
      )
  }
  if (dir === 'down') {
    const eyeL = x0 + Math.floor(w / 2) - 2
    const eyeR = x0 + Math.ceil(w / 2) + 1
    eye(eyeL, false)
    eye(eyeR, true)
    out.push(px(eyeL - 1 - (expr === 'wide' ? 1 : 0), ey + 2, 'b'))
    out.push(px(eyeR + 1 + (expr === 'wide' ? 1 : 0), ey + 2, 'b'))
    if (expr === 'wide') out.push(rect(x0 + w / 2 - 1, ey + 3, 2, 1, 'o', false))
    return out
  }
  // 왼쪽 옆모습: 눈 하나가 앞(왼쪽)으로. 앞에 든 소품의 외곽선(x0+1)에 덮이지 않게 x0+2
  const ex = x0 + 2
  eye(ex, true)
  out.push(px(ex + (expr === 'wide' ? 2 : 1), ey + 2, 'b'))
  if (expr === 'wide') out.push(px(x0, ey + 3, 'o'))
  return out
}

function propLayer(dir: DrawDir, def: KindDef, x0: number, top: number): Layer | null {
  if (!def.prop) return null
  const { rows, dx, dy } = def.prop
  const gw = Math.max(...rows.map((r) => r.length))
  // 긴 소품(클립보드)은 앉으면 바닥에 닿아 멈춘다(채움 맨 아래 y 14)
  const y = Math.min(top + 3 + dy, PET_H - 2 - (rows.length - 1))
  if (dir === 'down') return grid(rows, x0 + def.w - 1 + dx, y)
  // 옆모습: 좌우 반전해 화면 왼쪽(앞 손)에
  const mirrored = rows.map((r) => r.padEnd(gw, '.').split('').reverse().join(''))
  return grid(mirrored, x0 - (gw - 1) - dx, y)
}

/** 포즈 하나 → 16×16 기호 프레임 */
export function petFrame(kind: PetKind, dir: DrawDir, pose: PetPose, where: string): KeyFrame {
  const def = KINDS[kind]
  const w = def.w
  const h = BASE_H + (pose.dH ?? 0)
  const lift = pose.lift ?? 0
  const feetKind = pose.feet ?? 'stand'
  const bottom = feetKind === 'sit' ? SIT_BOTTOM : STAND_BOTTOM
  const x0 = (PET_W - w) / 2
  const top = bottom - h + 1

  const layers: Layer[] = []
  if (lift > 0) layers.push(rect(x0 + 1, PET_H - 1, w - 2, 1, 'G', false))

  // 뒷모습은 소품이 몸에 가려 안 보인다(몸 옆으로 비죽 나오면 날개처럼 보임)
  const prop = pose.noProp || dir === 'up' ? null : propLayer(dir, def, x0, top)
  const up: Layer[] = []
  up.push(
    merge(
      grid(bodyRows(w, h, def.shape), x0, top),
      ...def.deco(dir, x0, top, w),
      ...feet(dir, feetKind, x0, w, bottom + 1),
    ),
  )
  // 둥근 몸은 좌상단 반짝임(광원 좌상단)
  if (def.shape === 'round' && dir !== 'up' && !def.hat)
    up.push(rect(x0 + 1, top + 1, 1, 1, 'w', false))
  up.push(...(def.hat?.(dir, x0, top) ?? []))
  up.push(...(def.chest?.(dir, x0, top) ?? []))
  up.push(...face(dir, pose.expr ?? 'open', x0, w, top))
  if (prop) up.push(prop)
  // 땀방울은 소품 반대쪽(정면은 화면 왼쪽, 옆모습은 뒤통수 쪽)
  if (pose.sweat) up.push(grid(['y', 'y'], dir === 'left' ? x0 + w + 1 : x0 - 2, top - 1))

  for (const l of up) layers.push(shift(l, 0, -lift))
  return compose(layers, PET_W, PET_H, where)
}

// ---------------------------------------------------------------------------
// 애니메이션 — 이름은 아틀라스 키 pet_{kind}_{anim}_{dir}
// ---------------------------------------------------------------------------

export interface PetAnimDef {
  name: string
  /** 권장 프레임 간격(ms), 아틀라스 meta.frameMs */
  frameMs: number
  /** 한 번만 재생하고 끝나는 연출(깡충·놀람) */
  once?: boolean
  downOnly?: boolean
  frames: (dir: DrawDir) => PetPose[]
}

export const PET_ANIMS: readonly PetAnimDef[] = [
  {
    // 걷기: 발 디딤(몸 1px 눌림) → 모음 → 다른 발 → 모음
    name: 'walk',
    frameMs: 140,
    frames: () => [
      { feet: 'stepA', dH: -1 },
      { feet: 'stand' },
      { feet: 'stepB', dH: -1 },
      { feet: 'stand' },
    ],
  },
  {
    // 서 있기: 말랑하게 1px 눌렸다 펴짐
    name: 'idle',
    frameMs: 400,
    frames: () => [{}, { dH: -1 }],
  },
  {
    // 책상 옆 바닥에 앉기: 발을 접고 숨쉬기
    name: 'sit',
    frameMs: 600,
    downOnly: true,
    frames: () => [{ feet: 'sit' }, { feet: 'sit', dH: -1 }],
  },
  {
    // 깡충(도구 성공): 웅크림 → 3px 뜀 → 2px → 착지 웅크림. 한 번 재생
    name: 'hop',
    frameMs: 110,
    once: true,
    downOnly: true,
    frames: () => [
      { dH: -1, expr: 'happy' },
      { lift: 3, expr: 'happy' },
      { lift: 2, expr: 'happy' },
      { dH: -1, expr: 'happy' },
    ],
  },
  {
    // 놀람(오류): 몸이 늘어나며 1px 튀고 땀방울, 다시 내려앉음. 한 번 재생
    name: 'surprised',
    frameMs: 160,
    once: true,
    downOnly: true,
    frames: () => [
      { dH: 1, lift: 1, expr: 'wide', sweat: true },
      { expr: 'wide', sweat: true },
    ],
  },
  {
    // 잠(주인이 졸 때): 앉아서 눈 감고 느린 숨쉬기, 소품은 내려놓음. Zzz 는 씬이 ui 아이콘을 얹는다
    name: 'sleep',
    frameMs: 800,
    downOnly: true,
    frames: () => [
      { feet: 'sit', dH: -1, expr: 'closed', noProp: true },
      { feet: 'sit', expr: 'closed', noProp: true },
    ],
  },
]

export function petAnimDrawDirs(a: PetAnimDef): DrawDir[] {
  return a.downOnly ? ['down'] : ['down', 'up', 'left']
}

/** 그리는 방향(down·up·left)의 기호 프레임 */
export function petKeyFrames(kind: PetKind, a: PetAnimDef, dir: DrawDir): KeyFrame[] {
  return a.frames(dir).map((p, i) => petFrame(kind, dir, p, `pet_${kind}_${a.name}_${dir}_${i}`))
}
