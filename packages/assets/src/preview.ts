import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encodePng, PixelImage } from './canvas'
import { packOffice } from './officeSheet'
import { PREVIEW_PATH } from './paths'
import { writeAccessoryPreview } from './previewAccessories'
import { writeDecorPreview } from './previewDecor'
import { writePartnerPreview } from './previewPartners'
import { buildCharacterSheet } from './sheet'
import { ACTIONS, ALL_DIRS, FRAME_H, FRAME_W } from './sprites/character'

/*
 * 미리보기: 프레임을 정수 배율로 확대해 한 장에 모은다(생성물, git 에 넣지 않음).
 *   위: variant 0 의 전체 행동. 한 줄 = 행동 하나(ACTIONS 순서), 왼쪽부터 down | up | left | right.
 *   아래: 변형 0..7 의 idle_stand 4방향 + walk_left 4프레임.
 *   맨 아래: office 시트 전체(아틀라스 배치 그대로, 체커 바탕 = 투명). --only 를 주면 생략.
 * 옵션: --scale=N (기본 4) --variant=N --only=walk,type --out=경로
 */

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k ?? '', v ?? ''] as const
  }),
)
const scale = Number(args.get('scale') ?? 4)
const variant = Number(args.get('variant') ?? 0)
const only = args.get('only')?.split(',').filter(Boolean)
const out = args.get('out') ? resolve(args.get('out') as string) : PREVIEW_PATH

const sheet = buildCharacterSheet()
const byName = new Map(sheet.frames.map((f) => [f.name, f.image]))
const actions = ACTIONS.filter((a) => !only || only.includes(a.name))
// 칸 수 = 프레임 폭 합(16px 단위) — sofa_lie(32px) 는 칸 2개를 쓴다
const span = (img: PixelImage) => Math.ceil(img.width / FRAME_W)
const maxFrames = Math.max(
  ...actions.map((a) =>
    (sheet.animations[`char_${variant}_${a.name}_down`] ?? []).reduce(
      (n, name) => n + span(byName.get(name) as PixelImage),
      0,
    ),
  ),
  4,
)

const CELL_W = FRAME_W * scale + scale
const CELL_H = FRAME_H * scale + scale
const DIR_GAP = scale * 4
const PAD = scale * 2

const variantRows = only ? 0 : 2
const width = PAD * 2 + ALL_DIRS.length * maxFrames * CELL_W + (ALL_DIRS.length - 1) * DIR_GAP
const height = PAD * 2 + (actions.length + variantRows) * CELL_H + (variantRows ? DIR_GAP : 0)
const img = new PixelImage(width, height)

// 바탕: 따뜻한 바닥색 체커 + 셀마다 발끝선 표시(앵커 확인용)
const BG_A = 0xe9dcc6ff
const BG_B = 0xdfcfb5ff
const BASE = 0xb79c7aff
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++)
    img.set(x, y, (Math.floor(x / (scale * 4)) + Math.floor(y / (scale * 4))) % 2 ? BG_A : BG_B)

function cell(name: string, col: number, row: number, dirIndex: number) {
  const frame = byName.get(name)
  if (!frame) return
  const x = PAD + dirIndex * (maxFrames * CELL_W + DIR_GAP) + col * CELL_W
  const y = PAD + row * CELL_H
  // 발끝선 = 프레임 아래 끝(앵커). 키가 작은 프레임(sofa_lie)은 칸 아래에 붙인다
  const top = y + (FRAME_H - frame.height) * scale
  img.fill(x, y + FRAME_H * scale, frame.width * scale, 1, BASE)
  img.blit(frame, x, top, scale)
}

actions.forEach((a, row) => {
  ALL_DIRS.forEach((dir, di) => {
    const names = sheet.animations[`char_${variant}_${a.name}_${dir}`] ?? []
    let col = 0
    for (const n of names) {
      cell(n, col, row, di)
      col += span(byName.get(n) as PixelImage)
    }
  })
})

if (variantRows) {
  const top = actions.length + 0
  for (let v = 0; v < 8; v++) {
    const row = top + Math.floor(v / 4)
    const di = v % 4
    // 한 칸에 4개: idle down, up, left, right 를 maxFrames 칸에 나눠 그린다
    ALL_DIRS.forEach((dir, col) => {
      const frame = byName.get(`char_${v}_idle_stand_${dir}_0`)
      if (!frame) return
      const x = PAD + di * (maxFrames * CELL_W + DIR_GAP) + col * CELL_W
      const y = PAD + row * CELL_H + DIR_GAP
      img.fill(x, y + FRAME_H * scale, FRAME_W * scale, 1, BASE)
      img.blit(frame, x, y, scale)
    })
  }
}

// office 시트: 시트 배치 그대로 확대(투명은 회색 체커로 보이게)
let final = img
if (!only) {
  const office = packOffice().image
  const ow = office.width * scale
  const oh = office.height * scale
  final = new PixelImage(Math.max(width, ow + PAD * 2), height + oh + PAD * 2)
  final.blit(img, 0, 0)
  for (let y = height; y < final.height; y++)
    for (let x = 0; x < final.width; x++)
      final.set(
        x,
        y,
        (Math.floor(x / (scale * 4)) + Math.floor(y / (scale * 4))) % 2 ? 0xc9c9d1ff : 0xb4b4bfff,
      )
  final.blit(office, PAD, height + PAD, scale)
}

writeFileSync(out, encodePng(final))
console.log(`preview: ${final.width}x${final.height}px (scale ${scale}) -> ${out}`)
if (!only) console.log(writePartnerPreview())
if (!only) console.log(writeAccessoryPreview())
if (!only) console.log(writeDecorPreview())
