import type { Accessory } from './accessory'
import { Character } from './Character'
import { type DirectorOutput, isCharacterCommand, type SceneCommand } from './commands'
import { Partner, type PartnerKind } from './partner'
import type { CharacterView, PartnerView } from './render/types'

/*
 * 화면 위 캐릭터 목록(PixiJS 비의존). director 명령을 Character 에 나눠 주고 매 프레임 진행시킨다.
 * OfficeScene 과 테스트(시뮬레이션 시계)가 같은 코드를 쓴다.
 */
export class Roster {
  private readonly createView: (variant: number, accessory: Accessory) => CharacterView
  private readonly onScene: (cmd: SceneCommand) => void
  /** 조명 끄기 대기 중(퇴장 중인 사람이 다 나가면 끈다 — 기획서 5절 "마지막 사람이 나가면") */
  private lightsOffPending: SceneCommand | null = null
  readonly chars = new Map<string, Character>()
  /** 퇴장 중(문으로 걷는 중)인 캐릭터 — 같은 ID 가 다시 들어와도 겹치지 않게 분리 */
  departing: Character[] = []
  private highlight: string | null = null

  /** 파트너 몬스터 뷰(없으면 파트너를 만들지 않는다 — 옛 테스트) */
  private readonly createPartner: ((kind: PartnerKind) => PartnerView) | null

  constructor(
    createView: (variant: number, accessory: Accessory) => CharacterView,
    onScene: (cmd: SceneCommand) => void,
    createPartner: ((kind: PartnerKind) => PartnerView) | null = null,
  ) {
    this.createView = createView
    this.onScene = onScene
    this.createPartner = createPartner
  }

  /** 조명 끄기를 기다리는 중인가(테스트용) */
  get lightsOffDeferred(): boolean {
    return this.lightsOffPending !== null
  }

  /** 화면에 남아 있는 캐릭터 수(퇴장 중 포함) */
  get visibleCount(): number {
    return this.chars.size + this.departing.length
  }

  dispatch(outs: readonly DirectorOutput[]): void {
    for (const cmd of outs) {
      if (!isCharacterCommand(cmd)) {
        if (cmd.type === 'lights') {
          if (cmd.on) {
            this.lightsOffPending = null
            this.onScene(cmd)
          } else {
            this.lightsOffPending = cmd
            // 보고 후 머무는 서브가 조명 끄기를 3초 붙잡지 않도록 머묾을 끊는다
            for (const c of this.departing) c.hurryLeave()
          }
        } else {
          this.onScene(cmd)
        }
        continue
      }
      let ch = this.chars.get(cmd.agentId)
      switch (cmd.type) {
        case 'spawn':
        case 'place':
          if (ch === undefined) {
            ch = new Character(cmd.agentId, this.createView(cmd.variant, cmd.accessory ?? 'none'))
            ch.setHighlight(this.highlight === cmd.agentId)
            if (cmd.partner !== undefined && this.createPartner !== null) {
              ch.attachPartner(new Partner(cmd.partner, this.createPartner(cmd.partner)))
            }
            this.chars.set(cmd.agentId, ch)
          }
          ch.enqueue(cmd)
          break
        case 'remove':
          if (ch !== undefined) {
            ch.destroy()
            this.chars.delete(cmd.agentId)
          }
          break
        case 'leave':
          if (ch !== undefined) {
            ch.enqueue(cmd)
            this.chars.delete(cmd.agentId)
            this.departing.push(ch)
          }
          break
        default:
          ch?.enqueue(cmd)
      }
    }
    this.flushLights()
  }

  private flushLights(): void {
    if (this.lightsOffPending === null || this.departing.length > 0) return
    const cmd = this.lightsOffPending
    this.lightsOffPending = null
    this.onScene(cmd)
  }

  update(dtMs: number): void {
    for (const c of this.chars.values()) c.update(dtMs)
    if (this.departing.length > 0) {
      for (const c of this.departing) c.update(dtMs)
      const gone = this.departing.filter((c) => c.isGone)
      for (const c of gone) c.destroy()
      if (gone.length > 0) this.departing = this.departing.filter((c) => !c.isGone)
    }
    this.flushLights()
  }

  /** 퇴장 중 캐릭터를 즉시 제거(상태로 다시 맞출 때) */
  clearDeparting(): void {
    for (const c of this.departing) c.destroy()
    this.departing = []
    this.flushLights()
  }

  setHighlight(id: string | null): void {
    if (id === this.highlight) return
    if (this.highlight !== null) this.chars.get(this.highlight)?.setHighlight(false)
    this.highlight = id
    if (id !== null) this.chars.get(id)?.setHighlight(true)
  }

  destroy(): void {
    for (const c of this.chars.values()) c.destroy()
    this.chars.clear()
    this.clearDeparting()
  }
}
