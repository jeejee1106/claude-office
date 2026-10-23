import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { decodePng, PixelImage } from './canvas'
import type { OfficeAtlas } from './officeSheet'
import { VARIANT_COUNT } from './palette'
import { OUTPUT_DIR, REPO_ROOT } from './paths'
import type { PixiAtlas } from './sheet'
import { ALL_DIRS } from './sprites/character'
import { buildOfficeFrames } from './sprites/office'
import { offPalettePixels } from './validate'

/*
 * 디스크의 산출물(apps/web/public/assets/characters.*)을 씬 코드·매핑표와 대조한다.
 *   - 씬이 요구하는 애니메이션: apps/web/src/scene/activityMap.ts 의 ANIMATIONS
 *   - 매핑표 "필요한 애니메이션 목록": .claude/skills/pixel-office-scene/references/activity-mapping.md
 *   - 변형 수: apps/web/src/scene/variant.ts 의 VARIANT_COUNT
 *   - office 시트: 디스크의 office.png/json 이 생성 스크립트와 같은지, 크기 16 배수·앵커·팔레트
 *   - apps/web/src 가 이름으로 부르는 furn_/tile_/ui_ 프레임이 시트에 있는지(없으면 경고)
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

// ---------------------------------------------------------------------------
// office 시트: 디스크 산출물이 지금 생성 스크립트와 같은지 + 규격(16 배수, 앵커, 팔레트)
// ---------------------------------------------------------------------------
const officeAtlas = JSON.parse(
  readFileSync(resolve(OUTPUT_DIR, 'office.json'), 'utf8'),
) as OfficeAtlas
const officeSheet = decodePng(readFileSync(resolve(OUTPUT_DIR, officeAtlas.meta.image)))
if (officeSheet.width !== officeAtlas.meta.size.w || officeSheet.height !== officeAtlas.meta.size.h)
  errors.push('office: meta.size does not match the PNG')
const officeBad = offPalettePixels(officeSheet)
if (officeBad.length) errors.push(`office: off-palette pixels: ${officeBad.join(', ')}`)
const expected = buildOfficeFrames()
for (const f of expected) {
  const a = officeAtlas.frames[f.name]
  if (!a) {
    errors.push(`office: missing frame ${f.name} (run build)`)
    continue
  }
  const { x, y, w, h } = a.frame
  if (w % 16 || h % 16) errors.push(`office: ${f.name} is ${w}x${h}, not a multiple of 16`)
  if (!a.anchor) errors.push(`office: ${f.name} has no anchor`)
  if (x + w > officeSheet.width || y + h > officeSheet.height) {
    errors.push(`office: ${f.name} frame rect outside the sheet`)
    continue
  }
  const disk = new PixelImage(w, h)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) disk.set(i, j, officeSheet.get(x + i, y + j))
  if (!disk.equals(f.image))
    errors.push(`office: ${f.name} on disk differs from the script (run build)`)
}
for (const n of Object.keys(officeAtlas.frames))
  if (!expected.some((f) => f.name === n)) errors.push(`office: stale frame ${n} (run build)`)

// 씬 코드가 이름으로 부르는 furn_/tile_/ui_ 프레임이 시트에 있는지(경고만 — 씬이 아직 없는 가구를 부를 수 있음)
const warnings: string[] = []
const known = new Set([...Object.keys(officeAtlas.frames), ...Object.keys(atlas.frames)])
function scan(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) scan(p)
    else if (/\.(ts|tsx)$/.test(e.name))
      for (const m of readFileSync(p, 'utf8').matchAll(/['"`]((?:furn|tile|ui)_[a-z0-9_]+)['"`]/g))
        if (!known.has(m[1] as string))
          warnings.push(`${relative(REPO_ROOT, p)}: '${m[1]}' not in any sheet`)
  }
}
scan(resolve(REPO_ROOT, 'apps/web/src'))
if (warnings.length)
  console.warn(`verify warnings (${warnings.length}):\n  ${warnings.join('\n  ')}`)

if (errors.length) {
  console.error(`verify FAILED (${errors.length}):\n  ${errors.slice(0, 40).join('\n  ')}`)
  process.exit(1)
}
console.log(
  `verify OK: ${required.length} animations (${required.join(', ')}) x ${ALL_DIRS.length} dirs x ` +
    `${sceneVariants} variants, ${checked} frames checked; office ${expected.length} frames match the script; ` +
    '0 off-palette pixels',
)
