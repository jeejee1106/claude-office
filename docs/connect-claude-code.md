# 실제 Claude Code 연결하기

Claude Code의 훅에 `claude-office-hook`을 등록하면, 터미널에서 일하는 Claude Code의 행동이 로컬 서버(7333번 포트)로 전달되고 픽셀 사무실의 캐릭터가 움직입니다.

```
Claude Code ──훅(stdin JSON)──▶ claude-office-hook ──POST /events──▶ 서버(:7333) ──WS──▶ 웹(:5173)
```

## 1. 빌드

저장소 루트에서:

```bash
pnpm install
pnpm --filter @claude-office/collector build   # packages/collector/dist/ 에 훅·설치 도구 생성
```

## 2. 훅 설치

둘 중 하나를 고릅니다.

```bash
# 모든 Claude Code 세션에 적용 (~/.claude/settings.json)
node packages/collector/dist/claude-office.js install --user

# 특정 프로젝트에만 적용 (그 프로젝트의 .claude/settings.json)
cd ~/my-project
node /path/to/claude-office/packages/collector/dist/claude-office.js install --project
```

- 옵션을 생략하면 `--project`(현재 디렉터리)입니다.
- 이미 있는 다른 훅은 그대로 두고, Claude Office 항목만 12개 이벤트에 추가합니다.
- 바꾸기 전에 `settings.json.bak`을 만들고, 바뀐 내용을 diff로 보여 줍니다. 미리 보기만 하려면 `--dry-run`을 붙입니다.
- 여러 번 실행해도 중복되지 않습니다. 저장소 위치를 옮겼다면 다시 실행하면 경로가 갱신됩니다.
- 훅 명령은 `node "<저장소>/packages/collector/dist/claude-office-hook.js"`입니다. Claude Code가 실행되는 환경의 PATH에 `node`(22 이상)가 있어야 합니다.

이미 실행 중인 Claude Code 세션은 설정을 다시 읽어야 하므로 새로 시작하세요.

## 3. 대시보드 실행

```bash
pnpm dev
```

서버(`http://127.0.0.1:7333`)와 웹 개발 서버가 함께 뜹니다.

## 4. Claude Code 사용 → 브라우저로 보기

평소처럼 Claude Code를 쓰고 브라우저에서 **http://localhost:5173**을 엽니다. 파일을 읽으면 자료실로, 명령을 실행하면 서버실로, 서브에이전트를 부르면 새 팀원이 문으로 들어옵니다.

## 제거

```bash
node packages/collector/dist/claude-office.js uninstall --user      # 또는 --project
```

명령 문자열에 `claude-office-hook`이 들어 있는 항목만 지웁니다.

## 동작 원칙과 설정

| 항목 | 내용 |
| --- | --- |
| Claude Code를 막지 않음 | 훅은 항상 종료 코드 0으로 끝나고 아무것도 출력하지 않습니다. 서버가 꺼져 있으면 약 0.06초 만에 조용히 끝나고, 서버가 응답하지 않아도 0.5초 안에 끝납니다 |
| 보내는 정보 | 무엇을 하는지만 보냅니다: 도구 이름, 파일 이름(경로 없이), 명령 첫 단어, 검색어 앞부분, 서브에이전트 종류. 파일 내용, 프롬프트 원문, 명령 출력, 절대 경로는 보내지 않습니다 |
| `CLAUDE_OFFICE_URL` | 보낼 주소 (기본 `http://127.0.0.1:7333/events`) |
| `CLAUDE_OFFICE_DEBUG=1` | 훅이 무엇을 보냈는지, 왜 못 보냈는지를 stderr에 씁니다 |
| `CLAUDE_OFFICE_DISABLE=1` | 훅을 지우지 않고 잠시 끕니다 |

## 문제 해결

- **캐릭터가 움직이지 않음**: `curl http://127.0.0.1:7333/healthz`로 서버가 떠 있는지 확인합니다. 설치 후 Claude Code를 새로 시작했는지 확인합니다. 훅 하나를 직접 실행해 볼 수도 있습니다:
  ```bash
  echo '{"hook_event_name":"Stop","session_id":"test","cwd":"/tmp/demo"}' \
    | CLAUDE_OFFICE_DEBUG=1 node packages/collector/dist/claude-office-hook.js
  # 서버가 떠 있으면:  [claude-office-hook] turn.end → 202
  # 서버가 꺼져 있으면: [claude-office-hook] turn.end not sent: connect ECONNREFUSED 127.0.0.1:7333
  ```
- **"hook script not found"**: 1단계의 빌드를 먼저 실행합니다.
- **"is not valid JSON; not touching it"**: settings.json 문법 오류입니다. 설치 도구는 파일을 고치지 않으니 직접 고친 뒤 다시 실행합니다.
