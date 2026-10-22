import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encodePng } from './canvas'
import { OUTPUT_DIR } from './paths'
import { buildCharacterSheet, packSheet } from './sheet'
import { assertPalette, offPalettePixels } from './validate'

/*
 * 모든 시트를 그려 apps/web/public/assets/{sheet}.png + {sheet}.json 으로 쓴다.
 * 이번 범위: characters 시트만 (가구·바닥·벽은 다음 작업).
 * 실행: pnpm --filter @claude-office/assets build
 */

assertPalette()
mkdirSync(OUTPUT_DIR, { recursive: true })

const sheet = buildCharacterSheet()
const { image, atlas } = packSheet(sheet, 'characters.png')
const bad = offPalettePixels(image)
if (bad.length > 0) {
  console.error(`characters: ${bad.length}+ pixels outside the palette:\n  ${bad.join('\n  ')}`)
  process.exit(1)
}
writeFileSync(resolve(OUTPUT_DIR, 'characters.png'), encodePng(image))
writeFileSync(resolve(OUTPUT_DIR, 'characters.json'), `${JSON.stringify(atlas, null, 2)}\n`)
console.log(
  `characters: ${sheet.frames.length} frames, ${Object.keys(sheet.animations).length} animations, ` +
    `${image.width}x${image.height}px -> ${OUTPUT_DIR}`,
)
