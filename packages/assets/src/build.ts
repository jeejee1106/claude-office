import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encodePng, type PixelImage } from './canvas'
import { packOffice } from './officeSheet'
import { packPartners } from './partnerSheet'
import { OUTPUT_DIR } from './paths'
import { buildCharacterSheet, packSheet } from './sheet'
import { assertPalette, offPalettePixels } from './validate'

/*
 * 모든 시트를 그려 apps/web/public/assets/{sheet}.png + {sheet}.json 으로 쓴다.
 *   characters: 캐릭터 8변형 × 행동 × 4방향
 *   partners:   파트너 몬스터 5종 × 행동 (16×16, pet_*)
 *   office:     업무 공간 바닥·벽·칸막이 타일, 책상·의자, 팀 간판 3조각, 소품
 * 실행: pnpm --filter @claude-office/assets build
 */

assertPalette()
mkdirSync(OUTPUT_DIR, { recursive: true })

function write(sheet: string, image: PixelImage, atlas: unknown): void {
  const bad = offPalettePixels(image)
  if (bad.length > 0) {
    console.error(`${sheet}: ${bad.length}+ pixels outside the palette:\n  ${bad.join('\n  ')}`)
    process.exit(1)
  }
  writeFileSync(resolve(OUTPUT_DIR, `${sheet}.png`), encodePng(image))
  writeFileSync(resolve(OUTPUT_DIR, `${sheet}.json`), `${JSON.stringify(atlas, null, 2)}\n`)
}

const chars = buildCharacterSheet()
const packedChars = packSheet(chars, 'characters.png')
write('characters', packedChars.image, packedChars.atlas)
console.log(
  `characters: ${chars.frames.length} frames, ${Object.keys(chars.animations).length} animations, ` +
    `${packedChars.image.width}x${packedChars.image.height}px -> ${OUTPUT_DIR}`,
)

const partners = packPartners()
write('partners', partners.image, partners.atlas)
console.log(
  `partners: ${Object.keys(partners.atlas.frames).length} frames, ` +
    `${Object.keys(partners.atlas.animations).length} animations, ` +
    `${partners.image.width}x${partners.image.height}px -> ${OUTPUT_DIR}`,
)

const office = packOffice()
write('office', office.image, office.atlas)
console.log(
  `office: ${Object.keys(office.atlas.frames).length} frames, ` +
    `${office.image.width}x${office.image.height}px -> ${OUTPUT_DIR}`,
)
