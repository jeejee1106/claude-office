---
name: claude-code-hooks
description: "Claude Code의 훅(PreToolUse, PostToolUse, SubagentStart/Stop, SessionStart/End, UserPromptSubmit, Stop, Notification, PreCompact 등)으로 Claude Code의 행동을 수집하는 collector 패키지 구현 방법. 훅 페이로드 확인, settings.json 훅 등록·제거, 훅 스크립트의 지연·실패 처리, 서브에이전트 식별을 다룰 때 사용한다. 이벤트 스키마 자체를 바꾸는 일은 event-contract를 사용한다."
---

# Claude Code 훅 수집기 (packages/collector)

## 1. 왜 훅인가

Claude Code는 도구 실행 전후, 세션 시작·종료, 서브에이전트 시작·종료 등에 사용자가 등록한 명령을 실행하고 stdin으로 JSON을 넘긴다. Claude Office는 이 훅에 `claude-office-hook`을 등록해 행동을 포착한다. 트랜스크립트(JSONL) 감시는 훅으로 얻을 수 없는 정보가 있을 때만 보조 수단으로 쓴다 — 형식이 비공개라 더 자주 깨지기 때문이다.

## 2. 확인 절차 (구현 전에 반드시)

훅 이름·입력 필드·설정 형식은 Claude Code 버전에 따라 바뀐다. 기억에 의존해 구현하지 않는다.

1. **공식 문서 확인**: `claude-code-guide` 에이전트(또는 공식 hooks 문서)에 "현재 버전의 훅 이벤트 목록, 각 이벤트의 stdin JSON 필드, settings.json 훅 등록 형식, 서브에이전트 안에서 실행된 도구 훅이 agent를 식별하는 필드"를 질문한다.
2. **실제 캡처**: 아무 처리 없이 stdin을 파일로 저장하는 임시 훅을 등록하고, 실제 세션에서 Read/Edit/Bash/서브에이전트 생성을 한 번씩 일으켜 페이로드를 캡처한다. 캡처는 프로젝트 밖 스크래치 경로에 둔다.
3. 민감정보(경로의 사용자명, 파일 내용, 프롬프트)를 지운 뒤 `packages/collector/test/fixtures/{hook_event_name}.json`으로 저장한다. 이것이 정규화 테스트의 입력이다.
4. 문서와 캡처가 다르면 캡처를 따르고, 차이를 `_workspace/02_hook-integrator_summary.md`에 적는다.

확인한 사실은 `references/hook-notes.md`에 날짜·Claude Code 버전과 함께 누적한다. 다음 작업자가 같은 조사를 반복하지 않게 하기 위해서다.

## 3. 훅 스크립트 규칙

| 규칙 | 구현 | 이유 |
| --- | --- | --- |
| 항상 성공 종료 | 모든 경로에서 `exit 0`, stdout 출력 없음 | PreToolUse 훅의 종료 코드·출력은 도구 실행을 막거나 결정에 영향을 줄 수 있다 |
| 빠르게 끝냄 | 전송 타임아웃 기본 500ms, 응답 본문을 기다리지 않음 | 모든 도구 호출마다 실행되므로 지연이 그대로 사용자 체감 지연이 된다 |
| 서버 없음 = 무시 | 연결 실패 시 조용히 종료 (`CLAUDE_OFFICE_DEBUG=1`일 때만 stderr 로그) | 대시보드를 안 켠 날에도 Claude Code는 정상이어야 한다 |
| 가벼운 시작 | 의존성 최소, 번들된 단일 JS(Node) 파일 | 훅마다 프로세스가 새로 뜬다 |
| 정규화는 순수 함수 | `normalize(hookInput, ctx): OfficeEvent \| null` | fixture로 단위 테스트할 수 있어야 한다 |

전송 대상: `CLAUDE_OFFICE_URL`(기본 `http://127.0.0.1:7333/events`). 포트 기본값 7333은 shared 상수 `DEFAULT_PORT`로 두고 collector·server·문서가 모두 이 값을 쓴다.

## 4. 정규화 규칙

- snake_case 훅 입력 → camelCase OfficeEvent 변환은 `normalize` 한 곳에서만.
- `tool.target` 만들기: 파일 경로 도구는 `path.basename`, Bash는 명령의 첫 토큰(파이프·`&&` 앞), 검색은 패턴 앞 30자. 그 밖의 `tool_input`은 버린다.
- 도구 분류는 shared의 `categorizeTool()`만 사용한다. collector에 별도 매핑을 만들지 않는다.
- `agentId`: 훅 입력에 서브에이전트 식별 필드가 있으면 사용, 없으면 `"main"`. 서브에이전트 안의 도구 호출을 메인으로 잘못 귀속시키는지 fixture로 반드시 테스트한다.
- 매핑할 수 없는 훅 이벤트는 `null`을 반환하고 아무것도 보내지 않는다.

## 5. 설치·제거 명령

`claude-office install [--project|--user]`:
1. 대상 settings.json을 읽고 **기존 훅을 보존한 채** Claude Office 항목만 추가한다(다른 도구의 훅을 덮어쓰면 사용자 환경을 망가뜨린다).
2. 추가한 항목을 식별할 수 있게 명령 문자열에 `claude-office-hook`을 포함한다 → uninstall은 이 문자열이 있는 항목만 지운다.
3. 쓰기 전에 `.bak` 백업을 만들고, 변경 내용(diff)을 출력한다.
4. 멱등성: 두 번 실행해도 항목이 중복되지 않는다.

## 6. 테스트

- `normalize` 단위 테스트: fixture 전체를 돌려 스냅샷 + `OfficeEvent.parse` 통과 확인
- 지연 테스트: 서버 없이 훅 실행 시 종료까지 시간 측정(목표 < 300ms)과 exit code 0 확인
- install/uninstall: 임시 settings.json(기존 훅 포함)으로 왕복 후 원본과 동일한지 확인
