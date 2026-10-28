// 훅은 도구 호출마다 새 프로세스로 뜬다. tsx 로 매번 TS 를 변환하면 느리므로
// 의존성(shared, zod)까지 묶은 단일 ESM 파일을 만든다.
// claude-office.js(서버 실행 + install/uninstall)에는 서버(@claude-office/server)까지 묶는다.
// 훅 번들(claude-office-hook.js)에는 서버 코드가 들어가면 안 된다(src/hook.ts 는 서버를 import 하지 않는다).
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = fileURLToPath(new URL('.', import.meta.url))

const SHEBANG = '#!/usr/bin/env node'
// fastify·pino 등 CJS 의존성이 ESM 번들 안에서 Node 내장 모듈을 require() 하므로 진짜 require 를 만들어 둔다.
// (없으면 esbuild 의 __require 가 "Dynamic require of \"events\" is not supported" 로 실패한다)
const CJS_SHIM = [
  "import { createRequire as __coCreateRequire } from 'node:module';",
  'const require = __coCreateRequire(import.meta.url);',
].join('\n')

export const ENTRIES = [
  { entry: 'src/hook.ts', outfile: 'dist/claude-office-hook.js', server: false },
  { entry: 'src/cli.ts', outfile: 'dist/claude-office.js', server: true },
]

export async function buildAll() {
  for (const { entry, outfile, server } of ENTRIES) {
    await build({
      absWorkingDir: here,
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      minify: true,
      legalComments: 'none',
      banner: { js: server ? `${SHEBANG}\n${CJS_SHIM}` : SHEBANG },
      // ws 의 선택 의존(네이티브 가속)은 없으면 ws 가 알아서 건너뛴다.
      external: server ? ['bufferutil', 'utf-8-validate'] : [],
      logLevel: 'warning',
    })
    chmodSync(join(here, outfile), 0o755)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildAll()
}
