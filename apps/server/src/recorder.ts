import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { dirname } from 'node:path'
import type { OfficeEvent } from '@claude-office/shared'

/** 외부에서 수신해 수용된 이벤트를 JSONL 로 추가 기록한다(--record). */
export class Recorder {
  private readonly stream: WriteStream

  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true })
    this.stream = createWriteStream(file, { flags: 'a', encoding: 'utf8' })
    this.stream.on('error', (err) => {
      console.error(`[record] ${file} 쓰기 실패: ${err.message}`)
    })
  }

  write(event: OfficeEvent): void {
    this.stream.write(`${JSON.stringify(event)}\n`)
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.stream.end(() => resolve())
    })
  }
}
