import type { SoundId } from './soundRules'

/*
 * 효과음 합성 — 소리 파일 없이 Web Audio API(사각파·삼각파)로 만든다 (기획서 7절 "효과음").
 * 테스트에서는 SoundPlayer 를 가짜로 바꾸거나, createWebAudioSynth 에 가짜 AudioContext 를 넘긴다.
 *
 * 브라우저 자동재생 정책: AudioContext 는 사용자 동작(소리 켜기 버튼) 안에서 unlock() 으로 만들거나
 * resume 한다. 만들 수 없으면(오래된 브라우저 등) 조용히 무시하고 콘솔 경고는 한 번만 남긴다.
 */

export interface SoundPlayer {
  /** 사용자 동작 안에서 부른다: AudioContext 를 만들거나 resume */
  unlock(): void
  play(id: SoundId): void
}

/** 음 하나: 시작(초, 소리 시작 기준) · 길이(초) · 주파수(Hz) */
interface Note {
  at: number
  dur: number
  freq: number
}
interface Voice {
  wave: OscillatorType
  gain: number
  notes: readonly Note[]
}

/** 전체 음량. 각 소리의 gain 에 곱한다 (2026-10-29 사용자: 2·1 은 큼. 0.5 가 안 들린 건 suspended 버그 탓으로 보임) */
export const MASTER_GAIN = 0.6

/** 소리 모양. 모두 0.1~0.4초 */
export const VOICES: Readonly<Record<SoundId, Voice>> = {
  // 직원 출근: 짧게 올라가는 "띠링" (C5 → G5), 0.18초
  spawn: {
    wave: 'square',
    gain: 0.06,
    notes: [
      { at: 0, dur: 0.08, freq: 523.25 },
      { at: 0.09, dur: 0.09, freq: 783.99 },
    ],
  },
  // 확인 요청: 높고 또렷한 "삐삐" (E6 두 번), 0.22초
  attention: {
    wave: 'square',
    gain: 0.07,
    notes: [
      { at: 0, dur: 0.07, freq: 1318.51 },
      { at: 0.13, dur: 0.09, freq: 1318.51 },
    ],
  },
  // 팀장 일 끝: 내려가는 "따라란" (G5 → E5 → C5), 부드러운 삼각파, 0.34초
  turnEnd: {
    wave: 'triangle',
    gain: 0.12,
    notes: [
      { at: 0, dur: 0.1, freq: 783.99 },
      { at: 0.11, dur: 0.1, freq: 659.25 },
      { at: 0.22, dur: 0.12, freq: 523.25 },
    ],
  },
}

/** 소리 길이(초) — 마지막 음이 끝나는 시각 */
export function voiceDuration(v: Voice): number {
  return Math.max(...v.notes.map((n) => n.at + n.dur))
}

type AudioContextFactory = () => AudioContext

function defaultFactory(): AudioContext {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContext
    webkitAudioContext?: new () => AudioContext
  }
  const Ctor = g.AudioContext ?? g.webkitAudioContext
  if (Ctor === undefined) throw new Error('Web Audio API 없음')
  return new Ctor()
}

export function createWebAudioSynth(
  factory: AudioContextFactory = defaultFactory,
  warn: (msg: string, err: unknown) => void = (m, e) => console.warn(m, e),
): SoundPlayer {
  let ctx: AudioContext | null = null
  let failed = false

  const fail = (err: unknown) => {
    if (failed) return
    failed = true
    warn('[claude-office] 효과음을 낼 수 없음(Web Audio 사용 불가) — 소리 없이 계속합니다', err)
  }

  const ensure = (): AudioContext | null => {
    if (ctx !== null || failed) return ctx
    try {
      ctx = factory()
    } catch (err) {
      fail(err)
    }
    return ctx
  }

  const resume = (c: AudioContext) => {
    if (c.state !== 'suspended') return
    try {
      void c.resume().catch(() => {
        // 사용자 동작 밖이라 거절됨 — 다음 동작에서 다시 시도한다
      })
    } catch {
      // 위와 같음
    }
  }

  return {
    unlock() {
      const c = ensure()
      if (c !== null) resume(c)
    },
    play(id) {
      const c = ensure()
      if (c === null) return
      if (c.state === 'running') {
        schedule(c, id)
        return
      }
      // 막 만든 AudioContext 는 resume 이 끝나야 running 이 된다 → 끝나면 그때 낸다
      if (c.state !== 'suspended') return
      try {
        c.resume()
          .then(() => {
            if (c.state === 'running') schedule(c, id)
          })
          .catch(() => {
            // 사용자 동작 밖이라 거절됨 — 이번 소리는 건너뛴다
          })
      } catch {
        // 위와 같음
      }
    },
  }

  function schedule(c: AudioContext, id: SoundId) {
    try {
      const voice = VOICES[id]
      const t0 = c.currentTime
      const out = c.createGain()
      out.gain.value = voice.gain * MASTER_GAIN
      out.connect(c.destination)
      for (const n of voice.notes) {
        const osc = c.createOscillator()
        const env = c.createGain()
        osc.type = voice.wave
        osc.frequency.value = n.freq
        // 딸깍 소리가 나지 않게 아주 짧게 올렸다 내린다
        const start = t0 + n.at
        const end = start + n.dur
        env.gain.setValueAtTime(0, start)
        env.gain.linearRampToValueAtTime(1, start + 0.005)
        env.gain.setValueAtTime(1, Math.max(start + 0.005, end - 0.02))
        env.gain.linearRampToValueAtTime(0, end)
        osc.connect(env)
        env.connect(out)
        osc.start(start)
        osc.stop(end + 0.01)
      }
    } catch (err) {
      fail(err)
    }
  }
}
