/*
 * 문자 그리드 레이어 합성.
 *
 * 한 글자 = 기호 색 하나(KEY_COLORS). 레이어마다 채움만 그리고, outline: true 면
 * 합성할 때 그 레이어의 바깥(4방향 이웃 중 비어 있는 칸)에 1px 외곽선을 자동으로 두른다.
 * 앞 레이어 위에 그려진 외곽선이 곧 부위 사이 경계선(팔과 몸통, 턱과 셔츠)이 된다.
 * 4방향 이웃만 쓰므로 모서리가 둥글게 빠진다(동글동글한 인상).
 */

/** 그리드 기호. 변형 색(c/C/h/H)은 colorize 단계에서 variant 별로 정해진다 */
export type Key =
  | 'o' // 외곽선(짙은 남색) — 눈·입 등 내부 선에도 쓴다
  | 'w' // white
  | 's' // skin
  | 'S' // skinShade
  | 'b' // blush
  | 'm' // 입(pinkDark)
  | 'p' // pants
  | 'k' // 신발(brownDark)
  | 'c' // 셔츠(변형)
  | 'C' // 셔츠 그림자(변형)
  | 'h' // 머리(변형)
  | 'H' // 머리 그림자(변형)
  | 'g' // grayLight
  | 'G' // gray
  | 'r' // coral (전화기)
  | 'u' // blue (책 표지·마커)
  | 'U' // blueDark
  | 'n' // chestnut (가방)
  | 'N' // chestnutDark

const KEYS = new Set<string>([
  'o',
  'w',
  's',
  'S',
  'b',
  'm',
  'p',
  'k',
  'c',
  'C',
  'h',
  'H',
  'g',
  'G',
  'r',
  'u',
  'U',
  'n',
  'N',
])

export interface Pixel {
  x: number
  y: number
  k: Key
}

export interface Layer {
  px: Pixel[]
  outline: boolean
}

/** 문자 그리드 → 레이어. '.' 과 ' ' 는 비움. (x, y) 는 그리드 왼쪽 위 */
export function grid(rows: readonly string[], x: number, y: number, outline = true): Layer {
  const px: Pixel[] = []
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i] as string
      if (ch === '.' || ch === ' ') continue
      if (!KEYS.has(ch)) throw new Error(`unknown grid key '${ch}' in row "${row}"`)
      px.push({ x: x + i, y: y + j, k: ch as Key })
    }
  })
  return { px, outline }
}

export function rect(x: number, y: number, w: number, h: number, k: Key, outline = true): Layer {
  const px: Pixel[] = []
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px.push({ x: x + i, y: y + j, k })
  return { px, outline }
}

/** 여러 레이어를 하나로(외곽선은 합친 모양 바깥에만) */
export function merge(...layers: Layer[]): Layer {
  return { px: layers.flatMap((l) => l.px), outline: layers.some((l) => l.outline) }
}

export function shift(layer: Layer, dx: number, dy: number): Layer {
  return { px: layer.px.map((p) => ({ x: p.x + dx, y: p.y + dy, k: p.k })), outline: layer.outline }
}

/** 프레임 = 기호 그리드(null 은 투명) */
export type KeyFrame = (Key | null)[][]

export function compose(layers: readonly Layer[], w: number, h: number, where: string): KeyFrame {
  const out: KeyFrame = Array.from({ length: h }, () => Array<Key | null>(w).fill(null))
  const put = (x: number, y: number, k: Key) => {
    if (x < 0 || y < 0 || x >= w || y >= h)
      throw new Error(`${where}: pixel (${x},${y}) is outside the ${w}x${h} frame`)
    ;(out[y] as (Key | null)[])[x] = k
  }
  for (const layer of layers) {
    if (layer.outline) {
      const filled = new Set(layer.px.map((p) => `${p.x},${p.y}`))
      for (const p of layer.px) {
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = p.x + dx
          const ny = p.y + dy
          if (!filled.has(`${nx},${ny}`)) put(nx, ny, 'o')
        }
      }
    }
    for (const p of layer.px) put(p.x, p.y, p.k)
  }
  return out
}
