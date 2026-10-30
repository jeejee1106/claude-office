import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { encodePng, PixelImage } from './canvas'
import { REPO_ROOT } from './paths'
import { buildCharacterSheet } from './sheet'
import { buildDecorItems, SEASONS } from './sprites/decor'

/*
 * 계절 장식 미리보기(생성물): 계절마다 한 줄.
 *   줄 맨 앞에 크기 비교용 직원(char_0_idle_stand_down_0), 이어서 장식마다 모든 프레임.
 *   바닥 장식(floor)은 줄 아래 바닥선에, 거는 장식(hang·corner)은 줄 위 천장선에 붙인다(anchor 확인용).
 * 출력: _workspace/decor-preview.png (pnpm --filter @claude-office/assets preview 가 함께 만든다)
 */

export const DECOR_PREVIEW_PATH = resolve(REPO_ROOT, '_workspace/decor-preview.png')

export function writeDecorPreview(scale = 5, out = DECOR_PREVIEW_PATH): string {
  const items = buildDecorItems()
  const staff = buildCharacterSheet().frames.find(
    (f) => f.name === 'char_0_idle_stand_down_0',
  )?.image
  if (!staff) throw new Error('preview: missing char_0_idle_stand_down_0')

  const ROW_H = 52 * scale
  const GAP = scale * 4
  const PAD = scale * 3
  const rows = SEASONS.map((s) => items.filter((d) => d.season === s))
  const rowWidth = (r: typeof items) =>
    staff.width * scale +
    GAP * 2 +
    r.reduce((w, d) => w + d.frames.reduce((a, f) => a + f.width * scale + scale, 0) + GAP, 0)
  const width = PAD * 2 + Math.max(...rows.map(rowWidth))
  const height = PAD * 2 + rows.length * ROW_H + (rows.length - 1) * GAP
  const img = new PixelImage(width, height)

  const BG_A = 0xe9dcc6ff
  const BG_B = 0xdfcfb5ff
  const BASE = 0xb79c7aff
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      img.set(x, y, (Math.floor(x / (scale * 4)) + Math.floor(y / (scale * 4))) % 2 ? BG_A : BG_B)

  rows.forEach((row, r) => {
    const top = PAD + r * (ROW_H + GAP)
    const base = top + ROW_H - scale
    img.fill(PAD, top, width - PAD * 2, 1, BASE) // 천장선(거는 장식 기준)
    img.fill(PAD, base, width - PAD * 2, 1, BASE) // 바닥선(바닥 장식 기준)
    let x = PAD
    img.blit(staff, x, base - staff.height * scale, scale)
    x += staff.width * scale + GAP * 2
    for (const d of row) {
      for (const f of d.frames) {
        const y = d.place === 'floor' ? base - f.height * scale : top + 1
        img.blit(f, x, y, scale)
        x += f.width * scale + scale
      }
      x += GAP
    }
  })

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, encodePng(img))
  return `decor preview: ${width}x${height}px (scale ${scale}) -> ${out}`
}
