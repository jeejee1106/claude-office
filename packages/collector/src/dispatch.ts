import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `claude-office` 첫 인자로 할 일을 정한다(부수 효과 없음 → 단위 테스트 대상).
 * - 인자 없음, 또는 `-` 로 시작하는 서버 옵션(`--port 7444` 등) → 서버 + 화면 실행
 * - `help` / `--help` / `-h` → 전체 도움말
 * - `install` / `uninstall` → 훅 설치·제거
 * - 그 밖의 단어 → 알 수 없는 명령
 */
export type Dispatch =
  | { kind: 'server'; args: string[] }
  | { kind: 'help' }
  | { kind: 'install' | 'uninstall'; args: string[] }
  | { kind: 'unknown'; command: string }

export function dispatch(argv: readonly string[]): Dispatch {
  const [command, ...rest] = argv
  // `--` 단독은 pnpm 등이 끼워 넣는 구분자일 뿐이라 서버 옵션으로 넘긴다(서버가 걸러 낸다).
  if (command === undefined) return { kind: 'server', args: [] }
  if (command === 'help' || command === '--help' || command === '-h') return { kind: 'help' }
  if (command === 'install' || command === 'uninstall') return { kind: command, args: rest }
  if (command.startsWith('-')) return { kind: 'server', args: [...argv] }
  return { kind: 'unknown', command }
}

/**
 * 빌드된 웹 화면(apps/web/dist) 경로.
 * 번들(packages/collector/dist/claude-office.js)과 소스(packages/collector/src/cli.ts) 모두
 * 저장소 루트에서 세 단계 아래이므로 같은 상대 경로로 찾는다.
 * 없더라도 이 경로를 그대로 넘겨 서버가 "web UI not built" 안내를 하게 한다.
 */
export function webDistDir(moduleUrl: string): string {
  const here = dirname(fileURLToPath(moduleUrl))
  return join(here, '..', '..', '..', 'apps', 'web', 'dist')
}
