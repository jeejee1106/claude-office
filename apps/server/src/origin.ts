const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Origin 헤더 검사. 없으면(비브라우저 클라이언트) 허용, 있으면 localhost 계열(포트 무관)만 허용.
 * 악성 웹페이지가 로컬 WS 를 엿보거나 이벤트를 위조하는 것을 막는다.
 */
export function isAllowedOrigin(origin: string | string[] | undefined): boolean {
  if (origin === undefined) return true
  if (Array.isArray(origin)) return false
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return LOCAL_HOSTNAMES.has(url.hostname)
  } catch {
    return false
  }
}

export function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host)
}
