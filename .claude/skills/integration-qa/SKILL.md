---
name: integration-qa
description: "Claude Office의 모듈 경계 정합성 검증 방법. 훅 페이로드↔collector 정규화, collector 전송↔server 스키마, server WS 메시지↔web 파서, 이벤트 kind·ToolCategory↔씬 매핑 테이블, 씬의 프레임 이름↔에셋 아틀라스, 문서↔실제 명령을 양쪽 코드를 함께 읽어 대조한다. 모듈 완성 직후 점진 QA, 'QA 해줘', '정합성 점검', '전체 감사' 요청 시 사용한다. 단순 코드 스타일 리뷰에는 사용하지 않는다."
---

# 경계 정합성 QA

각 모듈은 따로 테스트하면 통과하지만 연결하면 깨지는 경우가 가장 많다. 이 스킬은 **생산자와 소비자를 함께 읽고 대조**한다.

## 1. 경계 표

| # | 생산자 | 소비자 | 대조할 것 |
| --- | --- | --- | --- |
| B1 | Claude Code 훅 페이로드 (`packages/collector/test/fixtures/`) | `normalize()` | 실제 필드명을 쓰는가, 서브에이전트 도구 호출이 올바른 `agentId`로 가는가, 모든 fixture가 `OfficeEvent.parse` 통과 |
| B2 | collector 전송 코드 | server `POST /events` | URL·메서드·바디 형태(단일/배열)·Content-Type 일치, 서버 down 시 훅이 exit 0으로 빠르게 끝나는가 |
| B3 | server WS 송신 | web `net/socket.ts` | `ServerMessage` 모든 `type`을 웹이 처리하는가, snapshot→syncAll 경로가 있는가 |
| B4 | shared `kind` 목록 · `ToolCategory` | web `activityMap.ts` + `references/activity-mapping.md` | 모든 kind·category에 매핑이 있는가, 표와 코드가 1:1인가, 모르는 값 기본 처리 |
| B5 | `activityMap`/씬 코드의 프레임·애니메이션 이름 | `apps/web/public/assets/*.json` | 참조하는 이름이 아틀라스에 모두 존재하는가 |
| B6 | shared `reduce` | server hub · web store | 둘 다 같은 `reduce`를 import하는가(복제 로직 없음) |
| B7 | `package.json` 스크립트·CLI 옵션 | README·docs | 문서의 모든 명령이 실제로 존재·동작하는가 |
| B8 | 계약 개인정보 규칙 | collector `normalize` | 파일 내용·프롬프트·절대경로·명령 전체가 이벤트에 실리지 않는가 |

모듈 하나를 검증할 때는 그 모듈이 생산자나 소비자로 등장하는 행만 본다. 전체 감사는 모든 행을 본다.

## 2. 절차

1. 대상 모듈의 요약 파일(`_workspace/02_{agent}_summary.md`)을 읽어 바뀐 범위를 파악한다.
2. 해당 경계 행마다 생산자·소비자 파일을 모두 열어 대조한다. 판단 근거는 `파일:줄`로 남긴다.
3. 실행 검증:
   - `pnpm -r typecheck && pnpm -r test`
   - 서버가 뜰 수 있으면: 서버 실행 후 `node .claude/skills/integration-qa/scripts/send-fixture-events.mjs` 로 샘플 세션 전송 → 모든 응답 202, `/api/state` 요약이 기대와 일치하는지 확인 (스크립트 옵션은 파일 상단 주석 참고)
   - B5는 grep으로 코드의 프레임 이름 문자열을 뽑고 아틀라스 JSON 키와 차집합을 낸다.
4. 결과를 `_workspace/03_integration-qa_{module}.md`에 쓴다:

```markdown
# QA: {module} ({날짜})
## 요약: PASS n / FAIL n / 미검증 n
## FAIL
- [B3] web이 `heartbeat`를 처리하지 않아 콘솔 오류 — 생산자 apps/server/src/hub.ts:42, 소비자 apps/web/src/net/socket.ts:30 — 수정 제안: default 분기 무시 처리 — 담당: office-scene-dev
## 미검증
- [B2] 서버 실행 실패(포트 사용 중) — 오류 메시지 …
## PASS
- [B1] …
```

## 3. 판정 기준

- **FAIL**: 실행으로 재현했거나, 양쪽 코드에서 불일치가 명백함
- **미검증**: 환경 문제로 실행 못 함, 또는 근거가 한쪽 코드뿐 → FAIL로 올리지 않는다(거짓 경보가 쌓이면 QA를 무시하게 된다)
- 스타일·취향 지적은 보고서에 넣지 않는다.

## 4. 워크플로 감사에서의 반환 스키마

전체 감사 워크플로에서 경계 하나를 맡으면 다음 JSON을 반환한다.

```json
{ "boundary": "B3", "findings": [ { "title": "...", "producer": "파일:줄", "consumer": "파일:줄", "evidence": "...", "owner": "office-scene-dev" } ] }
```
