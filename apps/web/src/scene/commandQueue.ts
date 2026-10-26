import type { CharacterCommand } from './commands'

/*
 * 캐릭터별 대기 명령 큐(순수). 도구 호출은 초당 여러 번 오므로 전부 재생하면 화면이 실제보다
 * 수십 초 뒤처진다. 대기 명령이 MAX_QUEUE 를 넘으면 중간의 "버려도 되는" 명령(moveTo/act)을
 * 오래된 것부터 버린다. 마지막 명령(최종 목표)과 spawn/place/leave/remove 는 버리지 않는다.
 * mark·label·partner 는 큐를 거치지 않는다(Character 가 즉시 적용).
 */

export const MAX_QUEUE = 3

export type QueuedCommand = Exclude<
  CharacterCommand,
  { type: 'mark' } | { type: 'label' } | { type: 'partner' }
>

const droppable = (c: QueuedCommand) => c.type === 'moveTo' || c.type === 'act'

export class CommandQueue {
  private items: QueuedCommand[] = []
  /** items 와 같은 순서의 넣은 시각(캐릭터 시계 ms) */
  private times: number[] = []

  get length(): number {
    return this.items.length
  }

  peekAll(): readonly QueuedCommand[] {
    return this.items
  }

  /** 가장 오래 기다린 명령을 넣은 시각. 비어 있으면 null */
  oldestAt(): number | null {
    return this.times[0] ?? null
  }

  clear(): void {
    this.items = []
    this.times = []
  }

  push(cmd: QueuedCommand, at = 0): void {
    this.items.push(cmd)
    this.times.push(at)
    while (this.items.length > MAX_QUEUE) {
      // 마지막(최신) 항목은 보존하고, 그 앞에서 가장 오래된 버릴 수 있는 명령을 찾는다.
      if (!this.dropOne()) break
    }
  }

  /**
   * 밀렸을 때: 마지막(최신) 명령과 spawn/leave 등 버릴 수 없는 명령만 남긴다.
   * 남은 명령의 대기 시각은 at 으로 갱신한다(방금 따라잡았으므로 연속 스킵 방지).
   */
  compactToLast(at: number): void {
    let dropped = this.dropOne()
    while (dropped) dropped = this.dropOne()
    this.times = this.times.map(() => at)
  }

  /**
   * 다음 실행할 명령. soft 명령은 뒤에 다른 명령이 있으면 건너뛴다
   * (도구 사이 "자기 책상 복귀"는 바로 다음 도구가 있으면 재생할 필요가 없다).
   */
  shift(): QueuedCommand | undefined {
    for (;;) {
      const next = this.items.shift()
      this.times.shift()
      if (next === undefined) return undefined
      if (next.type === 'moveTo' && next.soft && this.items.length > 0) continue
      return next
    }
  }

  private dropOne(): boolean {
    const idx = this.items.findIndex((c, i) => i < this.items.length - 1 && droppable(c))
    if (idx < 0) return false
    this.items.splice(idx, 1)
    this.times.splice(idx, 1)
    return true
  }
}
