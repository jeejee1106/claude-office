import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encodePng, PixelImage } from './canvas'
import { REPO_ROOT } from './paths'
import { buildCharacterSheet } from './sheet'
import { SOFA_SEAT } from './sprites/character'
import { buildOfficeFrames, type OfficeFrame } from './sprites/office'

/*
 * 휴게실 소파 확인 그림: 카펫 바닥 + 러그 + 소파(furn_sofa) 위에 sofa_sit / sofa_lie 를 씬과 같은 규칙으로 올린다.
 *   배치 규칙(요약 "2026-10-23 sofa" 절): 캐릭터 앵커 = 소파 앵커 + (dx, SOFA_SEAT.feetDy),
 *   그리는 순서 = 소파 → 캐릭터(캐릭터가 소파보다 위).
 * 한 장에 장면 6개(가로 3 × 세로 2): 빈 소파 | 둘이 앉음(프레임 0) | 둘이 앉음(프레임 1)
 *                                     누움(프레임 0) | 누움(프레임 1) | 한 명 앉고 다른 변형
 * 실행: pnpm --filter @claude-office/assets sample:lounge [--out=디렉터리]  (기본: _workspace/samples-lounge)
 * 출력: lounge-sofa.png (1배), lounge-sofa-x6.png (6배)
 */

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k ?? '', v ?? ''] as const
  }),
)
const outDir = args.get('out')
  ? resolve(args.get('out') as string)
  : resolve(REPO_ROOT, '_workspace/samples-lounge')

const office = new Map(buildOfficeFrames().map((f) => [f.name, f]))
const chars = new Map(buildCharacterSheet().frames.map((f) => [f.name, f.image]))

const SCENE_W = 80
const SCENE_H = 64
const img = new PixelImage(SCENE_W * 3, SCENE_H * 2)

function put(f: OfficeFrame, ax: number, ay: number) {
  img.blit(
    f.image,
    Math.round(ax - f.anchor.x * f.image.width),
    Math.round(ay - f.anchor.y * f.image.height),
  )
}
function officeFrame(name: string): OfficeFrame {
  const f = office.get(name)
  if (!f) throw new Error(`missing office frame ${name}`)
  return f
}
function char(name: string, ax: number, ay: number) {
  const c = chars.get(name)
  if (!c) throw new Error(`missing ${name}`)
  img.blit(c, ax - c.width / 2, ay - c.height)
}

type Seat = { name: string; dx: number }
const scenes: Seat[][] = [
  [],
  [
    { name: 'char_0_sofa_sit_down_0', dx: SOFA_SEAT.sitDx[0] },
    { name: 'char_2_sofa_sit_down_0', dx: SOFA_SEAT.sitDx[1] },
  ],
  [
    { name: 'char_0_sofa_sit_down_1', dx: SOFA_SEAT.sitDx[0] },
    { name: 'char_2_sofa_sit_down_1', dx: SOFA_SEAT.sitDx[1] },
  ],
  [{ name: 'char_5_sofa_lie_down_0', dx: SOFA_SEAT.lieDx }],
  [{ name: 'char_5_sofa_lie_down_1', dx: SOFA_SEAT.lieDx }],
  [{ name: 'char_7_sofa_sit_down_0', dx: SOFA_SEAT.sitDx[1] }],
]

const carpet = [officeFrame('tile_floor_carpet_0'), officeFrame('tile_floor_carpet_1')]
scenes.forEach((seats, i) => {
  const ox = (i % 3) * SCENE_W
  const oy = Math.floor(i / 3) * SCENE_H
  for (let ty = 0; ty < SCENE_H / 16; ty++)
    for (let tx = 0; tx < SCENE_W / 16; tx++)
      put(carpet[(tx + ty) % 5 === 0 ? 1 : 0] as OfficeFrame, ox + tx * 16, oy + ty * 16)
  // 소파 앵커 = 장면 아래 가운데 − 4px(씬: 소파 아래가 바깥 벽)
  const ax = ox + SCENE_W / 2
  const ay = oy + SCENE_H - 4
  put(officeFrame('furn_rug'), ax, ay - 14)
  put(officeFrame('furn_sofa'), ax, ay)
  for (const s of seats) char(s.name, ax + s.dx, ay + SOFA_SEAT.feetDy)
})

mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'lounge-sofa.png'), encodePng(img))
const big = new PixelImage(img.width * 6, img.height * 6)
big.blit(img, 0, 0, 6)
writeFileSync(resolve(outDir, 'lounge-sofa-x6.png'), encodePng(big))
console.log(`sample:lounge: ${img.width}x${img.height}px (+x6) -> ${outDir}`)
