import { type IngestResponse, OfficeEvent, PATHS } from '@claude-office/shared'
import type { FastifyInstance } from 'fastify'
import type { Hub } from './hub'
import { isAllowedOrigin } from './origin'
import { firstIssue } from './replay'

export const BODY_LIMIT = 64 * 1024
export const MAX_BATCH = 100

const brief = (v: unknown): string | undefined =>
  typeof v === 'string' ? v.slice(0, 64) : undefined

/** POST /events — OfficeEvent 하나 또는 배열(항목별 safeParse). */
export function registerIngest(app: FastifyInstance, hub: Hub): void {
  app.post(PATHS.events, { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    // 브라우저에서 온 요청은 localhost 계열 출처만 받는다(collector 는 Origin 을 보내지 않는다).
    if (!isAllowedOrigin(req.headers.origin)) {
      return reply.code(403).send({ error: 'origin not allowed' })
    }

    const body: unknown = req.body
    const res: IngestResponse = { accepted: 0, duplicates: 0, rejected: [] }

    if (Array.isArray(body) && body.length > MAX_BATCH) {
      res.rejected.push({
        index: MAX_BATCH,
        error: `batch too large: ${body.length} events (max ${MAX_BATCH})`,
      })
      return reply.code(400).send(res)
    }
    if (body === null || typeof body !== 'object') {
      res.rejected.push({ index: 0, error: 'expected an OfficeEvent object or an array of them' })
      return reply.code(400).send(res)
    }

    const items: unknown[] = Array.isArray(body) ? body : [body]
    items.forEach((item, index) => {
      const parsed = OfficeEvent.safeParse(item)
      if (!parsed.success) {
        const error = firstIssue(parsed.error.issues)
        res.rejected.push({ index, error })
        // 바디 원문은 로그에 남기지 않는다: id·kind·첫 이슈만.
        const rec =
          item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {}
        req.log.warn({ index, id: brief(rec.id), kind: brief(rec.kind), error }, 'event rejected')
        return
      }
      if (hub.ingest(parsed.data, 'external') === 'accepted') res.accepted++
      else res.duplicates++
    })

    const ok = items.length === 0 || res.accepted + res.duplicates > 0
    return reply.code(ok ? 202 : 400).send(res)
  })
}
