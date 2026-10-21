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
| 3. collector 구현 | 진행 중 |
| 4. 테스트·통합 | 대기 |
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
