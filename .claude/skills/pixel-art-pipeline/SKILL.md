---
name: pixel-art-pipeline
description: "Claude Office의 픽셀 아트 에셋을 코드로 생성하는 파이프라인(packages/assets) 규칙. 팔레트, 그리드 크기, 캐릭터 스프라이트시트·타일셋·가구·아이콘 생성 스크립트, PixiJS 아틀라스 JSON, 프레임 명명 규칙, 캐릭터 색 변형을 다룬다. 새 스프라이트·애니메이션·가구를 추가하거나 기존 에셋 스타일을 바꿀 때 사용한다. 씬에서 에셋을 배치·재생하는 일은 pixel-office-scene을 사용한다."
---

# 픽셀 아트 파이프라인 (packages/assets)

## 1. 왜 코드로 그리는가

이미지 생성 도구 없이도 에셋을 만들 수 있고, 생성 스크립트가 원본이므로 diff 리뷰·재생성·색 변형이 쉽다. 외부 에셋을 쓰지 않으므로 오픈소스 라이선스 문제도 없다. **PNG는 산출물이고 원본은 스크립트다.** PNG를 직접 고치지 않는다.

## 2. 구성

```
packages/assets/
├── src/
│   ├── palette.ts       # 고정 팔레트 (이름 → hex)
│   ├── canvas.ts        # 픽셀 버퍼 + PNG 인코딩 (pngjs 등 순수 JS 라이브러리)
│   ├── sprites/         # 그림 정의: 문자열 그리드(아래 3절) 또는 그리기 함수
│   ├── build.ts         # 모든 시트를 그려 PNG + 아틀라스 JSON 출력
│   └── preview.ts       # 전체 프레임을 한 장에 확대해 preview.png 출력
└── package.json         # "build": "tsx src/build.ts"
출력 → apps/web/public/assets/{sheet}.png, {sheet}.json
```

## 3. 스타일 규칙

| 항목 | 규칙 | 이유 |
| --- | --- | --- |
| 타일 | 16×16 px | 사무실 가구·바닥의 기본 격자 |
| 캐릭터 | 16×24 px 프레임 (발끝 기준 앵커 0.5, 1) | 타일 위에 서서 머리가 살짝 위로 |
| 팔레트 | `palette.ts`의 색만 사용 (40색 이내) | 스타일 통일. 생성 시 팔레트 외 색이 있으면 build 실패. 2026-10-23 32 → 40: 나머지 방 바닥(마루·카펫·철판)과 서버랙 금속을 기존 색으로 만들면 업무 공간 크림 바닥·나무 가구와 구분이 안 돼서 5색 추가(36색) |
| 외곽선 | 어두운 1px 외곽선, 순검정 대신 팔레트의 짙은 남색 | 부드러운 인상 |
| 조명 | 광원은 좌상단 | 그림자 방향 통일 |
| 안티앨리어싱 | 금지 (완전 불투명 또는 완전 투명) | 확대 시 번짐 방지 |

스프라이트 정의는 문자 그리드를 권장한다 — 한 글자가 팔레트 색 하나에 대응하고, 리뷰어가 diff에서 그림을 읽을 수 있다.

```ts
// '.' 투명, 'o' 외곽선, 's' 피부, 'h' 머리, 'c' 셔츠(변형 색) …
const idle_down_0 = [
  '.....oooooo.....',
  '....ohhhhhho....',
  // ...
]
```

## 4. 프레임 명명 규칙

- 캐릭터: `char_{variant}_{action}_{dir}_{frame}` 예: `char_2_walk_left_1`
  - `dir`: `down|up|left|right` (방향 무관 행동은 `down`만)
  - `right`는 `left`를 좌우 반전해 생성
- 가구: `furn_{name}` 예: `furn_bookshelf`, `furn_desk`, `furn_server_rack`
- 타일: `tile_{name}_{n}`
- 아이콘·말풍선: `ui_{name}`
- 아틀라스 JSON의 `animations` 필드에 `char_{variant}_{action}_{dir}` → 프레임 배열을 넣어 PixiJS `AnimatedSprite`가 바로 쓰게 한다.

이름을 바꾸거나 지우는 것은 씬 코드를 깨뜨리는 계약 변경이다. 요약 파일에 "변경된 이름" 절을 두고 리더에게 알린다.

## 5. 색 변형

캐릭터는 하나의 그림 정의에서 `variant` 0..N-1(기본 8개)을 생성한다. 변형마다 셔츠·머리 색 쌍만 바꾼다. variant 0은 메인 에이전트 전용으로 예약한다.

## 6. 검증

- `pnpm --filter assets build` 성공, 팔레트 외 색 0개
- 생성된 `preview.png`를 Read 도구로 열어 직접 본다: 프레임 정렬, 반전 방향, 외곽선 끊김
- 필요한 애니메이션 목록(`pixel-office-scene/references/activity-mapping.md` 마지막 절)이 아틀라스에 모두 있는지 스크립트로 확인
