import type { AnimName, Effect, Mark } from '../activityMap'
import type { Dir, Prop } from '../layout'

/*
 * 렌더링 경계. Character(상태 머신)·director·OfficeScene 은 이 인터페이스만 안다.
 *
 * 지금 구현: PlaceholderRenderer (PixiJS Graphics 로 코드로 그린 픽셀 도형)
 * 교체 지점: pixel-artist 의 아틀라스(apps/web/public/assets/*.json)가 생기면
 *   AtlasRenderer 를 같은 인터페이스로 만들고 OfficeScene 의 createRenderer() 한 줄만 바꾼다.
 *   - CharacterView.setAnimation(anim, dir) → AnimatedSprite.textures = animations[`char_${variant}_${anim}_${dir}`]
 *   - PropView → Sprite(`furn_${kind}`), 바닥 → `tile_floor_{n}`, 표시 → `ui_{mark}`
 *
 * 좌표는 모두 기준 해상도 픽셀(layout.BASE_WIDTH × BASE_HEIGHT). 구현체는 그리기 직전에
 * Math.round 하고, 확대는 OfficeScene 이 정수 배율로만 한다.
 */

export interface CharacterView {
  /** 발끝 위치(기준 해상도 픽셀, 소수 허용 — 구현체가 반올림) */
  setPosition(x: number, y: number): void
  /** 애니메이션 이름은 activity-mapping.md 의 목록과 같은 문자열. 방향 무관 행동은 dir 무시 */
  setAnimation(anim: AnimName, dir: Dir): void
  /** 머리 위 표시 ("!", "?", Zzz, 식은땀). null 이면 숨김 */
  setMark(mark: Mark | null): void
  /** 말풍선 텍스트(target 표시). null 이면 숨김 */
  setBubble(text: string | null): void
  setLabel(text: string): void
  setHighlight(on: boolean): void
  /** 행동 중 이펙트(종이 쌓임·김 나는 컵·종이 조각·퇴근 가방) */
  setEffect(effect: Effect | null): void
  /** 등장·퇴장 페이드 (0..1) */
  setAlpha(a: number): void
  /** 프레임 진행. 경과 ms */
  tick(dtMs: number): void
  destroy(): void
}

export interface SceneRenderer {
  /** 바닥·벽·가구를 그린다(1회) */
  drawRoom(props: readonly Prop[]): void
  createCharacter(variant: number): CharacterView
  setLights(on: boolean): void
  /** 서버실 LED: busy 면 빠르게 깜빡임(명령 실행 중) */
  setServerBusy(busy: boolean): void
  /** 회의실 화이트보드 글씨 남김(세션에서 계획을 한 번이라도 함). 쓰는 중의 글씨는 렌더러가 따로 켠다 */
  setBoardWritten(written: boolean): void
  /** 매 프레임 호출(조명 전환 등 전역 애니메이션) */
  tick(dtMs: number): void
  /** 정수 배율이 바뀌었을 때(오버레이 DOM 위치 계산용) */
  setScale(scale: number): void
  destroy(): void
}
