import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { encodePng, PixelImage } from './canvas'
import { rgba } from './palette'
import { PACKAGE_DIR } from './paths'
import { buildCharacterSheet } from './sheet'
import { buildOfficeFrames, type OfficeFrame, SIGN, signMidsFor, signWidth } from './sprites/office'

/*
 * 조립 확인용 그림: 업무 공간 한 칸(뒤 벽 + 바닥 + 팀장 책상 + 팀 간판 2개 + 직원 책상 4개 + 캐릭터).
 * 씬 담당이 참고할 "배치 오프셋"의 실제 예시이기도 하다(아래 OFFSET 상수 = 요약 문서의 표).
 * 실행: pnpm --filter @claude-office/assets sample [--out=디렉터리]  (기본: packages/assets/)
 * 출력: office-sample.png (1배), office-sample-x4.png (4배)
 */

/** 가구 앵커(바닥 접점) 기준 상대 위치 — 요약 문서 "배치 규칙" */
export const OFFSET = {
  /** 직원(위를 보고 앉음): 캐릭터 발끝 = 책상 앵커 + (0, 8), 의자 앵커 = 책상 앵커 + (0, 11) */
  staffFeetDy: 8,
  staffChairDy: 11,
  /** 팀장(아래를 보고 앉음): 캐릭터 발끝 = 책상 앵커 + (0, -14), 의자 앵커 = 책상 앵커 + (0, -15) */
  bossFeetDy: -14,
  bossChairDy: -15,
  /**
   * 책상 위 소품(furn_mug·papers·plant_small)의 앵커 y = 책상 앵커 + deskTopDy (윗면 맨 앞줄).
   * 그리기 순서는 책상 바로 뒤(책상과 같은 y 로 정렬하고 책상 다음에 그림).
   * 직원 책상 윗면 가로 범위: 앵커 x -15..+14, 모니터가 -9..+8 을 차지 → 소품은 x -11 또는 +11 근처.
   */
  staffDeskTopDy: -11,
  bossDeskTopDy: -13,
} as const

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k ?? '', v ?? ''] as const
  }),
)
const outDir = args.get('out') ? resolve(args.get('out') as string) : PACKAGE_DIR

const office = new Map(buildOfficeFrames().map((f) => [f.name, f]))
const chars = new Map(buildCharacterSheet().frames.map((f) => [f.name, f.image]))

const W = 256
const H = 192
const img = new PixelImage(W, H)

function get(name: string): OfficeFrame {
  const f = office.get(name)
  if (!f) throw new Error(`missing office frame ${name}`)
  return f
}

/** 앵커 위치(ax, ay)에 그림 */
function put(name: string, ax: number, ay: number) {
  const f = get(name)
  img.blit(
    f.image,
    Math.round(ax - f.anchor.x * f.image.width),
    Math.round(ay - f.anchor.y * f.image.height),
  )
}

// ---- 타일: 뒤 벽 2줄 + 바닥(변형은 좌표 해시로) + 왼쪽 세로 칸막이 + 아래 가로 칸막이(출입구) ----
for (let c = 0; c < 16; c++) {
  put('tile_wall_top_0', c * 16, 0)
  put(c === 12 ? 'tile_wall_1' : 'tile_wall_0', c * 16, 16)
  for (let r = 2; r < 12; r++) {
    const h = (c * 7 + r * 13) % 11
    put(h === 0 ? 'tile_floor_1' : h === 5 ? 'tile_floor_2' : 'tile_floor_0', c * 16, r * 16)
  }
}
for (let r = 2; r < 11; r++) put('tile_partition_v_0', 0, r * 16)
for (let c = 0; c < 16; c++) {
  if (c === 7 || c === 8) continue // 출입구
  const name =
    c === 0
      ? 'tile_partition_h_join_0'
      : c === 6
        ? 'tile_partition_h_right_0'
        : c === 9
          ? 'tile_partition_h_left_0'
          : 'tile_partition_h_0'
  put(name, c * 16, 11 * 16)
}

// ---- 벽 장식 ----
put('furn_window', 40, 28)
put('furn_window', 216, 28)
put('furn_corkboard', 168, 26)

// ---- y 정렬해서 그릴 것들(앵커 y 가 작은 것부터) ----
type Item = { y: number; draw: () => void }
const items: Item[] = []
const furn = (name: string, x: number, y: number) => items.push({ y, draw: () => put(name, x, y) })
const onDesk = (name: string, x: number, deskY: number) =>
  items.push({ y: deskY + 0.5, draw: () => put(name, x, deskY + OFFSET.staffDeskTopDy) })
const char = (name: string, x: number, feetY: number) =>
  items.push({
    y: feetY,
    draw: () => {
      const c = chars.get(name)
      if (!c) throw new Error(`missing ${name}`)
      img.blit(c, x - 8, feetY - 24)
    },
  })

// 팀장: 앞쪽(벽 바로 아래) 가운데 큰 책상, 직원 쪽(아래)을 봄
const BOSS = { x: 128, y: 78 }
furn('furn_desk_boss', BOSS.x, BOSS.y)
furn('furn_chair_boss', BOSS.x, BOSS.y + OFFSET.bossChairDy)
char('char_0_type_down_0', BOSS.x, BOSS.y + OFFSET.bossFeetDy)
furn('furn_plant', 88, 70)

// 팀 간판(스탠드형) + 가짜 글자(글자 영역 확인용 막대)
function sign(cx: number, bottom: number, glyphs: number, glyphW: number, glyphH: number) {
  const textW = glyphs * glyphW + (glyphs - 1)
  const mids = signMidsFor(textW)
  const w = signWidth(mids)
  const x0 = Math.round(cx - w / 2)
  items.push({
    y: bottom,
    draw: () => {
      put('furn_teamsign_left', x0, bottom)
      for (let i = 0; i < mids; i++) put('furn_teamsign_mid', x0 + 16 * (i + 1), bottom)
      put('furn_teamsign_right', x0 + 16 * (mids + 1), bottom)
      const top = bottom - SIGN.pieceH
      const tx = x0 + Math.round((w - textW) / 2)
      const ty = top + SIGN.panelTop + Math.round((SIGN.panelHeight - glyphH) / 2)
      for (let g = 0; g < glyphs; g++)
        img.fill(tx + g * (glyphW + 1), ty, glyphW, glyphH, rgba('brownDark'))
    },
  })
}
sign(64, 112, 3, 9, 9) // "조사팀" 3글자 9px
sign(192, 112, 13, 5, 7) // "Research Team" 13글자 5px

// 직원 책상 4개(팀마다 2개), 위를 보고 앉음
const DESK_Y = 150
const desks = [40, 84, 172, 216]
for (const x of desks) {
  furn('furn_desk', x, DESK_Y)
  furn('furn_chair', x, DESK_Y + OFFSET.staffChairDy)
}
char('char_1_type_up_0', 40, DESK_Y + OFFSET.staffFeetDy)
char('char_2_idle_sit_up_0', 216, DESK_Y + OFFSET.staffFeetDy)
onDesk('furn_mug', 29, DESK_Y)
onDesk('furn_papers', 95, DESK_Y)
onDesk('furn_plant_small', 227, DESK_Y)
furn('furn_plant', 244, 170)

items
  .sort((a, b) => a.y - b.y)
  .forEach((it) => {
    it.draw()
  })

mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'office-sample.png'), encodePng(img))
const big = new PixelImage(W * 4, H * 4)
big.blit(img, 0, 0, 4)
writeFileSync(resolve(outDir, 'office-sample-x4.png'), encodePng(big))
console.log(`sample: ${W}x${H}px (+x4) -> ${outDir}`)
