# 이벤트 → 사무실 행동 매핑 (기준표)

`apps/web/src/scene/activityMap.ts`와 1:1로 일치해야 한다. 바꿀 때 둘 다 바꾸고, 사용자 문서(README의 매핑 표)도 oss-docs-writer가 갱신한다.

## 도구 이벤트 (`tool.start`)

| ToolCategory | 이동할 스팟 | 행동 애니메이션 | 말풍선(target 표시) |
| --- | --- | --- | --- |
| `read` | 책장 앞 | `read` (책 펼치기) | 📄 파일명 |
| `edit` | 자기 책상 | `type` (타이핑) | ✏️ 파일명 |
| `write` | 자기 책상 | `type` + 종이 쌓이는 이펙트 | 🆕 파일명 |
| `search` | 서류 캐비닛 | `search` (서랍 뒤지기) | 🔍 패턴 |
| `bash` | 서버 랙/터미널 | `type` (서서 타이핑) | `>_` 명령 첫 단어 |
| `web` | 창가 지구본 | `look` | 🌐 |
| `agent` | 문 앞 | `wave` (새 직원 맞이) | 👋 agentType |
| `plan` | 화이트보드 | `write_board` | 📋 |
| `mcp` | 전화기 | `phone` | ☎️ 서버명 |
| `other` | 자기 책상 | `idle_sit` | — |

## 생명주기 이벤트

| kind | 행동 |
| --- | --- |
| `session.start` | 사무실 조명 켜짐, 메인 캐릭터가 문으로 등장해 자기 책상으로 |
| `prompt.submit` | 메인 캐릭터 머리 위 "!" 0.8초 |
| `agent.spawn` | 새 캐릭터 문에서 등장(`spawning`) → 배정된 책상 |
| `agent.finish` | 해당 캐릭터 문으로 이동 후 퇴장 |
| `turn.end` | 메인 캐릭터 커피머신으로 이동 후 `idle_drink` |
| `attention` | 해당 캐릭터 `raise_hand` + 깜빡이는 "?" (사용자 확인 필요) |
| `context.compact` | 메인 캐릭터 파쇄기 앞 `shred` |
| `session.end` | 전원 퇴장, 조명 꺼짐 |
| 60초 무활동 (서버 idle) | 자기 책상 `idle_sit`, 오래되면 `sleep` (Zzz) |

## 필요한 애니메이션 목록 (pixel-artist 요청 기준)

`walk`(4방향), `idle_sit`, `idle_stand`, `type`, `read`, `search`, `look`, `wave`, `write_board`, `phone`, `idle_drink`, `raise_hand`, `shred`, `sleep`
