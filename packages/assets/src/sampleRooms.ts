import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
// 실제 층 배치(방 경계·가구·스팟 좌표)를 그대로 쓴다 — 씬과 같은 숫자로 조립되는지 보는 그림이므로
import {
  COLS,
  DOOR_OUTSIDE,
  DOORWAYS,
  isWall,
  PROPS,
  type Prop,
  ROOMS,
  ROWS,
  type SpotId,
  spotPosition,
  tileFoot,
} from '../../../apps/web/src/scene/layout'
import { encodePng, PixelImage } from './canvas'
import { floorTileMap, propAnchor } from './floorplan'
import { rgba } from './palette'
import { REPO_ROOT } from './paths'
import { buildCharacterSheet } from './sheet'
import { buildOfficeFrames, type OfficeFrame, SIGN } from './sprites/office'

/*
 * 전체 층 확인 그림(24×14 타일 = 384×224): layout.ts 그대로 office 시트 타일·가구 + 캐릭터를 조립한다.
 *   rooms-idle  : 평상시(문 닫힘, 빈 화이트보드, 파쇄기·커피머신 꺼짐, 랙 LED 프레임 0..2)
 *   rooms-busy  : 모든 방에 사람이 있고 기계가 도는 상태(문 열림, 글씨 쓴 보드, 서랍 열림, 터미널 실행 중 …)
 * 실행: pnpm --filter @claude-office/assets sample:rooms [--out=디렉터리]  (기본: _workspace/samples-rooms)
 * 출력: rooms-{idle,busy}.png (1배), rooms-{idle,busy}-x4.png (4배)
 */

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k ?? '', v ?? ''] as const
  }),
)
const outDir = args.get('out')
  ? resolve(args.get('out') as string)
  : resolve(REPO_ROOT, '_workspace/samples-rooms')

const office = new Map(buildOfficeFrames().map((f) => [f.name, f]))
const chars = new Map(buildCharacterSheet().frames.map((f) => [f.name, f.image]))

/** 씬 쪽 배치 규칙(요약 문서 "배치" 절) — 책상 앵커 기준 오프셋 */
const STAFF_FEET = 8
const STAFF_CHAIR = 11
const BOSS_FEET = -14
const BOSS_CHAIR = -15
/** 앉은 사람 발끝 기준 의자 앵커 y (= STAFF_CHAIR - STAFF_FEET) */
const CHAIR_BEHIND_FEET = 3

/** 선택 가구(layout 에 아직 없음): 휴게실 러그·작은 테이블 */
const SUGGESTED = {
  rug: { x: 72, y: 194 },
  tableSmall: { x: 72, y: 181 },
}

const PROP_FRAME: Partial<Record<Prop['kind'], string>> = {
  bookshelf: 'furn_bookshelf',
  cabinet: 'furn_cabinet',
  shredder: 'furn_shredder',
  terminal: 'furn_terminal',
  serverRack: 'furn_server_rack_0',
  whiteboard: 'furn_whiteboard',
  commonTable: 'furn_table_meeting',
  coffee: 'furn_coffee',
  sofa: 'furn_sofa',
  globe: 'furn_globe',
  phone: 'furn_phone',
  plant: 'furn_plant',
}

type State = 'idle' | 'busy'

function render(state: State): PixelImage {
  const W = COLS * 16
  const H = ROWS * 16
  const img = new PixelImage(W, H)
  const get = (name: string): OfficeFrame => {
    const f = office.get(name)
    if (!f) throw new Error(`missing office frame ${name}`)
    return f
  }
  const put = (name: string, ax: number, ay: number) => {
    const f = get(name)
    img.blit(
      f.image,
      Math.round(ax - f.anchor.x * f.image.width),
      Math.round(ay - f.anchor.y * f.image.height),
    )
  }

  // ---- 1. 타일(바닥·벽·칸막이·출입구) ----
  const map = floorTileMap({
    cols: COLS,
    rows: ROWS,
    rooms: ROOMS,
    isWall,
    doorways: DOORWAYS,
    doorOutside: DOOR_OUTSIDE,
  })
  map.forEach((line, r) => {
    line.forEach((name, c) => {
      put(name, c * 16, r * 16)
    })
  })

  // ---- 2. 벽 장식(업무 공간 창문·게시판) ----
  for (const p of PROPS.filter((p) => p.kind === 'window')) {
    const x0 = p.col * 16
    const x1 = (p.col + p.w) * 16
    put('furn_window', x0 - 8, 28)
    put('furn_corkboard', Math.round((x0 + x1) / 2), 26)
    put('furn_window', x1 + 8, 28)
  }

  // ---- 3. 바닥 장식 + 출입문(캐릭터보다 아래 층) ----
  for (const p of PROPS) {
    const a = propAnchor(p)
    if (p.kind === 'cables') put('furn_cables', a.x, a.y)
    if (p.kind === 'door') {
      put('furn_doormat', a.x, a.y - 16)
      put(state === 'busy' ? 'furn_door_open' : 'furn_door', a.x, a.y)
    }
  }
  put('furn_rug', SUGGESTED.rug.x, SUGGESTED.rug.y)

  // ---- 4. 깊이 정렬(앵커 y) ----
  type Item = { y: number; draw: () => void }
  const items: Item[] = []
  const furn = (name: string, x: number, y: number) =>
    items.push({ y, draw: () => put(name, x, y) })
  const char = (name: string, x: number, feetY: number) =>
    items.push({
      y: feetY,
      draw: () => {
        const c = chars.get(name)
        if (!c) throw new Error(`missing ${name}`)
        img.blit(c, Math.round(x) - c.width / 2, Math.round(feetY) - c.height)
      },
    })
  const at = (id: SpotId, slot = 0) => spotPosition(id, slot)

  let rack = 0
  for (const p of PROPS) {
    const cx = p.col * 16 + (p.w * 16) / 2
    const a = propAnchor(p)
    switch (p.kind) {
      case 'desk': {
        const feet = (p.row + 1) * 16 + 14
        furn('furn_desk', cx, feet - STAFF_FEET)
        break
      }
      case 'chair': {
        const feet = p.row * 16 + 14
        furn('furn_chair', cx, feet - STAFF_FEET + STAFF_CHAIR)
        break
      }
      case 'mainDesk': {
        const b = at('mainDesk')
        furn('furn_desk_boss', b.x, b.y - BOSS_FEET)
        break
      }
      case 'mainChair': {
        const b = at('mainDesk')
        furn('furn_chair_boss', b.x, b.y - BOSS_FEET + BOSS_CHAIR)
        break
      }
      case 'teamSign': {
        const x0 = p.col * 16
        const bottom = (p.row + p.h) * 16
        const mids = Math.max(1, p.w - 2)
        items.push({
          y: bottom,
          draw: () => {
            put('furn_teamsign_left', x0, bottom)
            for (let i = 0; i < mids; i++) put('furn_teamsign_mid', x0 + 16 * (i + 1), bottom)
            put('furn_teamsign_right', x0 + 16 * (mids + 1), bottom)
            // 글자 자리 확인용 막대(3글자 9px)
            const w = 16 * (mids + 2)
            const tx = x0 + Math.round((w - 29) / 2)
            const ty = bottom - SIGN.pieceH + SIGN.panelTop + 2
            for (let g = 0; g < 3; g++) img.fill(tx + g * 10, ty, 9, 8, rgba('brownDark'))
          },
        })
        break
      }
      case 'serverRack': {
        const f = (rack + (state === 'busy' ? 1 : 0)) % 3
        furn(`furn_server_rack_${f}`, a.x, a.y)
        rack++
        break
      }
      case 'commonTable': {
        furn('furn_table_meeting', a.x, a.y)
        for (const slot of [0, 1, 2]) {
          const s = at('commonTable', slot)
          furn('furn_chair_meeting', s.x, s.y + CHAIR_BEHIND_FEET)
        }
        break
      }
      case 'window':
      case 'cables':
      case 'door':
        break
      default: {
        let name = PROP_FRAME[p.kind]
        if (!name) throw new Error(`no frame for ${p.kind}`)
        if (state === 'busy') {
          if (p.kind === 'cabinet') name = 'furn_cabinet_open'
          if (p.kind === 'terminal') name = 'furn_terminal_busy_0'
          if (p.kind === 'whiteboard') name = 'furn_whiteboard_written'
          if (p.kind === 'shredder') name = 'furn_shredder_on_0'
          if (p.kind === 'coffee') name = 'furn_coffee_brew_0'
        }
        furn(name, a.x, a.y)
      }
    }
  }
  // 서버실 터미널 앞 의자(선택 — type 동작이 앉은 자세라서)
  const term = at('serverTerminal')
  furn('furn_chair', term.x, term.y + CHAIR_BEHIND_FEET)
  furn('furn_table_small', SUGGESTED.tableSmall.x, SUGGESTED.tableSmall.y)

  // ---- 5. 캐릭터 ----
  const who: [SpotId, string, number?][] =
    state === 'busy'
      ? [
          ['mainDesk', 'char_0_type_down_0'],
          ['research1', 'char_1_type_up_0'],
          ['planning1', 'char_2_idle_sit_up_0'],
          ['dev2', 'char_3_type_up_0'],
          ['bookshelf', 'char_4_read_up_0'],
          ['cabinet', 'char_5_search_up_0'],
          ['shredder', 'char_6_shred_left_0'],
          ['serverTerminal', 'char_7_type_up_0'],
          ['whiteboard', 'char_1_write_board_up_0'],
          ['commonTable', 'char_2_idle_sit_up_0', 0],
          ['commonTable', 'char_3_idle_sit_up_0', 1],
          ['commonTable', 'char_4_idle_sit_up_0', 2],
          ['coffee', 'char_5_idle_drink_left_0'],
          ['globe', 'char_6_look_up_0'],
          ['phone', 'char_7_phone_up_0'],
          ['door', 'char_1_idle_stand_down_0'],
        ]
      : [['mainDesk', 'char_0_idle_sit_down_0']]
  for (const [id, name, slot] of who) {
    const p = at(id, slot ?? 0)
    char(name, p.x, p.y)
  }
  if (state === 'busy') {
    const out = tileFoot(DOOR_OUTSIDE)
    char('char_2_walk_up_0', out.x, out.y)
  }

  items
    .sort((a, b) => a.y - b.y)
    .forEach((it) => {
      it.draw()
    })
  return img
}

mkdirSync(outDir, { recursive: true })
for (const state of ['idle', 'busy'] as const) {
  const img = render(state)
  writeFileSync(resolve(outDir, `rooms-${state}.png`), encodePng(img))
  const big = new PixelImage(img.width * 4, img.height * 4)
  big.blit(img, 0, 0, 4)
  writeFileSync(resolve(outDir, `rooms-${state}-x4.png`), encodePng(big))
  // 방별 확대(6배, 둘레 1칸 포함) — 세부 확인용
  for (const room of ROOMS) {
    if (room.id === 'work') continue
    const a = room.area
    const x0 = (a.col - 1) * 16
    const y0 = Math.max(0, a.row - 2) * 16
    const w = (a.w + 2) * 16
    const h = (Math.min(ROWS, a.row + a.h + 1) - Math.max(0, a.row - 2)) * 16
    const crop = new PixelImage(w, h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) crop.set(x, y, img.get(x0 + x, y0 + y))
    const z = new PixelImage(w * 6, h * 6)
    z.blit(crop, 0, 0, 6)
    writeFileSync(resolve(outDir, `rooms-${state}-${room.id}-x6.png`), encodePng(z))
  }
}
// 타일 지도(행마다 "열:프레임") — 요약 문서·씬 대조용
const tileMap = floorTileMap({
  cols: COLS,
  rows: ROWS,
  rooms: ROOMS,
  isWall,
  doorways: DOORWAYS,
  doorOutside: DOOR_OUTSIDE,
})
writeFileSync(
  resolve(outDir, 'floor-map.txt'),
  `${tileMap.map((line, r) => `row ${r}: ${line.map((n, c) => `${c}:${n}`).join(' ')}`).join('\n')}\n`,
)
console.log(`sample:rooms: ${COLS * 16}x${ROWS * 16}px (+x4) idle/busy -> ${outDir}`)
