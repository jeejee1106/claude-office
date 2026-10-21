# Claude Office

터미널 속 Claude Code의 행동(파일 읽기, 코드 수정, 명령 실행, 서브에이전트 생성 등)을 실시간 2D 픽셀 아트 사무실로 시각화하는 웹 대시보드 오픈소스 프로젝트. 스택: pnpm 모노레포(TypeScript) — Node(Fastify + WebSocket) 서버, Vite + React + PixiJS 프런트엔드, 공유 이벤트 계약 패키지.

## 하네스: Claude Office 개발

**목표:** Claude Code 훅 수집 → 로컬 실시간 서버 → 픽셀 사무실 씬까지 모듈 경계 계약이 어긋나지 않게 기능을 설계·구현·검증한다.

**호출 조건:** 기능 구현·추가, 이벤트 스키마 변경, 에셋 추가, 정합성 점검·감사, 문서 갱신, 그리고 이전 결과의 수정·재실행 요청을 받으면 `office-dev-orchestrator` 스킬을 사용한다. 단순 질문이나 한 줄 수정은 직접 처리해도 된다.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
| --- | --- | --- | --- |
| 2026-10-21 | Harness v2로 처음 구성 | 전체 | - |
| 2026-10-21 | 경로 선택(경량·표준·전체) 추가: 계약 변경 여부와 모듈 수로 단계 깊이를 정하고, 경량·표준은 architect 생략 + 마지막 QA 1회 | skills/office-dev-orchestrator | "작은 작업인데 왜 오래 걸리냐" 피드백 (서버+웹 요청이 전 단계를 거쳐 약 40분) |
| 2026-10-21 | 기획서 `docs/product-spec.md` 신설, architect·scene·artist와 오케스트레이터가 이를 기준으로 삼도록 연결 | agents/office-architect, office-scene-dev, pixel-artist, skills/pixel-office-scene, office-dev-orchestrator | "내가 원하는 기능을 담은 설계서가 없다" 피드백 (매핑이 임의로 정해져 있었음) |
| 2026-10-22 | 훅 확인 기록 첫 작성: Claude Code 2.1.306 실제 캡처(서브에이전트·중첩 포함) + 공식 문서 결과 | skills/claude-code-hooks/references/hook-notes.md | collector 구현 전 확인 절차(2절) 수행 |
