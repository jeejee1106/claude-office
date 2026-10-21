# 작업 로그: packages/collector (Claude Code 훅 수집기)

- 브랜치: `feat/collector` (main 에서 분기, main 에는 커밋·머지하지 않음)
- 경로: **경량** — `packages/shared` 계약 변경 없음, 새 모듈 1개(collector). architect 생략, 마지막에 QA 1회(B1·B2·B8).
- 담당: hook-integrator 역할을 이 에이전트가 직접 수행 (custom agent type 은 이 환경에 등록되어 있지 않음).
- 시작: 2026-10-22

## 진행 상황

| 단계 | 상태 |
| --- | --- |
| 1. 환경 준비·기준선 | 완료 |
| 2. 훅 확인(문서 + 실제 캡처) | 진행 중 |
| 3. collector 구현 | 대기 |
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
