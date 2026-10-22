# 작업 로그: packages/collector (Claude Code 훅 수집기)

- 브랜치: `feat/collector` (main 에서 분기, main 에는 커밋·머지하지 않음)
- 경로: **경량** — `packages/shared` 계약 변경 없음, 새 모듈 1개(collector). architect 생략, 마지막에 QA 1회(B1·B2·B8).
- 담당: hook-integrator 역할을 이 에이전트가 직접 수행 (custom agent type 은 이 환경에 등록되어 있지 않음).
- 시작: 2026-10-22

## 진행 상황

| 단계 | 상태 |
| --- | --- |
| 1. 환경 준비·기준선 | 완료 |
| 2. 훅 확인(문서 + 실제 캡처) | 완료 |
| 3. collector 구현 | 완료 |
| 4. 테스트·통합 | 완료 |
| 5. QA (B1·B2·B8) | 완료 — PASS 3 / FAIL 0 / 미검증 0 |
| 6. 문서 | 완료 |
| 7. PR | 완료 — https://github.com/jeejee1106/claude-office/pull/1 (머지 안 함) |

## 결정 필요

계약(`packages/shared`) 변경이 꼭 필요한 항목은 **없습니다**. 아래는 제가 임시로 정해 둔 것이니 확인해 주세요.

1. **install 기본 대상**: 옵션 없이 `install` 하면 `--project`(현재 디렉터리)로 해 두었습니다. 전역 설정(`~/.claude`)을 말없이 바꾸지 않기 위해서입니다. "대시보드는 모든 세션을 보는 것"이 목적이라면 기본을 `--user` 로 바꾸는 편이 편할 수 있습니다.
2. **동기 훅 vs `async: true`**: 지금은 동기 훅입니다(도구 호출마다 약 60ms, 서버가 무응답이면 최대 0.5초 지연). Claude Code 문서상 `"async": true` 로 등록하면 지연이 0이 되지만, 이벤트 순서가 뒤섞일 수 있고 `claude -p` 종료 시 취소됩니다. 체감 지연이 거슬리면 async 로 바꾸는 것을 검토해 주세요.
3. **서브에이전트의 부모(`parentAgentId`)는 비워 둡니다**: 훅 입력에 부모를 가리키는 필드가 없고, 서브에이전트는 중첩될 수 있습니다(캡처로 확인). web 은 지금 `parentId` 를 쓰지 않아 화면 영향은 없습니다. 나중에 "팀원이 누구에게 보고하는지"를 보여 주려면 collector 에 작은 상태 파일을 두는 등 별도 설계가 필요합니다.
4. **`agent.spawn` 의 `description` 은 비어 있습니다**: 작업 설명은 PreToolUse(Agent) 의 `tool_input.description` 에만 있고 SubagentStart 에는 없습니다. 둘을 잇는 ID 가 시작 시점에는 없어서(연결은 끝난 뒤 PostToolUse 의 `tool_response.agentId` 로만 가능) 보내지 않았습니다.
5. **bin 이름 `claude-office`**: collector 의 설치 도구 이름으로 썼습니다. 나중에 `npx claude-office`(서버 실행) 패키징을 하면 이름이 겹치므로 그때 `claude-office install` 같은 하위 명령으로 합쳐야 합니다(범위 밖이라 손대지 않음).
6. **문서로만 확인한 훅**: Notification, PreCompact, PermissionRequest 는 `claude -p` 에서 발생하지 않아 캡처하지 못했습니다. 대화형 Claude Code 에서 `/compact` 와 권한 요청을 한 번 일으켜 캡처하면 fixture 를 실제 값으로 바꿀 수 있습니다.
7. (참고) 이벤트 카탈로그(`.claude/skills/event-contract/references/event-catalog.md`)의 "원천 훅(예정)" 열을 확인된 내용으로 고치는 것은 architect 담당이라 손대지 않았습니다. 확인 결과는 카탈로그의 예정과 같습니다(PostToolUseFailure 가 "실패 훅", PermissionRequest 가 attention 원천).

---

## 1단계: 환경 준비·기준선 (완료)

환경: macOS (Darwin 25.5), Node v24.14.0, pnpm 12.14.0(이미 설치됨), Claude Code CLI 2.1.306, gh 로그인됨.

| 명령 | 결과 |
| --- | --- |
| `pnpm install` | 성공 (454ms) |
| `pnpm typecheck` | shared·server·web 모두 통과 |
| `pnpm test` | shared 46 + web 76 + server 25 = **147 통과** (기대값과 일치) |
| `pnpm lint` (`biome check .`) | **실패**: "No files were processed" |
| `pnpm exec biome check apps packages` | 통과 (69 files, 오류 없음) |

문제: 이 작업은 `.claude/worktrees/agent-…/` 아래의 git worktree 에서 돌고 있다. `biome.json` 의 `"!**/.claude"` 제외 규칙이 절대 경로의 `.claude` 에 걸려 저장소 전체가 무시된다. **일반 체크아웃(저장소 루트가 `.claude` 아래가 아닌 경우)에서는 생기지 않는 환경 문제**라 biome.json 은 고치지 않았다. 이후 lint 는 `pnpm exec biome check apps packages` 로 확인한다.

## 2단계: 훅 확인 (완료)

**공식 문서**: https://code.claude.com/docs/en/hooks 전체(약 27만 자)를 3번에 나눠 읽었다.

**실제 캡처: 성공** (Claude Code 2.1.306)
- 스크래치 경로(저장소 밖)에 stdin 을 파일로만 저장하는 `dump.mjs` 와, 12개 이벤트(SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop, Stop, Notification, PreCompact, PermissionRequest)에 이를 등록한 임시 settings.json 을 만들었다.
- 실행: `claude -p "<Read → Edit → Bash → Bash false → Agent(Explore) 지시>" --settings <임시 settings.json> --add-dir <스크래치 proj> --allowedTools "Read,Edit,Bash,Agent,Task,Grep,Glob" --model haiku`
  - 참고: 처음엔 스크래치 디렉터리에서 실행하려 했으나 이 에이전트의 worktree 격리 규칙이 막아서, worktree 를 cwd 로 두고 `--settings` 로 훅만 주입했다. 저장소 파일은 건드리지 않았다(`git status` 깨끗함 확인).
- 결과: 20건 캡처 — SessionStart 1, UserPromptSubmit 1, PreToolUse 7, PostToolUse 6, PostToolUseFailure 1, SubagentStart 1, SubagentStop 1, Stop 1, SessionEnd 1.
- 캡처 못 함: **Notification, PreCompact, PermissionRequest** (`-p` + `--allowedTools` 에서는 발생하지 않음) → 문서 예시로 fixture 를 만들고 `_fixture_source: "docs-derived …"` 로 표시했다.

**fixture**: `packages/collector/test/fixtures/` 25개. 사용자명·실제 경로·세션 ID·프롬프트·파일 내용·명령 출력·설명은 지웠다(가짜 경로 `/Users/alice/work/demo-app` 로 치환, 정리 스크립트가 `jee`/`kmj` 등 문자열이 남으면 실패하도록 검사). 파일 이름은 `{hook_event_name}.json`, 같은 이벤트가 여러 개면 `{hook_event_name}.{변형}.json` (예 `PreToolUse.subagent-Read.json`).

**핵심 발견** (자세한 표: `.claude/skills/claude-code-hooks/references/hook-notes.md`)
1. 서브에이전트 안의 도구 훅에는 `agent_id` + `agent_type` 이 붙고, 메인에는 없다 → 서브에이전트 귀속 가능. (`agent_type` 은 `--agent` 세션 메인에도 붙을 수 있어 판별은 `agent_id` 로만)
2. SubagentStart/Stop 에는 **부모를 가리키는 필드가 없다**. 현재 Claude Code 에서 서브에이전트는 또 다른 서브에이전트를 만들 수 없으므로 `parentAgentId: "main"` 으로 둔다.
3. Agent 도구 PostToolUse 의 `tool_response.agentId` == SubagentStart 의 `agent_id` (캡처로 확인).
4. 실패한 도구는 PostToolUse 가 아니라 PostToolUseFailure 만 온다 → `tool.end status:error`.
5. Edit 의 PostToolUse `tool_response.originalFile` 에 파일 전체가 들어 있다 → collector 는 `tool_input`/`tool_response` 에서 경로·명령 첫 토큰 등만 뽑고 나머지는 버린다.
6. PermissionRequest 에는 `tool_use_id` 가 없다.

### 2단계 추가: 중첩 서브에이전트 캡처

공식 문서(sub-agents)에 "서브에이전트는 기본적으로 3단계까지 자기 서브에이전트를 만들 수 있다"고 되어 있어, 위 2번 판단("서브에이전트는 중첩 불가 → parent=main")이 **틀렸다**. general-purpose → Explore 중첩을 한 번 더 캡처했다(14건).
- 자식의 SubagentStart 에도 부모 필드가 없다. 부모 서브에이전트 안의 `PreToolUse(Agent)` 에만 부모의 `agent_id` 가 붙는다.
- 결론: **`parentAgentId` 는 채우지 않는다**(추측 금지). web 은 현재 `parentId` 를 쓰지 않아 화면 영향 없음.
- fixture 추가: `SubagentStart.nested.json`, `PreToolUse.subagent-Agent.json`, `PreToolUse.nested-Glob.json` (총 28개)

## 3단계: collector 구현 (완료)

`packages/collector` (`@claude-office/collector`)

| 파일 | 내용 |
| --- | --- |
| `src/normalize.ts` | 순수 함수 `normalize(hookInput, ctx): OfficeEvent \| null`. 12개 훅 → 10개 kind. 마지막에 `OfficeEvent.safeParse` 로 계약 검증(실패 시 null) |
| `src/target.ts` | `tool.target`: 파일=basename, Bash=첫 토큰(환경변수 대입 건너뜀, 경로면 basename), Grep/Glob=패턴 30자(절대경로면 마지막 조각, `/Users/<이름>` 은 `~`), WebFetch=호스트, Agent=subagent_type, MCP=서버명, WebSearch 질의 등은 없음. 항상 60자 이하 |
| `src/send.ts` | `node:http` POST, 500ms 타임아웃, 응답 본문 안 읽음 (fetch 보다 시작이 빠름) |
| `src/hook.ts` | `claude-office-hook`: stdin → normalize → POST. 항상 exit 0, stdout 없음, 2초 강제 종료 안전망, `CLAUDE_OFFICE_DEBUG=1` 일 때만 stderr, `CLAUDE_OFFICE_DISABLE=1` 이면 아무것도 안 함 |
| `src/settings.ts` | 순수 함수: `addOurHooks` / `removeOurHooks` / `lineDiff` |
| `src/cli.ts` | `claude-office install\|uninstall [--project\|--user\|--settings <file>] [--dry-run]` |
| `build.mjs` | esbuild 로 `dist/claude-office-hook.js`(461KB, zod 포함), `dist/claude-office.js` 번들. `package.json` bin 에 연결 |

설계 결정 (사용자 확인 권장 항목은 "결정 필요"에도 적음)
- **이벤트 ID**: 도구 이벤트는 `{sessionId}/{kind}/{tool_use_id}`, 서브에이전트 spawn/finish 는 `{sessionId}/{kind}/{agent_id}` 로 결정적으로 만든다 → user·project 양쪽에 중복 설치돼 훅이 두 번 돌아도 서버가 중복 제거한다. 나머지는 UUID.
- **Notification**: `permission_prompt`→permission, `idle_prompt`→idle, `elicitation_dialog`/`elicitation_url_dialog`/`agent_needs_input`→other, 그 밖(`auth_success` 등)은 보내지 않음.
- **PermissionRequest** → `attention permission`. Notification(permission_prompt)과 같이 오면 attention 이 두 번 가지만 reduce 결과는 같다.
- **설치 형식**: 12개 이벤트마다 `{ "hooks": [{ "type": "command", "command": "node \"<절대경로>/dist/claude-office-hook.js\"", "timeout": 5 }] }` (matcher 생략 = 전체). 동기 훅. `async: true` 는 쓰지 않았다(아래 결정 필요).
- **install 기본 대상**: `--project` (현재 디렉터리 `.claude/settings.json`). `--user` 는 명시해야 한다.

명령과 결과
| 명령 | 결과 |
| --- | --- |
| `pnpm install` | 성공 (esbuild 0.28.2 등 기존 스토어 재사용) |
| `pnpm --filter @claude-office/collector typecheck` | 통과 |
| `pnpm --filter @claude-office/collector test` | **136 통과** (4 파일, 스냅샷 27개 생성), 2.0초 |
| `pnpm exec biome check --write packages/collector` | 포맷 6건 자동 수정 후 `biome check apps packages` 오류 0 (86 files) |
| `pnpm typecheck` | shared·collector·server·web 모두 통과 |
| `pnpm test` | shared 46 + web 76 + server 25 + collector 136 = **283 통과** |

훅 지연(서버 없음, 연결 거부): **59 / 63 / 59 ms** (목표 < 300ms). 서버가 응답하지 않을 때: 561ms 후 exit 0.

테스트 구성
- `normalize.test.ts`: 모든 fixture 스냅샷 + `OfficeEvent.parse`, 개인정보(B8), 서브에이전트·중첩 귀속(B1), 모르는 훅·잘못된 입력 → null
- `target.test.ts`: target 규칙 표 테스트
- `hook.test.ts`: 실제 프로세스 실행 — 지연, exit 0, stdout 없음, 실제 HTTP 서버로 받은 요청이 `POST /events` + `application/json` + 단일 객체 + Origin 없음(B2), 타임아웃, DEBUG/DISABLE
- `settings.test.ts`: 기존 훅이 있는 임시 settings.json 으로 install → install(멱등) → uninstall 왕복 후 **원본 텍스트와 동일**, `.bak`, `--dry-run`, 잘못된 JSON 은 건드리지 않음

## 4단계: 통합 (완료)

### 4-1. fixture → 실제 훅 바이너리 → 실제 서버
- `pnpm start` (포트 7333, 비어 있음 확인) → `curl /healthz` = `{"ok":true,"version":"0.1.0","schema":1}`
- 스크래치 스크립트로 fixture 28개 중 27개를 실제 세션 순서대로 `node dist/claude-office-hook.js` 에 stdin 으로 넣고(`CLAUDE_OFFICE_DEBUG=1`), 단계마다 `GET /api/state` 를 확인했다.
- 결과: **모두 exit 0, stdout 없음, 55~64ms**. 보낸 이벤트는 전부 `202`, `auth_success` 알림은 의도대로 보내지 않음. 서버 로그에 `event rejected` 없음.

| 시점 | `/api/state` (세션 `demo-app`) |
| --- | --- |
| Read 시작 | main `working`, 도구 `Read:read:notes.txt` |
| Bash 시작 | main `working`, 도구 `Bash:bash:ls`, 직전 결과 `Edit:ok` |
| 서브에이전트 Read 중 | main 도구 `Agent:agent:Explore`, 직전 `Bash:error`(false 실패) / 서브에이전트 `a9d6…`(Explore) `working`, 도구 `Read:read:notes.txt` ← **메인이 아닌 서브에이전트로 귀속됨** |
| 서브에이전트 종료 | 서브에이전트 `gone`, main 직전 `Agent:ok` |
| 권한 요청 | main `waiting`, attention `permission` |
| 턴 끝 | main `idle` |
| 세션 끝 | `ended=yes`, 전원 `gone` |

### 4-2. 실제 Claude Code → 설치된 훅 → 실제 서버 (끝에서 끝까지)
- `node packages/collector/dist/claude-office.js install --settings <스크래치>/e2e/settings.json` → 12개 이벤트 등록, diff 출력 확인
- `claude -p "notes.txt 읽기 → echo hi → Agent(Explore)로 Glob" --settings <스크래치>/e2e/settings.json --allowedTools ... --model haiku`
- 결과 `/api/state`: 실제 세션 `c91a0866…` 생성, `ended=true (other)`, main 직전 결과 `Agent:ok`, 서브에이전트 `a836bc1e…` **type `Explore`**, 직전 결과 **`Glob:ok`**. → **실제 Claude Code 활동이 서버까지 도달하고, 서브에이전트 도구도 올바르게 귀속됨을 확인.**
- 서버 종료 후 `curl /healthz` 연결 거부 확인.

참고: `-p` 모드라서 project 이름은 cwd(이 worktree 디렉터리) basename 으로 나왔다. 실제 사용 시에는 `CLAUDE_PROJECT_DIR`(프로젝트 루트)의 basename.

### 4-3. 전체 검사
| 명령 | 결과 |
| --- | --- |
| `pnpm typecheck` | 4개 패키지 통과 |
| `pnpm test` | **283 통과** (shared 46, web 76, server 25, collector 136) |
| `pnpm exec biome check apps packages` | 오류 0 (86 files) — `pnpm lint` 는 1단계의 worktree 경로 문제로 이 환경에서만 실패 |

apps/server 변경: **없음**. packages/shared 변경: **없음**. apps/web 변경: **없음**.

## 5단계: QA — B1·B2·B8 (완료)

integration-qa 에이전트 타입은 이 환경에 등록되어 있지 않아, integration-qa 스킬 절차대로 이 에이전트가 생산자·소비자 코드를 함께 열어 직접 대조했다. (구현자와 검증자가 같다는 한계가 있으니 아침에 한 번 더 봐 주시면 좋습니다.)

# QA: collector (2026-10-22)
## 요약: PASS 3 / FAIL 0 / 미검증 0

## PASS
- **[B1] 훅 페이로드 ↔ normalize**
  - 사용하는 필드 `hook_event_name`, `session_id`, `agent_id`, `cwd`, `tool_name`, `tool_input`, `tool_use_id`, `source`, `reason`, `prompt`(길이만), `agent_type`, `notification_type`, `trigger` (`packages/collector/src/normalize.ts:69-189`) 는 전부 실제 캡처 fixture 또는 공식 문서에 있는 이름이다(`.claude/skills/claude-code-hooks/references/hook-notes.md`). 문서에만 있고 캡처 못 한 것: `notification_type`, `trigger`, PermissionRequest 형태.
  - 서브에이전트 귀속: `agent_id` 있으면 그 값, 없으면 `main` (`normalize.ts:73-74`). 테스트 `normalize.test.ts` "서브에이전트 귀속 (B1)" 5건 + 4단계 실제 서버에서 서브에이전트 Read 가 `a9d6…` 로, 실제 Claude Code 실행에서 Glob 이 `a836…`(Explore) 로 귀속됨을 확인.
  - fixture 28개 모두 `OfficeEvent.parse` 통과(`auth_success` 1개는 의도적으로 null).
- **[B2] collector 전송 ↔ server `POST /events`**
  - URL: 생산자 `send.ts:5` `http://${DEFAULT_HOST}:${DEFAULT_PORT}${PATHS.events}` ↔ 소비자 `apps/server/src/ingest.ts:15` `app.post(PATHS.events…)` — 둘 다 shared 상수(`/events`, 7333).
  - 메서드 POST, `content-type: application/json` (`send.ts:47-50`), 바디는 단일 객체 `JSON.stringify(event)` (`hook.ts:77`) ↔ 서버는 단일·배열 모두 받고(`ingest.ts:36`) 항목별 `safeParse`(`ingest.ts:38`).
  - Origin 헤더를 보내지 않음(테스트로 확인) ↔ 서버는 Origin 없으면 허용(`apps/server/src/origin.ts`).
  - 바디 크기: 이벤트는 수백 바이트, 서버 제한 64KB(`ingest.ts:7`).
  - 서버 없음: 연결 거부 시 59~63ms 에 exit 0, 무응답 서버에서는 561ms 에 exit 0 (`hook.test.ts`). 실제 서버로 27건 모두 202.
- **[B8] 개인정보 규칙 ↔ normalize**
  - 이벤트에 실리는 문자열: `sessionId`, `agentId`, `project`(cwd basename), `tool.name`, `tool.target`(60자 이하 요약), `tool.useId`, `agentType`, `reason`/`source`/`trigger`. 프롬프트는 길이(숫자)만.
  - `tool_input` 은 target 추출에만 쓰고 버림. `tool_response`·`last_assistant_message`·`description`·`prompt`·`error` 는 읽지 않음.
  - 테스트: fixture 전체에서 `/Users/`·사용자명·`.jsonl`·`redacted` 가 이벤트에 없음. 비밀 문자열을 프롬프트·Bash 인자·Edit 내용·WebSearch 질의·Agent 프롬프트·SubagentStop 메시지에 넣어도 이벤트에 없음(`normalize.test.ts` "개인정보 (B8)").

## 참고 (FAIL 아님)
- Grep/Glob 의 `target` 은 계약대로 "패턴 앞 30자"라서, Claude 가 비밀 문자열 자체를 검색하면 그 앞부분이 화면에 보일 수 있다. 계약이 허용한 범위다.
- Bash 첫 토큰이 `$(cat` 처럼 어색하게 나올 수 있으나 표시만 어색할 뿐 유출은 아니다.

## 6단계: 문서 (완료)

- 새 문서 `docs/connect-claude-code.md` "실제 Claude Code 연결하기": 빌드 → install(`--user`/`--project`) → `pnpm dev` → Claude Code 사용 → http://localhost:5173, 제거, 환경 변수, 문제 해결.
- 문서의 명령 확인: `node packages/collector/dist/claude-office.js --help` 동작, 문제 해결의 `echo … | CLAUDE_OFFICE_DEBUG=1 node …/claude-office-hook.js` 실행 → 서버 꺼진 상태에서 `turn.end not sent: connect ECONNREFUSED 127.0.0.1:7333`, exit 0 (서버가 켜진 경우의 `→ 202` 는 4단계에서 확인). `pnpm dev` 가 server(`tsx watch`)·web(`vite`) dev 스크립트를 실행함을 package.json 에서 확인.
- `docs/product-spec.md`: 화면 동작이 바뀌지 않아 **수정 안 함**.
- `CLAUDE.md` 변경 이력: 하네스 파일(`.claude/skills/claude-code-hooks/references/hook-notes.md`)을 처음 채웠으므로 1행 추가.

## 7단계: PR (완료)

- `gh pr create --base main --head feat/collector` → https://github.com/jeejee1106/claude-office/pull/1
- **머지하지 않았습니다.** main 에는 커밋·머지하지 않았습니다.
- 변경 범위: `packages/collector/**`(신규), `docs/connect-claude-code.md`(신규), `docs/progress/collector.md`(신규), `.claude/skills/claude-code-hooks/references/hook-notes.md`, `CLAUDE.md`(변경 이력 1행), `pnpm-lock.yaml`. `packages/shared`·`apps/server`·`apps/web` 변경 0.
- lockfile 참고: collector 추가 외에 pnpm 이 vitest 의 peer `vite@8.3.4` 를 web 과 같은 `8.3.3` 으로 합쳤습니다(dedupe, 테스트 283 통과).

## 아침에 직접 확인해 볼 명령

```bash
git checkout feat/collector && pnpm install
pnpm --filter @claude-office/collector build
node packages/collector/dist/claude-office.js install --user --dry-run   # 미리 보기
node packages/collector/dist/claude-office.js install --user
pnpm dev            # 그리고 새 터미널에서 claude 실행 → http://localhost:5173
node packages/collector/dist/claude-office.js uninstall --user           # 되돌리기
```
