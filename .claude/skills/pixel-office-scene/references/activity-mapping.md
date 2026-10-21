# 이벤트 → 사무실 행동 매핑 (기준표)

`apps/web/src/scene/activityMap.ts`와 1:1로 일치해야 한다. 바꿀 때 둘 다 바꾸고, 사용자 문서(README의 매핑 표)도 oss-docs-writer가 갱신한다.
무엇을 보여 줄지는 기획서 `docs/product-spec.md`가 정한다. 이 표는 그것을 스팟·애니메이션 이름으로 옮긴 것이다.

## 공간 (기획서 3절)

사무실 층 24×14 타일, 방은 칸막이 벽으로 구분되고 벽에 뚫린 출입구로만 오간다(`layout.ts` `ROOMS`·`INNER_WALLS`·`DOORWAYS`, 경로탐색은 벽을 지나지 않는다).

| 방 | 스팟 | 들어 있는 것 |
| --- | --- | --- |
| 업무 공간 | `mainDesk`(창가 큰 책상), `desk1`~`desk4`, `globe`(창가 지구본), `phone`, `door`(로비·출입문) | 책상·모니터, 창문, 지구본, 전화기 |
| 자료실 | `bookshelf`, `cabinet`, `shredder` | 책장, 서류 캐비닛, 파쇄기 |
| 서버실 | `serverTerminal` | 서버랙 5대(깜빡이는 LED), 터미널 콘솔·모니터, 바닥 케이블 |
| 회의실 | `whiteboard`, `commonTable`(회의 테이블 — 서브 책상이 모자랄 때 공용 자리) | 화이트보드, 회의 테이블 |
| 휴게실 | `coffee` | 커피머신, 소파, 화분 |

## 도구 이벤트 (`tool.start`)

| ToolCategory | 이동할 스팟 | 행동 애니메이션 | 말풍선(target 표시) |
| --- | --- | --- | --- |
| `read` | 책장 앞 | `read` (책 펼치기) | 📄 파일명 |
| `edit` | 자기 책상 | `type` (타이핑) | ✏️ 파일명 |
| `write` | 자기 책상 | `type` + 종이 쌓이는 이펙트 | 🆕 파일명 |
| `search` | 서류 캐비닛 | `search` (서랍 뒤지기) | 🔍 패턴 |
| `bash` | 서버실 터미널 | `type` (서서 타이핑) + 서버 LED 빠르게 깜빡임 | `>_` 명령 첫 단어 |
| `web` | 창가 지구본 | `look` | 🌐 |
| `agent` | 문 앞 | `wave` (문 쪽으로 손짓, 새 직원 맞이) | 👋 agentType |
| `plan` | 화이트보드 | `write_board` | 📋 |
| `mcp` | 전화기 | `phone` | ☎️ 서버명 |
| `other` | 자기 책상 | `idle_sit` | — |

서버실 LED: 어떤 에이전트든 `bash` 도구를 실행 중이면(그 에이전트의 다음 이벤트 전까지) 씬 명령 `servers busy` → 0.1초 간격 깜빡임, 아니면 0.5초 간격.

## 생명주기 이벤트

대사 열은 `i18n.ts` `LINES` 의 상황 키다. 각 상황에 후보가 3개씩(ko/en) 있고, 이벤트 id 해시로 하나를 고른다(리플레이마다 같음). 첫 후보가 기획서에 적힌 대사.

| kind | 행동 | 대사 |
| --- | --- | --- |
| `session.start` | 사무실 조명 켜짐, 메인 캐릭터가 문으로 등장해 자기 책상으로 | `sessionStart` "출근했습니다!" (등장할 때) |
| `prompt.submit` | 자리에서 일어남 `idle_stand`(brief: 1.5초 뒤 자기 책상 `idle_sit`, soft) + 머리 위 "!" 0.8초 | `promptSubmit` "네, 알겠습니다!" |
| `agent.spawn` | 새 캐릭터 문에서 등장(`spawning`) → 배정된 책상 | `subSpawn` "부르셨어요?" (등장할 때) |
| `agent.finish` | 팀장 책상 쪽을 보고 `report` 0.4초 → 문으로 퇴장 | `subFinish` "다녀왔습니다!" (퇴장 내내) |
| `turn.end` | 휴게실 커피머신으로 이동 후 `idle_drink` + 김 나는 컵 이펙트 | `turnEnd` "휴~" (도착할 때) |
| `attention` | 해당 캐릭터 `raise_hand` + 깜빡이는 "?" (사용자 확인 필요) | `attention` "확인 부탁드려요!" |
| `context.compact` | 자료실 파쇄기 앞 `shred` + 종이 조각 이펙트 | `compact` "정리 좀 할게요" (도착할 때) |
| `session.end` | 전원 `pack`(짐 챙기기) 0.4초 → 가방 들고 문으로 퇴장. 마지막 사람이 나가면 조명 꺼짐 | `sessionEnd` "퇴근하겠습니다!" (퇴장 내내) |
| `agent.idle` (서버가 60초 무활동 시 생성) | 자기 책상 `idle_sit`, `isAsleep()`(5분)이면 `sleep` (Zzz) | — |
| `tool.end` | 정상(`status: ok`): 자기 책상 복귀 `idle_sit` (soft — 다음 명령이 이미 있으면 생략). `status: error`: 그 자리에서 `flinch`(멈칫) + 식은땀(`sweat`) 1.2초 후 자기 책상 `idle_sit`. 같은 캐릭터가 사이에 ok 없이 3회 이상 연속 실패하면 `head_hold`(머리 감싸기) + 땀 증가(`sweat_heavy`) | `error` "앗…" / `errorRepeated` "이상하다…" |
| (모르는 kind) | 자기 책상 `idle_sit` (soft). throw 하지 않는다. 소켓 파서는 계약 밖 kind 를 콘솔 경고 후 버린다 | — |

연속 에러 수는 상태(계약)에 없으므로 web 의 director 가 이벤트 열로 센다(캐릭터별, ok `tool.end` 에서 0으로, 다시 배치(`syncAll`)하면 0부터).

### 말풍선·대사 규칙 (기획서 6절)

- 말풍선은 한 사람당 하나. 새 말풍선(도구든 대사든)이 뜨면 이전 것은 즉시 사라진다.
- 도구 말풍선이 대사보다 우선: 도구 말풍선은 대사를 즉시 대체하고, 대사는 도구 말풍선을 덮지 않는다(도구 사용이 없는 순간에만 뜬다).
- 대사는 1.5초(`SPEECH_MS`) 뒤 사라진다. 대사를 띄우는 제자리 행동(멈칫·잠깐 일어남)은 뒤에 도구 명령이 오면 최소 0.6초(`DIALOG_MIN_MS`) 뒤 끊긴다. 퇴장 대사는 사라질 때까지 유지.

### 화면 지연 규칙

씬은 서버 상태의 투영이다. 걷기는 경로 길이와 무관하게 최대 1.2초(뒤에 명령이 쌓여 있으면 0.6초) 안에 끝나고, 가장 오래 기다린 명령이 1.5초를 넘기면 현재 이동을 목적지로 순간이동시키고 중간 명령을 버린다. 퇴장(`leave`)은 시작 후 2초 안에 반드시 사라진다 — 준비 동작이 있는 퇴장(`pack`·`report`)은 준비 0.4초 + 걷기 1.1초 + 페이드 0.3초 = 1.8초로 고정해, 대사가 보일 만큼 머물면서도 이 한도를 지킨다. 조명 끄기는 퇴장 중인 마지막 캐릭터가 사라질 때까지 미룬다(최대 약 2초). 시간은 `requestAnimationFrame` 간격이 아니라 실제 경과 시간(`performance.now()`)으로 계산한다.

## 필요한 애니메이션 목록 (pixel-artist 요청 기준)

`walk`(4방향), `idle_sit`, `idle_stand`, `type`, `read`, `search`, `look`, `wave`, `write_board`, `phone`, `idle_drink`, `raise_hand`, `shred`, `sleep`, `flinch`, `head_hold`, `pack`, `report`
