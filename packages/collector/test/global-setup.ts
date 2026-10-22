import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** 프로세스 단위 테스트(hook·cli)가 쓰는 dist/ 번들을 먼저 만든다. */
export default function setup(): void {
  const root = fileURLToPath(new URL('..', import.meta.url))
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'inherit' })
}
