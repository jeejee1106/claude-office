import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js'
import { subscribeLang, teamName } from '../../i18n'
import { type Accessory, type AccessoryAtlas, pickAccessoryFrame } from '../accessory'
import type { AnimName, Effect, Mark } from '../activityMap'
import {
  DECOR_SPECS,
  type DecorAtlas,
  type DecorKind,
  decorFrameIndex,
  decorFrameMs,
  decorPlacements,
  type Season,
} from '../decor'
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
  SOFA_SORT_Y,
  TILE,
} from '../layout'
import type { PartnerAnim, PartnerKind } from '../partner'
import type { TeamId } from '../teams'
import {
  animKey,
  type CharacterAtlas,
  pickFrame,
  pickFrameName,
  resolveAnim,
  SOFA_POSES,
} from './characterSheet'
import {
  ANIM_MS,
  DEFAULT_SIGN,
  OFFICE_FRAMES,
  officeTiles,
  type Placement,
  type PropSprite,
  placementOf,
  ROOM_FRAMES,
  type RoomActivity,
  rackFrameIndex,
  roomActivity,
  roomExtras,
  roomPropSprite,
  type SignGeometry,
  signMids,
  signTextBox,
  stepDoor,
  type ViewSample,
  wallDecor,
} from './officeSheet'
import { type PartnerAtlas, partnerAnimKey, pickPartnerFrame } from './partnerSheet'
import type { CharacterView, PartnerView, SceneRenderer } from './types'

/*
 * 씬 렌더러. 층 전체(모든 방 바닥·벽·칸막이·출입구·가구)는 office 아틀라스(office.json)가 있으면
 * 그 스프라이트로, 없거나 프레임이 빠졌으면 그 조각만 PixiJS Graphics 로 그린 도형으로 그린다.
 * 캐릭터 몸도 같다(characters.json). 어느 경우든 화면이 비지 않는다. 머리 위 표시·캐릭터 이펙트는 코드 그림.
 * 이 파일이 프로젝트에서 Graphics 를 생성하는 유일한 곳이다(렌더링 경계).
 *
 * 방 가구 애니메이션은 기존 트리거에만 붙인다: 서버랙 LED·터미널 = setServerBusy, 문 = 문 근처 캐릭터,
 * 캐비닛·화이트보드·파쇄기·커피머신 = 그 스팟에서 그 동작 중인 캐릭터(officeSheet.roomActivity).
 *
 * 픽셀 퍼펙트: 모든 rect 는 정수 좌표·정수 크기, 위치는 Math.round, 확대는 OfficeScene 의
 * 정수 배율 stage.scale 로만. 텍스트(말풍선·이름표)는 DOM 오버레이(정수 배율 좌표)로 그린다.
 *
 * 캐릭터 스프라이트: 앵커 (0.5, 1) = 발끝 중앙(플레이스홀더 원점과 같음), 1 텍스처 픽셀 = 기준 해상도 1px,
 * 텍스처는 nearest. 프레임은 meta.frameMs 간격으로 실제 경과 시간(tick dt)에 맞춰 넘긴다.
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
  // 캐릭터 아틀라스 팔레트(packages/assets/src/palette.ts)의 가방 색 — pack 포즈의 가방과 같은 색
  bagBody: 0xb5703f,
  bagShade: 0x8a4f2c,
  chair: 0x4b4470,
  chairDark: 0x332e52,
  // office 시트 팔레트 cream / brownDark (간판 글자판·글자)
  signPanel: 0xfbefd5,
  signText: 0x4a2c20,
} as const

/**
 * 간판 글자(PixiJS Text). 기준 해상도 px(한글은 9px 아래로 내리면 뭉개진다 — pixel-artist 권장 9~10).
 * 텍스트 해상도 = 씬 정수 배율로 다시 그려 화면 픽셀 1:1 로 선명하다.
 */
const SIGN_FONT_SIZE = 9
const SIGN_FONT_MIN = 7
const SIGN_FONT = '"Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif'

/** office 아틀라스(업무 공간 바닥·벽·가구). 없거나 프레임이 빠지면 그 조각만 코드로 그린다 */
export interface OfficeAtlas<T> {
  readonly textures: Readonly<Record<string, T | undefined>>
  readonly sign: SignGeometry
}

interface SignLabel {
  team: TeamId
  text: Text
  /** 판 안쪽(글자 영역) 기준 해상도 px */
  x: number
  y: number
  w: number
  h: number
}

/**
 * variant 별 (셔츠, 머리) — 0 은 메인 고정. 아틀라스가 없을 때도 같은 사람이 같은 색으로 보이도록
 * 캐릭터 아틀라스의 변형 표(_workspace/02_pixel-artist_summary.md)와 같은 색을 쓴다.
 */
export const VARIANT_COLORS: readonly (readonly [number, number])[] = [
  [0xe8735a, 0x6b4430], // coral / brown (메인)
  [0x4f8ff0, 0x3b3656], // blue / ink
  [0x6cc46a, 0xb5703f], // green / chestnut
  [0xa283e0, 0x6b4430], // purple / brown
  [0xf5c84c, 0xb5703f], // yellow / chestnut
  [0x45bfb0, 0xf5c84c], // teal / yellow
  [0xf59ab5, 0x3b3656], // pink / ink
  [0xc5c9d6, 0xf5c84c], // grayLight / yellow
]

const SEATED: ReadonlySet<AnimName> = new Set(['idle_sit', 'sleep', 'phone_sit', 'sofa_sit'])
const FRAME_MS = 180

let warned = false
/** 아틀라스에 없는 키는 한 번씩만 경고한다 */
const warnedKeys = new Set<string>()
/** 소품 경고(시트 없음 = 'sheet', 프레임 없음 = 소품 종류)는 한 번씩만 */
const warnedAccessory = new Set<string>()
/** 장식 경고(시트 없음 = 'sheet', 프레임 없음 = 장식 종류)는 한 번씩만 */
const warnedDecor = new Set<string>()

/** 계절 장식 하나(시트 스프라이트 또는 코드 도형). 2프레임이면 ms 간격으로 교대 */
interface DecorView {
  obj: Container
  kind: DecorKind
  /** 시트 프레임(스프라이트일 때). 코드 도형이면 null → 프레임마다 다시 그린다 */
  textures: Texture[] | null
  g: Graphics | null
  frames: number
  ms: number
  phase: number
  frame: number
}

/** 상태(트리거)가 켜지면 active 프레임을 ms 간격으로 돌리고, 꺼지면 idle 로 돌아가는 가구 */
interface PropToggle {
  sprite: Sprite
  idle: Texture
  active: Texture[]
  ms: number
  key: Exclude<keyof RoomActivity, 'doorOpen'> | 'serverBusy'
  on: boolean
  elapsed: number
  step: number
}

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
  private ledMs = 0
  private ledTick = 0
  private serverBusy = false
  /** 화이트보드 글씨 남김(세션에서 계획을 한 번이라도 함 — director 의 board 명령) */
  private boardWritten = false
  /** 시트 프레임이 없어 코드로 그린 서버랙(LED 도 코드로 그린다) */
  private codeRacks: { prop: Prop; leds: Graphics }[] = []
  /** 시트 서버랙 스프라이트(애니메이션 furn_server_rack) */
  private readonly rackSprites: { sprite: Sprite; frames: Texture[] }[] = []
  private rackMs = 0
  private rackStep = 0
  /** 상태에 따라 텍스처를 바꾸는 가구(터미널·파쇄기·커피머신·화이트보드·캐비닛) */
  private readonly toggles: PropToggle[] = []
  private door: { sprite: Sprite; frames: Texture[]; step: number; ms: number } | null = null
  /** 파쇄기 작동 프레임이 있으면 캐릭터의 코드 종이 조각 이펙트를 끈다(프레임 안에 조각이 있음) */
  private shredsInProp = false
  private readonly views = new Set<PlaceholderCharacterView>()
  private readonly partnerViews = new Set<PartnerSpriteView>()
  /** 캐릭터 층에 깊이 정렬로 섞여 그려지는 가구(팀장 책상·직원 의자) */
  private readonly frontProps: Container[] = []
  private readonly signs: SignLabel[] = []
  private readonly unsubLang: () => void
  /** 계절 장식(undefined = 아직 한 번도 정하지 않음) */
  private season: Season | null | undefined = undefined
  private decorViews: DecorView[] = []
  private decorMs = 0

  private readonly atlas: CharacterAtlas<Texture> | null
  private readonly office: OfficeAtlas<Texture> | null
  private readonly partners: PartnerAtlas<Texture> | null
  private readonly accessories: AccessoryAtlas<Texture> | null
  private readonly decor: DecorAtlas<Texture> | null

  /**
   * atlas 가 null 이면(로드 실패) 캐릭터도 코드로 그린 도형으로 그린다. office 도 같다(업무 공간 가구).
   * partners 가 null 이면 파트너 몬스터는 팀 색의 작은 덩어리로 그린다.
   * accessories 가 null 이면 외모 소품을 그리지 않는다(캐릭터는 그대로).
   */
  constructor(
    layers: PlaceholderLayers,
    domOverlay: HTMLElement,
    atlas: CharacterAtlas<Texture> | null = null,
    office: OfficeAtlas<Texture> | null = null,
    partners: PartnerAtlas<Texture> | null = null,
    accessories: AccessoryAtlas<Texture> | null = null,
    decor: DecorAtlas<Texture> | null = null,
  ) {
    this.layers = layers
    this.dom = domOverlay
    this.atlas = atlas
    this.office = office
    this.partners = partners
    this.accessories = accessories
    this.decor = decor
    if (!warned && atlas === null) {
      warned = true
      console.warn(
        '[claude-office] 캐릭터 아틀라스 없음 — 캐릭터를 코드로 그린 플레이스홀더 도형으로 그립니다.',
      )
    }
    this.dimmer.rect(0, 0, BASE_WIDTH, BASE_HEIGHT).fill(0x0b0d1a)
    this.dimmer.alpha = this.dimAlpha
    layers.lighting.addChild(this.dimmer)
    this.unsubLang = subscribeLang(() => this.refreshSigns())
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
    // 층 전체 바닥·벽·칸막이·출입구: office 시트 타일(불투명). 빠진 프레임 칸은 위의 코드 그림이 보인다
    if (this.office !== null) {
      const tiles = new Container()
      for (const t of officeTiles()) {
        const tex = this.tex(t.frame)
        if (tex === null) continue
        const sp = new Sprite(tex)
        sp.anchor.set(0, 0)
        sp.position.set(t.col * TILE, t.row * TILE)
        tiles.addChild(sp)
      }
      this.layers.floor.addChild(tiles)
    }
    // 바닥 장식(케이블·현관 매트·러그): 바닥 타일 바로 위
    const decor = new Container()
    this.layers.floor.addChild(decor)

    const f = new Graphics()
    for (const p of props) {
      const at = placementOf(p)
      if (at !== null) {
        // 업무 공간 가구: 캐릭터 층에서 바닥 접점 y 로 깊이 정렬(팀장 책상은 팀장 앞, 의자는 직원 앞)
        this.addFront(this.anchoredProp(p, at), at.y)
        if (p.kind === 'teamSign' && p.team !== undefined) this.addSign(p, p.team, at.y)
        continue
      }
      if (p.kind === 'window' && this.office !== null && this.drawWallDecor(p)) continue
      const rs = roomPropSprite(p)
      if (rs !== null) {
        const sp = this.sprite(rs.frame, rs.x, rs.y, 0.5, 1)
        if (sp !== null) {
          this.place(sp, rs, decor)
          this.registerAnim(p, sp)
          continue
        }
        // office 시트가 있으면 문 그림이 없어도 아래 벽의 문 자리는 열린 출입구(바닥)로 보인다
        if (p.kind === 'door' && this.office !== null && this.tex(OFFICE_FRAMES.floor[0]) !== null)
          continue
        // 프레임이 없으면 그 가구만 코드 그림 — 스프라이트와 같은 층·깊이
        const fg = new Graphics()
        drawProp(fg, p)
        this.place(fg, rs, decor)
        if (p.kind === 'serverRack') {
          const leds = new Graphics()
          this.addFront(leds, rs.y + 0.5)
          this.codeRacks.push({ prop: p, leds })
        }
        continue
      }
      drawProp(f, p)
    }
    this.layers.furniture.addChild(f)
    // layout 에 없는 장식(회의 의자·터미널 의자·현관 매트·러그). 프레임이 없으면 생략(전에도 없던 것)
    if (this.office !== null) {
      for (const e of roomExtras()) {
        const sp = this.sprite(e.frame, e.x, e.y, 0.5, 1)
        if (sp !== null) this.place(sp, e, decor)
      }
    }
    this.shredsInProp = this.toggles.some((t) => t.key === 'shredder')
    for (const v of this.views) v.setShredsInProp(this.shredsInProp)
  }

  /** 방 가구 하나를 층에 놓는다(바닥 장식 / 캐릭터 아래 / 캐릭터 층 깊이 정렬) */
  private place(obj: Container, at: PropSprite, decor: Container): void {
    if (at.layer === 'floor') decor.addChild(obj)
    else if (at.layer === 'under') this.layers.furniture.addChild(obj)
    else this.addFront(obj, at.y)
  }

  private texList(names: readonly string[]): Texture[] {
    return names.map((n) => this.tex(n)).filter((t): t is Texture => t !== null)
  }

  /** 애니메이션·상태 프레임이 있는 가구를 등록한다(빠진 프레임은 건너뛰고, 하나도 없으면 정지 그림) */
  private registerAnim(p: Prop, sp: Sprite): void {
    const idle = sp.texture
    const toggle = (key: PropToggle['key'], names: readonly string[], ms: number) => {
      const active = this.texList(names)
      if (active.length > 0)
        this.toggles.push({ sprite: sp, idle, active, ms, key, on: false, elapsed: 0, step: 0 })
    }
    switch (p.kind) {
      case 'serverRack': {
        const frames = this.texList(ROOM_FRAMES.serverRack)
        const i = this.rackSprites.length
        const first = frames[rackFrameIndex(i, 0, frames.length)]
        if (first !== undefined) sp.texture = first
        if (frames.length > 1) this.rackSprites.push({ sprite: sp, frames })
        break
      }
      case 'terminal':
        toggle('serverBusy', ROOM_FRAMES.terminalBusy, ANIM_MS.terminalBusy)
        break
      case 'shredder':
        toggle('shredder', ROOM_FRAMES.shredderOn, ANIM_MS.shredder)
        break
      case 'coffee':
        toggle('coffee', ROOM_FRAMES.coffeeBrew, ANIM_MS.coffee)
        break
      case 'whiteboard':
        toggle('whiteboard', [ROOM_FRAMES.whiteboardWritten], Number.POSITIVE_INFINITY)
        break
      case 'cabinet':
        toggle('cabinet', [ROOM_FRAMES.cabinetOpen], Number.POSITIVE_INFINITY)
        break
      case 'door': {
        const frames = this.texList(ROOM_FRAMES.door)
        if (frames.length > 1) this.door = { sprite: sp, frames, step: 0, ms: 0 }
        break
      }
      default:
        break
    }
  }

  createPartner(kind: PartnerKind): PartnerView {
    const v = new PartnerSpriteView(kind, this.layers.characters, this.partners, () => {
      this.partnerViews.delete(v)
    })
    this.partnerViews.add(v)
    return v
  }

  createCharacter(variant: number, accessory: Accessory = 'none'): CharacterView {
    const v = new PlaceholderCharacterView(
      variant,
      this.layers.characters,
      this.dom,
      this.atlas,
      () => {
        this.views.delete(v)
      },
      accessory,
      this.accessories,
    )
    v.setScale(this.scale)
    v.setShredsInProp(this.shredsInProp)
    this.views.add(v)
    return v
  }

  setLights(on: boolean): void {
    this.dimTarget = on ? 0 : 0.65
  }

  setServerBusy(busy: boolean): void {
    this.serverBusy = busy
    this.ledMs = Number.POSITIVE_INFINITY // 바로 다시 그린다
    this.rackMs = Number.POSITIVE_INFINITY
  }

  setBoardWritten(written: boolean): void {
    this.boardWritten = written
  }

  setDecor(season: Season | null): void {
    if (season === this.season) return
    this.season = season
    this.clearDecor()
    for (const p of decorPlacements(season)) {
      const spec = DECOR_SPECS[p.kind]
      const textures = this.decorTextures(p.kind)
      const flip = p.flipX ? -1 : 1
      const base = { kind: p.kind, frames: spec.frames.length, phase: p.phase, frame: -1 }
      const ms = decorFrameMs(p.kind, this.decor?.frameMs)
      let view: DecorView
      if (textures !== null) {
        const sp = new Sprite(textures[0])
        sp.anchor.set(spec.ax, spec.ay)
        sp.scale.x = flip
        sp.position.set(Math.round(p.x), Math.round(p.y))
        view = { ...base, obj: sp, textures, g: null, ms, frames: textures.length }
      } else {
        // 시트·프레임이 없으면 그 장식만 코드 도형(같은 anchor·크기)
        const root = new Container()
        const g = new Graphics()
        g.position.set(-Math.round(spec.ax * spec.w), -Math.round(spec.ay * spec.h))
        root.addChild(g)
        root.scale.x = flip
        root.position.set(Math.round(p.x), Math.round(p.y))
        view = { ...base, obj: root, textures: null, g, ms }
      }
      // 벽 장식 = 가구 층(늘 캐릭터 뒤), 바닥 장식 = 캐릭터 층 바닥 접점 y 로 깊이 정렬(가구와 같은 규칙)
      if (spec.layer === 'wall') this.layers.furniture.addChild(view.obj)
      else {
        view.obj.zIndex = p.y
        this.layers.characters.addChild(view.obj)
      }
      this.decorViews.push(view)
    }
    this.decorMs = 0
    this.tickDecor(0)
  }

  /** 장식의 시트 프레임(모두 있어야 사용). 하나라도 없으면 null → 코드 도형 */
  private decorTextures(kind: DecorKind): Texture[] | null {
    const names = DECOR_SPECS[kind].frames
    const list = names.map((n) => this.decor?.textures[n])
    if (list.every((t): t is Texture => t !== undefined)) return list
    const key = this.decor === null ? 'sheet' : kind
    if (!warnedDecor.has(key)) {
      warnedDecor.add(key)
      console.warn(
        this.decor === null
          ? '[claude-office] 장식 시트(decor.json) 없음 — 계절 장식을 코드 도형으로 그립니다.'
          : `[claude-office] 장식 시트에 ${names.join(', ')} 없음 — 그 장식만 코드 도형으로 그립니다.`,
      )
    }
    return null
  }

  private tickDecor(dtMs: number): void {
    if (this.decorViews.length === 0) return
    this.decorMs += dtMs
    for (const v of this.decorViews) {
      const f = decorFrameIndex(this.decorMs, v.ms, v.frames, v.phase)
      if (f === v.frame) continue
      v.frame = f
      if (v.textures !== null) {
        const t = v.textures[f]
        if (t !== undefined && v.obj instanceof Sprite) v.obj.texture = t
      } else if (v.g !== null) {
        v.g.clear()
        drawDecorShape(v.g, v.kind, f)
      }
    }
  }

  private clearDecor(): void {
    for (const v of this.decorViews.splice(0)) v.obj.destroy({ children: true })
  }

  setScale(scale: number): void {
    this.scale = scale
    for (const v of this.views) v.setScale(scale)
    // 간판 글자는 화면 픽셀 1:1 로 다시 그린다(정수 배율에서 번지지 않게)
    for (const s of this.signs) s.text.resolution = scale
  }

  private tex(name: string): Texture | null {
    return this.office?.textures[name] ?? null
  }

  private addFront(obj: Container, sortY: number): void {
    obj.zIndex = sortY
    this.layers.characters.addChild(obj)
    this.frontProps.push(obj)
  }

  /** 스프라이트 하나(앵커는 시트의 defaultAnchor 가 아니라 명시) */
  private sprite(name: string, x: number, y: number, ax: number, ay: number): Sprite | null {
    const t = this.tex(name)
    if (t === null) return null
    const sp = new Sprite(t)
    sp.anchor.set(ax, ay)
    sp.position.set(Math.round(x), Math.round(y))
    return sp
  }

  /** 업무 공간 가구 하나: office 시트에 프레임이 있으면 스프라이트, 없으면 코드 그림 */
  private anchoredProp(p: Prop, at: Placement): Container {
    const geo = this.office?.sign ?? DEFAULT_SIGN
    const single = (name: string, ax: number, ay: number): Container | null =>
      this.sprite(name, at.x, at.y, ax, ay)
    let obj: Container | null = null
    switch (p.kind) {
      case 'desk':
        obj = single(OFFICE_FRAMES.desk, 0.5, 1)
        break
      case 'chair':
        obj = single(OFFICE_FRAMES.chair, 0.5, 1)
        break
      case 'mainDesk':
        obj = single(OFFICE_FRAMES.bossDesk, 0.5, 1)
        break
      case 'mainChair':
        obj = single(OFFICE_FRAMES.bossChair, 0.5, 1)
        break
      case 'plant':
        obj = single(OFFICE_FRAMES.plant, 0.5, 1)
        break
      case 'teamSign': {
        const mids = signMids(p, geo)
        const names = [
          OFFICE_FRAMES.signLeft,
          ...Array.from({ length: mids }, () => OFFICE_FRAMES.signMid),
          OFFICE_FRAMES.signRight,
        ]
        const parts = names.map((n, i) => this.sprite(n, at.x + geo.pieceW * i, at.y, 0, 1))
        if (parts.every((s) => s !== null)) {
          obj = new Container()
          for (const s of parts) if (s !== null) obj.addChild(s)
        }
        break
      }
      default:
        break
    }
    if (obj !== null) return obj
    const g = new Graphics()
    drawAnchored(g, p, at, geo)
    return g
  }

  /** 뒤 벽 창문·게시판(시트). 하나라도 빠지면 false → 코드로 그린 창문 */
  private drawWallDecor(p: Prop): boolean {
    const parts = wallDecor(p).map((d) => this.sprite(d.frame, d.x, d.y, 0.5, 1))
    if (parts.some((s) => s === null)) return false
    for (const s of parts) if (s !== null) this.layers.furniture.addChild(s)
    return true
  }

  /** 팀 간판 글자(i18n 사전, 언어가 바뀌면 다시 씀). 간판 바로 위 깊이 */
  private addSign(p: Prop, team: TeamId, sortY: number): void {
    const geo = this.office?.sign ?? DEFAULT_SIGN
    const text = new Text({
      text: '',
      resolution: this.scale,
      style: {
        fontFamily: SIGN_FONT,
        fontSize: SIGN_FONT_SIZE,
        fontWeight: '700',
        fill: C.signText,
      },
    })
    const label: SignLabel = { team, text, ...signTextBox(p, geo) }
    this.signs.push(label)
    this.addFront(text, sortY + 0.5)
    layoutSign(label)
  }

  private refreshSigns(): void {
    for (const s of this.signs) layoutSign(s)
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
    // 서버랙(시트): furn_server_rack 프레임을 평소 0.5초, 명령 실행 중 0.1초마다. 랙마다 시작 프레임을 엇갈림
    if (this.rackSprites.length > 0) {
      this.rackMs += dtMs
      if (this.rackMs >= (this.serverBusy ? ANIM_MS.rackBusy : ANIM_MS.rackIdle)) {
        this.rackMs = 0
        this.rackStep++
        for (const [i, r] of this.rackSprites.entries()) {
          const t = r.frames[rackFrameIndex(i, this.rackStep, r.frames.length)]
          if (t !== undefined) r.sprite.texture = t
        }
      }
    }
    // 서버 LED(코드로 그린 랙만): 평소 0.5초, 명령 실행 중이면 0.1초마다 무작위처럼(결정적) 깜빡인다
    if (this.codeRacks.length > 0) {
      this.ledMs += dtMs
      if (this.ledMs >= (this.serverBusy ? ANIM_MS.rackBusy : ANIM_MS.rackIdle)) {
        this.ledMs = 0
        this.ledTick++
        for (const [ri, { prop, leds }] of this.codeRacks.entries()) {
          drawLeds(leds, prop, ri, this.ledTick, this.serverBusy)
        }
      }
    }
    this.tickRoomProps(dtMs)
    this.tickDecor(dtMs)
  }

  /** 문·터미널·파쇄기·커피머신·화이트보드·캐비닛: 캐릭터 상태(와 서버 busy)에서 프레임을 고른다 */
  private tickRoomProps(dtMs: number): void {
    if (this.toggles.length === 0 && this.door === null) return
    const samples: ViewSample[] = []
    for (const v of this.views) {
      const s = v.sample()
      if (s !== null) samples.push(s)
    }
    const act = roomActivity(samples)
    // 화이트보드: 쓰는 중이거나, 이 세션에서 계획을 한 번이라도 했으면 글씨가 남아 있다
    if (this.boardWritten) act.whiteboard = true
    for (const t of this.toggles) {
      const on = t.key === 'serverBusy' ? this.serverBusy : act[t.key]
      if (on !== t.on) {
        t.on = on
        t.elapsed = 0
        t.step = 0
        t.sprite.texture = on ? (t.active[0] ?? t.idle) : t.idle
        continue
      }
      if (!on || t.active.length < 2) continue
      t.elapsed += dtMs
      if (t.elapsed < t.ms) continue
      t.elapsed = 0
      t.step = (t.step + 1) % t.active.length
      t.sprite.texture = t.active[t.step] ?? t.idle
    }
    // 문: 누가 문 근처면 열고(닫힘→반쯤→열림), 지나가면 거꾸로 닫는다. 80ms 한 칸, 반복 없음
    const d = this.door
    if (d !== null) {
      d.ms += dtMs
      if (d.ms >= ANIM_MS.door) {
        d.ms = 0
        const next = stepDoor(d.step, act.doorOpen, d.frames.length)
        if (next !== d.step) {
          d.step = next
          const t = d.frames[next]
          if (t !== undefined) d.sprite.texture = t
        }
      }
    }
  }

  destroy(): void {
    this.unsubLang()
    this.clearDecor()
    for (const v of [...this.views]) v.destroy()
    for (const v of [...this.partnerViews]) v.destroy()
    for (const c of this.frontProps.splice(0)) c.destroy()
    this.signs.length = 0
    this.codeRacks = []
    this.rackSprites.length = 0
    this.toggles.length = 0
    this.door = null
    for (const c of this.layers.floor.removeChildren()) c.destroy()
    for (const c of this.layers.furniture.removeChildren()) c.destroy()
    for (const c of this.layers.lighting.removeChildren()) c.destroy()
  }
}

// ---------------------------------------------------------------------------
// 바닥·가구
// ---------------------------------------------------------------------------

/** 간판 글자를 판 가운데에 정수 좌표로 놓는다. 판보다 넓으면 글자 크기를 줄인다 */
function layoutSign(s: SignLabel): void {
  s.text.text = teamName(s.team)
  let size = SIGN_FONT_SIZE
  s.text.style.fontSize = size
  while (s.text.width > s.w && size > SIGN_FONT_MIN) {
    size--
    s.text.style.fontSize = size
  }
  s.text.x = Math.round(s.x + (s.w - s.text.width) / 2)
  s.text.y = Math.round(s.y + (s.h - s.text.height) / 2)
}

/** 코드로 그린 서버랙의 LED(시트 프레임이 없을 때만) */
function drawLeds(g: Graphics, rack: Prop, ri: number, tick: number, busy: boolean): void {
  g.clear()
  const x = rack.col * TILE
  const y = rack.row * TILE
  for (let i = 0; i < 4; i++) {
    const n = (tick * 7 + ri * 13 + i * 5) % 11
    const on = busy ? n < 6 : (i + ri + tick) % 2 === 0
    g.rect(x + 4, y + 4 + i * 7, 2, 1).fill(on ? C.green : C.dark)
    g.rect(x + 8, y + 4 + i * 7, 1, 1).fill(on && n % 3 === 0 ? C.yellow : C.dark)
    if (i === 1 && ri === 0) g.rect(x + 11, y + 4 + i * 7, 1, 1).fill(tick % 2 ? C.red : C.dark)
  }
}

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

/**
 * office 시트가 없을 때 업무 공간 가구를 코드로 그린다. 시트와 같은 앵커·크기(at = 바닥 접점)로 그려
 * 깊이 정렬·캐릭터와의 겹침이 스프라이트일 때와 같다.
 */
function drawAnchored(g: Graphics, p: Prop, at: Placement, geo: SignGeometry): void {
  const { x, y } = at
  switch (p.kind) {
    case 'desk':
      // 직원 책상 32×32: 윗면 x −15..+14, 모니터 화면이 보임(직원이 아래에 앉아 위를 봄)
      g.rect(x - 15, y - 15, 30, 13).fill(C.outline)
      g.rect(x - 14, y - 14, 28, 3).fill(C.woodLight)
      g.rect(x - 14, y - 11, 28, 8).fill(C.wood)
      g.rect(x - 14, y - 4, 28, 1).fill(C.woodDark)
      g.rect(x - 14, y - 2, 2, 2).fill(C.woodDark)
      g.rect(x + 12, y - 2, 2, 2).fill(C.woodDark)
      g.rect(x - 9, y - 27, 18, 12).fill(C.outline)
      g.rect(x - 8, y - 26, 16, 9).fill(C.screen)
      g.rect(x - 1, y - 16, 2, 2).fill(C.outline)
      break
    case 'chair':
      // 직원 의자 뒷모습 16×16: 앉은 직원 앞에 겹친다
      g.rect(x - 6, y - 12, 12, 8).fill(C.outline)
      g.rect(x - 5, y - 11, 10, 6).fill(C.chair)
      g.rect(x - 5, y - 11, 10, 1).fill(C.chairDark)
      g.rect(x - 1, y - 4, 2, 2).fill(C.outline)
      g.rect(x - 5, y - 2, 10, 2).fill(C.metalDark)
      break
    case 'mainDesk':
      // 팀장 큰 책상 48×32: 팀장 하체 앞. 모니터는 왼쪽 구석(뒷면)이라 얼굴이 보인다
      g.rect(x - 24, y - 18, 48, 18).fill(C.outline)
      g.rect(x - 23, y - 17, 46, 4).fill(C.woodLight)
      g.rect(x - 23, y - 13, 46, 10).fill(C.wood)
      g.rect(x - 20, y - 11, 12, 6).fill(C.woodDark)
      g.rect(x + 8, y - 11, 12, 6).fill(C.woodDark)
      g.rect(x - 3, y - 9, 6, 2).fill(C.yellow)
      g.rect(x - 23, y - 26, 15, 10).fill(C.outline)
      g.rect(x - 22, y - 25, 13, 8).fill(C.metal)
      g.rect(x + 11, y - 19, 10, 3).fill(C.white)
      break
    case 'mainChair':
      // 팀장 의자 32×32: 등받이 높음, 팀장 뒤
      g.rect(x - 9, y - 30, 18, 26).fill(C.outline)
      g.rect(x - 8, y - 29, 16, 24).fill(C.chair)
      g.rect(x - 8, y - 29, 16, 2).fill(C.chairDark)
      g.rect(x - 6, y - 4, 12, 2).fill(C.metalDark)
      break
    case 'teamSign': {
      // 스탠드형 간판: 판(위 0..19) + 양 끝 기둥 + 바닥 받침. 글자는 Text 로 따로 얹는다
      const w = geo.pieceW * (2 + signMids(p, geo))
      const top = y - geo.pieceH
      g.rect(x + 7, top + 19, 2, 11).fill(C.woodDark)
      g.rect(x + w - 9, top + 19, 2, 11).fill(C.woodDark)
      g.rect(x + 4, y - 3, 8, 2).fill(C.woodDark)
      g.rect(x + w - 12, y - 3, 8, 2).fill(C.woodDark)
      g.rect(x + 2, top + 1, w - 4, 19).fill(C.outline)
      g.rect(x + 3, top + 2, w - 6, 17).fill(C.wood)
      g.rect(
        x + geo.panelInsetX,
        top + geo.panelTop,
        w - 2 * geo.panelInsetX,
        geo.panelHeight,
      ).fill(C.signPanel)
      break
    }
    default:
      drawProp(g, p)
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

/**
 * decor 시트가 없을 때의 계절 장식 코드 도형. (0,0) = 프레임 왼쪽 위, 크기 = DECOR_SPECS 의 w×h.
 * frame = 2프레임 장식의 지금 프레임(호박·트리 불빛 깜빡임, 선풍기·박쥐 움직임).
 */
function drawDecorShape(g: Graphics, kind: DecorKind, frame: number): void {
  const on = frame % 2 === 1
  switch (kind) {
    case 'blossomPot':
    case 'sunflowerPot': {
      g.rect(4, 24, 8, 8).fill(C.pot)
      g.rect(7, 10, 2, 14).fill(C.plant)
      if (kind === 'blossomPot') {
        g.rect(2, 2, 12, 10).fill(0xf59ab5)
        g.rect(5, 4, 2, 2).fill(C.white)
        g.rect(10, 7, 2, 2).fill(C.white)
      } else {
        g.rect(3, 2, 10, 10).fill(C.yellow)
        g.rect(6, 5, 4, 4).fill(C.woodDark)
        g.rect(9, 14, 4, 3).fill(C.plant)
      }
      break
    }
    case 'garland':
      g.rect(0, 1, 32, 1).fill(C.plant)
      for (let i = 0; i < 4; i++) {
        const x = 2 + i * 8
        g.rect(x, 2 + (i % 2) * 2, 4, 4).fill(i % 2 ? C.white : 0xf59ab5)
      }
      break
    case 'fan':
      g.rect(7, 14, 2, 14).fill(C.metalDark)
      g.rect(3, 28, 10, 4).fill(C.metalDark)
      g.rect(2, 2, 12, 12).fill(C.metal)
      if (on) g.rect(3, 7, 10, 2).fill(C.white)
      else g.rect(7, 3, 2, 10).fill(C.white)
      g.rect(7, 7, 2, 2).fill(C.dark)
      break
    case 'watermelon':
      g.rect(2, 8, 12, 7).fill(C.plant)
      g.rect(3, 8, 10, 5).fill(C.red)
      g.rect(5, 10, 1, 1).fill(C.dark)
      g.rect(9, 10, 1, 1).fill(C.dark)
      break
    case 'pumpkin':
      g.rect(2, 6, 12, 10).fill(0xf08c00)
      g.rect(7, 3, 2, 3).fill(C.plant)
      g.rect(4, 9, 2, 2).fill(on ? C.yellow : C.dark)
      g.rect(10, 9, 2, 2).fill(on ? C.yellow : C.dark)
      g.rect(5, 13, 6, 1).fill(on ? C.yellow : C.dark)
      break
    case 'bat':
      g.rect(7, 0, 1, 5).fill(C.metalDark)
      g.rect(5, 5, 6, 5).fill(C.dark)
      if (on) {
        g.rect(1, 4, 4, 3).fill(C.dark)
        g.rect(11, 4, 4, 3).fill(C.dark)
      } else {
        g.rect(1, 7, 4, 3).fill(C.dark)
        g.rect(11, 7, 4, 3).fill(C.dark)
      }
      g.rect(6, 6, 1, 1).fill(C.red)
      g.rect(9, 6, 1, 1).fill(C.red)
      break
    case 'cobweb':
      g.rect(0, 0, 16, 1).fill(C.white)
      g.rect(0, 0, 1, 16).fill(C.white)
      for (let i = 1; i < 12; i++) g.rect(i, i, 1, 1).fill(C.white)
      g.rect(0, 6, 7, 1).fill(C.white)
      g.rect(6, 0, 1, 7).fill(C.white)
      break
    case 'tree': {
      g.rect(14, 40, 4, 8).fill(C.woodDark)
      g.rect(10, 4, 12, 12).fill(C.plant)
      g.rect(6, 14, 20, 14).fill(C.plant)
      g.rect(2, 26, 28, 14).fill(C.plant)
      g.rect(14, 0, 4, 4).fill(C.yellow)
      const lights = [
        [12, 10],
        [18, 18],
        [9, 22],
        [22, 30],
        [6, 34],
        [15, 34],
      ] as const
      for (const [i, [x, y]] of lights.entries()) {
        g.rect(x, y, 2, 2).fill((i + frame) % 2 === 0 ? C.red : C.yellow)
      }
      break
    }
    case 'gift':
      g.rect(2, 6, 12, 10).fill(C.red)
      g.rect(7, 6, 2, 10).fill(C.yellow)
      g.rect(2, 9, 12, 2).fill(C.yellow)
      g.rect(5, 3, 6, 3).fill(C.yellow)
      break
    case 'wreath':
      g.rect(3, 2, 10, 12).fill(C.plant)
      g.rect(6, 5, 4, 6).fill(C.wall)
      g.rect(6, 11, 4, 3).fill(C.red)
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
  /** 아틀라스 스프라이트 몸. 아틀라스가 없거나 키가 빠졌으면 숨기고 body(Graphics)를 그린다 */
  private readonly sprite = new Sprite()
  private readonly atlas: CharacterAtlas<Texture> | null
  private readonly variant: number
  private usingSprite = false
  /** 스프라이트로 실제 그리는 동작(대체 그림이면 대체 동작). 스프라이트 크기는 텍스처 크기 그대로(sofa_lie 32×16) */
  private drawnAnim: AnimName | null = null
  /**
   * 외모 소품 겹침 그림: 캐릭터 스프라이트 바로 위(이펙트·머리 위 표시 아래), 같은 앵커·오프셋.
   * 캐릭터 프레임 이름의 char_{v}_ → acc_{kind}_ 프레임. 없으면 숨긴다.
   */
  private readonly accSprite = new Sprite()
  private readonly accessory: Accessory
  private readonly accAtlas: AccessoryAtlas<Texture> | null
  /** 마지막으로 소품을 맞춘 캐릭터 프레임 이름(같으면 다시 찾지 않는다) */
  private accFor: string | null = null
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
  private shredsInProp = false
  private px = Number.NaN
  private py = Number.NaN
  private scale = 1

  constructor(
    variant: number,
    layer: Container,
    dom: HTMLElement,
    atlas: CharacterAtlas<Texture> | null,
    onDestroy: () => void,
    accessory: Accessory = 'none',
    accAtlas: AccessoryAtlas<Texture> | null = null,
  ) {
    const colors = VARIANT_COLORS[variant % VARIANT_COLORS.length] ?? VARIANT_COLORS[0] ?? [0, 0]
    this.shirt = colors[0]
    this.hair = colors[1]
    this.variant = variant
    this.atlas = atlas
    this.onDestroy = onDestroy
    this.accessory = accessory
    this.accAtlas = accAtlas
    if (accessory !== 'none' && accAtlas === null && !warnedAccessory.has('sheet')) {
      warnedAccessory.add('sheet')
      console.warn(
        '[claude-office] 소품 시트(accessories.json) 없음 — 외모 소품을 그리지 않습니다.',
      )
    }
    // 발끝 중앙 앵커(아틀라스 frame.anchor 와 같은 값). texture 교체 때 defaultAnchor 가 다시 읽히지 않으므로 직접 고정
    this.sprite.anchor.set(0.5, 1)
    this.sprite.visible = false
    this.accSprite.anchor.set(0.5, 1)
    this.accSprite.visible = false
    this.root.addChild(this.ring, this.body, this.sprite, this.accSprite, this.fx, this.markG)
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

  /** 파쇄기 시트 프레임(종이 조각 포함)이 있으면 코드 종이 조각을 그리지 않는다(렌더러 내부 전용) */
  setShredsInProp(on: boolean): void {
    if (this.shredsInProp === on) return
    this.shredsInProp = on
    if (this.effect === 'shreds') this.drawFx()
  }

  /** 방 가구 애니메이션 트리거용 요약(렌더러 내부 전용). 아직 배치 전이면 null */
  sample(): ViewSample | null {
    if (Number.isNaN(this.px)) return null
    return { x: this.px, y: this.py, anim: this.anim }
  }

  setPosition(x: number, y: number): void {
    const rx = Math.round(x)
    const ry = Math.round(y)
    if (rx === this.px && ry === this.py) return
    this.px = rx
    this.py = ry
    this.root.x = rx
    this.root.y = ry
    this.updateDepth()
    this.placeDom()
  }

  /** 깊이 = 발끝 y. 소파 위 동작은 소파 바로 위(SOFA_SORT_Y = 소파 앵커 y + 1) — 좌석 쿠션이 사람을 덮지 않게 */
  private updateDepth(): void {
    if (Number.isNaN(this.py)) return
    this.root.zIndex = SOFA_POSES.has(this.anim) ? SOFA_SORT_Y : this.py
  }

  setAnimation(anim: AnimName, dir: Dir): void {
    if (anim === this.anim && dir === this.dir) return
    this.anim = anim
    this.dir = dir
    this.updateDepth()
    this.elapsed = 0
    this.frame = -1
    this.redraw()
    // 가방·김 위치는 동작·방향에 따라 달라진다. 표시 위치도(누운 모습)
    if (this.effect !== null) this.drawFx()
    if (this.mark !== null) this.drawMark()
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
    // 스프라이트 몸은 애니메이션마다 다른 간격(meta.frameMs)으로 넘긴다
    if (this.usingSprite) this.updateSprite()
    // 표시·이펙트·플레이스홀더 몸은 FRAME_MS 간격
    const f = Math.floor(this.elapsed / FRAME_MS)
    if (f !== this.frame) {
      this.frame = f
      if (!this.usingSprite) this.drawBody()
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

  /** 애니메이션·방향이 바뀌었을 때: 아틀라스 키가 있으면 스프라이트, 없으면 도형 */
  private redraw(): void {
    if (this.atlas !== null) {
      const key = animKey(this.variant, this.anim, this.dir)
      const resolved = resolveAnim(this.atlas, this.variant, this.anim, this.dir)
      if (resolved !== null) {
        this.usingSprite = true
        this.drawnAnim = resolved.anim
        this.sprite.visible = true
        // 대체 그림(예: 앉아서 전화 = phone 프레임을 앉은 높이로)은 정수 px 만큼 내린다
        this.sprite.y = resolved.dy
        this.body.clear()
        this.body.visible = false
        // phone → phone_sit 처럼 같은 프레임 이름에 오프셋만 바뀌는 경우도 소품 위치를 다시 맞춘다
        this.accFor = null
        this.updateSprite()
        return
      }
      if (!warnedKeys.has(key)) {
        warnedKeys.add(key)
        console.warn(
          `[claude-office] 캐릭터 아틀라스에 ${key} 없음 — 플레이스홀더 도형으로 그립니다.`,
        )
      }
    }
    this.usingSprite = false
    this.drawnAnim = null
    this.sprite.visible = false
    // 코드로 그린 몸에는 소품 그림이 맞지 않는다
    this.accSprite.visible = false
    this.accFor = null
    this.body.visible = true
    this.drawBody()
  }

  private updateSprite(): void {
    if (this.atlas === null) return
    const tex = pickFrame(this.atlas, this.variant, this.anim, this.dir, this.elapsed)
    if (tex !== null && this.sprite.texture !== tex) this.sprite.texture = tex
    if (this.accessory !== 'none') this.updateAccessory()
  }

  /** 소품을 지금 캐릭터 프레임에 맞춘다(같은 프레임·방향·뒤집기·오프셋). 프레임이 없으면 숨김 */
  private updateAccessory(): void {
    if (this.atlas === null) return
    const name = pickFrameName(this.atlas, this.variant, this.anim, this.dir, this.elapsed)
    if (name === this.accFor) return
    this.accFor = name
    const tex = pickAccessoryFrame(this.accAtlas, this.accessory, name)
    if (tex === null) {
      this.accSprite.visible = false
      if (this.accAtlas !== null && name !== null && !warnedAccessory.has(this.accessory)) {
        warnedAccessory.add(this.accessory)
        console.warn(
          `[claude-office] 소품 시트에 ${name} 에 맞는 ${this.accessory} 프레임 없음 — 그 프레임에서는 소품을 그리지 않습니다.`,
        )
      }
      return
    }
    if (this.accSprite.texture !== tex) this.accSprite.texture = tex
    this.accSprite.x = this.sprite.x
    this.accSprite.y = this.sprite.y
    this.accSprite.scale.copyFrom(this.sprite.scale)
    this.accSprite.visible = true
  }

  /** 플레이스홀더 몸 그리기. 원점 = 발끝 중앙, 16×24 프레임 영역(-8..8, -24..0) */
  private drawBody(): void {
    const g = this.body
    const f = Math.max(this.frame, 0)
    const two = f % 2
    const seated = SEATED.has(this.anim)
    const back = this.dir === 'up'
    g.clear()

    if (this.anim === 'sofa_lie') {
      // 소파에 누움: 머리 왼쪽, 몸·다리 오른쪽으로 눕힌 모습(소파 폭 안, -12..12). 숨 쉬듯 몸통 1px
      g.rect(-12, -11, 9, 9).fill(C.outline)
      g.rect(-11, -10, 7, 7).fill(C.skin)
      g.rect(-11, -10, 2, 7).fill(this.hair)
      g.rect(-7, -7, 2, 1).fill(C.outline) // 감은 눈
      g.rect(-3, -9 - (two ? 1 : 0), 9, 7 + (two ? 1 : 0)).fill(C.outline)
      g.rect(-2, -8 - (two ? 1 : 0), 7, 5 + (two ? 1 : 0)).fill(this.shirt)
      g.rect(6, -7, 6, 4).fill(C.pants)
      g.rect(11, -7, 1, 4).fill(C.outline)
      return
    }

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
      case 'phone_sit':
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
    // 누운 모습(sofa_lie 32×16 스프라이트·도형)은 머리가 낮고 왼쪽 팔걸이 쪽(x −14..−6, y −13..)에 있다
    // → 표시를 그 머리 바로 위로. 대체 그림(앉아 조는 sleep 프레임)이면 평소 자리
    const lying = this.anim === 'sofa_lie' && (!this.usingSprite || this.drawnAnim === 'sofa_lie')
    const top = lying ? -22 : -34
    g.x = lying ? -14 : 0
    if (m === 'sleep') {
      const z = f % 6
      drawGlyph(g, 'Z', 4, top + 4 - Math.floor(z / 2), C.zzz)
      if (z >= 2) drawGlyph(g, 'Z', 8, top - 1 - Math.floor(z / 3), C.zzz)
      return
    }
    if (m === 'sweat' || m === 'sweat_heavy') {
      // 식은땀: 이마 옆에서 맺혀 뺨을 타고 떨어지는 물방울. 무거우면 3방울 + 이마의 땀 줄
      // 스프라이트 머리(외곽선 포함 x -7..6, y -24..-12)는 도형보다 커서 머리 바깥 양옆으로 뺀다
      const big = this.usingSprite
      const drops =
        m === 'sweat'
          ? big
            ? [
                { x: 8, phase: 0 },
                { x: -8, phase: 3 },
              ]
            : [
                { x: 4, phase: 0 },
                { x: -6, phase: 3 },
              ]
          : big
            ? [
                { x: 8, phase: 0 },
                { x: -8, phase: 2 },
                { x: 5, phase: 4 }, // 오른뺨(눈 옆 볼터치 자리)
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
        // 이마의 땀 줄: 스프라이트는 앞머리 끝·이마(y -19..-18)
        const fy = big ? -19 : -24
        g.rect(big ? -4 : -3, fy, 1, 2).fill(C.sweat)
        g.rect(big ? -1 : 0, fy - (big ? 0 : 1), 1, 2).fill(C.sweat)
        g.rect(big ? 2 : 3, fy, 1, 2).fill(C.sweat)
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
        const k = f % 4
        if (!this.usingSprite) {
          // 손에 든 컵 위로 김이 피어오름
          g.rect(5, -17 - k, 1, 2).fill(C.steam)
          g.rect(6 + (k % 2), -20 - k, 1, 2).fill(C.steam)
          if (k >= 2) g.rect(5, -23 - k + 2, 1, 1).fill(C.steam)
          break
        }
        // 스프라이트는 컵이 큰 머리 바로 아래(턱·입 앞)에 있어 위로 피우면 얼굴을 덮는다
        // → 컵 쪽 머리 옆으로 피어오르게 한다(left 는 왼쪽, 나머지는 오른쪽)
        const sg = this.dir === 'left' ? -1 : 1
        const bx = sg > 0 ? 7 : -8
        g.rect(bx, -13 - k, 1, 2).fill(C.steam)
        g.rect(bx + sg * (1 + (k % 2)), -16 - k, 1, 2).fill(C.steam)
        if (k >= 2) g.rect(bx, -17 - k, 1, 1).fill(C.steam)
        break
      }
      case 'shreds': {
        // 파쇄기 시트 그림(furn_shredder_on)에 떨어지는 조각이 이미 있다 — 같은 연출을 두 번 그리지 않는다
        if (this.shredsInProp) break
        // 파쇄기 아래로 떨어지는 종이 조각
        for (let i = 0; i < 4; i++) {
          const p = (f + i * 2) % 6
          g.rect(-12 + (i % 2) * 3, -8 + p * 2, 1, 2).fill(i % 2 ? C.white : C.glassLight)
        }
        break
      }
      case 'bag': {
        // 퇴근 가방. pack 포즈(짐 챙기기)는 몸 그림에 가방이 이미 있으므로 그리지 않는다(가방 두 개 방지)
        if (this.anim === 'pack') break
        if (!this.usingSprite) {
          g.rect(5, -11, 6, 6).fill(C.bag)
          g.rect(6, -13, 4, 2).fill(C.woodDark)
          g.rect(7, -9, 2, 1).fill(C.yellow)
          break
        }
        // 스프라이트: pack 포즈의 가방과 같은 자리·색(왼손, right 방향은 좌우 반전)으로 이어 들고 나간다
        const x0 = this.dir === 'right' ? 2 : -8
        g.rect(x0 + 1, -8, 4, 1).fill(C.outline) // 손잡이
        g.rect(x0, -7, 6, 5).fill(C.outline)
        g.rect(x0 + 1, -6, 4, 3).fill(C.bagBody)
        g.rect(x0 + 1, -6, 4, 1).fill(C.bagShade)
        break
      }
      default:
        break
    }
  }
}

// ---------------------------------------------------------------------------
// 파트너 몬스터
// ---------------------------------------------------------------------------

/** 시트가 없을 때 파트너 덩어리 색(pixel-artist 요약 "5종" 몸 색과 같은 계열) */
const PARTNER_COLORS: Readonly<Record<PartnerKind, number>> = {
  research: 0x45bfb0,
  planning: 0xa283e0,
  design: 0xf59ab5,
  dev: 0x4f8ff0,
  boss: 0xe8735a,
}
/** 앉음·잠 자세의 머리 위 Zzz 높이(발끝 기준, pixel-artist 권장 약 −14px) */
const PARTNER_ZZZ_TOP = -18
const PARTNER_ZZZ_MS = 400

let warnedPartnerSheet = false

class PartnerSpriteView implements PartnerView {
  private readonly root = new Container()
  private readonly sprite = new Sprite()
  private readonly body = new Graphics()
  private readonly zzz = new Graphics()
  private readonly kind: PartnerKind
  private readonly atlas: PartnerAtlas<Texture> | null
  private readonly onDestroy: () => void
  private anim: PartnerAnim = 'idle'
  private dir: Dir = 'down'
  private elapsed = 0
  private zStep = -1
  private px = Number.NaN
  private py = Number.NaN
  private destroyed = false

  constructor(
    kind: PartnerKind,
    layer: Container,
    atlas: PartnerAtlas<Texture> | null,
    onDestroy: () => void,
  ) {
    this.kind = kind
    this.atlas = atlas
    this.onDestroy = onDestroy
    // 발끝 중앙 앵커 고정(텍스처 교체 때 defaultAnchor 를 다시 읽지 않는다)
    this.sprite.anchor.set(0.5, 1)
    this.root.addChild(this.body, this.sprite, this.zzz)
    this.root.visible = false // 첫 위치를 받기 전에는 (0,0) 에 보이지 않게
    layer.addChild(this.root)
    if (atlas === null && !warnedPartnerSheet) {
      warnedPartnerSheet = true
      console.warn('[claude-office] 파트너 시트 없음 — 파트너를 작은 색 덩어리로 그립니다.')
    }
  }

  setPosition(x: number, y: number): void {
    const rx = Math.round(x)
    const ry = Math.round(y)
    if (rx === this.px && ry === this.py) return
    this.px = rx
    this.py = ry
    this.root.position.set(rx, ry)
    this.root.zIndex = ry // 발끝 y 로 캐릭터·가구와 깊이 정렬
    this.root.visible = true
  }

  setAnimation(anim: PartnerAnim, dir: Dir): void {
    this.anim = anim
    this.dir = dir
    this.elapsed = 0
    this.zStep = -1
    this.redraw()
  }

  setAlpha(a: number): void {
    this.root.alpha = Math.round(a * 4) / 4
  }

  tick(dtMs: number): void {
    this.elapsed += dtMs
    if (this.atlas !== null) this.updateSprite()
    if (this.anim === 'sleep') {
      const s = Math.floor(this.elapsed / PARTNER_ZZZ_MS) % 4
      if (s !== this.zStep) {
        this.zStep = s
        this.drawZzz(s)
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.root.destroy({ children: true })
    this.onDestroy()
  }

  private redraw(): void {
    this.zzz.clear()
    if (this.anim === 'sleep') this.drawZzz(0)
    if (this.atlas !== null && this.updateSprite()) {
      this.body.clear()
      this.body.visible = false
      this.sprite.visible = true
      return
    }
    this.sprite.visible = false
    this.body.visible = true
    this.drawBody()
  }

  /** 시트 프레임을 고른다. 키가 없으면 false(덩어리로 그린다) */
  private updateSprite(): boolean {
    if (this.atlas === null) return false
    const tex = pickPartnerFrame(this.atlas, this.kind, this.anim, this.dir, this.elapsed)
    if (tex === null) {
      const key = partnerAnimKey(this.kind, this.anim, this.dir)
      if (!warnedKeys.has(key)) {
        warnedKeys.add(key)
        console.warn(`[claude-office] 파트너 시트에 ${key} 없음 — 색 덩어리로 그립니다.`)
      }
      return false
    }
    if (this.sprite.texture !== tex) this.sprite.texture = tex
    return true
  }

  /** 시트가 없을 때: 원점 = 발끝 중앙, 8×(앉음 6 / 섬 8) 덩어리 + 눈 */
  private drawBody(): void {
    const g = this.body
    g.clear()
    const low = this.anim === 'sit' || this.anim === 'sleep'
    const h = low ? 6 : 8
    const lift = this.anim === 'hop' ? 2 : 0
    g.rect(-5, -h - 2 - lift, 10, h + 2).fill(C.outline)
    g.rect(-4, -h - 1 - lift, 8, h).fill(PARTNER_COLORS[this.kind])
    if (this.dir !== 'up' && this.anim !== 'sleep') {
      g.rect(-2, -h + 1 - lift, 1, 1).fill(C.outline)
      g.rect(1, -h + 1 - lift, 1, 1).fill(C.outline)
    }
  }

  /** 작은 Zzz: 글자 하나가 위로 떠오르며 깜빡인다 */
  private drawZzz(step: number): void {
    const g = this.zzz
    g.clear()
    if (step === 3) return
    drawGlyph(g, 'Z', 3, PARTNER_ZZZ_TOP - step, C.zzz)
  }
}
