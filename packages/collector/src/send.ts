import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { DEFAULT_HOST, DEFAULT_PORT, PATHS } from '@claude-office/shared'

export const DEFAULT_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}${PATHS.events}`
export const SEND_TIMEOUT_MS = 500

export type SendResult = { ok: true; status: number } | { ok: false; error: string }

/**
 * JSON 바디를 POST 한다. 응답 상태 코드만 기다리고 본문은 읽지 않는다.
 * 연결 실패·타임아웃·잘못된 URL 은 throw 하지 않고 `{ ok: false }`.
 * fetch 대신 node:http 를 쓰는 이유: 훅은 매번 새 프로세스라 시작 비용이 작아야 한다.
 */
export function postJson(
  url: string,
  body: string,
  timeoutMs: number = SEND_TIMEOUT_MS,
): Promise<SendResult> {
  return new Promise((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const finish = (r: SendResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(r)
    }

    let target: URL
    try {
      target = new URL(url)
    } catch {
      finish({ ok: false, error: `invalid url: ${url}` })
      return
    }
    const request =
      target.protocol === 'https:' ? httpsRequest : target.protocol === 'http:' ? httpRequest : null
    if (!request) {
      finish({ ok: false, error: `unsupported protocol: ${target.protocol}` })
      return
    }

    const req = request(
      target,
      {
        method: 'POST',
        agent: false,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume()
        finish({ ok: true, status: res.statusCode ?? 0 })
      },
    )
    req.on('error', (err) => finish({ ok: false, error: err.message }))
    timer = setTimeout(() => {
      req.destroy()
      finish({ ok: false, error: `timeout after ${timeoutMs}ms` })
    }, timeoutMs)
    req.end(body)
  })
}
