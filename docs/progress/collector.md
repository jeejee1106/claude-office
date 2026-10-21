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
| 4. 테스트·통합 | 진행 중 (단위 테스트 완료, 실제 서버 통합 남음) |
| 5. QA (B1·B2·B8) | 대기 |
| 6. 문서 | 대기 |
| 7. PR | 대기 |

## 결정 필요

(아직 없음)

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
