import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type HealthResponse,
  type IdleThresholds,
  PATHS,
  SCHEMA_VERSION,
  type ServerMessage,
} from '@claude-office/shared'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { Hub } from './hub'
import { BODY_LIMIT, registerIngest } from './ingest'
import { isAllowedOrigin } from './origin'
import { Recorder } from './recorder'

export interface BuildAppOptions {
  /** 현재 시각(epoch ms). idleSweep·heartbeat·snapshot.ts 에 쓰인다. */
  now?: () => number
  /** idleSweep 주기 (기본 5000ms). 0 이면 타이머를 돌리지 않는다(테스트에서 hub.sweep() 직접 호출). */
  sweepIntervalMs?: number
  /** heartbeat 주기 (기본 15000ms). 0 이면 보내지 않는다. */
  heartbeatMs?: number
  idle?: Partial<IdleThresholds>
  /** 지정 시 외부 수신 이벤트를 JSONL 로 추가 기록 */
  recordFile?: string
  /** 빌드된 web 경로. 기본 apps/web/dist. false 면 정적 서빙 안 함. 디렉터리가 없으면 안내 텍스트. */
  webDistDir?: string | false
  logger?: FastifyServerOptions['logger']
}

declare module 'fastify' {
  interface FastifyInstance {
    hub: Hub
  }
}

const here = fileURLToPath(new URL('.', import.meta.url))
export const DEFAULT_WEB_DIST = join(here, '../../web/dist')

export const SERVER_VERSION: string = (() => {
  try {
    const pkg: unknown = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'))
    if (pkg && typeof pkg === 'object' && 'version' in pkg && typeof pkg.version === 'string') {
      return pkg.version
    }
  } catch {
    // 아래 기본값
  }
  return '0.0.0'
})()

/** 느린 소켓이 이만큼 이상 쌓이면 끊는다(재접속 시 snapshot 으로 복원된다). */
const MAX_BUFFERED = 4 * 1024 * 1024

const NO_WEB_TEXT = `Claude Office server is running.
The web UI is not built. Run \`pnpm --filter @claude-office/web build\` and restart,
or use the dev server: \`pnpm --filter @claude-office/web dev\` → http://localhost:5173
`

/** buildApp 의 webDistDir 옵션을 실제 경로로 푼다. undefined → DEFAULT_WEB_DIST, false → false. */
export function resolveWebDist(dir: string | false | undefined): string | false {
  return dir === undefined ? DEFAULT_WEB_DIST : dir
}

/** buildApp 이 이 경로로 빌드된 web 을 서빙하는지(index.html 이 있는지). */
export function hasWebDist(dir: string | false): dir is string {
  return dir !== false && dir !== '' && existsSync(join(dir, 'index.html'))
}

/** Fastify 인스턴스를 만든다. 포트는 열지 않는다(테스트는 app.inject 사용). */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const now = opts.now ?? Date.now
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: BODY_LIMIT, // 요청 로그는 info 레벨이라 CLI(warn)에서는 나오지 않는다
  })

  const recorder = opts.recordFile ? new Recorder(opts.recordFile) : undefined
  const hub = new Hub({
    now,
    ...(opts.idle ? { idle: opts.idle } : {}),
    onAccepted: recorder
      ? (event, origin) => {
          if (origin === 'external') recorder.write(event)
        }
      : undefined,
  })
  app.decorate('hub', hub)

  await app.register(fastifyWebsocket, { options: { maxPayload: 4096 } })

  registerIngest(app, hub)

  app.get(PATHS.state, async () => hub.getState())

  app.get(
    PATHS.health,
    async (): Promise<HealthResponse> => ({
      ok: true,
      version: SERVER_VERSION,
      schema: SCHEMA_VERSION,
    }),
  )

  app.get(
    PATHS.ws,
    {
      websocket: true,
      // 업그레이드 전에 거부한다(HTTP 403).
      preValidation: async (req, reply) => {
        if (!isAllowedOrigin(req.headers.origin)) {
          await reply.code(403).send({ error: 'origin not allowed' })
        }
      },
    },
    (socket) => {
      const send = (msg: ServerMessage) => {
        if (socket.readyState !== socket.OPEN) throw new Error('socket not open')
        if (socket.bufferedAmount > MAX_BUFFERED) {
          socket.close(1013, 'slow consumer')
          throw new Error('slow consumer')
        }
        socket.send(JSON.stringify(msg))
      }
      const unsubscribe = hub.subscribe(send)
      socket.on('close', unsubscribe)
      socket.on('error', unsubscribe)
      // 클라이언트 메시지는 무시한다.
    },
  )

  const webDist = resolveWebDist(opts.webDistDir)
  if (hasWebDist(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' })
  } else {
    app.get('/', async (_req, reply) => reply.type('text/plain; charset=utf-8').send(NO_WEB_TEXT))
  }

  const timers: ReturnType<typeof setInterval>[] = []
  const sweepMs = opts.sweepIntervalMs ?? 5000
  const heartbeatMs = opts.heartbeatMs ?? 15000
  if (sweepMs > 0) timers.push(setInterval(() => hub.sweep(), sweepMs))
  if (heartbeatMs > 0) timers.push(setInterval(() => hub.heartbeat(), heartbeatMs))
  for (const t of timers) t.unref?.()

  app.addHook('onClose', async () => {
    for (const t of timers) clearInterval(t)
    await recorder?.close()
  })

  return app
}
