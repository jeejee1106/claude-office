import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createInitialState, type OfficeState, reduce } from '@claude-office/shared'
import { afterEach, describe, expect, it } from 'vitest'
import {
  accessoryOf,
  DEFAULT_EMPLOYEE_SETTINGS,
  EMPLOYEE_SETTINGS_VERSION,
  type EmployeeSettings,
  getEmployeeSettings,
  parseEmployeeSettings,
  resetEmployeeSettings,
  updateBoss,
  updateType,
} from '../src/employeeSettings'
import { accessoryName } from '../src/i18n'
import {
  ACCESSORIES,
  ACCESSORY_KINDS,
  type Accessory,
  type AccessoryAtlas,
  accessoryFrameName,
  isAccessory,
  missingAccessoryFrames,
  pickAccessoryFrame,
} from '../src/scene/accessory'
import { type CharacterCommand, isCharacterCommand } from '../src/scene/commands'
import { Director } from '../src/scene/director'
import { type CharacterAtlas, pickFrame, pickFrameName } from '../src/scene/render/characterSheet'
import type { CharacterView } from '../src/scene/render/types'
import { Roster } from '../src/scene/roster'
import { ev } from './helpers'

const settings = (p: Partial<EmployeeSettings>): EmployeeSettings => ({
  ...DEFAULT_EMPLOYEE_SETTINGS,
  ...p,
})

describe('직원 설정: 외모 소품', () => {
  afterEach(() => resetEmployeeSettings())

  it('목록·기본값: 없음 · 동그란 안경 · 선글라스 · 야구 모자 · 헤드폰 · 리본, 기본은 모두 없음', () => {
    expect([...ACCESSORIES]).toEqual([
      'none',
      'glasses',
      'sunglasses',
      'cap',
      'headphones',
      'ribbon',
    ])
    expect(ACCESSORIES.map((a) => accessoryName(a, 'ko'))).toEqual([
      '없음',
      '동그란 안경',
      '선글라스',
      '야구 모자',
      '헤드폰',
      '리본',
    ])
    for (const a of ACCESSORIES) expect(accessoryName(a, 'en')).not.toBe('')
    const d = DEFAULT_EMPLOYEE_SETTINGS
    expect(accessoryOf('main', undefined, d)).toBe('none')
    expect(accessoryOf('a1', 'Explore', d)).toBe('none')
  })

  it('소품 칸이 없는 옛 저장값도 그대로 읽힌다(구조 버전 그대로)', () => {
    const old = {
      v: EMPLOYEE_SETTINGS_VERSION,
      boss: { name: '김팀장', variant: 3 },
      types: { Explore: { name: '탐정', team: 'dev', variant: 5 } },
    }
    expect(parseEmployeeSettings(old)).toEqual(old)
    expect(accessoryOf('main', undefined, parseEmployeeSettings(old))).toBe('none')
  })

  it('고른 소품은 저장되고, 모르는 값·none 은 없음으로', () => {
    const s = parseEmployeeSettings({
      v: EMPLOYEE_SETTINGS_VERSION,
      boss: { accessory: 'cap' },
      types: {
        Explore: { accessory: 'ribbon', name: '탐정' },
        Plan: { accessory: 'crown' },
        'pixel-artist': { accessory: 'none' },
        bad: { accessory: 3 },
      },
    })
    expect(s).toEqual({
      v: EMPLOYEE_SETTINGS_VERSION,
      boss: { accessory: 'cap' },
      types: { Explore: { accessory: 'ribbon', name: '탐정' } },
    })
    expect(accessoryOf('main', undefined, s)).toBe('cap')
    expect(accessoryOf('a1', 'Explore', s)).toBe('ribbon')
    expect(accessoryOf('a2', 'Plan', s)).toBe('none')
    expect(accessoryOf('a3', 'toString', s)).toBe('none')
    expect(isAccessory('crown')).toBe(false)
  })

  it('update 로 바꾸고 none/undefined 로 되돌린다', () => {
    updateBoss({ accessory: 'sunglasses' })
    updateType('Explore', { accessory: 'headphones' })
    expect(getEmployeeSettings().boss).toEqual({ accessory: 'sunglasses' })
    expect(getEmployeeSettings().types.Explore).toEqual({ accessory: 'headphones' })
    updateBoss({ accessory: 'none' })
    updateType('Explore', { accessory: undefined })
    expect(getEmployeeSettings()).toEqual(DEFAULT_EMPLOYEE_SETTINGS)
  })
})

describe('소품 프레임 이름', () => {
  it('캐릭터 프레임 이름의 char_{v}_ → acc_{kind}_', () => {
    expect(accessoryFrameName('char_3_walk_left_2', 'cap')).toBe('acc_cap_walk_left_2')
    expect(accessoryFrameName('char_0_sofa_lie_down_0', 'ribbon')).toBe(
      'acc_ribbon_sofa_lie_down_0',
    )
    expect(accessoryFrameName('char_12_idle_stand_down_0', 'glasses')).toBe(
      'acc_glasses_idle_stand_down_0',
    )
    expect(accessoryFrameName('pet_dev_walk_left_0', 'cap')).toBeNull()
    expect(accessoryFrameName('xchar_1_walk_left_0', 'cap')).toBeNull()
  })

  const acc: AccessoryAtlas<string> = {
    frames: { acc_cap_walk_left_0: 'C0', acc_cap_walk_left_1: 'C1' },
  }

  it('없음·시트 없음·프레임 없음이면 그리지 않는다(null, 오류 없음)', () => {
    expect(pickAccessoryFrame(acc, 'cap', 'char_2_walk_left_1')).toBe('C1')
    expect(pickAccessoryFrame(acc, 'none', 'char_2_walk_left_1')).toBeNull()
    expect(pickAccessoryFrame(null, 'cap', 'char_2_walk_left_1')).toBeNull()
    expect(pickAccessoryFrame(acc, 'cap', 'char_2_walk_left_7')).toBeNull()
    expect(pickAccessoryFrame(acc, 'glasses', 'char_2_walk_left_0')).toBeNull()
    expect(pickAccessoryFrame(acc, 'cap', null)).toBeNull()
    expect(pickAccessoryFrame({ frames: {} }, 'cap', 'char_0_constructor_')).toBeNull()
  })

  it('캐릭터와 같은 순간의 프레임을 고른다(대체 그림·방향 무관 동작 포함)', () => {
    const names = {
      char_2_walk_left: ['char_2_walk_left_0', 'char_2_walk_left_1'],
      char_2_phone_down: ['char_2_phone_down_0', 'char_2_phone_down_1'],
      char_2_sofa_sit_down: ['char_2_sofa_sit_down_0'],
    }
    const chars: CharacterAtlas<string> = {
      animations: {
        char_2_walk_left: ['T0', 'T1'],
        char_2_phone_down: ['P0', 'P1'],
        char_2_sofa_sit_down: ['S0'],
      },
      frameMs: { walk: 140, phone: 300 },
      frameNames: names,
    }
    for (const t of [0, 139, 140, 300, 1000]) {
      const tex = pickFrame(chars, 2, 'walk', 'left', t)
      const name = pickFrameName(chars, 2, 'walk', 'left', t)
      expect(name?.endsWith(tex === 'T0' ? '_0' : '_1')).toBe(true)
    }
    // 앉아서 전화 = phone 프레임(대체 그림)과 같은 이름
    expect(pickFrameName(chars, 2, 'phone_sit', 'down', 300)).toBe('char_2_phone_down_1')
    expect(pickFrameName(chars, 2, 'sofa_sit', 'right', 0)).toBe('char_2_sofa_sit_down_0')
    // 이름 목록이 없으면(옛 아틀라스 모양) 소품 없이
    expect(pickFrameName({ animations: chars.animations, frameMs: {} }, 2, 'walk', 'left', 0)).toBe(
      null,
    )
  })

  it('빠진 소품 프레임 목록(변형과 상관없이 하나씩)', () => {
    const chars = ['char_0_walk_left_0', 'char_1_walk_left_0', 'char_0_walk_left_1']
    const has = (n: string) => n === 'acc_cap_walk_left_0'
    expect(missingAccessoryFrames(chars, has, ['cap'])).toEqual(['acc_cap_walk_left_1'])
    expect(missingAccessoryFrames(chars, () => false).length).toBe(2 * ACCESSORY_KINDS.length)
  })
})

describe('director·Roster: 소품을 캐릭터에 싣는다', () => {
  const charCmds = (out: ReturnType<Director['handle']>) =>
    out.filter((c): c is CharacterCommand => isCharacterCommand(c))

  it('spawn/place 에 소품(없음이면 싣지 않음), 설정을 바꾸고 다시 그리면 새 소품', () => {
    let s = settings({ boss: { accessory: 'cap' } })
    const director = new Director({ now: () => 0, employees: () => s })
    const evs = [
      ev({ kind: 'session.start' }),
      ev({ kind: 'agent.spawn', agentId: 'a1', agentType: 'Explore', parentAgentId: 'main' }),
    ]
    let state: OfficeState = createInitialState()
    const out: CharacterCommand[] = []
    for (const e of evs) {
      state = reduce(state, e)
      out.push(...charCmds(director.handle(e, state.sessions.s)))
    }
    const spawns = out.filter((c) => c.type === 'spawn')
    expect(spawns.map((c) => c.type === 'spawn' && [c.agentId, c.accessory])).toEqual([
      ['main', 'cap'],
      ['a1', undefined],
    ])
    s = settings({ types: { Explore: { accessory: 'glasses' } } })
    const placed = charCmds(director.syncAll(state, 's')).filter((c) => c.type === 'place')
    expect(placed.map((c) => c.type === 'place' && [c.agentId, c.accessory])).toEqual([
      ['main', undefined],
      ['a1', 'glasses'],
    ])
  })

  it('Roster 는 소품을 뷰 생성에 넘긴다(없으면 none)', () => {
    const made: [number, Accessory][] = []
    const view: CharacterView = {
      setPosition() {},
      setAnimation() {},
      setMark() {},
      setBubble() {},
      setLabel() {},
      setHighlight() {},
      setEffect() {},
      setAlpha() {},
      tick() {},
      destroy() {},
    }
    const roster = new Roster(
      (v, a) => {
        made.push([v, a])
        return view
      },
      () => {},
    )
    const base = {
      type: 'place' as const,
      cause: 'sync',
      label: 'x',
      spot: 'mainDesk' as const,
      slot: 0,
      anim: 'idle_sit' as const,
      bubble: null,
      mark: null,
    }
    roster.dispatch([
      { ...base, agentId: 'main', variant: 0, accessory: 'ribbon' },
      { ...base, agentId: 'a', variant: 4 },
    ])
    expect(made).toEqual([
      [0, 'ribbon'],
      [4, 'none'],
    ])
  })
})

const ACC_JSON = fileURLToPath(new URL('../public/assets/accessories.json', import.meta.url))
const CHAR_JSON = fileURLToPath(new URL('../public/assets/characters.json', import.meta.url))
type SheetJson = {
  frames: Record<string, { frame: { w: number; h: number }; anchor?: { x: number; y: number } }>
  meta: { image: string }
}

describe.skipIf(!existsSync(ACC_JSON))('실제 소품 시트 accessories.json', () => {
  const chars = JSON.parse(readFileSync(CHAR_JSON, 'utf8')) as SheetJson
  const acc = JSON.parse(readFileSync(ACC_JSON, 'utf8')) as SheetJson

  it('캐릭터 프레임마다 소품 프레임이 있고 크기·앵커가 같다', () => {
    const names = Object.keys(chars.frames)
    expect(missingAccessoryFrames(names, (n) => acc.frames[n] !== undefined)).toEqual([])
    for (const n of names)
      for (const k of ACCESSORY_KINDS) {
        const a = acc.frames[accessoryFrameName(n, k) ?? '']
        expect(a?.frame, `${n} ${k}`).toMatchObject({
          w: chars.frames[n]?.frame.w,
          h: chars.frames[n]?.frame.h,
        })
        expect(a?.anchor ?? { x: 0.5, y: 1 }).toEqual({ x: 0.5, y: 1 })
      }
    expect(acc.meta.image).toBe('accessories.png')
  })
})
