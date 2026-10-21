import { Container, Graphics } from 'pixi.js'
import type { AnimName, Effect, Mark } from '../activityMap'
import {
  BASE_HEIGHT,
  BASE_WIDTH,
  COLS,
  type Dir,
  DOORWAYS,
  isWall,
  type Prop,
  ROOMS,
  ROWS,
  TILE,
} from '../layout'
import type { CharacterView, SceneRenderer } from './types'

/*
 * 플레이스홀더 렌더러 — 아틀라스가 생기기 전까지 PixiJS Graphics 로 픽셀 도형을 직접 그린다.
 * 이 파일이 프로젝트에서 Graphics 를 생성하는 유일한 곳이다(렌더링 경계).
 *
 * 픽셀 퍼펙트: 모든 rect 는 정수 좌표·정수 크기, 위치는 Math.round, 확대는 OfficeScene 의
 * 정수 배율 stage.scale 로만. 텍스트(말풍선·이름표)는 DOM 오버레이(정수 배율 좌표)로 그린다.
 *
 * 교체: AtlasRenderer(같은 SceneRenderer/CharacterView 인터페이스)로 바꾸면 이 파일은 지워도 된다.
 */

/** 팔레트(플레이스홀더 전용). pixel-artist 의 palette.ts 가 생기면 그 값으로 맞춘다. */
const C = {
  outline: 0x1b1f3b,
  wall: 0x7d7396,
  wallDark: 0x5a5170,
  wallTrim: 0x3f3854,
  floorA: 0xd9c2a0,
  floorB: 0xcdb38c,
  wood: 0x8b5a2b,
  woodDark: 0x6b4220,
  woodLight: 0xa8743f,
  metal: 0x9aa5b1,
  metalDark: 0x6b7280,
  screen: 0x7fd1ff,
  dark: 0x2b2d42,
  white: 0xf4f4f4,
  glass: 0x9bd4f5,
  glassLight: 0xc9ecff,
  red: 0xe03131,
  green: 0x4ade80,
  yellow: 0xffd43b,
  blue: 0x3b82f6,
  plant: 0x2f9e44,
  pot: 0xb45309,
  skin: 0xf2c29b,
  pants: 0x3a3f5c,
  zzz: 0x9ec5ff,
  sweat: 0x8fd3ff,
  sweatLight: 0xe0f4ff,
  steam: 0xe8e8f0,
  carpetA: 0xb5654a,
  carpetB: 0xa95c43,
  plankA: 0xc99a64,
  plankB: 0xb98a56,
  metalFloorA: 0x5d6675,
  metalFloorB: 0x535b69,
  tileA: 0xc9d3dc,
  tileB: 0xbac5cf,
  cable: 0x1f2937,
  sofa: 0x4f6d9a,
  sofaDark: 0x3c5478,
  bag: 0x7a4a24,
} as const

/** variant 별 (셔츠, 머리) — 0 은 메인 고정 */
const VARIANT_COLORS: readonly (readonly [number, number])[] = [
  [0xe07a5f, 0x5b3a29],
  [0x3d85c6, 0x2b2d42],
  [0x6aa84f, 0x8b5a2b],
  [0x8e7cc3, 0x1b1f3b],
  [0xf1c232, 0x6b4220],
  [0x45b5aa, 0x3f3854],
  [0xc27ba0, 0xd9a066],
  [0x7f8c8d, 0x2f2f2f],
]

const SEATED: ReadonlySet<AnimName> = new Set(['idle_sit', 'sleep'])
const FRAME_MS = 180

let warned = false

export interface PlaceholderLayers {
  floor: Container
  furniture: Container
  characters: Container
  lighting: Container
}

export class PlaceholderRenderer implements SceneRenderer {
  private readonly layers: PlaceholderLayers
  private readonly dom: HTMLElement
  private scale = 1
  private readonly dimmer = new Graphics()
  private dimAlpha = 0.65
  private dimTarget = 0.65
  private readonly leds = new Graphics()
  private ledMs = 0
  private ledTick = 0
  private serverBusy = false
  private racks: readonly Prop[] = []
  private readonly views = new Set<PlaceholderCharacterView>()

  constructor(layers: PlaceholderLayers, domOverlay: HTMLElement) {
    this.layers = layers
    this.dom = domOverlay
    if (!warned) {
      warned = true
      console.warn(
        '[claude-office] 아틀라스 에셋 없음 — PlaceholderRenderer(코드로 그린 도형)를 사용합니다.',
      )
    }
    this.dimmer.rect(0, 0, BASE_WIDTH, BASE_HEIGHT).fill(0x0b0d1a)
    this.dimmer.alpha = this.dimAlpha
    layers.lighting.addChild(this.dimmer)
  }

  drawRoom(props: readonly Prop[]): void {
    const g = new Graphics()
    // 바닥: 방마다 다른 무늬(업무 공간=체크, 자료실=마루, 휴게실=카펫, 서버실=철판, 회의실=타일)
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        g.rect(c * TILE, r * TILE, TILE, TILE).fill((r + c) % 2 === 0 ? C.floorA : C.floorB)
      }
    }
    for (const room of ROOMS) {
      const a = room.area
      for (let r = a.row; r < a.row + a.h; r++) {
        for (let c = a.col; c < a.col + a.w; c++) drawFloorTile(g, room.floor, c, r)
      }
    }
    // 바깥 벽: 위 2행, 좌우 1열, 아래 1행
    g.rect(0, 0, BASE_WIDTH, TILE * 2).fill(C.wall)
    g.rect(0, TILE * 2 - 3, BASE_WIDTH, 3).fill(C.wallTrim)
    g.rect(0, 0, TILE, BASE_HEIGHT).fill(C.wallDark)
    g.rect(BASE_WIDTH - TILE, 0, TILE, BASE_HEIGHT).fill(C.wallDark)
    g.rect(0, BASE_HEIGHT - TILE, BASE_WIDTH, TILE).fill(C.wallDark)
    g.rect(0, BASE_HEIGHT - TILE, BASE_WIDTH, 2).fill(C.wallTrim)
    // 칸막이 벽(방 구분): 위에서 본 벽 윗면 + 아래쪽 벽면
    for (let r = 2; r < ROWS - 1; r++) {
      for (let c = 1; c < COLS - 1; c++) {
        if (!isWall(c, r)) continue
        const x = c * TILE
        const y = r * TILE
        const below = isWall(c, r + 1)
        g.rect(x, y, TILE, TILE).fill(C.wallDark)
        g.rect(x + 2, y, TILE - 4, below ? TILE : TILE - 5).fill(C.wall)
        if (!below) g.rect(x, y + TILE - 5, TILE, 5).fill(C.wallTrim)
      }
    }
    // 출입구: 바닥 + 문지방 + 양옆 문틀 기둥
    for (const d of DOORWAYS) {
      const x = d.col * TILE
      const y = d.row * TILE
      g.rect(x, y, TILE, TILE).fill(C.floorB)
      g.rect(x + 7, y + 1, 2, TILE - 2).fill(C.woodDark)
      g.rect(x, y, TILE, 2).fill(C.wallTrim)
      g.rect(x, y + TILE - 2, TILE, 2).fill(C.wallTrim)
      g.rect(x + 1, y - 3, 2, 3).fill(C.woodDark)
      g.rect(x + TILE - 3, y - 3, 2, 3).fill(C.woodDark)
    }
    this.layers.floor.addChild(g)

    const f = new Graphics()
    for (const p of props) drawProp(f, p)
    this.layers.furniture.addChild(f)

    this.racks = props.filter((p) => p.kind === 'serverRack')
    this.layers.furniture.addChild(this.leds)
  }

  createCharacter(variant: number): CharacterView {
    const v = new PlaceholderCharacterView(variant, this.layers.characters, this.dom, () => {
      this.views.delete(v)
    })
    v.setScale(this.scale)
    this.views.add(v)
    return v
  }

  setLights(on: boolean): void {
    this.dimTarget = on ? 0 : 0.65
  }

  setServerBusy(busy: boolean): void {
    this.serverBusy = busy
    this.ledMs = Number.POSITIVE_INFINITY // 바로 다시 그린다
  }

  setScale(scale: number): void {
    this.scale = scale
    for (const v of this.views) v.setScale(scale)
  }

  tick(dtMs: number): void {
    if (this.dimAlpha !== this.dimTarget) {
      const step = dtMs / 600
      this.dimAlpha =
        this.dimAlpha < this.dimTarget
          ? Math.min(this.dimTarget, this.dimAlpha + step)
          : Math.max(this.dimTarget, this.dimAlpha - step)
      // 조명은 4단계로 끊어서(픽셀 아트 느낌) 바꾼다
      this.dimmer.alpha = Math.round(this.dimAlpha * 4) / 4
    }
    // 서버 LED: 평소 0.5초, 명령 실행 중이면 0.1초마다 무작위처럼(결정적) 깜빡인다
    this.ledMs += dtMs
    const period = this.serverBusy ? 100 : 500
    if (this.ledMs >= period) {
      this.ledMs = 0
      this.ledTick++
      this.leds.clear()
      for (const [ri, rack] of this.racks.entries()) {
        const x = rack.col * TILE
        const y = rack.row * TILE
        for (let i = 0; i < 4; i++) {
          const n = (this.ledTick * 7 + ri * 13 + i * 5) % 11
          const on = this.serverBusy ? n < 6 : (i + ri + this.ledTick) % 2 === 0
          this.leds.rect(x + 4, y + 4 + i * 7, 2, 1).fill(on ? C.green : C.dark)
          this.leds.rect(x + 8, y + 4 + i * 7, 1, 1).fill(on && n % 3 === 0 ? C.yellow : C.dark)
          if (i === 1 && ri === 0)
            this.leds.rect(x + 11, y + 4 + i * 7, 1, 1).fill(this.ledTick % 2 ? C.red : C.dark)
        }
      }
    }
  }

  destroy(): void {
    for (const v of [...this.views]) v.destroy()
    for (const c of this.layers.floor.removeChildren()) c.destroy()
    for (const c of this.layers.furniture.removeChildren()) c.destroy()
    for (const c of this.layers.lighting.removeChildren()) c.destroy()
  }
}

// ---------------------------------------------------------------------------
// 바닥·가구
// ---------------------------------------------------------------------------

function drawFloorTile(g: Graphics, kind: (typeof ROOMS)[number]['floor'], c: number, r: number) {
  const x = c * TILE
  const y = r * TILE
  switch (kind) {
    case 'checker':
      g.rect(x, y, TILE, TILE).fill((r + c) % 2 === 0 ? C.floorA : C.floorB)
      break
    case 'wood':
      // 마루: 가로 널판 2줄, 이음매 엇갈림
      g.rect(x, y, TILE, 8).fill(C.plankA)
      g.rect(x, y + 8, TILE, 8).fill(C.plankB)
      g.rect(x, y + 7, TILE, 1).fill(C.woodLight)
      g.rect(x + ((c % 2) * 8 + 3), y, 1, 8).fill(C.wood)
      g.rect(x + (((c + 1) % 2) * 8 + 3), y + 8, 1, 8).fill(C.wood)
      break
    case 'carpet':
      g.rect(x, y, TILE, TILE).fill(C.carpetA)
      if ((r + c) % 2 === 0) g.rect(x + 6, y + 6, 4, 4).fill(C.carpetB)
      break
    case 'metal':
      g.rect(x, y, TILE, TILE).fill((r + c) % 2 === 0 ? C.metalFloorA : C.metalFloorB)
      g.rect(x, y, TILE, 1).fill(C.metalDark)
      g.rect(x, y, 1, TILE).fill(C.metalDark)
      g.rect(x + 2, y + 2, 1, 1).fill(C.metal)
      g.rect(x + 13, y + 13, 1, 1).fill(C.metal)
      break
    case 'tile':
      g.rect(x, y, TILE, TILE).fill((r + c) % 2 === 0 ? C.tileA : C.tileB)
      g.rect(x, y + TILE - 1, TILE, 1).fill(C.metal)
      g.rect(x + TILE - 1, y, 1, TILE).fill(C.metal)
      break
  }
}

function drawProp(g: Graphics, p: Prop): void {
  const x = p.col * TILE
  const y = p.row * TILE
  const w = p.w * TILE
  const h = p.h * TILE
  switch (p.kind) {
    case 'window':
      g.rect(x + 2, y + 4, w - 4, h - 8).fill(C.white)
      g.rect(x + 4, y + 6, w - 8, h - 12).fill(C.glass)
      g.rect(x + 4, y + 6, w - 8, 3).fill(C.glassLight)
      g.rect(x + w / 2 - 1, y + 6, 2, h - 12).fill(C.white)
      break
    case 'mainDesk':
    case 'desk': {
      g.rect(x, y + 2, w, h - 4).fill(C.wood)
      g.rect(x, y + h - 4, w, 2).fill(C.woodDark)
      g.rect(x + 1, y + h - 2, 2, 2).fill(C.woodDark)
      g.rect(x + w - 3, y + h - 2, 2, 2).fill(C.woodDark)
      // 모니터
      const mx = x + Math.floor(w / 2) - 5
      g.rect(mx, y - 7, 10, 8).fill(C.dark)
      g.rect(mx + 1, y - 6, 8, 5).fill(C.screen)
      g.rect(mx + 4, y + 1, 2, 2).fill(C.dark)
      if (p.kind === 'mainDesk') {
        // 메인 책상: 머그컵 + 화분
        g.rect(x + 3, y, 3, 3).fill(C.white)
        g.rect(x + w - 7, y - 4, 4, 4).fill(C.plant)
        g.rect(x + w - 6, y, 3, 3).fill(C.pot)
      }
      break
    }
    case 'commonTable':
      g.rect(x + 1, y + 3, w - 2, h - 8).fill(C.woodLight)
      g.rect(x + 1, y + h - 5, w - 2, 2).fill(C.woodDark)
      g.rect(x + 2, y + h - 3, 2, 3).fill(C.woodDark)
      g.rect(x + w - 4, y + h - 3, 2, 3).fill(C.woodDark)
      g.rect(x + 10, y + 8, 6, 4).fill(C.white)
      g.rect(x + 28, y + 6, 3, 3).fill(C.white)
      break
    case 'bookshelf': {
      g.rect(x, y, w, h).fill(C.woodDark)
      const bookColors = [C.red, C.blue, C.green, C.yellow, C.white, C.metal]
      for (let shelf = 0; shelf < 3; shelf++) {
        const sy = y + 3 + shelf * 10
        g.rect(x + 2, sy + 7, w - 4, 2).fill(C.wood)
        for (let b = 0; b < 10; b++) {
          const color = bookColors[(b * 7 + shelf * 3) % bookColors.length] ?? C.red
          g.rect(x + 3 + b * 4, sy + ((b + shelf) % 3 === 0 ? 1 : 0), 3, 7).fill(color)
        }
      }
      break
    }
    case 'cabinet':
      // 서류 캐비닛(타일 1칸 폭마다 한 대)
      for (let cx = x; cx < x + w; cx += TILE) {
        g.rect(cx + 1, y, TILE - 2, h).fill(C.metal)
        for (let i = 0; i < 3; i++) {
          g.rect(cx + 2, y + 2 + i * 10, TILE - 4, 8).fill(C.metalDark)
          g.rect(cx + 6, y + 5 + i * 10, 4, 1).fill(C.white)
        }
      }
      break
    case 'serverRack':
      g.rect(x + 1, y - 4, w - 2, h + 4).fill(C.outline)
      g.rect(x + 2, y - 3, w - 4, h + 2).fill(C.dark)
      for (let i = 0; i < 4; i++) {
        g.rect(x + 3, y + 2 + i * 7, w - 6, 5).fill(C.outline)
        g.rect(x + 3, y + 6 + i * 7, w - 6, 1).fill(C.metalDark)
      }
      g.rect(x + 2, y + h - 2, w - 4, 2).fill(C.metalDark)
      break
    case 'terminal': {
      // 서버실 콘솔: 금속 책상 + 검은 화면(초록 글자) + 키보드
      g.rect(x, y + 4, w, h - 6).fill(C.metalDark)
      g.rect(x, y + h - 3, w, 1).fill(C.dark)
      g.rect(x + 1, y + h - 2, 2, 2).fill(C.dark)
      g.rect(x + w - 3, y + h - 2, 2, 2).fill(C.dark)
      const mx = x + 4
      g.rect(mx, y - 8, 14, 11).fill(C.outline)
      g.rect(mx + 1, y - 7, 12, 8).fill(0x0b1a10)
      g.rect(mx + 2, y - 6, 5, 1).fill(C.green)
      g.rect(mx + 2, y - 4, 8, 1).fill(C.green)
      g.rect(mx + 2, y - 2, 3, 1).fill(C.green)
      g.rect(mx + 6, y + 3, 2, 1).fill(C.outline)
      g.rect(x + 20, y - 6, 9, 8).fill(C.outline)
      g.rect(x + 21, y - 5, 7, 5).fill(C.screen)
      g.rect(x + 6, y + 6, 12, 3).fill(C.dark)
      break
    }
    case 'cables':
      // 바닥을 기는 케이블 묶음(랙 → 터미널, 랙 → 옆 랙). 2px 굵기
      g.rect(x + 4, y, 2, 11).fill(C.cable)
      g.rect(x - 14, y + 9, 20, 2).fill(C.cable)
      g.rect(x + 22, y, 2, 15).fill(C.blue)
      g.rect(x + 22, y + 13, 34, 2).fill(C.blue)
      g.rect(x + 54, y + 13, 2, 6).fill(C.blue)
      g.rect(x + 38, y, 2, 6).fill(C.yellow)
      g.rect(x + 38, y + 5, 18, 2).fill(C.yellow)
      g.rect(x + 12, y, 2, 30).fill(C.red)
      g.rect(x + 12, y + 28, 20, 2).fill(C.red)
      break
    case 'sofa':
      g.rect(x + 1, y - 2, w - 2, 8).fill(C.sofaDark)
      g.rect(x + 1, y + 5, w - 2, 8).fill(C.sofa)
      g.rect(x, y + 1, 4, 12).fill(C.sofaDark)
      g.rect(x + w - 4, y + 1, 4, 12).fill(C.sofaDark)
      g.rect(x + Math.floor(w / 2), y + 6, 1, 6).fill(C.sofaDark)
      g.rect(x + 8, y - 1, 7, 5).fill(C.yellow)
      break
    case 'globe':
      g.rect(x + 7, y + 11, 2, 3).fill(C.woodDark)
      g.rect(x + 4, y + 14, 8, 2).fill(C.woodDark)
      g.rect(x + 3, y + 1, 10, 10).fill(C.blue)
      g.rect(x + 5, y + 3, 3, 3).fill(C.green)
      g.rect(x + 9, y + 6, 3, 3).fill(C.green)
      g.rect(x + 2, y + 5, 1, 3).fill(C.woodDark)
      break
    case 'whiteboard':
      // 회의실 칸막이 벽에 걸린 보드 + 펜 받침(아래 타일)
      g.rect(x + 2, y + h - 4, w - 4, 2).fill(C.metalDark)
      g.rect(x + 6, y + h - 5, 4, 1).fill(C.red)
      g.rect(x + 12, y + h - 5, 4, 1).fill(C.blue)
      g.rect(x + 2, y + 3, w - 4, h - 7).fill(C.metal)
      g.rect(x + 4, y + 5, w - 8, h - 11).fill(C.white)
      g.rect(x + 8, y + 9, 14, 1).fill(C.blue)
      g.rect(x + 8, y + 13, 20, 1).fill(C.blue)
      g.rect(x + 8, y + 17, 10, 1).fill(C.red)
      g.rect(x + 30, y + 10, 8, 8).fill(C.yellow)
      break
    case 'phone':
      g.rect(x + 1, y + 6, w - 2, h - 6).fill(C.wood)
      g.rect(x + 3, y + 2, 10, 5).fill(C.red)
      g.rect(x + 2, y + 1, 12, 2).fill(C.dark)
      break
    case 'coffee':
      g.rect(x + 1, y + 2, w - 2, h - 2).fill(C.dark)
      g.rect(x + 3, y + 5, w - 6, 6).fill(C.metalDark)
      g.rect(x + 5, y + 13, 6, 5).fill(C.white)
      g.rect(x + 11, y + 4, 2, 2).fill(C.red)
      break
    case 'shredder':
      g.rect(x + 2, y + 4, w - 4, h - 4).fill(C.metalDark)
      g.rect(x + 2, y + 2, w - 4, 3).fill(C.dark)
      g.rect(x + 5, y, 6, 3).fill(C.white)
      break
    case 'door':
      g.rect(x + 4, y, w - 8, h).fill(C.woodDark)
      g.rect(x + 6, y + 2, w - 12, h - 2).fill(C.wood)
      g.rect(x + w - 10, y + 7, 2, 2).fill(C.yellow)
      break
    case 'plant':
      g.rect(x + 4, y + h - 8, 8, 8).fill(C.pot)
      g.rect(x + 2, y + h - 18, 12, 10).fill(C.plant)
      g.rect(x + 5, y + h - 22, 6, 4).fill(C.plant)
      break
  }
}

// ---------------------------------------------------------------------------
// 캐릭터
// ---------------------------------------------------------------------------

/** 3×5 비트맵 글리프 (머리 위 표시) */
const GLYPH: Readonly<Record<'!' | '?' | 'Z', readonly number[]>> = {
  '!': [0b010, 0b010, 0b010, 0b000, 0b010],
  '?': [0b111, 0b001, 0b011, 0b000, 0b010],
  Z: [0b111, 0b001, 0b010, 0b100, 0b111],
}

function drawGlyph(g: Graphics, ch: keyof typeof GLYPH, x: number, y: number, color: number) {
  const rows = GLYPH[ch]
  rows.forEach((bits, r) => {
    for (let c = 0; c < 3; c++) if (bits & (1 << (2 - c))) g.rect(x + c, y + r, 1, 1).fill(color)
  })
}

class PlaceholderCharacterView implements CharacterView {
  private readonly root = new Container()
  private readonly body = new Graphics()
  private readonly ring = new Graphics()
  private readonly markG = new Graphics()
  private readonly fx = new Graphics()
  private readonly label: HTMLDivElement
  private readonly bubble: HTMLDivElement
  private bubbleW = 0
  private readonly onDestroy: () => void
  private readonly shirt: number
  private readonly hair: number
  private anim: AnimName = 'idle_stand'
  private dir: Dir = 'down'
  private frame = -1
  private elapsed = 0
  private mark: Mark | null = null
  private effect: Effect | null = null
  private highlight = false
  private px = Number.NaN
  private py = Number.NaN
  private scale = 1

  constructor(variant: number, layer: Container, dom: HTMLElement, onDestroy: () => void) {
    const colors = VARIANT_COLORS[variant % VARIANT_COLORS.length] ?? VARIANT_COLORS[0] ?? [0, 0]
    this.shirt = colors[0]
    this.hair = colors[1]
    this.onDestroy = onDestroy
    this.root.addChild(this.ring, this.body, this.fx, this.markG)
    layer.addChild(this.root)

    this.label = document.createElement('div')
    this.label.className = 'nametag'
    this.bubble = document.createElement('div')
    this.bubble.className = 'bubble'
    this.bubble.hidden = true
    dom.append(this.label, this.bubble)
    this.redraw()
  }

  setScale(scale: number): void {
    this.scale = scale
    if (!this.bubble.hidden) this.bubbleW = this.bubble.offsetWidth
    this.placeDom()
  }

  setPosition(x: number, y: number): void {
    const rx = Math.round(x)
    const ry = Math.round(y)
    if (rx === this.px && ry === this.py) return
    this.px = rx
    this.py = ry
    this.root.x = rx
    this.root.y = ry
    this.root.zIndex = ry
    this.placeDom()
  }

  setAnimation(anim: AnimName, dir: Dir): void {
    if (anim === this.anim && dir === this.dir) return
    this.anim = anim
    this.dir = dir
    this.elapsed = 0
    this.frame = -1
    this.redraw()
  }

  setMark(mark: Mark | null): void {
    this.mark = mark
    this.drawMark()
  }

  setBubble(text: string | null): void {
    this.bubble.hidden = text === null
    this.bubble.textContent = text ?? ''
    // 폭은 말풍선이 바뀔 때만 잰다(프레임마다 레이아웃을 읽지 않는다)
    this.bubbleW = text === null ? 0 : this.bubble.offsetWidth
    this.placeDom()
  }

  setLabel(text: string): void {
    this.label.textContent = text
  }

  setHighlight(on: boolean): void {
    this.highlight = on
    this.label.classList.toggle('highlight', on)
    this.drawRing()
  }

  setEffect(effect: Effect | null): void {
    this.effect = effect
    this.drawFx()
  }

  setAlpha(a: number): void {
    // 4단계로 끊은 알파(디더 대신)
    this.root.alpha = Math.round(a * 4) / 4
    this.label.style.opacity = String(this.root.alpha)
  }

  tick(dtMs: number): void {
    this.elapsed += dtMs
    const f = Math.floor(this.elapsed / FRAME_MS)
    if (f !== this.frame) {
      this.frame = f
      this.redraw()
      if (this.mark !== null && this.mark !== 'alert') this.drawMark()
      if (this.highlight) this.drawRing()
      if (this.effect !== null) this.drawFx()
    }
  }

  destroy(): void {
    this.label.remove()
    this.bubble.remove()
    this.root.destroy({ children: true })
    this.onDestroy()
  }

  // -------------------------------------------------------------------------

  private placeDom(): void {
    if (Number.isNaN(this.px)) return
    const s = this.scale
    this.label.style.transform = `translate(${this.px * s}px, ${(this.py + 2) * s}px) translateX(-50%)`
    // 말풍선은 캐릭터 위 가운데, 단 사무실 가장자리 밖으로 잘리지 않게 안쪽으로 민다
    const half = this.bubbleW / 2
    const bx = Math.min(Math.max(this.px * s, half + 2), BASE_WIDTH * s - half - 2)
    this.bubble.style.transform = `translate(${Math.round(bx)}px, ${(this.py - 34) * s}px) translate(-50%, -100%)`
  }

  /** 몸 그리기. 원점 = 발끝 중앙, 16×24 프레임 영역(-8..8, -24..0) */
  private redraw(): void {
    const g = this.body
    const f = Math.max(this.frame, 0)
    const two = f % 2
    const seated = SEATED.has(this.anim)
    const back = this.dir === 'up'
    g.clear()

    let bob = 0
    if (this.anim === 'search' || this.anim === 'type' || this.anim === 'pack') bob = two
    if (this.anim === 'walk') bob = two === 1 ? -1 : 0
    // 멈칫: 첫 프레임에 움찔(위로 1px) 후 굳음, 보고: 고개 숙임
    if (this.anim === 'flinch') bob = f === 0 ? -1 : 0
    if (this.anim === 'report') bob = two
    const sy = (seated ? 3 : 0) + bob // 앉으면 3px 아래
    const headTilt = this.anim === 'sleep' ? 1 : this.anim === 'look' && two ? -1 : 0

    // 다리
    if (seated) {
      g.rect(-4, -4, 3, 4).fill(C.pants)
      g.rect(1, -4, 3, 4).fill(C.pants)
    } else if (this.anim === 'walk') {
      g.rect(-3, -7, 2, two ? 6 : 7).fill(C.pants)
      g.rect(1, -7, 2, two ? 7 : 6).fill(C.pants)
      g.rect(-3, two ? -2 : -1, 2, 1).fill(C.outline)
      g.rect(1, two ? -1 : -2, 2, 1).fill(C.outline)
    } else {
      g.rect(-3, -7, 2, 7).fill(C.pants)
      g.rect(1, -7, 2, 7).fill(C.pants)
      g.rect(-3, -1, 2, 1).fill(C.outline)
      g.rect(1, -1, 2, 1).fill(C.outline)
    }

    // 몸통(외곽선 포함)
    g.rect(-5, -16 + sy, 10, 10).fill(C.outline)
    g.rect(-4, -15 + sy, 8, 8).fill(this.shirt)

    // 머리
    const hx = -4 + headTilt
    g.rect(hx - 1, -24 + sy, 10, 9).fill(C.outline)
    g.rect(hx, -23 + sy, 8, 7).fill(C.skin)
    g.rect(hx, -23 + sy, 8, back ? 6 : 2).fill(this.hair)
    if (!back) {
      if (this.anim === 'sleep') {
        g.rect(hx + 1, -19 + sy, 2, 1).fill(C.outline)
        g.rect(hx + 5, -19 + sy, 2, 1).fill(C.outline)
      } else if (this.dir === 'left') {
        g.rect(hx + 1, -20 + sy, 1, 2).fill(C.outline)
      } else if (this.dir === 'right') {
        g.rect(hx + 6, -20 + sy, 1, 2).fill(C.outline)
      } else {
        g.rect(hx + 2, -20 + sy, 1, 2).fill(C.outline)
        g.rect(hx + 5, -20 + sy, 1, 2).fill(C.outline)
      }
    }

    // 팔·소품 (행동별)
    const arm = (x: number, y: number, h: number) => g.rect(x, y + sy, 1, h).fill(C.outline)
    switch (this.anim) {
      case 'raise_hand':
        arm(-5, -14, 6)
        g.rect(4, -26 + sy + (two ? 1 : 0), 2, 11).fill(C.outline)
        g.rect(4, -27 + sy + (two ? 1 : 0), 2, 2).fill(C.skin)
        break
      case 'wave':
        arm(-5, -14, 6)
        g.rect(two ? 4 : 5, -24 + sy, 2, 9).fill(C.outline)
        g.rect(two ? 4 : 6, -26 + sy, 2, 2).fill(C.skin)
        break
      case 'write_board':
        arm(-5, -14, 6)
        g.rect(4, -24 + sy + two * 2, 2, 9).fill(C.outline)
        break
      case 'type':
        g.rect(-5, -12 + sy + two, 3, 2).fill(C.skin)
        g.rect(2, -12 + sy + (1 - two), 3, 2).fill(C.skin)
        break
      case 'read':
        g.rect(-4, -13 + sy, 8, 5).fill(C.white)
        g.rect(-1, -13 + sy, 1, 5).fill(C.woodDark)
        g.rect(two ? -3 : 1, -12 + sy, 2, 1).fill(C.metalDark)
        break
      case 'phone':
        arm(-5, -14, 6)
        g.rect(4, -21 + sy, 2, 6).fill(C.red)
        break
      case 'idle_drink':
        arm(-5, -14, 6)
        g.rect(4, -13 + sy - two * 2, 3, 3).fill(C.white)
        break
      case 'shred':
        g.rect(-6, -11 + sy + two * 2, 4, 3).fill(C.white)
        arm(4, -14, 6)
        break
      case 'search':
        g.rect(-6, -10 + sy, 2, 3).fill(C.skin)
        g.rect(4, -10 + sy - two, 2, 3).fill(C.skin)
        break
      case 'flinch':
        // 양팔을 몸에 붙이고 어깨를 움츠림
        g.rect(-6, -15 + sy, 1, 5).fill(C.outline)
        g.rect(5, -15 + sy, 1, 5).fill(C.outline)
        g.rect(-6, -10 + sy, 2, 2).fill(C.skin)
        g.rect(4, -10 + sy, 2, 2).fill(C.skin)
        break
      case 'head_hold':
        // 두 손으로 머리를 감싸 쥠(좌우로 흔들)
        g.rect(-7 + two, -22 + sy, 2, 8).fill(C.outline)
        g.rect(5 + two, -22 + sy, 2, 8).fill(C.outline)
        g.rect(-7 + two, -23 + sy, 2, 2).fill(C.skin)
        g.rect(5 + two, -23 + sy, 2, 2).fill(C.skin)
        break
      case 'pack':
        // 책상 위 물건을 가방에 담음
        g.rect(-7, -9 + sy, 6, 6).fill(C.bag)
        g.rect(-6, -11 + sy, 4, 2).fill(C.woodDark)
        g.rect(1, -11 + sy - two * 2, 3, 2).fill(C.white)
        arm(4, -14, 5)
        break
      case 'report':
        arm(-5, -14, 6)
        g.rect(3, -13 + sy, 4, 5).fill(C.white)
        g.rect(4, -12 + sy, 2, 1).fill(C.metalDark)
        break
      default:
        arm(-5, -14, 6)
        arm(4, -14, 6)
        break
    }
  }

  private drawMark(): void {
    const g = this.markG
    g.clear()
    const m = this.mark
    if (m === null) return
    const f = Math.max(this.frame, 0)
    const blinkOff = f % 4 >= 3
    const top = -34
    if (m === 'sleep') {
      const z = f % 6
      drawGlyph(g, 'Z', 4, top + 4 - Math.floor(z / 2), C.zzz)
      if (z >= 2) drawGlyph(g, 'Z', 8, top - 1 - Math.floor(z / 3), C.zzz)
      return
    }
    if (m === 'sweat' || m === 'sweat_heavy') {
      // 식은땀: 이마 옆에서 맺혀 뺨을 타고 떨어지는 물방울. 무거우면 3방울 + 이마의 땀 줄
      const drops =
        m === 'sweat'
          ? [
              { x: 4, phase: 0 },
              { x: -6, phase: 3 },
            ]
          : [
              { x: 4, phase: 0 },
              { x: -6, phase: 2 },
              { x: 6, phase: 4 },
            ]
      for (const d of drops) {
        const p = (f + d.phase) % 6 // 0..5: 맺힘 → 떨어짐
        const y = -22 + p * 2
        g.rect(d.x, y, 1, 1).fill(C.sweatLight)
        g.rect(d.x - (p >= 1 ? 1 : 0), y + 1, p >= 1 ? 2 : 1, 2).fill(C.sweat)
        if (p >= 2) g.rect(d.x - 1, y + 3, 2, 1).fill(C.outline)
      }
      if (m === 'sweat_heavy') {
        g.rect(-3, -24, 1, 2).fill(C.sweat)
        g.rect(0, -25, 1, 2).fill(C.sweat)
        g.rect(3, -24, 1, 2).fill(C.sweat)
      }
      return
    }
    if (m === 'question' && blinkOff) return
    const bg = m === 'alert' ? C.yellow : C.white
    g.rect(-4, top - 1, 9, 9).fill(C.outline)
    g.rect(-3, top, 7, 7).fill(bg)
    g.rect(0, top + 8, 1, 1).fill(C.outline)
    drawGlyph(g, m === 'question' ? '?' : '!', -1, top + 1, C.outline)
  }

  private drawRing(): void {
    const g = this.ring
    g.clear()
    if (!this.highlight) return
    const color = Math.max(this.frame, 0) % 4 < 2 ? C.yellow : C.white
    g.rect(-6, -1, 12, 1).fill(color)
    g.rect(-8, 0, 2, 1).fill(color)
    g.rect(6, 0, 2, 1).fill(color)
    g.rect(-6, 1, 12, 1).fill(color)
  }

  private drawFx(): void {
    const g = this.fx
    g.clear()
    const f = Math.max(this.frame, 0)
    switch (this.effect) {
      case 'paper': {
        // 책상 옆에 종이가 쌓인다 (최대 5장)
        const n = 1 + ((f % 10) >> 1)
        for (let i = 0; i < n; i++)
          g.rect(7, -12 - i * 2, 5, 2).fill(i % 2 ? C.white : C.glassLight)
        break
      }
      case 'steam': {
        // 손에 든 컵 위로 김이 피어오름
        const k = f % 4
        g.rect(5, -17 - k, 1, 2).fill(C.steam)
        g.rect(6 + (k % 2), -20 - k, 1, 2).fill(C.steam)
        if (k >= 2) g.rect(5, -23 - k + 2, 1, 1).fill(C.steam)
        break
      }
      case 'shreds': {
        // 파쇄기 아래로 떨어지는 종이 조각
        for (let i = 0; i < 4; i++) {
          const p = (f + i * 2) % 6
          g.rect(-12 + (i % 2) * 3, -8 + p * 2, 1, 2).fill(i % 2 ? C.white : C.glassLight)
        }
        break
      }
      case 'bag':
        // 퇴근 가방
        g.rect(5, -11, 6, 6).fill(C.bag)
        g.rect(6, -13, 4, 2).fill(C.woodDark)
        g.rect(7, -9, 2, 1).fill(C.yellow)
        break
      default:
        break
    }
  }
}
