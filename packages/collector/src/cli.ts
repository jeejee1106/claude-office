import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DEFAULT_HOST, DEFAULT_PORT } from '@claude-office/shared'
import { dispatch, webDistDir } from './dispatch'
import {
  addOurHooks,
  formatSettings,
  HOOK_EVENTS,
  HOOK_MARKER,
  hookCommand,
  lineDiff,
  removeOurHooks,
  type Settings,
  SettingsFormatError,
} from './settings'

const HELP = `claude-office — Claude Code activity as a pixel-art office

Usage:
  claude-office [server options]   start the server + office screen (default http://127.0.0.1:7333)
  claude-office install   [--project | --user | --settings <file>] [--dry-run]
  claude-office uninstall [--project | --user | --settings <file>] [--dry-run]
  claude-office help

Server options (the screen is served from apps/web/dist; build it with \`pnpm --filter @claude-office/web build\`):
  --port <n>         listen port (default ${DEFAULT_PORT}, env CLAUDE_OFFICE_PORT)
  --host <addr>      bind address (default ${DEFAULT_HOST}; non-loopback prints a warning)
  --record <file>    append every received event to a JSONL file
  --replay <file>    replay a recorded JSONL session into the server
  --speed <n>        replay speed multiplier (default 4)
  --loop             repeat the replay forever (each run is a new session)

Install targets:
  --user             ~/.claude/settings.json (default; every Claude Code session; honors CLAUDE_CONFIG_DIR)
  --project          ./.claude/settings.json (this project only; this file is usually committed)
  --settings <file>  any settings.json path

install   adds a "${HOOK_MARKER}" command hook to ${HOOK_EVENTS.length} events, keeping your other hooks.
uninstall removes only hook entries whose command contains "${HOOK_MARKER}".
Both write <file>.bak before changing anything and print the diff. Running twice is safe.

Hook env: CLAUDE_OFFICE_URL (default http://127.0.0.1:7333/events), CLAUDE_OFFICE_DEBUG=1, CLAUDE_OFFICE_DISABLE=1
`

class CliError extends Error {}

function resolveTarget(values: { user?: boolean; project?: boolean; settings?: string }): string {
  const picked = [values.user, values.project, values.settings !== undefined].filter(Boolean)
  if (picked.length > 1) throw new CliError('choose only one of --project, --user, --settings')
  // `pnpm --filter … exec` 등으로 실행되면 cwd 가 패키지 디렉터리가 되므로 INIT_CWD 를 우선한다.
  const cwd = process.env.INIT_CWD ?? process.cwd()
  if (values.settings !== undefined) return resolve(cwd, values.settings)
  if (values.project) return join(cwd, '.claude', 'settings.json')
  // 기본값은 전역: 한 번 설치로 어느 폴더의 Claude Code 세션이든 사무실에 보이게 하고,
  // 커밋되는 프로젝트 settings.json 을 건드려 다른 기여자에게 훅이 퍼지는 일을 피한다.
  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(configDir, 'settings.json')
}

/** 번들(dist/claude-office.js) 옆의 dist/claude-office-hook.js. 소스(tsx)에서 실행하면 ../dist 를 본다. */
function hookScriptPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, `${HOOK_MARKER}.js`),
    join(here, '..', 'dist', `${HOOK_MARKER}.js`),
  ]
  const found = candidates.find((p) => existsSync(p))
  if (!found) {
    throw new CliError(
      `hook script not found (${candidates[0]}). Run \`pnpm --filter @claude-office/collector build\` first.`,
    )
  }
  return resolve(found)
}

function readSettings(file: string): { text: string; settings: Settings } {
  if (!existsSync(file)) return { text: '', settings: {} }
  const text = readFileSync(file, 'utf8')
  if (text.trim() === '') return { text, settings: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new CliError(
      `${file} is not valid JSON (${err instanceof Error ? err.message : err}); not touching it`,
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError(`${file} must contain a JSON object; not touching it`)
  }
  return { text, settings: parsed as Settings }
}

function writeSettings(file: string, after: string): string | undefined {
  mkdirSync(dirname(file), { recursive: true })
  let backup: string | undefined
  if (existsSync(file)) {
    backup = `${file}.bak`
    copyFileSync(file, backup)
  }
  const tmp = `${file}.claude-office.tmp`
  writeFileSync(tmp, after)
  renameSync(tmp, file)
  return backup
}

async function main(argv: string[]): Promise<number | undefined> {
  const d = dispatch(argv)
  switch (d.kind) {
    case 'help':
      console.log(HELP)
      return 0
    case 'unknown':
      throw new CliError(`unknown command: ${d.command}\n\n${HELP}`)
    case 'install':
    case 'uninstall':
      return installOrUninstall(d.kind, d.args)
    case 'server': {
      // 서버 코드(fastify 등)는 서버를 띄울 때만 초기화한다. 종료 코드·신호 처리는 runServer 가 맡는다.
      const { runServer } = await import('@claude-office/server/run')
      await runServer(d.args, {
        webDistDir: webDistDir(import.meta.url),
        progName: 'claude-office',
      })
      return undefined
    }
  }
}

function installOrUninstall(command: 'install' | 'uninstall', rest: string[]): number {
  let values: { user?: boolean; project?: boolean; settings?: string; 'dry-run'?: boolean }
  try {
    values = parseArgs({
      args: rest.filter((a) => a !== '--'),
      options: {
        user: { type: 'boolean' },
        project: { type: 'boolean' },
        settings: { type: 'string' },
        'dry-run': { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (err) {
    throw new CliError(`${err instanceof Error ? err.message : String(err)}\n\n${HELP}`)
  }

  const file = resolveTarget(values)
  const { text: before, settings } = readSettings(file)

  let next: Settings
  try {
    next =
      command === 'install'
        ? addOurHooks(settings, hookCommand(hookScriptPath()))
        : removeOurHooks(settings).settings
  } catch (err) {
    if (err instanceof SettingsFormatError) {
      throw new CliError(`${file}: ${err.message}; not touching it`)
    }
    throw err
  }

  // 변경 여부는 내용으로 비교한다(원래 파일의 공백 형식 차이만으로 다시 쓰지 않는다).
  const unchanged =
    before.trim() === ''
      ? Object.keys(next).length === 0
      : JSON.stringify(next) === JSON.stringify(settings)
  if (unchanged) {
    console.log(
      command === 'install'
        ? `Claude Office hooks already installed in ${file}. Nothing changed.`
        : `No Claude Office hooks in ${file}. Nothing changed.`,
    )
    return 0
  }

  const after = formatSettings(next)
  const diff = lineDiff(before, after)
  if (values['dry-run']) {
    console.log(`[dry-run] would update ${file}:\n${diff}`)
    return 0
  }
  const backup = writeSettings(file, after)
  console.log(`Updated ${file}${backup ? ` (backup: ${backup})` : ''}:\n${diff}`)
  if (command === 'install') {
    console.log(
      `\nInstalled the Claude Office hook for ${HOOK_EVENTS.length} events. Start the office with \`claude-office\` (in this repo: \`pnpm office\`), open http://${DEFAULT_HOST}:${DEFAULT_PORT}, and use Claude Code as usual.`,
    )
  } else {
    console.log('\nRemoved the Claude Office hooks.')
  }
  return 0
}

try {
  const code = await main(process.argv.slice(2))
  if (code !== undefined) process.exitCode = code
} catch (err) {
  console.error(`claude-office: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
}
