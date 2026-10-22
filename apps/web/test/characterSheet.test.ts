import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ANIMATIONS } from '../src/scene/activityMap'
import {
  animKey,
  type CharacterAtlas,
  DEFAULT_FRAME_MS,
  DIRS,
  frameMsFor,
  missingAnimationKeys,
  parseFrameMs,
  pickFrame,
} from '../src/scene/render/characterSheet'
import { VARIANT_COUNT } from '../src/scene/variant'

describe('characterSheet 조회', () => {
  const atlas: CharacterAtlas<string> = {
    animations: { char_2_walk_left: ['a', 'b', 'c', 'd'], char_2_type_up: ['x', 'y'] },
    frameMs: { walk: 140 },
  }

  it('키 규칙 char_{variant}_{anim}_{dir}', () => {
    expect(animKey(3, 'idle_sit', 'down')).toBe('char_3_idle_sit_down')
  })

  it('frameMs 간격으로 프레임이 넘어가고 반복한다', () => {
    expect(pickFrame(atlas, 2, 'walk', 'left', 0)).toBe('a')
    expect(pickFrame(atlas, 2, 'walk', 'left', 139)).toBe('a')
    expect(pickFrame(atlas, 2, 'walk', 'left', 140)).toBe('b')
    expect(pickFrame(atlas, 2, 'walk', 'left', 140 * 4 + 1)).toBe('a')
  })

  it('frameMs 가 없는 동작은 기본 간격', () => {
    expect(frameMsFor(atlas, 'type')).toBe(DEFAULT_FRAME_MS)
    expect(pickFrame(atlas, 2, 'type', 'up', DEFAULT_FRAME_MS)).toBe('y')
  })

  it('없는 키는 null (플레이스홀더로 떨어짐)', () => {
    expect(pickFrame(atlas, 2, 'walk', 'right', 0)).toBeNull()
    expect(pickFrame(atlas, 5, 'walk', 'left', 0)).toBeNull()
  })

  it('parseFrameMs: 잘못된 값은 버린다', () => {
    expect(parseFrameMs(null)).toEqual({})
    expect(parseFrameMs({ frameMs: { walk: 140, bad: 'x', neg: -1, inf: Infinity } })).toEqual({
      walk: 140,
    })
  })
})

describe('실제 아틀라스 apps/web/public/assets/characters.json', () => {
  const path = fileURLToPath(new URL('../public/assets/characters.json', import.meta.url))
  const json = JSON.parse(readFileSync(path, 'utf8')) as {
    frames: Record<string, { frame: { w: number; h: number }; anchor?: { x: number; y: number } }>
    animations: Record<string, string[]>
    meta: { image: string; frameMs: Record<string, number> }
  }

  it('씬이 쓰는 모든 동작 × 4방향 × 변형 키가 있고 프레임이 실제로 존재한다', () => {
    expect(missingAnimationKeys(json.animations, VARIANT_COUNT)).toEqual([])
    for (const frames of Object.values(json.animations)) {
      for (const f of frames) expect(json.frames[f]).toBeDefined()
    }
  })

  it('프레임은 16×24, 앵커 (0.5, 1) — 표시·말풍선·이름표 오프셋의 전제', () => {
    for (const fr of Object.values(json.frames)) {
      expect(fr.frame).toMatchObject({ w: 16, h: 24 })
      expect(fr.anchor).toEqual({ x: 0.5, y: 1 })
    }
  })

  it('모든 동작의 frameMs 가 있다', () => {
    const ms = parseFrameMs(json.meta)
    for (const a of ANIMATIONS) expect(ms[a]).toBeGreaterThan(0)
    expect(json.meta.image).toBe('characters.png')
  })

  it('방향 목록은 down/up/left/right', () => {
    expect([...DIRS]).toEqual(['down', 'up', 'left', 'right'])
  })
})
