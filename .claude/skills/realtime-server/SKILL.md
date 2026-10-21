---
name: realtime-server
description: "Claude Office 로컬 서버(apps/server, Fastify + WebSocket) 구현 규칙. 이벤트 수신 엔드포인트, OfficeState 집계, WS 브로드캐스트·스냅샷, 재접속, 비활성 타임아웃, JSONL 기록·리플레이를 구현하거나 고칠 때 사용한다. 이벤트 형식 변경은 event-contract, 훅 쪽 전송 로직은 claude-code-hooks를 사용한다."
---

# 실시간 서버 (apps/server)

## 1. 구성

```
apps/server/src/
├── index.ts          # CLI 진입점: 포트·호스트 옵션, 웹 정적 파일 서빙
├── app.ts            # buildApp(opts): Fastify 인스턴스 (테스트에서 inject로 사용)
├── ingest.ts         # POST /events
├── hub.ts            # 상태 보관 + 구독자 관리 + 브로드캐스트
├── recorder.ts       # 이벤트 JSONL 기록 (옵션)
└── replay.ts         # JSONL 재생 (개발용)
```

`buildApp`과 `index.ts`를 나누는 이유: 테스트가 실제 포트를 열지 않고 `app.inject()`로 검증할 수 있게 하기 위해서다.

## 2. 엔드포인트

| 경로 | 동작 |
| --- | --- |
| `POST /events` | 단일 이벤트 또는 배열. `OfficeEvent.safeParse` 실패 시 400. 성공 시 202 즉시 응답 |
| `GET /ws` | WebSocket. 접속 직후 `snapshot`, 이후 `event`, 주기적 `heartbeat` |
| `GET /api/state` | 현재 OfficeState (디버그·테스트용) |
| `GET /healthz` | `{ ok: true, version }` — collector가 서버 존재를 확인할 때 |
| `/` | 빌드된 `apps/web` 정적 파일 (`npx claude-office` 한 번으로 실행되도록) |

메시지 형식은 shared의 `ServerMessage`만 사용한다.

## 3. 상태 처리 규칙

- 상태 갱신은 shared의 `reduce(state, event)`만 사용한다. 서버 안에서 상태를 직접 변형하는 코드를 따로 두지 않는다.
- 중복 이벤트(`id` 동일)는 최근 N개 ID 집합으로 무시한다(훅 재시도 대비).
- 순서 뒤바뀜 허용: `tool.end`가 짝 없는 경우, `agent.finish`가 `agent.spawn`보다 먼저 온 경우에도 throw하지 않는다 — 리듀서 테스트로 보장한다.
- 비활성 처리: 일정 시간(기본 60초) 이벤트가 없는 에이전트는 `idle`, 세션이 오래(기본 30분) 조용하면 정리. 타이머는 hub에서 돌리고 결과도 이벤트 형태로 리듀서를 거쳐 반영한다(상태 변경 경로를 하나로 유지).
- 최근 이벤트 링버퍼(기본 500개)를 snapshot에 포함해 새로 연 탭에서도 타임라인이 보이게 한다.

## 4. 보안·운영

- 기본 바인딩 `127.0.0.1`. `--host 0.0.0.0`은 경고 출력 후 허용.
- CORS는 같은 출처만. WS는 Origin 헤더가 localhost 계열인지 확인한다(악성 웹페이지가 로컬 WS를 엿보는 것 방지).
- 요청 바디 크기 제한(예: 64KB).

## 5. 기록·리플레이

- `--record <file>`: 수신 이벤트를 JSONL로 추가 기록.
- `--replay <file> [--speed 4]`: 기록된 `ts` 간격을 배속으로 재현해 hub에 주입. 프런트엔드 개발과 QA가 Claude Code 없이 돌아가게 하는 핵심 기능이다.
- 샘플 세션: `.claude/skills/integration-qa/assets/sample-session.jsonl`을 저장소 `fixtures/`로 복사해 사용할 수 있다.

## 6. 테스트 (vitest)

- `app.inject`로 POST /events: 정상 202, 스키마 위반 400, 배열 처리
- WS: 접속 → snapshot 수신 → 이벤트 POST → event 수신 순서
- 리듀서: 순서 뒤바뀜·중복·타임아웃 시나리오
