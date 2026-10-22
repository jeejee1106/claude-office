# 훅 확인 기록

`claude-code-hooks` 스킬 2절의 확인 절차로 확인한 사실을 누적한다. 추측은 적지 않는다.

- 문서: https://code.claude.com/docs/en/hooks (2026-10-22 열람)
- 실제 캡처: 2026-10-22, Claude Code **2.1.306**, macOS. `claude -p ... --settings <임시 settings.json> --model haiku` 로 Read → Edit → Bash → 실패하는 Bash(`false`) → Agent(Explore, 안에서 Read·Grep) 를 한 번씩 일으키고, stdin 을 파일로만 저장하는 임시 훅(12개 이벤트 등록)으로 20건을 받았다. 캡처 원본은 저장소 밖 스크래치 경로에 두었고, 민감정보를 지운 사본이 `packages/collector/test/fixtures/` 에 있다.
- fixture 의 `_fixture_source` 필드로 출처를 구분한다: `capture …` = 실제 캡처, `docs-derived …` = 문서 예시로 만든 것.

| 날짜 | Claude Code 버전 | 훅 / 항목 | 확인한 사실 | 근거(문서 URL 또는 fixture 경로) |
| --- | --- | --- | --- | --- |
| 2026-10-22 | 2.1.306 | 이벤트 목록 | 문서상 33개: SessionStart, Setup, UserPromptSubmit, UserPromptExpansion, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, MessageDisplay, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle, InstructionsLoaded, ConfigChange, CwdChanged, DirectoryAdded, FileChanged, WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, PreModelSwitch, PostModelSwitch, Elicitation, ElicitationResult, SessionEnd | 문서 |
| 2026-10-22 | 2.1.306 | 공통 필드 | `session_id`, `transcript_path`, `cwd`, `hook_event_name` 은 항상. `prompt_id`·`permission_mode`·`effort`(`{level}`)는 이벤트에 따라 있음(SessionStart 에는 없었음, SessionEnd 는 `prompt_id` 만). | 캡처 전체 |
| 2026-10-22 | 2.1.306 | SessionStart | `source`: `startup`(캡처). 문서상 `resume`/`clear`/`compact`/`fork`. `fork` 는 계약 enum 에 없음 → `.catch(undefined)` 로 빠짐. `-p` 에서는 `model`/`agent_type` 없음. | `SessionStart.json` |
| 2026-10-22 | 2.1.306 | SessionEnd | `reason`: 캡처 `other`. 문서상 `clear`/`resume`/`logout`/`prompt_input_exit`/`other`. SessionEnd 훅 기본 제한 1.5초. | `SessionEnd.json` |
| 2026-10-22 | 2.1.306 | UserPromptSubmit | `prompt` 에 원문 전체. collector 는 길이만 보낸다. | `UserPromptSubmit.json` |
| 2026-10-22 | 2.1.306 | PreToolUse | `tool_name`, `tool_input`, `tool_use_id`. `tool_input` 키: Read `{file_path}`, Edit `{file_path,old_string,new_string,replace_all}`, Bash `{command,description}`, Grep `{pattern,path,output_mode,-n}`, Agent `{description,prompt,subagent_type,run_in_background}`. | `PreToolUse.*.json` |
| 2026-10-22 | 2.1.306 | PostToolUse | PreToolUse 필드 + `tool_response`(도구별, Edit 은 `originalFile` 로 파일 전체를 담음) + `duration_ms`. `tool_use_id` 가 PreToolUse 와 같다(짝 맞추기 가능). | `PostToolUse.*.json` |
| 2026-10-22 | 2.1.306 | PostToolUseFailure | 실패한 도구는 PostToolUse 대신 이 훅만 온다. `error`(예 `"Exit code 1"`), `is_interrupt`, `tool_use_id`. | `PostToolUseFailure.Bash-fail.json` |
| 2026-10-22 | 2.1.306 | 서브에이전트 식별 | 서브에이전트 안의 도구 훅에는 `agent_id`(예 `a9d6fcc6fccdd5788`)와 `agent_type`(`Explore`)이 붙는다. 메인 에이전트 훅에는 없다. 문서: `agent_type` 은 `--agent` 세션의 메인에도 붙을 수 있으므로 **서브에이전트 판별은 `agent_id` 로만** 한다. | `PreToolUse.subagent-*.json` |
| 2026-10-22 | 2.1.306 | SubagentStart / Stop | `agent_id`, `agent_type`. **부모를 가리키는 필드는 없다**(부모 tool_use_id·부모 agent_id 없음). Stop 에는 `agent_transcript_path`, `last_assistant_message`, `stop_hook_active`. 순서: PreToolUse(Agent) → SubagentStart → 서브에이전트 도구들 → SubagentStop → PostToolUse(Agent). | `SubagentStart.json`, `SubagentStop.json` |
| 2026-10-22 | 2.1.306 | Agent 도구 PostToolUse | `tool_response.agentId` 가 SubagentStart 의 `agent_id` 와 **같음을 캡처로 확인**. PreToolUse(Agent) 시점에는 agent ID 를 알 수 없다. | `PostToolUse.Agent.json` |
| 2026-10-22 | 2.1.306 | Stop | `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session_crons`. | `Stop.json` |
| 2026-10-22 | 문서 | Notification | `message`, `title?`, `notification_type`: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `elicitation_url_dialog`, `elicitation_complete`, `elicitation_response`, `agent_needs_input`, `agent_completed`, `quota_auto_resume_*`, `plugin_notification`. `-p` 에서는 발생하지 않아 **캡처 못 함**. | 문서, `Notification.*.json`(docs-derived) |
| 2026-10-22 | 문서 | PreCompact | `trigger`(`manual`/`auto`), `custom_instructions`. **캡처 못 함**. | 문서, `PreCompact.json`(docs-derived) |
| 2026-10-22 | 문서 | PermissionRequest | PreToolUse 와 같은 `tool_name`/`tool_input` 이지만 **`tool_use_id` 없음**, `permission_suggestions`. `--allowedTools` 로 돌려 **캡처 못 함**. | 문서, `PermissionRequest.json`(docs-derived) |
| 2026-10-22 | 문서 | settings.json 형식 | `{"hooks": {"<Event>": [{"matcher": "...", "hooks": [{"type": "command", "command": "...", "timeout": <초>}]}]}}`. `matcher` 생략·`""`·`"*"` = 전체. command 기본 timeout 600초. `"async": true` 로 백그라운드 실행 가능(단 `-p` 종료 시 취소). | 문서 |
