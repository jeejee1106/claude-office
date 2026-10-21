import { Character } from './Character'
import { type DirectorOutput, isCharacterCommand } from './commands'
import type { CharacterView } from './render/types'

/*
 * 화면 위 캐릭터 목록(PixiJS 비의존). director 명령을 Character 에 나눠 주고 매 프레임 진행시킨다.
 * OfficeScene 과 테스트(시뮬레이션 시계)가 같은 코드를 쓴다.
 */
export class Roster {
  private readonly createView: (variant: number) => CharacterView
  private readonly onLights: (on: boolean) => void
  readonly chars = new Map<string, Character>()
  /** 퇴장 중(문으로 걷는 중)인 캐릭터 — 같은 ID 가 다시 들어와도 겹치지 않게 분리 */
  departing: Character[] = []
  private highlight: string | null = null

  constructor(createView: (variant: number) => CharacterView, onLights: (on: boolean) => void) {
    this.createView = createView
    this.onLights = onLights
  }

  /** 화면에 남아 있는 캐릭터 수(퇴장 중 포함) */
  get visibleCount(): number {
    return this.chars.size + this.departing.length
  }

  dispatch(outs: readonly DirectorOutput[]): void {
    for (const cmd of outs) {
      if (!isCharacterCommand(cmd)) {
        this.onLights(cmd.on)
        continue
      }
      let ch = this.chars.get(cmd.agentId)
      switch (cmd.type) {
        case 'spawn':
        case 'place':
          if (ch === undefined) {
            ch = new Character(cmd.agentId, this.createView(cmd.variant))
            ch.setHighlight(this.highlight === cmd.agentId)
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
  }

  update(dtMs: number): void {
    for (const c of this.chars.values()) c.update(dtMs)
    if (this.departing.length > 0) {
      for (const c of this.departing) c.update(dtMs)
      const gone = this.departing.filter((c) => c.isGone)
      for (const c of gone) c.destroy()
      if (gone.length > 0) this.departing = this.departing.filter((c) => !c.isGone)
    }
  }

  /** 퇴장 중 캐릭터를 즉시 제거(상태로 다시 맞출 때) */
  clearDeparting(): void {
    for (const c of this.departing) c.destroy()
    this.departing = []
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
