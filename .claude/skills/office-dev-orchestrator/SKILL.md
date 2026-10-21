---
name: office-dev-orchestrator
description: "Claude Office(Claude Code의 행동을 실시간 2D 픽셀 아트 사무실로 시각화하는 웹 대시보드) 개발 하네스의 오케스트레이터. 기능 구현·추가('서브에이전트 입장 애니메이션 만들어줘', '훅 수집기 구현', 'WebSocket 서버', '캐릭터 스프라이트 추가', 'MVP 만들어줘'), 이벤트 스키마 변경, 모듈 간 정합성 점검·전체 감사, 문서 갱신을 요청받으면 사용한다. 이전 결과의 수정, 보완, 다시 실행, 'QA만 다시', '스프라이트만 다시', 'web 쪽만 고쳐줘', 이전 결과를 바탕으로 한 개선 같은 후속 요청에도 사용한다. 한 줄짜리 오타 수정이나 단순 질문에는 사용하지 않고 직접 처리한다."
---

# Claude Office 개발 오케스트레이터

## 실행 모드: 혼합

| 단계 | 실행 모드 | 선택 이유 |
| --- | --- | --- |
| 1. 설계·계약 | 서브에이전트 위임 (office-architect 1회) | 계획과 계약 확정은 결과만 받으면 된다 |
| 2. 구현 | 지속형 에이전트 협업 (필요한 모듈 담당만) | 구현 중 계약 질문·에셋 요청·QA 피드백을 같은 담당자가 맥락을 유지한 채 반영해야 한다 |
| 3. 점진 QA | 서브에이전트 위임 (integration-qa, 모듈 완료마다) | 독립 검증 한 번이면 된다. 검증자는 구현 맥락에 오염되지 않는 편이 낫다 |
| 3'. 전체 감사 (요청 시) | 워크플로 조율 | 경계 목록(B1~B8)이 고정되어 있어 코드로 분산 + 적대적 검증이 가능하다 |
| 4. 문서 | 서브에이전트 위임 (oss-docs-writer) | 확정된 결과를 정리하는 일회성 작업 |

## 에이전트 구성

| 이름(name) | `subagent_type` | 담당 | 스킬 | 주 산출물 |
| --- | --- | --- | --- | --- |
| architect | office-architect | 계획·계약(packages/shared)·ADR | event-contract | `_workspace/01_architect_plan.md` |
| hooks | hook-integrator | packages/collector | claude-code-hooks, event-contract | `_workspace/02_hook-integrator_summary.md` |
| backend | realtime-backend | apps/server | realtime-server, event-contract | `_workspace/02_realtime-backend_summary.md` |
| scene | office-scene-dev | apps/web | pixel-office-scene, event-contract | `_workspace/02_office-scene-dev_summary.md` |
| artist | pixel-artist | packages/assets → apps/web/public/assets | pixel-art-pipeline | `_workspace/02_pixel-artist_summary.md` |
| (단발) | integration-qa | 경계 검증 | integration-qa, event-contract | `_workspace/03_integration-qa_{module}.md` |
| (단발) | oss-docs-writer | README·docs | — | `_workspace/04_oss-docs-writer_summary.md` |

**규모 원칙:** 요청이 건드리는 모듈의 담당만 실행한다. "스프라이트 추가"면 artist + scene, "훅 버그"면 hooks만. MVP·대형 기능일 때만 4명 모두 실행한다.

## 경로 선택 (0단계 직후 반드시 결정)

담당자 수뿐 아니라 **거치는 단계 수도 요청의 위험도에 맞춘다.** 설계 단계와 모듈별 QA는 계약이 흔들릴 때 비싼 재작업을 막기 위한 장치다. 계약이 그대로인 요청에 이 장치를 모두 거치면 대기 시간만 늘고 막아 줄 위험은 없다. 실제로 "서버랑 웹만 먼저" 요청이 설계 → 구현 → 모듈별 QA 2회를 거쳐 약 40분이 걸렸고, 사용자가 "작은 작업인데 왜 오래 걸리냐"고 지적했다.

| 경로 | 조건 | 거치는 단계 |
| --- | --- | --- |
| **경량** | `packages/shared` 계약 변경 없음 + 모듈 1개 (버그 수정, 국소 기능, 에셋 추가, 문서 수정) | 담당 1명이 바로 구현 → 마지막에 QA 1회(그 모듈이 등장하는 경계만) |
| **표준** | 계약 변경 없음 + 모듈 2개 이상 | 담당들 병렬 구현 → 전부 끝난 뒤 통합 QA 1회 |
| **전체** | 계약 변경, 신규 스캐폴딩, 새 모듈 추가 | 1단계(설계) → 2단계(구현) → 3단계(모듈별 QA) → 4단계(문서) |

- 판단 기준은 **계약을 바꾸는지**다. 요청 문장의 크기("작은 거", "MVP")가 아니다. 애매하면 담당 에이전트에게 "계약 변경이 필요하면 구현하지 말고 보고하라"고 지시하고 경량·표준 경로로 시작한다. 계약 변경이 필요하다는 보고가 오면 그때 전체 경로로 올린다. 일단 가볍게 시작하는 편이 대부분의 요청에서 빠르다.
- 경량·표준 경로에서는 1단계(architect)를 생략한다. 요청 원문은 담당 프롬프트에 직접 넣고, `_workspace/00_input/`과 계획 파일은 만들지 않는다.
- 경량·표준 경로의 QA는 **모든 구현이 끝난 뒤 한 번만** 실행한다. 병렬 구현 중에 모듈별 QA를 돌리면 상대 모듈이 미완성이라 경계가 "미검증"으로 남고, 다음 QA가 같은 경계를 다시 검사하게 된다.
- 사용자가 결과를 화면으로 직접 확인할 수 있는 상태라면(로컬 서버 실행 중 등) 담당 에이전트가 직접 화면을 확인하는 것으로 QA를 대신할 수 있다. 이 경우 최종 보고에 "별도 QA 생략"이라고 밝힌다.
- 경로는 시작할 때 사용자에게 한 줄로 알린다. 예: "계약 변경이 없는 웹 단일 모듈 수정이라 경량 경로(담당 1명 + 마지막 QA)로 진행합니다."

## 작업 절차

### 0단계: 기존 작업 확인

1. `_workspace/`를 확인한다.
   - 없음 → 처음부터.
   - 있음 + 이전 결과 일부 수정 요청 → 해당 단계·에이전트만 다시 실행. 이전 산출물 경로를 프롬프트에 넣는다.
   - 있음 + 새 기능 요청 → `_workspace/`를 `_workspace_{YYYYMMDD-HHMM}/`로 옮긴 뒤 새로 시작.
2. 기획서 확인: 요청이 화면에 보이는 동작(공간, 캐릭터 행동, 대사, 연출)을 바꾸면 `docs/product-spec.md`를 먼저 읽는다. 요청이 기획서에 없는 동작이면 기획서에 `요청` 항목으로 먼저 추가하고 사용자에게 한 줄로 알린 뒤 구현을 맡긴다. 기획서가 원하는 기능의 기준이므로, 구현이 기획서보다 앞서 나가면 다음 작업자가 무엇이 의도인지 알 수 없다.
3. 저장소 상태 확인: 모노레포가 아직 없으면(`pnpm-workspace.yaml` 없음) 1단계 계획에 "스캐폴딩"을 첫 작업으로 넣게 한다.
4. 전체 감사 재실행이고 `_workspace/run_meta.json`에 직전 `runId`가 있으면 `resumeFromRunId`로 재개한다.

### 1단계: 설계·계약 확정

**실행 모드:** 서브에이전트 위임

1. 요청 원문을 `_workspace/00_input/request.md`에 저장한다.
2. `Agent(subagent_type: "office-architect", run_in_background: false, prompt: "request.md를 읽고 event-contract 스킬에 따라 계획과(필요 시) 계약 변경을 작성하라. 출력: _workspace/01_architect_plan.md")`
3. 계획 파일 맨 위에 `## 결정 필요`가 있으면 사용자에게 묻고, 답을 받아 architect를 다시 호출한다.
4. 계약이 바뀌었으면 `pnpm -r typecheck`로 영향 범위를 확인하고 `shasum packages/shared/src/* > _workspace/freeze_01_contract.sha`로 동결한다. 이후 계약 변경은 2단계에서 architect를 다시 불러서만 한다.

### 2단계: 구현

**실행 모드:** 지속형 에이전트 협업

1. 계획에서 작업이 있는 모듈 담당만 **한 메시지에서 병렬로** 실행한다. 각 프롬프트에 포함할 것: 역할, 계획 파일 경로, 계약 diff 경로(있으면), 출력 요약 파일 경로, "첫 보고에 실제 사용 가능한 도구 목록을 알려라".
   - `Agent(name: "hooks", subagent_type: "hook-integrator", prompt: ...)`
   - `Agent(name: "backend", subagent_type: "realtime-backend", prompt: ...)`
   - `Agent(name: "scene", subagent_type: "office-scene-dev", prompt: ...)`
   - `Agent(name: "artist", subagent_type: "pixel-artist", prompt: ...)`
2. `TaskCreate`로 모듈별 작업을 등록하고 의존 관계를 건다. 전형적인 의존:
   - 스캐폴딩(모노레포·shared) → 나머지 전부
   - artist의 아틀라스 → scene의 실제 스프라이트 적용 (scene은 플레이스홀더로 먼저 진행)
   - backend의 `--replay` → scene의 통합 확인
   - 에이전트에게 Task 도구가 없다고 보고되면 리더가 `TaskUpdate`를 대신 수행한다.
3. 메시지 중계 규칙:
   - 계약 변경 요청 → 리더가 판단 후 `Agent(subagent_type: "office-architect")`로 처리 → 바뀐 diff 경로를 영향받는 담당에게 `SendMessage`
   - scene의 에셋 요청 → `SendMessage({to: "artist"}, 프레임 이름·크기·프레임 수·용도)`
   - artist의 프레임 이름 변경 → `SendMessage({to: "scene"}, ...)`
   - 전송 방식 질문(hooks↔backend) → 계약에 있으면 리더가 답하고, 없으면 계약 변경 절차로
4. 같은 파일을 두 담당이 고치지 않는다. 디렉터리 소유권이 겹치는 작업은 리더가 한 명에게 몰아준다.

### 3단계: 점진 QA (모듈 완료마다)

**실행 모드:** 서브에이전트 위임

> 전체 경로에서만 모듈마다 QA를 실행한다. 경량·표준 경로는 위 "경로 선택" 절에 따라 마지막에 한 번만 실행한다.

1. 담당에게서 "완료" 보고를 받으면 그 모듈의 산출물을 동결한다: `SendMessage({to: 담당}, "이후 수정은 QA 피드백을 받은 뒤에만 하라")`.
2. `Agent(subagent_type: "integration-qa", prompt: "모듈 {module}, 요약 파일 {path}. integration-qa 스킬의 경계 표에서 이 모듈이 등장하는 행을 검증하라. 출력 _workspace/03_integration-qa_{module}.md")` — 여러 모듈이 동시에 끝나면 한 메시지에서 병렬 호출.
3. FAIL이 있으면 해당 담당에게 보고서 경로와 FAIL 항목만 `SendMessage`로 보내 수정시키고, 수정 완료 후 QA를 다시 호출한다. **수정↔QA 왕복은 최대 2회.** 그래도 남으면 최종 보고에 미해결로 적는다.
4. 모든 모듈이 PASS면 마지막으로 B4·B5·B6(모듈을 가로지르는 경계)만 한 번 더 검증한다.

### 3'단계: 전체 감사 (사용자가 '전체 감사', '정합성 전수 점검'을 요청했을 때만)

**실행 모드:** 워크플로 조율 — 이 스킬을 불러온 것으로 Workflow 사용에 동의한 것으로 본다. 기본은 경계당 탐색 1명 + 발견 항목당 검증 1명. "철저히"를 요청하면 검증자를 3명으로 늘리고 과반 `confirmed`만 통과시킨다.

- `args`: `{ boundaries: ["B1", ..., "B8"], verifiers: 1 }` (리더가 저장소에 없는 모듈의 경계는 미리 뺀다)
- 스크립트 개요:

```javascript
export const meta = {
  name: 'claude-office-audit',
  description: '모듈 경계별 정합성 탐색 후 발견 항목마다 반대 관점 검증',
  phases: [{ title: '탐색' }, { title: '검증' }],
}
const FINDINGS = { type: 'object', required: ['boundary', 'findings'], properties: {
  boundary: { type: 'string' },
  findings: { type: 'array', items: { type: 'object',
    required: ['title', 'producer', 'consumer', 'evidence', 'owner'], properties: {
      title: { type: 'string' }, producer: { type: 'string' }, consumer: { type: 'string' },
      evidence: { type: 'string' }, owner: { type: 'string' } } } } } }
const VERDICT = { type: 'object', required: ['status', 'reason'], properties: {
  status: { type: 'string', enum: ['confirmed', 'refuted', 'uncertain'] }, reason: { type: 'string' } } }
const n = args.verifiers ?? 1

const results = await pipeline(
  args.boundaries,
  b => agent(`integration-qa 스킬의 경계 ${b}만 검증하라. 생산자와 소비자 코드를 모두 열고 파일:줄 근거를 남겨라.`,
    { agentType: 'integration-qa', label: `탐색:${b}`, phase: '탐색', schema: FINDINGS }),
  r => parallel((r?.findings ?? []).map(f => () =>
    parallel(Array.from({ length: n }, (_, i) => () =>
      agent(`다음 지적이 실제 런타임 오류나 잘못된 화면을 일으키는지 반대 관점에서 검증하라. 양쪽 코드를 직접 열어 확인하고, 근거가 충분하면 confirmed, 반박되면 refuted, 판단 불가면 uncertain: ${JSON.stringify(f)}`,
        { agentType: 'integration-qa', label: `검증:${r.boundary}:${i}`, phase: '검증', schema: VERDICT })))
      .then(vs => ({ ...f, boundary: r.boundary, verdicts: vs.filter(Boolean) }))))
)
const all = results.flat().filter(Boolean)
const missing = args.boundaries.length - results.filter(Boolean).length
if (missing) log(`경계 ${missing}개 탐색 실패`)
const confirmed = all.filter(f => f.verdicts.filter(v => v.status === 'confirmed').length > n / 2)
log(`발견 ${all.length}건 중 ${confirmed.length}건 확인`)
return { confirmed, rejected: all.filter(f => !confirmed.includes(f)), missingBoundaries: missing }
```

- 완료 알림 후 `runId`를 `_workspace/run_meta.json`에 기록하고, 결과를 `_workspace/03_audit_report.md`로 정리한다(확인됨 / 기각됨 / 탐색 실패 경계). 확인된 항목의 수정은 사용자 동의 후 2단계 절차로 진행한다.

### 4단계: 문서

**실행 모드:** 서브에이전트 위임

사용자에게 보이는 동작·설치·CLI·매핑 표가 바뀌었을 때만 `Agent(subagent_type: "oss-docs-writer", prompt: "_workspace/02_*_summary.md와 03_* 보고서를 읽고 바뀐 부분의 문서만 갱신하라")`. 이후 integration-qa로 B7만 확인한다.

### 5단계: 마무리

1. `TaskList`로 남은 작업이 없는지 확인한다. 동결 해시가 있으면 `shasum -c _workspace/freeze_*.sha`로 계약이 몰래 바뀌지 않았는지 확인한다.
2. 사용자 보고: 바뀐 모듈, 실행한 테스트와 결과(실제 출력 기준), QA PASS/FAIL/미검증 수, 미해결 항목, 직접 확인해 볼 명령(예: 서버 실행 + 샘플 전송).
3. `_workspace/`는 지우지 않는다. 커밋은 사용자가 요청할 때만.

## 데이터 전달 요약

| 경로 | 방법 |
| --- | --- |
| 리더 → architect | `_workspace/00_input/request.md` |
| architect → 구현 담당 | `_workspace/01_architect_plan.md`, `01_architect_contract-diff.md`, 코드(`packages/shared`) |
| 구현 담당 ↔ 구현 담당 | 리더 중계 `SendMessage` (직접 대화 대신 리더가 계약과 대조해 걸러낸다) |
| 구현 담당 → QA | `_workspace/02_{agent}_summary.md` + 코드 |
| QA → 구현 담당 | `_workspace/03_integration-qa_{module}.md`의 FAIL 항목을 `SendMessage`로 |
| 워크플로 → 리더 | 구조화 반환값 → `_workspace/03_audit_report.md` |

## 오류 처리

| 상황 | 대응 |
| --- | --- |
| 담당 에이전트 무응답·중지 | `SendMessage`로 상태 확인 후 재지시. 그래도 실패하면 같은 `subagent_type`을 `{name}-b`로 실행하고 요약 파일·계획 경로를 넘긴다 |
| 사용량 한도·인증 만료·권한 거부 | 재시도하지 않는다. 부분 산출물(코드·요약 파일)을 직접 열어 진행 범위를 확인하고 `_workspace/99_incomplete.md`에 기록 후 보고(한도라면 해제 시각 포함). 에이전트의 판단 내용은 추측해 채우지 않는다 |
| 의존성 설치·빌드 환경 실패 | 우회 코드를 쓰지 않는다. 오류 원문과 함께 사용자에게 보고 |
| 훅 페이로드 사실 확인 불가 | collector 해당 기능을 보류하고 확인 필요 항목으로 보고. 추측 구현 금지 |
| 수정↔QA 2회 후에도 FAIL | 미해결로 보고서에 남기고 사용자 판단 요청 |
| 절반 넘는 담당 실패 | 진행을 멈추고 사용자에게 계속할지 확인 |
| 워크플로 `agent()` null | `.filter(Boolean)` 후 누락 경계 수를 보고서에 명시 |

## 테스트 시나리오

### 정상 흐름 — "MVP 만들어줘"
1. 0단계: `_workspace/` 없음, 모노레포 없음 → 계획에 스캐폴딩 포함.
2. 1단계: architect가 계획 + shared 계약(v1) 작성 → 동결.
3. 2단계: hooks·backend·scene·artist 4명 병렬 실행, 작업 등록(스캐폴딩 → 나머지). scene은 플레이스홀더로 진행하다 artist 완료 후 실제 아틀라스 적용.
4. 3단계: 모듈 완료마다 QA. backend 완료 후 `send-fixture-events.mjs`로 29건 전송 → 모두 202, orphan `tool.end`(e26)에도 서버 정상.
5. 4단계: README·CONTRIBUTING 작성 → B7 검증.
6. 결과: `pnpm -r test` 통과, 서버 실행 후 브라우저에서 샘플 세션 재생 시 메인 + 서브에이전트 캐릭터가 매핑 표대로 움직임.

### 부분 재실행 — "서브에이전트 캐릭터 색이 다 똑같아, 고쳐줘"
1. 0단계: `_workspace/` 있음 + 수정 요청 → 계약 변경 없음, 모듈 1개 → **경량 경로**. architect 생략.
2. scene(`agentType` 해시 → variant)과 artist(변형 수) 중 원인 담당 1명만 실행.
3. 구현이 끝난 뒤 QA를 한 번 실행하고 B4·B5만 재검증.

### 경로 승격 — "말풍선에 파일 경로 전체를 보여줘"
1. 처음 판단: web 단일 모듈 → 경량 경로로 scene 실행.
2. scene이 "target은 계약상 basename·60자 제한이라 계약 변경 필요"라고 보고하고 구현을 멈춘다.
3. 리더는 개인정보 원칙(절대경로 금지)과 충돌하는지 사용자에게 확인하고, 진행한다면 전체 경로(architect부터)로 올린다.

### 오류 흐름 — 훅 필드 불일치
1. hooks가 실제 캡처에서 서브에이전트 식별 필드를 찾지 못했다고 보고.
2. 리더는 추측 구현을 막고, architect에 "서브에이전트 귀속 불가 시 대안(Agent 도구 start/end 사이 이벤트를 부모에 귀속)" 계약 검토를 요청.
3. 최종 보고에 "서브에이전트 내부 도구 호출 귀속: 제한적" + 확인 필요 사항을 명시.
