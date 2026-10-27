import type { OfficeEvent } from '@claude-office/shared'
import { Application, Assets, Container, Spritesheet, type Texture, TextureSource } from 'pixi.js'
import { getEmployeeSettings, subscribeEmployeeSettings } from '../employeeSettings'
import {
  effectiveSessionId,
  type OfficeStore,
  type SceneListener,
  type StoreState,
} from '../store/officeStore'
import { ACCESSORY_ATLAS_URL, type AccessoryAtlas, missingAccessoryFrames } from './accessory'
import type { DirectorOutput } from './commands'
import { Director } from './director'
import { BASE_HEIGHT, BASE_WIDTH, PROPS } from './layout'
import {
  CHARACTER_ATLAS_URL,
  type CharacterAtlas,
  missingAnimationKeys,
  parseFrameMs,
} from './render/characterSheet'
import {
  missingOfficeFrames,
  OFFICE_ATLAS_URL,
  OFFICE_FRAME_NAMES,
  parseSignMeta,
} from './render/officeSheet'
import { type OfficeAtlas, PlaceholderRenderer } from './render/PlaceholderRenderer'
import { missingPartnerKeys, PARTNER_ATLAS_URL, type PartnerAtlas } from './render/partnerSheet'
import type { SceneRenderer } from './render/types'
import { Roster } from './roster'
import { routeSceneEvent } from './sceneRouting'
import { VARIANT_COUNT } from './variant'

/*
 * PixiJS 씬. 자체 ticker 로 돌고 React 상태를 프레임마다 건드리지 않는다.
 * store 의 onSnapshot/onEvent 를 받아 director 로 명령을 만들고 Character 에 넘긴다.
 *
 * 픽셀 퍼펙트: 기준 해상도(BASE_WIDTH×BASE_HEIGHT) 고정, 호스트 크기에 맞는 "정수" 배율로
 * stage 를 확대, antialias 끔, roundPixels, 텍스처 기본 scaleMode 'nearest'.
 */

// 아틀라스 텍스처(나중)도 번지지 않도록 전역 기본값을 nearest 로
TextureSource.defaultOptions.scaleMode = 'nearest'

const SLEEP_CHECK_MS = 5_000
/**
 * 프레임 간격이 이보다 길면(탭이 숨겨졌다 돌아옴 등) 애니메이션을 따라잡지 않고 상태로 다시 맞춘다.
 * dt 는 PixiJS ticker.deltaMS(minFPS 때문에 100ms 로 잘림)가 아니라 performance.now() 로 잰다.
 * 잘린 dt 를 쓰면 낮은 fps 에서 화면이 슬로모션이 되어 이벤트를 영영 따라잡지 못한다.
 */
const RESYNC_GAP_MS = 3_000

export class OfficeScene {
  private readonly host: HTMLElement
  private readonly store: OfficeStore
  private app: Application | null = null
  private renderer: SceneRenderer | null = null
  private overlay: HTMLDivElement | null = null
  private readonly director: Director
  private roster: Roster | null = null
  private sessionId: string | null = null
  private lastFrameAt = 0
  private destroyed = false
  private readonly cleanups: (() => void)[] = []
  private sleepMs = 0

  constructor(host: HTMLElement, store: OfficeStore) {
    this.host = host
    this.store = store
    this.director = new Director({
      now: () => store.serverNow(),
      employees: getEmployeeSettings,
    })
  }

  async init(): Promise<void> {
    const app = new Application()
    await app.init({
      width: BASE_WIDTH,
      height: BASE_HEIGHT,
      antialias: false,
      resolution: 1,
      roundPixels: true,
      backgroundColor: 0x1b1f3b,
    })
    // 캐릭터 아틀라스: 실패해도 null → 플레이스홀더 캐릭터로 그린다(화면이 비지 않게)
    const [atlas, office, partners] = await Promise.all([
      loadCharacterAtlas(),
      loadOfficeAtlas(),
      loadPartnerAtlas(),
    ])
    // 소품 시트는 캐릭터 프레임 이름으로 빠진 프레임을 세므로 캐릭터 아틀라스 다음에
    const accessories = await loadAccessoryAtlas(atlas)
    if (this.destroyed) {
      app.destroy(true, { children: true })
      return
    }
    this.app = app
    app.canvas.classList.add('office-canvas')
    this.host.append(app.canvas)

    const overlay = document.createElement('div')
    overlay.className = 'office-overlay'
    this.host.append(overlay)
    this.overlay = overlay

    const floor = new Container()
    const furniture = new Container()
    const characters = new Container()
    characters.sortableChildren = true
    const lighting = new Container()
    app.stage.addChild(floor, furniture, characters, lighting)

    const renderer = createRenderer(
      { floor, furniture, characters, lighting },
      overlay,
      atlas,
      office,
      partners,
      accessories,
    )
    this.renderer = renderer
    renderer.drawRoom(PROPS)
    this.roster = new Roster(
      (variant, accessory) => renderer.createCharacter(variant, accessory),
      (cmd) => {
        if (cmd.type === 'lights') renderer.setLights(cmd.on)
        else if (cmd.type === 'servers') renderer.setServerBusy(cmd.busy)
        else renderer.setBoardWritten(cmd.written)
      },
      (kind) => renderer.createPartner(kind),
    )

    // 리사이즈: 정수 배율
    const ro = new ResizeObserver(() => this.resize())
    ro.observe(this.host)
    this.cleanups.push(() => ro.disconnect())
    this.resize()

    // store 연결
    const listener: SceneListener = {
      onSnapshot: (s) => this.resync(s),
      onEvent: (e, s) => this.onEvent(e, s),
    }
    this.cleanups.push(this.store.addSceneListener(listener))
    this.cleanups.push(this.store.subscribe(() => this.syncHighlight()))
    // 직원 설정(이름·팀·색)이 바뀌면 층 전환과 같은 경로로 상태대로 다시 그린다 — 팀을 바꾼 팀원은 즉시 새 팀 책상에
    this.cleanups.push(subscribeEmployeeSettings(() => this.resync(this.store.getState())))
    this.resync(this.store.getState())

    // 탭이 다시 보이면 상태로 즉시 맞춘다(숨겨진 동안 rAF 가 멈춰 애니메이션이 밀려 있다)
    const onVisible = () => {
      if (document.visibilityState === 'visible') this.resync(this.store.getState())
    }
    document.addEventListener('visibilitychange', onVisible)
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisible))

    this.lastFrameAt = performance.now()
    app.ticker.add(() => {
      const now = performance.now()
      const dt = now - this.lastFrameAt
      this.lastFrameAt = now
      if (dt > RESYNC_GAP_MS) this.resync(this.store.getState())
      else this.update(dt)
    })
  }

  destroy(): void {
    this.destroyed = true
    for (const c of this.cleanups.splice(0)) c()
    this.roster?.destroy()
    this.roster = null
    this.renderer?.destroy()
    this.renderer = null
    this.overlay?.remove()
    this.overlay = null
    if (this.app !== null) {
      this.app.canvas.remove()
      this.app.destroy(true, { children: true })
      this.app = null
    }
  }

  // -------------------------------------------------------------------------

  private resize(): void {
    const app = this.app
    if (app === null) return
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    const scale = Math.max(1, Math.floor(Math.min(w / BASE_WIDTH, h / BASE_HEIGHT)))
    app.renderer.resize(BASE_WIDTH * scale, BASE_HEIGHT * scale)
    app.stage.scale.set(scale)
    if (this.overlay !== null) {
      this.overlay.style.width = `${BASE_WIDTH * scale}px`
      this.overlay.style.height = `${BASE_HEIGHT * scale}px`
    }
    this.renderer?.setScale(scale)
  }

  private resync(s: StoreState): void {
    this.sessionId = effectiveSessionId(s)
    // 퇴장 중이던 캐릭터도 상태 기준으로는 이미 없다
    this.roster?.clearDeparting()
    this.dispatch(this.director.syncAll(s.office, this.sessionId))
    this.syncHighlight()
  }

  private onEvent(e: OfficeEvent, s: StoreState): void {
    const r = routeSceneEvent(this.director, this.sessionId, e, s)
    this.sessionId = r.sessionId
    if (r.resynced) this.roster?.clearDeparting()
    this.dispatch(r.outputs)
    if (r.resynced) this.syncHighlight()
  }

  private dispatch(outs: readonly DirectorOutput[]): void {
    this.roster?.dispatch(outs)
  }

  private update(dt: number): void {
    this.roster?.update(dt)
    this.sleepMs += dt
    if (this.sleepMs >= SLEEP_CHECK_MS) {
      this.sleepMs = 0
      const s = this.store.getState()
      if (this.sessionId !== null) {
        this.dispatch(this.director.refreshSleep(s.office.sessions[this.sessionId]))
      }
    }
    this.renderer?.tick(dt)
  }

  private syncHighlight(): void {
    this.roster?.setHighlight(this.store.getState().highlightAgentId)
  }
}

/**
 * 렌더러 교체 지점. 캐릭터(characters.json)와 층 전체 바닥·벽·가구(office.json)는 아틀라스가 있으면
 * 스프라이트, 빠진 조각은 코드 그림. 머리 위 표시·캐릭터 이펙트는 코드로 그린다.
 */
function createRenderer(
  layers: ConstructorParameters<typeof PlaceholderRenderer>[0],
  overlay: HTMLElement,
  atlas: CharacterAtlas<Texture> | null,
  office: OfficeAtlas<Texture> | null,
  partners: PartnerAtlas<Texture> | null,
  accessories: AccessoryAtlas<Texture> | null,
): SceneRenderer {
  return new PlaceholderRenderer(layers, overlay, atlas, office, partners, accessories)
}

/**
 * accessories.json(+png) 로드 — 외모 소품. 실패하면 경고만 남기고 null(소품을 그리지 않는다).
 * 프레임 이름은 캐릭터 프레임 이름의 char_{v}_ → acc_{kind}_ (accessory.ts).
 */
async function loadAccessoryAtlas(
  chars: CharacterAtlas<Texture> | null,
): Promise<AccessoryAtlas<Texture> | null> {
  const url = `${import.meta.env.BASE_URL}${ACCESSORY_ATLAS_URL}`
  try {
    const sheet: unknown = await Assets.load(url)
    if (!(sheet instanceof Spritesheet) || Object.keys(sheet.textures).length === 0) {
      console.warn(`[claude-office] ${url} 이 소품 시트 형식이 아님 — 소품을 그리지 않습니다.`)
      return null
    }
    sheet.textureSource.scaleMode = 'nearest'
    if (chars?.frameNames !== undefined) {
      const names = Object.values(chars.frameNames).flatMap((l) => l ?? [])
      const missing = missingAccessoryFrames(names, (n) => sheet.textures[n] !== undefined)
      if (missing.length > 0) {
        console.warn(
          `[claude-office] 소품 시트에 프레임 ${missing.length}개 없음(예: ${missing[0]}) — 그 프레임에서는 소품을 그리지 않습니다.`,
        )
      }
    }
    return { frames: { ...sheet.textures } }
  } catch (err) {
    console.warn(`[claude-office] 소품 시트 로드 실패(${url}) — 소품을 그리지 않습니다.`, err)
    return null
  }
}

/** partners.json(+png) 로드 — 파트너 몬스터. 실패하면 경고만 남기고 null(색 덩어리로 그린다) */
async function loadPartnerAtlas(): Promise<PartnerAtlas<Texture> | null> {
  const url = `${import.meta.env.BASE_URL}${PARTNER_ATLAS_URL}`
  try {
    const sheet: unknown = await Assets.load(url)
    if (!(sheet instanceof Spritesheet) || Object.keys(sheet.animations).length === 0) {
      console.warn(`[claude-office] ${url} 이 파트너 시트 형식이 아님 — 색 덩어리로 그립니다.`)
      return null
    }
    sheet.textureSource.scaleMode = 'nearest'
    const missing = missingPartnerKeys(sheet.animations)
    if (missing.length > 0) {
      console.warn(
        `[claude-office] 파트너 시트에 애니메이션 ${missing.length}개 없음(예: ${missing[0]}) — 그 동작만 색 덩어리로 그립니다.`,
      )
    }
    return { animations: sheet.animations, frameMs: parseFrameMs(sheet.data.meta) }
  } catch (err) {
    console.warn(`[claude-office] 파트너 시트 로드 실패(${url}) — 색 덩어리로 그립니다.`, err)
    return null
  }
}

/** office.json(+png) 로드 — 층 전체 바닥·벽·가구. 실패하면 경고만 남기고 null(코드로 그린다) */
async function loadOfficeAtlas(): Promise<OfficeAtlas<Texture> | null> {
  const url = `${import.meta.env.BASE_URL}${OFFICE_ATLAS_URL}`
  try {
    const sheet: unknown = await Assets.load(url)
    if (!(sheet instanceof Spritesheet) || Object.keys(sheet.textures).length === 0) {
      console.warn(`[claude-office] ${url} 이 office 아틀라스 형식이 아님 — 코드로 그립니다.`)
      return null
    }
    sheet.textureSource.scaleMode = 'nearest'
    const missing = missingOfficeFrames((n) => sheet.textures[n] !== undefined)
    if (missing.length > 0) {
      console.warn(
        `[claude-office] office 아틀라스에 프레임 ${missing.length}개 없음(예: ${missing[0]}) — 그 조각만 코드로 그립니다.`,
      )
    }
    const textures: Record<string, Texture> = {}
    for (const n of OFFICE_FRAME_NAMES) {
      const t = sheet.textures[n]
      if (t !== undefined) textures[n] = t
    }
    return { textures, sign: parseSignMeta(sheet.data.meta) }
  } catch (err) {
    console.warn(`[claude-office] office 아틀라스 로드 실패(${url}) — 코드로 그립니다.`, err)
    return null
  }
}

/** characters.json(+png) 로드. 실패·형식 오류면 경고만 남기고 null */
async function loadCharacterAtlas(): Promise<CharacterAtlas<Texture> | null> {
  const url = `${import.meta.env.BASE_URL}${CHARACTER_ATLAS_URL}`
  try {
    const sheet: unknown = await Assets.load(url)
    if (!(sheet instanceof Spritesheet) || Object.keys(sheet.animations).length === 0) {
      console.warn(
        `[claude-office] ${url} 이 캐릭터 아틀라스 형식이 아님 — 플레이스홀더로 그립니다.`,
      )
      return null
    }
    // 전역 기본값(nearest)과 별개로 확실히 한다 — 번진 픽셀 아트 방지
    sheet.textureSource.scaleMode = 'nearest'
    const missing = missingAnimationKeys(sheet.animations, VARIANT_COUNT)
    if (missing.length > 0) {
      console.warn(
        `[claude-office] 캐릭터 아틀라스에 애니메이션 ${missing.length}개 없음(예: ${missing[0]}) — 그 동작만 플레이스홀더로 그립니다.`,
      )
    }
    return {
      animations: sheet.animations,
      frameMs: parseFrameMs(sheet.data.meta),
      // 소품이 캐릭터 프레임 이름으로 자기 프레임을 찾는다
      frameNames: sheet.data.animations ?? {},
    }
  } catch (err) {
    console.warn(
      `[claude-office] 캐릭터 아틀라스 로드 실패(${url}) — 플레이스홀더로 그립니다.`,
      err,
    )
    return null
  }
}
