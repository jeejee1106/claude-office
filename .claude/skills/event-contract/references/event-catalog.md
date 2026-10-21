# OfficeEvent 카탈로그 (v1 초안)

사람이 읽는 명세다. 코드(`packages/shared/src/event.ts`)와 이 문서가 다르면 버그다. 계약을 바꿀 때 함께 갱신한다.

## 공통 필드

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `v` | `1` | ✔ | 스키마 버전 |
| `id` | string | ✔ | 이벤트 ID (collector가 생성, 중복 제거용) |
| `ts` | string (ISO 8601) | ✔ | 발생 시각 |
| `sessionId` | string | ✔ | Claude Code `session_id` |
| `agentId` | string | ✔ | 메인 에이전트 `"main"`, 서브에이전트는 Claude Code가 준 agent ID |
| `parentAgentId` | string | | 서브에이전트의 부모 |
| `kind` | 아래 표 | ✔ | 이벤트 종류 |
| `project` | string | | 작업 디렉터리 basename (사무실 이름표 표시용) |

## kind 목록

| kind | 원천 훅(예정) | 추가 필드 | 의미 |
| --- | --- | --- | --- |
| `session.start` | SessionStart | `source?` (startup/resume/clear/compact) | 출근 — 사무실 불이 켜진다 |
| `session.end` | SessionEnd | `reason?` | 퇴근 — 전원 퇴장 |
| `prompt.submit` | UserPromptSubmit | (원문 없음) `length?` | 사용자가 일을 맡김 — 메인 캐릭터 머리 위 "!" |
| `tool.start` | PreToolUse | `tool` | 도구 사용 시작 — 해당 가구로 이동 |
| `tool.end` | PostToolUse / 실패 훅 | `tool`, `status`: ok \| error | 도구 사용 끝 |
| `agent.spawn` | SubagentStart 또는 PreToolUse(tool=Agent/Task) | `agentType?`, `description?`(짧게) | 새 직원 입장 |
| `agent.finish` | SubagentStop | `status?` | 직원 퇴장 |
| `turn.end` | Stop | | 메인 에이전트 한 턴 종료 — 휴식 |
| `attention` | Notification / PermissionRequest | `reason`: permission \| idle \| other | 사용자 확인 필요 — 손 들기 |
| `context.compact` | PreCompact | `trigger?` | 서류 정리(파쇄기) |

> "원천 훅" 열은 설계 의도다. 실제 훅 이름·필드는 Claude Code 버전마다 다를 수 있으므로 `claude-code-hooks` 스킬의 확인 절차를 거친 뒤 확정한다.

## tool 객체

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `name` | string | 원래 도구 이름 (`Read`, `Edit`, `Bash`, `mcp__x__y` …) |
| `category` | ToolCategory | 아래 표 |
| `target` | string? | 표시용 요약, 최대 60자. 파일은 basename, Bash는 첫 토큰(`npm`, `git`), 검색은 패턴 앞부분 |
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

`categorizeTool(name)`은 모르는 이름에 `other`를 반환해야 하며 throw하지 않는다.

## ServerMessage (WS)

| type | 페이로드 | 시점 |
| --- | --- | --- |
| `snapshot` | `state: OfficeState`, `recent: OfficeEvent[]` | 접속 직후 1회 |
| `event` | `event: OfficeEvent` | 이벤트 수신마다 |
| `heartbeat` | `ts` | 주기적 (연결 확인) |

## OfficeState (요약)

```
sessions: Record<sessionId, { project?, startedAt, endedAt?, agents: Record<agentId, AgentState> }>
AgentState: { id, parentId?, type?, activity: 'idle'|'working'|'waiting'|'gone',
              currentTool?: { name, category, target?, since }, lastEventAt }
```
