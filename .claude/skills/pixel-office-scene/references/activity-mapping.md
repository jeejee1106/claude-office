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
| `agent.idle` (서버가 60초 무활동 시 생성) | 자기 책상 `idle_sit`, `isAsleep()`(5분)이면 `sleep` (Zzz) |
| `tool.end` | 정상(`status: ok`): 자기 책상 복귀 `idle_sit` (soft — 다음 명령이 이미 있으면 생략). `status: error`: 머리 위 빨간 "!" 1초 + 제자리 `idle_stand` 1초 후 자기 책상 `idle_sit` |
| (모르는 kind) | 자기 책상 `idle_sit` (soft). throw 하지 않는다. 소켓 파서는 계약 밖 kind 를 콘솔 경고 후 버린다 |

### 화면 지연 규칙

씬은 서버 상태의 투영이다. 걷기는 경로 길이와 무관하게 최대 1.2초(뒤에 명령이 쌓여 있으면 0.6초) 안에 끝나고, 가장 오래 기다린 명령이 1.5초를 넘기면 현재 이동을 목적지로 순간이동시키고 중간 명령을 버린다. 퇴장(`leave`)은 2초 안에 반드시 사라진다. 시간은 `requestAnimationFrame` 간격이 아니라 실제 경과 시간(`performance.now()`)으로 계산한다.

## 필요한 애니메이션 목록 (pixel-artist 요청 기준)

`walk`(4방향), `idle_sit`, `idle_stand`, `type`, `read`, `search`, `look`, `wave`, `write_board`, `phone`, `idle_drink`, `raise_hand`, `shred`, `sleep`
