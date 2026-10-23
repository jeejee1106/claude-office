import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ANIMATIONS } from '../src/scene/activityMap'
import {
  ANIM_FALLBACK,
  animKey,
  type CharacterAtlas,
  DEFAULT_FRAME_MS,
  DIRS,
  DOWN_ONLY,
  fallbackAnimationKeys,
  frameMsFor,
  missingAnimationKeys,
  parseFrameMs,
  pickFrame,
  resolveAnim,
  SIT_DROP_PX,
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

  it('앉아서 전화(phone_sit): 프레임이 없으면 phone 프레임을 SIT_DROP_PX 내려 그린다', () => {
    const a: CharacterAtlas<string> = {
      animations: { char_1_phone_down: ['p0', 'p1'] },
      frameMs: { phone: 300 },
    }
    expect(resolveAnim(a, 1, 'phone_sit', 'down')).toEqual({
      anim: 'phone',
      dy: SIT_DROP_PX,
      dir: 'down',
    })
    expect(SIT_DROP_PX).toBe(2)
    expect(pickFrame(a, 1, 'phone_sit', 'down', 0)).toBe('p0')
    expect(pickFrame(a, 1, 'phone_sit', 'down', 300)).toBe('p1')
    expect(pickFrame(a, 1, 'phone_sit', 'up', 0)).toBeNull()
    expect(missingAnimationKeys(a.animations, 2)).not.toContain('char_1_phone_sit_down')
    expect(fallbackAnimationKeys(a.animations, 2)).toEqual(['char_1_phone_sit_down'])
    // 아티스트가 진짜 앉은 전화 프레임을 넣으면 그쪽을 오프셋 없이 쓴다
    const drawn: CharacterAtlas<string> = {
      animations: { char_1_phone_down: ['p0'], char_1_phone_sit_down: ['s0'] },
      frameMs: {},
    }
    expect(resolveAnim(drawn, 1, 'phone_sit', 'down')).toEqual({
      anim: 'phone_sit',
      dy: 0,
      dir: 'down',
    })
    expect(pickFrame(drawn, 1, 'phone_sit', 'down', 0)).toBe('s0')
  })

  it('방향 무관 동작(sofa_sit·sofa_lie)은 캐릭터 방향과 관계없이 _down 키, 없으면 원래 방향의 대체 그림', () => {
    const a: CharacterAtlas<string> = {
      animations: {
        char_3_sofa_sit_down: ['s0', 's1'],
        char_3_sofa_lie_down: ['l0'],
        char_4_idle_sit_up: ['i0'],
        char_4_sleep_up: ['z0'],
      },
      frameMs: { sofa_sit: 600 },
    }
    expect([...DOWN_ONLY].sort()).toEqual(['sofa_lie', 'sofa_sit'])
    for (const d of DIRS) {
      expect(resolveAnim(a, 3, 'sofa_sit', d)).toEqual({ anim: 'sofa_sit', dy: 0, dir: 'down' })
      expect(pickFrame(a, 3, 'sofa_sit', d, 600)).toBe('s1')
      expect(pickFrame(a, 3, 'sofa_lie', d, 0)).toBe('l0')
    }
    // 프레임이 없는 변형: 소파를 향한 뒷모습(up)의 idle_sit / sleep
    expect(pickFrame(a, 4, 'sofa_sit', 'up', 0)).toBe('i0')
    expect(pickFrame(a, 4, 'sofa_lie', 'up', 0)).toBe('z0')
    expect(
      missingAnimationKeys(a.animations, 4).filter((k) => k.startsWith('char_3_sofa')),
    ).toEqual([])
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
    meta: { image: string; frameMs: Record<string, number>; downOnly?: string[] }
  }

  it('씬이 쓰는 모든 동작 × 4방향 × 변형 키가 있고 프레임이 실제로 존재한다', () => {
    expect(missingAnimationKeys(json.animations, VARIANT_COUNT)).toEqual([])
    for (const frames of Object.values(json.animations)) {
      for (const f of frames) expect(json.frames[f]).toBeDefined()
    }
  })

  it('프레임은 16×24(sofa_lie 만 32×16), 앵커 (0.5, 1) — 표시·말풍선·이름표 오프셋의 전제', () => {
    let lie = 0
    for (const [name, fr] of Object.entries(json.frames)) {
      // 누운 그림은 넓고 낮다(pixel-artist "2026-10-23 sofa"). 렌더러는 텍스처 크기를 그대로 쓴다
      if (/_sofa_lie_/.test(name)) {
        lie++
        expect(fr.frame, name).toMatchObject({ w: 32, h: 16 })
      } else expect(fr.frame, name).toMatchObject({ w: 16, h: 24 })
      expect(fr.anchor, name).toEqual({ x: 0.5, y: 1 })
    }
    expect(lie).toBe(VARIANT_COUNT * 2)
  })

  it('방향 무관 동작은 _down 키만 있고 meta.downOnly 와 같다', () => {
    expect([...(json.meta.downOnly ?? [])].sort()).toEqual([...DOWN_ONLY].sort())
    for (let v = 0; v < VARIANT_COUNT; v++)
      for (const a of DOWN_ONLY) {
        expect(json.animations[animKey(v, a, 'down')]?.length, `${v} ${a}`).toBeGreaterThan(0)
        for (const d of ['up', 'left', 'right'] as const)
          expect(json.animations[animKey(v, a, d)], `${v} ${a} ${d}`).toBeUndefined()
      }
  })

  it('모든 동작의 frameMs 가 있다(대체 그림으로 그리는 동작은 대체 동작의 frameMs)', () => {
    const ms = parseFrameMs(json.meta)
    const keys = new Set(fallbackAnimationKeys(json.animations, VARIANT_COUNT))
    for (const a of ANIMATIONS) {
      const viaFallback = keys.has(animKey(0, a, 'down'))
      expect(ms[viaFallback ? (ANIM_FALLBACK[a]?.anim ?? a) : a], a).toBeGreaterThan(0)
    }
    expect(json.meta.image).toBe('characters.png')
  })

  it('방향 목록은 down/up/left/right', () => {
    expect([...DIRS]).toEqual(['down', 'up', 'left', 'right'])
  })
})
