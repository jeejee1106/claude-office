# 이벤트 → 사무실 행동 매핑 (기준표)

`apps/web/src/scene/activityMap.ts`와 1:1로 일치해야 한다. 바꿀 때 둘 다 바꾸고, 사용자 문서(README의 매핑 표)도 oss-docs-writer가 갱신한다.
무엇을 보여 줄지는 기획서 `docs/product-spec.md`가 정한다. 이 표는 그것을 스팟·애니메이션 이름으로 옮긴 것이다.

## 공간 (기획서 3절)

사무실 층 24×14 타일, 방은 칸막이 벽으로 구분되고 벽에 뚫린 출입구로만 오간다(`layout.ts` `ROOMS`·`INNER_WALLS`·`DOORWAYS`, 경로탐색은 벽을 지나지 않는다).

| 방 | 스팟 | 들어 있는 것 |
| --- | --- | --- |
| 업무 공간 | `mainDesk`(팀장 큰 책상 — 위쪽, face `down`), 팀 자리 `research1·2`(조사팀) `planning1·2`(기획팀) `design1·2`(디자인팀) `dev1·2`(개발팀, face `up`), `globe`(창가 지구본), `phone`, `door`(로비·출입문) | 팀 간판 4개, 책상·의자, 창문, 지구본, 전화기 |
| 자료실 | `bookshelf`, `cabinet`, `shredder` | 책장, 서류 캐비닛, 파쇄기 |
| 서버실 | `serverTerminal` | 서버랙 4대(LED 프레임 애니메이션: 평소 500ms, 명령 실행 중 100ms), 터미널 콘솔·모니터, 바닥 케이블 |
| 회의실 | `whiteboard`, `commonTable`(회의 테이블 — 서브 책상이 모자랄 때 공용 자리) | 화이트보드, 회의 테이블 |
| 휴게실 | `coffee`, `sofaSit`(소파에 앉기 — 왼쪽·오른쪽 2자리), `sofaLie`(소파에 눕기 — 1자리, 좌석 전부를 차지). 누가 누워 있으면 앉기·눕기 불가, 누가 앉아 있으면 눕기 불가, 앉기는 최대 2명. 소파는 방 쪽(위)을 향함 → face `up`(뒷모습), 소파 위 캐릭터는 깊이 y 209(소파 바로 위) | 커피머신, 소파, 러그, 화분 (작은 테이블은 두지 않음 — 2026-10-23 사용자 결정) |

### 방 가구 반응 (기획서 3절 "현재 구현", 5절 연출 칸)

가구는 새 연출을 만들지 않고 기존 행동에 붙는다(`render/officeSheet.ts` `roomActivity`, 사용자 확인 2026-10-23 — 유지).

| 가구 | 언제 | 그림 |
| --- | --- | --- |
| 출입문 | 누가 문 근처(등장·퇴장)에 있을 때 | `furn_door` → `furn_door_ajar` → `furn_door_open` (80ms, 지나가면 거꾸로 닫힘) |
| 서류 캐비닛 | `cabinet` 스팟에서 `search` 중 | `furn_cabinet_open` (서랍 열림) |
| 화이트보드 | `whiteboard` 스팟에서 `write_board` 중, **또는 그 세션에서 계획(`plan`)을 한 번이라도 한 뒤 세션이 끝날 때까지** | `furn_whiteboard_written`. 씬 명령 `board written` — `session.end` 에서 지움. 세션을 바꾸면 그 세션의 기억대로(계획한 적 없으면 빈 보드). 페이지를 새로 열면 기억이 없어 다음 계획 전까지 빈 보드(계획 여부는 상태 계약에 없음) |
| 커피머신 | `coffee` 스팟에서 `idle_drink` 중 | `furn_coffee_brew_0/1` (250ms) |
| 파쇄기 | `shredder` 스팟에서 `shred` 중 | `furn_shredder_on_0/1` (150ms) |
| 서버랙·터미널 | 아래 "서버실 LED" | `furn_server_rack_*`, `furn_terminal_busy_*` |

## 도구 이벤트 (`tool.start`)

| ToolCategory | 이동할 스팟 | 행동 애니메이션 | 말풍선(target 표시) |
| --- | --- | --- | --- |
| `read` | 책장 앞 | `read` (책 펼치기) | 📄 파일명 |
| `edit` | 자기 책상 | `type` (타이핑) | ✏️ 파일명 |
| `write` | 자기 책상 | `type` + 종이 쌓이는 이펙트 | 🆕 파일명 |
| `search` | 서류 캐비닛 | `search` (서랍 뒤지기) | 🔍 패턴 |
| `bash` | 서버실 터미널 | `type` (서서 타이핑) + 서버 LED 빠르게 깜빡임 | `>_` 명령 첫 단어 |
| `web` | 창가 지구본 | `look` | 🌐 |
| `agent` | 자기 책상 | `phone_sit` (앉은 채 전화기를 들고 팀원을 부름. brief: 1.5초 뒤 같은 자리 `idle_sit`, soft) | 📞 agentType (tool.end 까지 유지) |
| `plan` | 화이트보드 | `write_board` | 📋 |
| `mcp` | 전화기 | `phone` | ☎️ 서버명 |
| `other` | 자기 책상 | `idle_sit` | — |

`agent`(서브에이전트 호출): 팀장은 큰 책상(`mainDesk`, face `down`), 서브가 또 서브를 부르면(중첩) 자기 팀 책상(face `up`)에서 같은 동작. 다른 곳에 있었으면 자기 자리로 걸어가서 건다. 문 앞으로 가지 않는다 — 불린 팀원은 `agent.spawn` 으로 문에서 들어온다. Agent 도구는 서브가 끝나야 `tool.end` 가 오므로 전화는 `brief`(1.5초, `BRIEF_TOOL_MS`)만 들고, 뒤에 다른 도구가 오면 바로 끊긴다. 말풍선은 도구가 진행 중인 동안(`tool.end` 까지) 남는다. 다시 배치(`syncAll`)하면 진행 중이어도 자기 책상 `idle_sit` + 📞 말풍선.

`phone_sit` 프레임이 아틀라스에 없으면 `phone` 프레임을 앉은 높이(`SIT_DROP_PX` = 2px)만큼 내려 그린다(`characterSheet.ts` `ANIM_FALLBACK`, 다리는 책상·의자에 가려짐). `char_{v}_phone_sit_{dir}` 이 생기면 그쪽을 쓴다.

서버실 LED: 어떤 에이전트든 `bash` 도구를 실행 중이면(그 에이전트의 다음 이벤트 전까지) 씬 명령 `servers busy` → 0.1초 간격 깜빡임, 아니면 0.5초 간격.

## 생명주기 이벤트

대사 열은 `i18n.ts` `LINES` 의 상황 키다. 각 상황에 후보가 3개씩(ko/en) 있고, 이벤트 id 해시로 하나를 고른다(리플레이마다 같음). 첫 후보가 기획서에 적힌 대사.

| kind | 행동 | 대사 |
| --- | --- | --- |
| `session.start` | 사무실 조명 켜짐, 메인 캐릭터가 문으로 등장해 자기 책상으로. (그 밖의 이벤트라도 보고 있는 세션이 끝나지 않았는데 조명이 꺼져 있으면 켠다 — 서버 재시작 등으로 `session.start` 없이 세션이 생긴 경우. 끄는 쪽은 `session.end` 만) | `sessionStart` "출근했습니다!" (등장할 때) |
| `prompt.submit` | 자리에서 일어남 `idle_stand`(brief: 1.5초 뒤 자기 책상 `idle_sit`, soft) + 머리 위 "!" 0.8초 | `promptSubmit` "네, 알겠습니다!" |
| `agent.spawn` | 새 캐릭터 문에서 등장(`spawning`) → 자기 팀 책상의 빈자리(`agentType` → 팀: `apps/web/src/scene/teams.ts` 기본값 위에 직원 설정의 팀을 덮어씀 — `employeeSettings.toTeamConfig`), 팀 책상이 다 차면 `commonTable` | `subSpawn` "부르셨어요?" (등장할 때) |
| `agent.finish` | 팀장 책상 쪽을 보고 `report` 0.4초 → 그 자리에 `idle_stand` 3초 머묾 → 문으로 퇴장 | `subFinish` "퇴근하겠습니다!" (퇴장 내내, 약 4.8초) |
| `turn.end` | 휴게실에서 쉼 — 이벤트 id 해시(`pickLoungeRest`, 접두사 `lounge:`)로 셋 중 하나: 커피머신 `coffee` 에서 `idle_drink` + 김 나는 컵(`steam`) / 소파 `sofaSit` 에서 `sofa_sit` / 소파 `sofaLie` 에서 `sofa_lie`. 고른 소파 자리가 없으면(휴게실 행의 소파 규칙) 커피. 김은 커피일 때만 | `turnEnd` "휴~" (도착할 때, 셋 공통) |
| `attention` | 해당 캐릭터 `raise_hand` + 깜빡이는 "?" (사용자 확인 필요) | `attention` "확인 부탁드려요!" |
| `attention.clear` (사용자가 확인에 답함 — 허락) | "?" 를 내리고 손을 내려 하던 일로(`resume`, soft): 상태(reduce 뒤)에 `currentTool` 이 있으면 그 도구의 자리·동작과 말풍선(예: `bash` → 서버실 터미널 `type`, LED 다시 busy). `agent`(brief 전화)는 다시 걸지 않고 자기 책상 `idle_sit` + 📞 말풍선. 진행 중 도구가 없으면 자기 책상 `idle_sit`. "?" 가 이미 없거나, 상태에 attention 이 남아 있으면(reason 불일치) 아무것도 하지 않음. 화면에 없는 캐릭터를 새로 만들지 않음. 일반 도구는 collector 가 `[attention.clear, tool.end]` 를 함께 보내므로 soft 이동은 건너뛰고 바로 책상 복귀 | — (대사 없음) |
| `context.compact` | 자료실 파쇄기 앞 `shred` + 종이 조각 이펙트 | `compact` "정리 좀 할게요" (도착할 때) |
| `session.end` | 전원 `pack`(짐 챙기기) 0.4초 → 가방 들고 문으로 퇴장. 마지막 사람이 나가면 조명 꺼짐 | `sessionEnd` "퇴근하겠습니다!" (퇴장 내내) |
| `agent.idle` (서버가 60초 무활동 시 생성) | 자기 책상 `idle_sit`, `isAsleep()`(5분)이면 `sleep` (Zzz). 예외: 소파에 누워(`sofaLie`) 있으면 책상으로 가지 않고 그 자리에서 Zzz 만(주기 검사 `refreshSleep` 도 같음) | — |
| `tool.end` | 정상(`status: ok`): 자기 책상 복귀 `idle_sit` (soft — 다음 명령이 이미 있으면 생략). `status: error`: 그 자리에서 `flinch`(멈칫) + 식은땀(`sweat`) 1.2초 후 자기 책상 `idle_sit`. 같은 캐릭터가 사이에 ok 없이 3회 이상 연속 실패하면 `head_hold`(머리 감싸기) + 땀 증가(`sweat_heavy`) | `error` "앗…" / `errorRepeated` "이상하다…" |
| (모르는 kind) | 자기 책상 `idle_sit` (soft). throw 하지 않는다. 소켓 파서는 계약 밖 kind 를 콘솔 경고 후 버린다 | — |

연속 에러 수는 상태(계약)에 없으므로 web 의 director 가 이벤트 열로 센다(캐릭터별, ok `tool.end` 에서 0으로, 다시 배치(`syncAll`)하면 0부터).

### 직원 설정 (기획서 4절 "직원 설정", `apps/web/src/employeeSettings.ts`)

- 저장: localStorage `claude-office.employees` = `{ v: 1, boss: { name?, variant? }, types: { [agentType]: { name?, team?, variant? } } }`. 버전이 다르거나 깨진 값이면 기본값, 틀린 칸만 버린다. 빈 칸은 기본 규칙.
- 이름표(`spawn`/`place` 의 `label`)·직원 목록·타임라인 "who" 는 모두 `displayNames(session, settings)`: 정한 이름 → 없으면 `main` / 종류 이름 / id 앞 8자. 지금 사무실에 있는(gone 아닌) 사람 중 같은 이름이 2명 이상이면 상태의 에이전트 순서대로 두 번째부터 "이름 2". 퇴장한 사람은 번호 없이. 번호가 바뀌면(앞사람 퇴장 등) director 가 즉시 명령 `label` 로 이름표를 바꾼다.
- 색 변형: 정한 값(0..7, 팀장도 고를 수 있음) → 없으면 `variant.ts` 규칙(main=0, `FIXED_VARIANTS`, 해시).
- 팀: 정한 팀 → 없으면 `teams.ts`. 팀장은 팀 없음.
- 설정이 바뀌면 씬은 층 전환과 같은 `resync`(`syncAll`)로 상태대로 다시 그린다 — 팀을 바꾼 팀원은 즉시 새 팀 책상에 앉은 채로 나타난다(걸어가지 않음). 대사 선택(이벤트 id 해시)은 이름과 무관.

### 말풍선·대사 규칙 (기획서 6절)

- 말풍선은 한 사람당 하나. 새 말풍선(도구든 대사든)이 뜨면 이전 것은 즉시 사라진다.
- 도구 말풍선이 대사보다 우선: 도구 말풍선은 대사를 즉시 대체하고, 대사는 도구 말풍선을 덮지 않는다(도구 사용이 없는 순간에만 뜬다).
- 대사는 1.5초(`SPEECH_MS`) 뒤 사라진다. 대사를 띄우는 제자리 행동(멈칫·잠깐 일어남)은 뒤에 도구 명령이 오면 최소 0.6초(`DIALOG_MIN_MS`) 뒤 끊긴다. 퇴장 대사는 사라질 때까지 유지.

### 화면 지연 규칙

씬은 서버 상태의 투영이다. 걷기는 경로 길이와 무관하게 최대 1.2초(뒤에 명령이 쌓여 있으면 0.6초) 안에 끝나고, 가장 오래 기다린 명령이 1.5초를 넘기면 현재 이동을 목적지로 순간이동시키고 중간 명령을 버린다. 퇴장(`leave`)은 시작 후 2초 안에 반드시 사라진다 — 준비 동작이 있는 퇴장 중 `pack`(퇴근)은 준비 0.4초 + 걷기 1.1초 + 페이드 0.3초 = 1.8초로 고정해, 대사가 보일 만큼 머물면서도 이 한도를 지킨다. 예외(기획서 2절): `report`(서브 완료)는 준비 0.4초 + 머묾 3초 + 걷기 1.1초 + 페이드 0.3초 = 4.8초이고 한도는 5초(`LEAVE_REPORT_MAX_MS`). 머무는 서브가 비운 책상은 새 서브에게 5초 동안 배정하지 않는다(빈 책상이 그것뿐이면 배정). 조명 끄기는 퇴장 중인 마지막 캐릭터가 사라질 때까지 미룬다(최대 약 2초) — 조명 끄기가 오면 머무는 서브는 머묾을 끊고 바로 문으로 나간다. 재접속(resync)·세션 전환 때는 퇴장 중인 캐릭터를 즉시 지운다. 시간은 `requestAnimationFrame` 간격이 아니라 실제 경과 시간(`performance.now()`)으로 계산한다.

## 필요한 애니메이션 목록 (pixel-artist 요청 기준)

`walk`(4방향), `idle_sit`, `idle_stand`, `type`, `read`, `search`, `look`, `wave`, `write_board`, `phone`, `phone_sit`(앉아서 전화 — 없으면 phone 프레임을 2px 내려 그림), `idle_drink`, `sofa_sit`(소파에 앉은 뒷모습 16×24, 방향 무관 down 키만 — 없으면 idle_sit 프레임), `sofa_lie`(소파에 눕기 32×16, 방향 무관 down 키만 — 없으면 sleep 프레임), `raise_hand`, `shred`, `sleep`, `flinch`, `head_hold`, `pack`, `report`
