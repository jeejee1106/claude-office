import type { OfficeEvent } from '@claude-office/shared'
import { Application, Container, TextureSource } from 'pixi.js'
import {
  effectiveSessionId,
  type OfficeStore,
  type SceneListener,
  type StoreState,
} from '../store/officeStore'
import type { DirectorOutput } from './commands'
import { Director } from './director'
import { BASE_HEIGHT, BASE_WIDTH, PROPS } from './layout'
import { PlaceholderRenderer } from './render/PlaceholderRenderer'
import type { SceneRenderer } from './render/types'
import { Roster } from './roster'
import { routeSceneEvent } from './sceneRouting'

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
    this.director = new Director({ now: () => store.serverNow() })
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

    const renderer = createRenderer({ floor, furniture, characters, lighting }, overlay)
    this.renderer = renderer
    renderer.drawRoom(PROPS)
    this.roster = new Roster(
      (variant) => renderer.createCharacter(variant),
      (cmd) => {
        if (cmd.type === 'lights') renderer.setLights(cmd.on)
        else renderer.setServerBusy(cmd.busy)
      },
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
 * 렌더러 교체 지점. 아틀라스가 생기면 여기서 AtlasRenderer 를 반환한다
 * (예: Assets.load('/assets/office.json') 성공 시 AtlasRenderer, 실패 시 PlaceholderRenderer).
 */
function createRenderer(
  layers: ConstructorParameters<typeof PlaceholderRenderer>[0],
  overlay: HTMLElement,
): SceneRenderer {
  return new PlaceholderRenderer(layers, overlay)
}
