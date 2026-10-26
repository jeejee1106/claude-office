import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { encodePng, PixelImage } from './canvas'
import { buildPartnerSheet, petAnimDirs } from './partnerSheet'
import { REPO_ROOT } from './paths'
import { buildCharacterSheet } from './sheet'
import { FRAME_H } from './sprites/character'
import { PET_ANIMS, PET_KINDS, type PetKind } from './sprites/partner'

/*
 * 파트너 몬스터 미리보기(생성물): 종마다 2줄.
 *   1줄: 크기 비교용 직원(idle_stand_down) | 직원 옆에 선 파트너 | walk down·up·left·right 4프레임씩
 *   2줄: 직원 | idle 4방향 2프레임씩 | sit | hop | surprised | sleep
 * 칸 높이는 캐릭터(24px)에 맞추고 모두 발끝선(아래 끝)에 세운다.
 * 출력: _workspace/partner-preview.png (pnpm --filter @claude-office/assets preview 가 함께 만든다)
 */

export const PARTNER_PREVIEW_PATH = resolve(REPO_ROOT, '_workspace/partner-preview.png')

/** 미리보기에서 함께 세울 직원 변형(팀장 = 0) */
const OWNER: Record<PetKind, number> = { research: 1, planning: 2, design: 3, dev: 4, boss: 0 }

export function writePartnerPreview(scale = 5, out = PARTNER_PREVIEW_PATH): string {
  const pets = buildPartnerSheet()
  const chars = buildCharacterSheet()
  const byName = new Map([...pets.frames, ...chars.frames].map((f) => [f.name, f.image]))

  const CELL = 16 * scale + scale
  const GAP = scale * 5
  const ROW_H = FRAME_H * scale + scale * 3
  const PAD = scale * 3

  type Item = { names: string[] } | 'gap'
  const rowsFor = (kind: PetKind): Item[][] => {
    const owner = [`char_${OWNER[kind]}_idle_stand_down_0`]
    const walk: Item[] = []
    const rest: Item[] = []
    for (const a of PET_ANIMS)
      for (const dir of petAnimDirs(a)) {
        const item = { names: pets.animations[`pet_${kind}_${a.name}_${dir}`] ?? [] }
        if (a.name === 'walk') walk.push(item, 'gap')
        else rest.push(item, 'gap')
      }
    return [
      [{ names: [...owner, `pet_${kind}_idle_down_0`] }, 'gap', 'gap', ...walk],
      [{ names: owner }, 'gap', ...rest],
    ]
  }

  const layout = PET_KINDS.flatMap(rowsFor)
  const rowWidth = (r: Item[]) =>
    r.reduce((w, it) => w + (it === 'gap' ? GAP : it.names.length * CELL), 0)
  const width = PAD * 2 + Math.max(...layout.map(rowWidth))
  const height = PAD * 2 + layout.length * ROW_H + (PET_KINDS.length - 1) * GAP
  const img = new PixelImage(width, height)

  const BG_A = 0xe9dcc6ff
  const BG_B = 0xdfcfb5ff
  const BASE = 0xb79c7aff
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      img.set(x, y, (Math.floor(x / (scale * 4)) + Math.floor(y / (scale * 4))) % 2 ? BG_A : BG_B)

  layout.forEach((row, r) => {
    const baseY = PAD + r * ROW_H + Math.floor(r / 2) * GAP + FRAME_H * scale
    let x = PAD
    for (const it of row) {
      if (it === 'gap') {
        x += GAP
        continue
      }
      for (const n of it.names) {
        const f = byName.get(n)
        if (!f) throw new Error(`preview: missing frame ${n}`)
        img.fill(x, baseY, f.width * scale, 1, BASE)
        img.blit(f, x, baseY - f.height * scale, scale)
        x += CELL
      }
    }
  })

  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, encodePng(img))
  return `partner preview: ${width}x${height}px (scale ${scale}) -> ${out}`
}
