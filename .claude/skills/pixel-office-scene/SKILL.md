---
name: pixel-office-scene
description: "Claude Office 프런트엔드(apps/web, Vite + React + PixiJS v8)의 픽셀 사무실 씬 구현 규칙. 타일맵·가구 배치, 캐릭터 이동·애니메이션 상태 머신, 이벤트→행동 매핑, 서브에이전트 입·퇴장, 말풍선, 대시보드 UI(타임라인·에이전트 목록·연결 상태)를 만들거나 고칠 때 사용한다. 스프라이트 자체를 그리는 일은 pixel-art-pipeline을 사용한다."
---

# 픽셀 사무실 씬 (apps/web)

## 1. 구성

```
apps/web/src/
├── net/socket.ts          # WS 연결·재접속(지수 백오프), ServerMessage safeParse
├── store/                 # 요약 상태(zustand 등) — React UI용
├── scene/
│   ├── OfficeScene.ts     # PixiJS Application, 레이어(바닥·가구·캐릭터·UI오버레이)
│   ├── layout.ts          # 타일맵·가구 좌표·"스팟"(책장 앞, 책상 i, 서버랙 앞 …)
│   ├── Character.ts       # 스프라이트 + 상태 머신
│   ├── director.ts        # OfficeEvent → 캐릭터 명령 변환 (매핑 테이블 사용)
│   ├── activityMap.ts     # ToolCategory/kind → 스팟·애니메이션 매핑 (단일 테이블)
│   └── pathfinding.ts     # 타일 그리드 A* (또는 단순 L자 이동으로 시작)
└── ui/                    # React: Timeline, AgentList, ConnectionBadge, Tooltip
```

## 2. 데이터 흐름

```
WS snapshot → store 초기화 + director.syncAll(state)  (캐릭터를 상태대로 즉시 배치, 애니메이션 없음)
WS event    → reduce로 store 갱신 + director.handle(event) (애니메이션 큐에 추가)
```

- 씬은 서버 상태의 투영이다. 이벤트를 놓치거나 탭이 백그라운드였다면 snapshot/상태로 다시 맞춘다(`syncAll`).
- 캐릭터마다 명령 큐를 두되, 큐가 3개를 넘으면 중간 명령을 버리고 마지막 목표로 바로 이동한다. 도구 호출은 초당 여러 번 일어나므로 전부 재생하면 화면이 실제보다 수십 초 뒤처진다.

## 3. 이벤트→행동 매핑

무엇을 보여 줄지는 **기획서 `docs/product-spec.md`**가 정한다(공간, 캐릭터, 상황별 행동·대사·연출). `references/activity-mapping.md`는 기획서를 구현 단위(스팟·애니메이션 이름)로 옮긴 표다. 기획서가 바뀌면 매핑 표와 코드를 같은 작업에서 맞춘다.

사람이 읽는 구현 기준표는 `references/activity-mapping.md`다. 코드의 `activityMap.ts`는 이 표와 1:1로 일치해야 하며, 한쪽을 바꾸면 다른 쪽도 같은 작업에서 바꾼다(integration-qa가 대조한다).

## 4. 캐릭터 상태 머신

```
spawning(문에서 등장) → walking(목표 스팟) → acting(행동 애니메이션 루프)
      ↑                    ↓ 새 명령                 ↓ tool.end / 타임아웃
      └──────────────── idle(자기 책상 or 커피머신) ◀──┘
leaving(agent.finish / session.end → 문으로 이동 후 제거)
```

- 메인 에이전트는 고정 책상(창가 큰 책상), 서브에이전트는 빈 책상을 순서대로 배정. 책상이 모자라면 공용 테이블.
- 서브에이전트 색 변형은 `agentType` 해시로 결정적으로 고른다(pixel-art-pipeline의 변형 수 범위 안에서).
- 같은 스팟에 여러 명이 가면 스팟의 대기 오프셋 슬롯을 사용해 겹치지 않게 한다.
- `tool.end`의 `status: error` → 머리 위 빨간 "!" 1초 후 idle.

## 5. 픽셀 퍼펙트 렌더링

- 기준 해상도(예: 320×180 타일 단위) 고정 → 창 크기에 맞는 **정수 배율**로 확대.
- 텍스처 `scaleMode: 'nearest'`, 좌표는 렌더 직전 `Math.round`.
- 텍스트(이름표·말풍선)는 비트맵 폰트 또는 정수 배율 후 오버레이 DOM으로 그린다(흐릿한 벡터 폰트 금지).

## 6. 에셋 참조

- `Assets.load`로 아틀라스 JSON을 불러오고, 프레임 이름은 pixel-artist 요약 파일의 목록에 있는 것만 쓴다.
- 프레임 이름 규칙: `pixel-art-pipeline` 스킬 참고 (`char_{variant}_{action}_{dir}_{frame}` 등).
- 없는 에셋은 플레이스홀더(팔레트 색 사각형)로 그리고 콘솔 경고를 남긴다 — 화면이 깨지지 않게.

## 7. UI

- React는 요약 상태만 구독한다(에이전트 목록, 최근 이벤트 50개). 프레임마다 setState 하지 않는다.
- 타임라인 항목 클릭 시 해당 캐릭터를 하이라이트.
- 연결 끊김 시 화면 상단 배지 + 사무실을 어둡게. 재접속하면 snapshot으로 복원.

## 8. 테스트

- `director`·`activityMap`: 이벤트 열 → 캐릭터 명령 열 단위 테스트(vitest, PixiJS 없이 돌도록 명령 생성과 렌더링을 분리)
- 서버 `--replay`로 샘플 세션을 재생해 수동 확인 (QA는 `integration-qa` 스킬의 스크립트 사용)
