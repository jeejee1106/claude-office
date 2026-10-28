import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildAccessorySheet } from './accessorySheet'
import { encodePng, PixelImage } from './canvas'
import { REPO_ROOT } from './paths'
import { buildCharacterSheet } from './sheet'
import { ACC_KINDS } from './sprites/accessory'
import { FRAME_H } from './sprites/character'

/*
 * 외모 소품 미리보기(생성물): 캐릭터 프레임 위에 오버레이를 겹쳐 그린다(씬과 같은 방식).
 *   1줄: 소품 없음(variant 0) — 비교용
 *   그다음 소품 종류마다 VARIANTS_SHOWN 줄.
 *   칸: stand 4방향 | walk down 4 | walk left 0,2 | idle_sit down·left·up | phone_sit down·left·up |
 *       sofa_sit | sofa_lie | sleep down·left | head_hold down·left | look down 1 | report left 1
 * 출력: _workspace/accessory-preview.png (pnpm --filter @claude-office/assets preview 가 함께 만든다)
 */

export const ACCESSORY_PREVIEW_PATH = resolve(REPO_ROOT, '_workspace/accessory-preview.png')

const VARIANTS_SHOWN = [0, 1, 5]

const POSES: (string | 'gap')[] = [
  'idle_stand_down_0',
  'idle_stand_up_0',
  'idle_stand_left_0',
  'idle_stand_right_0',
  'gap',
  'walk_down_0',
  'walk_down_1',
  'walk_down_2',
  'walk_down_3',
  'walk_left_0',
  'walk_left_2',
  'gap',
  'idle_sit_down_0',
  'idle_sit_left_0',
  'idle_sit_up_0',
  'phone_sit_down_0',
  'phone_sit_left_0',
  'phone_sit_up_0',
  'gap',
  'sofa_sit_down_0',
  'sofa_lie_down_0',
  'gap',
  'sleep_down_0',
  'sleep_left_0',
  'head_hold_down_1',
  'head_hold_left_0',
  'look_down_1',
  'report_left_1',
]

export function writeAccessoryPreview(scale = 5, out = ACCESSORY_PREVIEW_PATH): string {
  const chars = buildCharacterSheet()
  const accs = buildAccessorySheet()
  const byName = new Map([...chars.frames, ...accs.frames].map((f) => [f.name, f.image]))
  const get = (n: string) => {
    const f = byName.get(n)
    if (!f) throw new Error(`accessory preview: missing frame ${n}`)
    return f
  }

  const GAP = scale * 4
  const ROW_H = FRAME_H * scale + scale * 3
  const PAD = scale * 3
  const rows: (string | null)[][] = [
    // [variant, kind | null]
    ['0', null],
    ...ACC_KINDS.flatMap((k) => VARIANTS_SHOWN.map((v) => [String(v), k])),
  ]
  const cellW = (pose: string) => get(`char_0_${pose}`).width * scale + scale
  const rowW = POSES.reduce((w, p) => w + (p === 'gap' ? GAP : cellW(p)), 0)
  const width = PAD * 2 + rowW
  const height = PAD * 2 + rows.length * ROW_H + ACC_KINDS.length * GAP
  const img = new PixelImage(width, height)

  const BG_A = 0xe9dcc6ff
  const BG_B = 0xdfcfb5ff
  const BASE = 0xb79c7aff
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      img.set(x, y, (Math.floor(x / (scale * 4)) + Math.floor(y / (scale * 4))) % 2 ? BG_A : BG_B)

  rows.forEach(([v, kind], r) => {
    const group = r === 0 ? 0 : 1 + Math.floor((r - 1) / VARIANTS_SHOWN.length)
    const baseY = PAD + r * ROW_H + group * GAP + FRAME_H * scale
    let x = PAD
    for (const pose of POSES) {
      if (pose === 'gap') {
        x += GAP
        continue
      }
      const ch = get(`char_${v}_${pose}`)
      img.fill(x, baseY, ch.width * scale, 1, BASE)
      img.blit(ch, x, baseY - ch.height * scale, scale)
      if (kind) img.blit(get(`acc_${kind}_${pose}`), x, baseY - ch.height * scale, scale)
      x += cellW(pose)
    }
  })

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, encodePng(img))
  return `accessory preview: ${width}x${height}px (scale ${scale}) -> ${out}`
}
