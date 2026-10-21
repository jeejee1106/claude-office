# ADR 0001: 공유 계약을 TS 소스로 소비하고, 비활성 처리는 서버 생성 이벤트로 반영한다

- 상태: 채택 (2026-10-21)
- 범위: packages/shared, apps/server, apps/web

## 맥락

`packages/shared`(OfficeEvent, ServerMessage, OfficeState, reduce)는 Node 서버(tsx 실행)와 Vite 웹 양쪽에서 import된다. 또 서버는 에이전트 비활성(60초)·세션 만료(30분)를 상태에 반영해야 하는데, 웹도 같은 `reduce`로 상태를 따라가야 한다.

## 결정

1. **shared는 빌드하지 않고 TS 소스를 직접 소비한다.** `package.json`의 `exports`가 `./src/index.ts`를 가리키고, 소비자는 `"@claude-office/shared": "workspace:*"`로 의존한다. 루트 `tsconfig.base.json`은 `moduleResolution: "Bundler"`(확장자 없는 상대 import)로 통일한다. tsx·Vite·vitest가 모두 이 방식을 그대로 처리한다.
2. **비활성 처리는 순수 함수 `idleSweep(state, now) → OfficeEvent[]`로 만든다.** 서버 hub가 주기적으로 호출하고, 결과 이벤트(`agent.idle`, `session.end{reason:'timeout'}`)를 일반 이벤트와 똑같이 `reduce`하고 WS로 브로드캐스트한다. 웹은 `idleSweep`을 호출하지 않는다.

## 근거

- (1) 빌드 단계·`dist` 감시·소스맵 문제 없이 shared 수정이 서버(tsx watch)와 웹(Vite HMR)에 바로 반영된다. 계약 패키지가 private이라 배포용 JS가 필요 없다.
- (2) 상태 변경 경로가 `reduce` 하나로 유지되어 서버 상태와 웹 상태가 갈라지지 않는다. 웹에서 시계를 돌리면 서버와 시계가 달라 상태가 어긋난다.

## 결과·제약

- shared는 plain `node`로 직접 실행할 수 없다. 서버는 개발 중 tsx로 실행하고, `npx claude-office` 배포 단계(이번 범위 밖)에서는 서버를 esbuild/tsup 등으로 **번들**해 shared를 포함시켜야 한다.
- shared 소스는 DOM·Node 전용 API를 쓰지 않는다(양쪽 런타임 공용).
- `agent.idle`은 OfficeEvent의 kind지만 서버만 생성한다. 기록 파일(`--record`)에는 외부 수신 이벤트만 남기고, 리플레이 시 서버가 다시 생성한다.
