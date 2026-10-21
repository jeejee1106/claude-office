// 훅은 도구 호출마다 새 프로세스로 뜬다. tsx 로 매번 TS 를 변환하면 느리므로
// 의존성(shared, zod)까지 묶은 단일 ESM 파일을 만든다.
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = fileURLToPath(new URL('.', import.meta.url))

export const ENTRIES = [
  ['src/hook.ts', 'dist/claude-office-hook.js'],
  ['src/cli.ts', 'dist/claude-office.js'],
]

export async function buildAll() {
  for (const [entry, outfile] of ENTRIES) {
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
      banner: { js: '#!/usr/bin/env node' },
      logLevel: 'warning',
    })
    chmodSync(join(here, outfile), 0o755)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await buildAll()
}
