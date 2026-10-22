import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decodePng, PixelImage } from './canvas'
import { VARIANT_COUNT } from './palette'
import { OUTPUT_DIR, REPO_ROOT } from './paths'
import type { PixiAtlas } from './sheet'
import { ALL_DIRS } from './sprites/character'
import { offPalettePixels } from './validate'

/*
 * 디스크의 산출물(apps/web/public/assets/characters.*)을 씬 코드·매핑표와 대조한다.
 *   - 씬이 요구하는 애니메이션: apps/web/src/scene/activityMap.ts 의 ANIMATIONS
 *   - 매핑표 "필요한 애니메이션 목록": .claude/skills/pixel-office-scene/references/activity-mapping.md
 *   - 변형 수: apps/web/src/scene/variant.ts 의 VARIANT_COUNT
 * 실행: pnpm --filter @claude-office/assets verify  (build 뒤)
 */

const errors: string[] = []
const read = (p: string) => readFileSync(resolve(REPO_ROOT, p), 'utf8')

const activityMap = read('apps/web/src/scene/activityMap.ts')
const animBlock = /export const ANIMATIONS = \[([\s\S]*?)\] as const/.exec(activityMap)?.[1] ?? ''
const sceneAnims = [...animBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string)
if (sceneAnims.length === 0) errors.push('could not read ANIMATIONS from activityMap.ts')

const mapping = read('.claude/skills/pixel-office-scene/references/activity-mapping.md')
const listSection = mapping.split('## 필요한 애니메이션 목록')[1] ?? ''
const docAnims = [...listSection.matchAll(/`([a-z_]+)`/g)].map((m) => m[1] as string)

const variantSrc = read('apps/web/src/scene/variant.ts')
const sceneVariants = Number(/VARIANT_COUNT = (\d+)/.exec(variantSrc)?.[1] ?? Number.NaN)
if (sceneVariants !== VARIANT_COUNT)
  errors.push(`variant count: scene ${sceneVariants}, assets ${VARIANT_COUNT}`)

const atlas = JSON.parse(readFileSync(resolve(OUTPUT_DIR, 'characters.json'), 'utf8')) as PixiAtlas
const sheet = decodePng(readFileSync(resolve(OUTPUT_DIR, atlas.meta.image)))
if (sheet.width !== atlas.meta.size.w || sheet.height !== atlas.meta.size.h)
  errors.push('meta.size does not match the PNG')

const bad = offPalettePixels(sheet)
if (bad.length) errors.push(`off-palette pixels: ${bad.join(', ')}`)

function crop(name: string): PixelImage | null {
  const f = atlas.frames[name]
  if (!f) return null
  const { x, y, w, h } = f.frame
  if (x + w > sheet.width || y + h > sheet.height) {
    errors.push(`${name}: frame rect outside the sheet`)
    return null
  }
  const out = new PixelImage(w, h)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.set(i, j, sheet.get(x + i, y + j))
  return out
}

const required = [...new Set([...sceneAnims, ...docAnims])]
for (const a of docAnims)
  if (!sceneAnims.includes(a)) errors.push(`doc lists '${a}' but scene ANIMATIONS does not`)
for (const a of sceneAnims)
  if (!docAnims.includes(a)) errors.push(`scene uses '${a}' but doc list does not`)

let checked = 0
for (let v = 0; v < sceneVariants; v++) {
  for (const anim of required) {
    for (const dir of ALL_DIRS) {
      const key = `char_${v}_${anim}_${dir}`
      const names = atlas.animations[key]
      if (!names || names.length === 0) {
        errors.push(`missing animation ${key}`)
        continue
      }
      names.forEach((n, i) => {
        if (n !== `${key}_${i}`) errors.push(`${key}: frame ${i} is named ${n}`)
        const img = crop(n)
        if (!img) errors.push(`${key}: frame ${n} missing from frames`)
        if (dir === 'right') {
          const left = crop(n.replace('_right_', '_left_'))
          if (img && left && !img.equals(left.flipH()))
            errors.push(`${n} is not the mirror of left`)
        }
        checked++
      })
    }
  }
}

if (errors.length) {
  console.error(`verify FAILED (${errors.length}):\n  ${errors.slice(0, 40).join('\n  ')}`)
  process.exit(1)
}
console.log(
  `verify OK: ${required.length} animations (${required.join(', ')}) x ${ALL_DIRS.length} dirs x ` +
    `${sceneVariants} variants, ${checked} frames checked, 0 off-palette pixels`,
)
