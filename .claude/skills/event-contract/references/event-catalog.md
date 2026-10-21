# OfficeEvent 카탈로그 (v1 — 2026-10-21 확정)

사람이 읽는 명세다. 코드(`packages/shared/src/event.ts`)와 이 문서가 다르면 버그다. 계약을 바꿀 때 함께 갱신한다.

## 공통 필드

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `v` | `1` | ✔ | 스키마 버전 |
| `id` | string (1–128) | ✔ | 이벤트 ID (collector가 생성). 중복 제거는 서버 hub 책임 — `reduce`는 거르지 않는다 |
| `ts` | string (ISO 8601, `Z` 또는 오프셋) | ✔ | 발생 시각 |
| `sessionId` | string (1–128) | ✔ | Claude Code `session_id` |
| `agentId` | string (1–128) | ✔ | 메인 에이전트 `"main"`, 서브에이전트는 Claude Code가 준 agent ID |
| `parentAgentId` | string (1–128) | | 서브에이전트의 부모 |
| `kind` | 아래 표 | ✔ | 이벤트 종류 |
| `project` | string (1–120) | | 작업 디렉터리 basename (사무실 이름표 표시용, 경로 금지) |

호환 규칙(코드: `packages/shared/src/event.ts`)
- 모르는 필드는 parse 시 제거된다(strip) → 새 optional 필드는 하위 호환.
- 모르는 `kind`는 parse 실패 → 소비자는 `safeParse` 후 버린다.
- 열거형 보조 필드는 모르는 값을 기본값으로 떨어뜨린다: `tool.category`→`other`, `attention.reason`→`other`, `source`/`trigger`/`agent.finish.status`→없음(undefined). 그래서 새 값 추가는 `v`를 올리지 않는다.

## kind 목록

| kind | 원천 훅(예정) | 추가 필드 | 의미 |
| --- | --- | --- | --- |
| `session.start` | SessionStart | `source?` (startup/resume/clear/compact) | 출근 — 사무실 불이 켜진다 |
| `session.end` | SessionEnd / 서버 타임아웃 | `reason?` (≤40자, 예: exit, clear, `timeout`=서버 비활성 정리) | 퇴근 — 전원 퇴장 |
| `prompt.submit` | UserPromptSubmit | (원문 없음) `length?` (0 이상 정수) | 사용자가 일을 맡김 — 메인 캐릭터 머리 위 "!" |
| `tool.start` | PreToolUse | `tool` | 도구 사용 시작 — 해당 가구로 이동 |
| `tool.end` | PostToolUse / 실패 훅 | `tool`, `status`: ok \| error | 도구 사용 끝 |
| `agent.spawn` | SubagentStart 또는 PreToolUse(tool=Agent/Task) | `agentType?`(≤60자), `description?`(≤120자) | 새 직원 입장 |
| `agent.finish` | SubagentStop | `status?`: ok \| error | 직원 퇴장 |
| `turn.end` | Stop | | 메인 에이전트 한 턴 종료 — 휴식 |
| `attention` | Notification / PermissionRequest | `reason`: permission \| idle \| other | 사용자 확인 필요 — 손 들기 |
| `context.compact` | PreCompact | `trigger?`: manual \| auto | 서류 정리(파쇄기) |
| `agent.idle` | **서버 전용** (hub 비활성 타이머의 `idleSweep`) | 없음 | 60초 무활동 — 자기 책상 `idle_sit`. collector는 보내지 않는다 |

> "원천 훅" 열은 설계 의도다. 실제 훅 이름·필드는 Claude Code 버전마다 다를 수 있으므로 `claude-code-hooks` 스킬의 확인 절차를 거친 뒤 확정한다.

## tool 객체

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `name` | string | 원래 도구 이름 (`Read`, `Edit`, `Bash`, `mcp__x__y` …) |
| `category` | ToolCategory | 아래 표 |
| `target` | string? | 표시용 요약, 최대 60자(초과 시 parse 실패 — collector가 잘라서 보낸다). 파일은 basename, Bash는 첫 토큰(`npm`, `git`), 검색은 패턴 앞부분, MCP는 서버명(`mcpServerName()`) |
| `useId` | string? | `tool_use_id` — start/end 짝 맞추기 |

## ToolCategory

| category | 도구 예 | 사무실 위치(씬 매핑은 pixel-office-scene 참조) |
| --- | --- | --- |
| `read` | Read, NotebookRead | 책장 |
| `edit` | Edit, MultiEdit, NotebookEdit | 자기 책상 타이핑 |
| `write` | Write | 자기 책상 타이핑(새 종이) |
| `search` | Grep, Glob, LS | 서류 캐비닛 |
| `bash` | Bash, BashOutput, KillShell | 서버 랙/터미널 |
| `web` | WebFetch, WebSearch | 창가 지구본 |
| `agent` | Agent, Task | 문 앞(새 직원 맞이) |
| `plan` | TodoWrite, TaskCreate, ExitPlanMode | 화이트보드 |
| `mcp` | `mcp__*` | 전화기 |
| `other` | 그 밖의 모든 것 | 자기 책상 대기 |

`categorizeTool(name)`은 대소문자를 구분하고, 모르는 이름에 `other`를 반환하며 throw하지 않는다.

## ServerMessage (WS)

| type | 페이로드 | 시점 |
| --- | --- | --- |
| `snapshot` | `state: OfficeState`, `recent: OfficeEvent[]`(오래된→최신, ≤500), `ts`(서버 시각) | 접속 직후 1회 |
| `event` | `event: OfficeEvent` | 이벤트 수신마다 |
| `heartbeat` | `ts` | 주기적 (연결 확인) |

## OfficeState

```
OfficeState  = { sessions: Record<sessionId, SessionState> }
SessionState = { id, project?, startedAt, endedAt?, endReason?, lastEventAt,
                 agents: Record<agentId, AgentState> }
AgentState   = { id, parentId?, type?, description?,
                 activity: 'idle'|'working'|'waiting'|'gone',
                 currentTool?: { name, category, target?, useId?, since },
                 lastToolResult?: { name, category, status: ok|error, at },
                 attention?: permission|idle|other,
                 lastEventAt, finishedAt? }
```

### reduce(state, event) 규칙 (순수, throw 없음, 입력 불변)

| kind | 상태 변화 |
| --- | --- |
| (공통) | 세션·에이전트가 없으면 lazy 생성. `main`은 항상 생성. `lastEventAt`은 단조 증가(`agent.idle`은 갱신 안 함) |
| `session.start` | `project` 반영, `gone`이던 main → `idle` |
| `prompt.submit` | `working`, attention 해제 |
| `tool.start` | `working`, `currentTool` 설정, attention 해제 |
| `tool.end` | 짝(useId 동일, 둘 중 하나라도 useId 없으면 이름 동일)이면 `currentTool` 해제, 짝 없으면(orphan) 유지. `lastToolResult` 갱신. `waiting`이 아니면 `working`(턴 진행 중) |
| `agent.spawn` | `type`/`description` 반영, `idle`이면 `working` |
| `agent.finish` | `gone`, `finishedAt`. 이후 ts ≤ finishedAt 인 이벤트는 메타데이터만 반영(spawn이 늦게 와도 되살아나지 않음) |
| `turn.end` | `idle`, 도구·attention 해제 |
| `attention` | `waiting`, `attention=reason` |
| `context.compact` | `lastEventAt`만 |
| `agent.idle` | 존재하는 `working` 에이전트만 `idle` + 도구 해제 |
| `session.end` | `endedAt`/`endReason`, 전원 `gone`. 이후 ts ≤ endedAt 이벤트 무시, ts > endedAt 이벤트는 세션 재개. 종료 세션은 최근 10개(`MAX_ENDED_SESSIONS`)만 유지 |

### 비활성 처리 (`idleSweep(state, now, thresholds?) → OfficeEvent[]`)

서버 hub가 주기적으로 호출해 나온 이벤트를 일반 이벤트처럼 reduce·브로드캐스트한다. web은 호출하지 않는다.

| 임계값 | 기본 | 결과 |
| --- | --- | --- |
| `agentIdleMs` | 60초 | 진행 중 도구 없는 `working` 에이전트 → `agent.idle` |
| `staleToolMs` | 10분 | 진행 중 도구가 있는 `working` 에이전트(tool.end 누락) → `agent.idle` |
| `sessionExpireMs` | 30분 | 세션 → `session.end` (`reason: 'timeout'`) |
| `sleepMs` | 5분 | web 표시 전용 `isAsleep(agent, now)` — `idle` + 경과 시 Zzz |

`waiting` 에이전트는 비활성 처리하지 않는다.

## HTTP 응답 (shared `messages.ts`)

| 경로 | 스키마 |
| --- | --- |
| `POST /events` | `IngestResponse { accepted, duplicates, rejected: [{index, error}] }` — 202(1개 이상 수용 또는 전부 중복), 400(JSON 아님·전부 거부) |
| `GET /healthz` | `HealthResponse { ok: true, version, schema: 1 }` |

경로·포트 상수: `PATHS`(`/events`, `/ws`, `/api/state`, `/healthz`), `DEFAULT_PORT=7333`, `DEFAULT_HOST='127.0.0.1'`.
