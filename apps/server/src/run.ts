import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { DEFAULT_HOST, DEFAULT_PORT, PATHS } from '@claude-office/shared'
import { buildApp, hasWebDist, resolveWebDist } from './app'
import { isLoopbackHost } from './origin'
import { loadReplayFile, type ReplayHandle, startReplay } from './replay'

export interface RunServerOptions {
  /** 빌드된 web 경로. 생략 시 DEFAULT_WEB_DIST(apps/web/dist). false 면 정적 서빙 안 함. */
  webDistDir?: string | false
  /** 오류 메시지 앞에 붙는 이름 (기본 'claude-office') */
  progName?: string
}

function helpText(): string {
  return `claude-office server

Usage: claude-office [options]

Options:
  --port <n>         listen port (default ${DEFAULT_PORT}, env CLAUDE_OFFICE_PORT)
  --host <addr>      bind address (default ${DEFAULT_HOST}; non-loopback prints a warning)
  --record <file>    append every received event to a JSONL file
  --replay <file>    replay a recorded JSONL session into the server
  --speed <n>        replay speed multiplier (default 4)
  --loop             repeat the replay forever (each run is a new session)
  -h, --help         show this help

Hooks: claude-office install | uninstall   (add/remove the Claude Code hooks)
`
}

const NO_WEB_HINT =
  '  web UI not built: run `pnpm --filter @claude-office/web build` and restart, or use the dev server `pnpm --filter @claude-office/web dev` → http://localhost:5173'

/**
 * 서버 CLI 본체. argv 는 process.argv.slice(2) 형태.
 * 잘못된 인자·포트 사용 중 등은 stderr 에 출력 후 process.exit(1).
 * 서버가 뜨면 resolve 되고, SIGINT/SIGTERM 에서 닫은 뒤 process.exit(0).
 */
export async function runServer(argv: string[], opts: RunServerOptions = {}): Promise<void> {
  const prog = opts.progName ?? 'claude-office'
  const fail = (msg: string): never => {
    console.error(`${prog}: ${msg}`)
    process.exit(1)
  }
  try {
    await run(argv, opts, fail)
  } catch (err) {
    fail(err instanceof Error ? (err.stack ?? err.message) : String(err))
  }
}

async function run(
  argv: string[],
  opts: RunServerOptions,
  fail: (msg: string) => never,
): Promise<void> {
  const HELP = helpText()
  const parse = () =>
    parseArgs({
      args: argv.filter((a) => a !== '--'),
      options: {
        port: { type: 'string' },
        host: { type: 'string' },
        record: { type: 'string' },
        replay: { type: 'string' },
        speed: { type: 'string' },
        loop: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }).values
  let values: ReturnType<typeof parse>
  try {
    values = parse()
  } catch (err) {
    return fail(`${err instanceof Error ? err.message : String(err)}\n\n${HELP}`)
  }
  if (values.help) {
    console.log(HELP)
    return
  }

  const port = Number(values.port ?? process.env.CLAUDE_OFFICE_PORT ?? DEFAULT_PORT)
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`invalid port: ${values.port}`)
  const host = values.host ?? DEFAULT_HOST
  const speed = Number(values.speed ?? 4)
  if (!(speed > 0)) fail(`invalid speed: ${values.speed}`)

  // 루트에서 `pnpm replay` 로 실행하면 cwd 는 apps/server, INIT_CWD 는 루트다.
  const baseDir = process.env.INIT_CWD ?? process.cwd()
  const recordFile = values.record ? resolve(baseDir, values.record) : undefined
  const replayFile = values.replay ? resolve(baseDir, values.replay) : undefined

  let replayEvents: ReturnType<typeof loadReplayFile> | undefined
  if (replayFile) {
    try {
      replayEvents = loadReplayFile(replayFile)
    } catch (err) {
      fail(`cannot read replay file ${replayFile}: ${err instanceof Error ? err.message : err}`)
    }
    if (replayEvents) {
      for (const s of replayEvents.skipped) {
        console.warn(`[replay] skipped line ${s.line}: ${s.error}`)
      }
      if (replayEvents.events.length === 0) fail(`no valid events in ${replayFile}`)
    }
  }

  if (!isLoopbackHost(host)) {
    console.warn(
      `WARNING: binding to ${host}. Your Claude Code activity will be visible to other machines on the network.`,
    )
  }

  const webDist = resolveWebDist(opts.webDistDir)
  const app = await buildApp({
    logger: { level: 'warn' },
    webDistDir: webDist,
    ...(recordFile ? { recordFile } : {}),
  })

  try {
    await app.listen({ port, host })
  } catch (err) {
    await app.close().catch(() => {})
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE') fail(`port ${port} is already in use (try --port <n>)`)
    fail(err instanceof Error ? err.message : String(err))
  }

  const shown = host.includes(':') ? `[${host}]` : host
  const base = `http://${shown}:${port}`
  console.log(`Claude Office server listening on ${base}`)
  if (hasWebDist(webDist)) console.log(`  open: ${base}/`)
  else console.log(NO_WEB_HINT)
  console.log(
    `  events: POST ${base}${PATHS.events}   ws: ${base}${PATHS.ws}   state: ${base}${PATHS.state}`,
  )
  if (recordFile) console.log(`  recording to ${recordFile}`)

  let replay: ReplayHandle | undefined
  if (replayFile && replayEvents) {
    replay = startReplay(app.hub, replayEvents.events, {
      speed,
      loop: values.loop ?? false,
      onRunStart: (n, suffix, count) =>
        console.log(`[replay] run ${n}: ${count} events at ${speed}x (session suffix -${suffix})`),
      onRunEnd: (n) => console.log(`[replay] run ${n} finished`),
    })
  }

  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    replay?.stop()
    await app.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
