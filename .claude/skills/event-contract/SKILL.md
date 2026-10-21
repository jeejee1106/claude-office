---
name: event-contract
description: "Claude Office의 이벤트 계약(packages/shared의 OfficeEvent, ToolCategory, WS 메시지, OfficeState 리듀서)을 정의·변경·사용하는 규칙. collector·server·web 어느 쪽이든 이벤트를 만들거나 읽는 코드를 작성할 때, 새 이벤트 종류·필드·도구 분류를 추가할 때, 스키마 버전을 올릴 때 반드시 사용한다. 훅 설치 방법 자체는 claude-code-hooks, 씬 애니메이션은 pixel-office-scene을 사용한다."
---

# 이벤트 계약 (packages/shared)

Claude Office는 세 모듈이 하나의 계약으로 이어진다.

```
Claude Code 훅 ──stdin JSON──▶ collector ──POST /events (OfficeEvent)──▶ server
                                                                          │ reduce(state, event)
                                                     web ◀──WS (ServerMessage)──┘
```

모든 경계 버그는 이 계약이 코드 여러 곳에 중복 정의될 때 생긴다. 그래서 **계약은 `packages/shared` 한 곳에만 정의하고, 나머지는 import만 한다.**

## 1. 위치와 구성

```
packages/shared/src/
├── event.ts        # OfficeEvent zod 스키마 + 타입 (z.infer)
├── tools.ts        # 도구 이름 → ToolCategory 매핑 함수 categorizeTool()
├── messages.ts     # ServerMessage(WS) 스키마: snapshot | event | heartbeat
├── state.ts        # OfficeState 타입 + 순수 함수 reduce(state, event)
└── index.ts
```

- 타입은 반드시 zod 스키마에서 `z.infer`로 얻는다. 손으로 쓴 interface와 스키마가 따로 놀면 런타임 검증과 타입이 어긋난다.
- `reduce`를 shared에 두는 이유: 서버(실제 상태)와 웹(낙관적 갱신·리플레이)이 같은 로직을 쓰게 하기 위해서다.

## 2. OfficeEvent 기본 형태

정확한 필드 목록과 종류별 의미는 `references/event-catalog.md`를 읽는다. 핵심 원칙만 요약한다.

- 공통 필드: `v`(스키마 버전), `id`(이벤트 고유 ID), `ts`(ISO 문자열), `sessionId`, `agentId`(메인은 `"main"`, 서브에이전트는 Claude Code가 준 ID), `parentAgentId?`, `kind`
- `kind`는 점 표기 소문자: `session.start`, `tool.start`, `agent.spawn` …
- 도구 관련 이벤트는 `tool: { name, category, target?, useId? }`를 가진다. `target`은 화면 표시용 짧은 요약(파일 basename, 명령 첫 단어)이며 원문이 아니다.

## 3. 변경 규칙

| 변경 | 허용 방법 | 이유 |
| --- | --- | --- |
| 새 optional 필드 | 그대로 추가 | 구버전 소비자는 무시한다 |
| 새 `kind` / 새 `ToolCategory` 값 | 추가 + 소비자는 모르는 값을 무시하도록 이미 구현되어 있어야 함 | 사용자가 훅·서버·웹 버전을 섞어 쓴다 |
| 필수 필드 추가, 의미 변경, 삭제, 이름 변경 | `v` 증가 + 서버에서 이전 버전 변환기 제공 | 이미 설치된 훅이 옛 형식을 계속 보낸다 |

변경 절차(office-architect만 수행):
1. `packages/shared` 수정 + 스키마 단위 테스트 추가
2. `references/event-catalog.md` 갱신 (이 문서가 사람이 읽는 명세다)
3. `_workspace/01_architect_contract-diff.md`에 변경 내용과 소비자별 영향(collector/server/web/문서)을 적는다
4. `pnpm -r typecheck`로 소비자 쪽 컴파일 오류를 확인해 영향 범위를 확정한다

## 4. 소비자 규칙 (collector / server / web 공통)

- 이벤트를 만들 때: `OfficeEvent.parse()`로 직접 검증하고 보낸다. 잘못된 이벤트를 보내는 것보다 버리는 편이 낫다.
- 이벤트를 받을 때: `safeParse` 후 실패하면 버리고 경고 로그. 모르는 `kind`는 무시(default 분기에서 throw 금지).
- `as OfficeEvent`, `any`, 제네릭 단언으로 검증을 건너뛰지 않는다. 경계 버그를 컴파일러가 못 잡는 대표 원인이다.
- 필드명은 camelCase. Claude Code 훅 입력(snake_case)은 collector에서 한 번만 변환한다.

## 5. 개인정보 규칙

계약에 다음을 담는 필드를 만들지 않는다: 파일 내용, diff, 명령 출력, 프롬프트·응답 원문, 환경 변수, 절대 경로(홈 디렉터리 노출). 시각화에는 "무엇을 하고 있는가"만 필요하다.
