import { useEffect, useSyncExternalStore } from 'react'
import { audioHooks, getAudioCtx } from './sound'

/**
 * 背景音樂：用 Web Audio 即時合成，不用音檔。
 * - 每個情境（scene）是一段可無限循環的生成式配樂。
 * - 切換情境時新舊兩段交叉淡入淡出；開關音樂、切到背景也都會淡入淡出。
 * - 任務提示音響起時，音樂會暫時壓低（ducking），避免蓋過提示。
 */
export type Scene = 'lobby' | 'reveal' | 'hiding' | 'stealth' | 'hunt' | 'task' | 'results'

const ENABLED_KEY = 'hs.music'
const MASTER_LEVEL = 0.8
const CROSSFADE = 2.5 // 秒
const FADE = 1.2
const LOOKAHEAD = 0.3
const TICK_MS = 25

// ───────────────────────── 音色 ─────────────────────────

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

interface Voices {
  pad(notes: number[], t: number, dur: number, level?: number, cutoff?: number): void
  pluck(note: number, t: number, level?: number): void
  bell(note: number, t: number, level?: number): void
  bass(note: number, t: number, dur: number, level?: number): void
  kick(t: number, level?: number): void
  tick(t: number, level?: number): void
  riser(t: number, dur: number, level?: number): void
}

export function makeVoices(ctx: AudioContext, out: AudioNode, send: AudioNode, noise: AudioBuffer): Voices {
  /** 一個音的出口：乾聲到 out、部分送進殘響 */
  const route = (node: AudioNode, wet: number) => {
    node.connect(out)
    if (wet > 0) {
      const s = ctx.createGain()
      s.gain.value = wet
      node.connect(s).connect(send)
    }
  }
  const env = (g: GainNode, t: number, level: number, attack: number, hold: number, release: number) => {
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(level, t + attack)
    g.gain.setValueAtTime(level, t + attack + hold)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release)
  }
  return {
    pad(notes, t, dur, level = 0.05, cutoff = 900) {
      const g = ctx.createGain()
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = cutoff
      f.Q.value = 0.4
      f.connect(g)
      const attack = Math.min(1.8, dur / 3)
      env(g, t, level, attack, Math.max(0, dur - attack - 1.5), 1.5)
      for (const n of notes)
        for (const detune of [-7, 7]) {
          const o = ctx.createOscillator()
          o.type = 'sawtooth'
          o.frequency.value = hz(n)
          o.detune.value = detune
          o.connect(f)
          o.start(t)
          o.stop(t + dur + 0.1)
        }
      route(g, 0.5)
    },
    pluck(note, t, level = 0.08) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      const f = ctx.createBiquadFilter()
      o.type = 'triangle'
      o.frequency.value = hz(note)
      f.type = 'lowpass'
      f.frequency.setValueAtTime(3200, t)
      f.frequency.exponentialRampToValueAtTime(600, t + 0.5)
      env(g, t, level, 0.005, 0, 0.7)
      o.connect(f).connect(g)
      route(g, 0.35)
      o.start(t)
      o.stop(t + 0.8)
    },
    bell(note, t, level = 0.05) {
      const g = ctx.createGain()
      env(g, t, level, 0.004, 0, 2.6)
      for (const [ratio, amp] of [
        [1, 1],
        [2.76, 0.35],
        [5.4, 0.12],
      ]) {
        const o = ctx.createOscillator()
        const a = ctx.createGain()
        o.type = 'sine'
        o.frequency.value = hz(note) * ratio
        a.gain.value = amp
        o.connect(a).connect(g)
        o.start(t)
        o.stop(t + 2.7)
      }
      route(g, 0.8)
    },
    bass(note, t, dur, level = 0.14) {
      const o = ctx.createOscillator()
      const sub = ctx.createOscillator()
      const g = ctx.createGain()
      const f = ctx.createBiquadFilter()
      o.type = 'sawtooth'
      sub.type = 'sine'
      o.frequency.value = sub.frequency.value = hz(note)
      f.type = 'lowpass'
      f.frequency.setValueAtTime(700, t)
      f.frequency.exponentialRampToValueAtTime(180, t + dur)
      env(g, t, level, 0.01, Math.max(0, dur - 0.12), 0.1)
      o.connect(f)
      sub.connect(f)
      f.connect(g)
      route(g, 0.05)
      for (const x of [o, sub]) {
        x.start(t)
        x.stop(t + dur + 0.05)
      }
    },
    kick(t, level = 0.5) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.setValueAtTime(120, t)
      o.frequency.exponentialRampToValueAtTime(42, t + 0.14)
      env(g, t, level, 0.003, 0, 0.38)
      o.connect(g)
      route(g, 0)
      o.start(t)
      o.stop(t + 0.42)
    },
    tick(t, level = 0.05) {
      const s = ctx.createBufferSource()
      const f = ctx.createBiquadFilter()
      const g = ctx.createGain()
      s.buffer = noise
      f.type = 'highpass'
      f.frequency.value = 6500
      env(g, t, level, 0.001, 0, 0.04)
      s.connect(f).connect(g)
      route(g, 0.15)
      s.start(t, Math.random() * 1.5)
      s.stop(t + 0.06)
    },
    riser(t, dur, level = 0.06) {
      const s = ctx.createBufferSource()
      const f = ctx.createBiquadFilter()
      const g = ctx.createGain()
      s.buffer = noise
      s.loop = true
      f.type = 'bandpass'
      f.Q.value = 6
      f.frequency.setValueAtTime(300, t)
      f.frequency.exponentialRampToValueAtTime(5000, t + dur)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(level, t + dur * 0.95)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3)
      s.connect(f).connect(g)
      route(g, 0.6)
      s.start(t)
      s.stop(t + dur + 0.4)
    },
  }
}

// ───────────────────────── 配樂（每格 = 八分音符，一小節 8 格） ─────────────────────────

interface Track {
  bpm: number
  /** beat = 一格（八分音符）的秒數 */
  step(v: Voices, i: number, t: number, beat: number): void
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const chance = (p: number) => Math.random() < p
const D_MINOR_PENTA = [62, 65, 67, 69, 72, 74, 77, 79, 81]

/** 匯出供離線試聽與測試 */
export const TRACKS: Record<Scene, Track> = {
  // 大廳：溫和、等人中。Am – F – C – G，柔和撥弦琶音
  lobby: {
    bpm: 76,
    step(v, i, t, beat) {
      const chords = [
        [57, 60, 64],
        [53, 57, 60],
        [55, 60, 64],
        [55, 59, 62],
      ]
      const bar = Math.floor(i / 8) % 4
      const c = chords[bar]
      if (i % 8 === 0) {
        v.pad(c, t, beat * 8 + 0.6, 0.035, 1100)
        v.bass(c[0] - 24, t, beat * 3.5, 0.09)
      }
      if (i % 8 === 4) v.bass(c[0] - 24, t, beat * 1.5, 0.06)
      if (i % 2 === 0 ? chance(0.7) : chance(0.25)) v.pluck(pick(c) + 12, t, 0.055)
    },
  },
  // 抽鬼：上升的噪音＋越來越密的鼓，製造揭曉前的緊張
  reveal: {
    bpm: 100,
    step(v, i, t, beat) {
      if (i === 0) {
        v.riser(t, beat * 8, 0.07)
        v.pad([50, 53, 56], t, beat * 16, 0.04, 700)
      }
      if (i < 8 ? i % 4 === 0 : i < 16 ? i % 2 === 0 : true) v.kick(t, 0.35)
      v.tick(t, 0.03)
    },
  },
  // 躲藏倒數：時鐘滴答＋低音脈動，D 小調
  hiding: {
    bpm: 96,
    step(v, i, t, beat) {
      v.tick(t, i % 2 === 0 ? 0.06 : 0.025)
      if (i % 8 === 0 || i % 8 === 3 || i % 8 === 6) v.bass(38, t, beat * 0.9, 0.12)
      if (i % 16 === 0) v.pad([50, 57, 62], t, beat * 16 + 0.5, 0.03, 650)
      if (i % 32 === 28) v.bell(pick(D_MINOR_PENTA) + 12, t, 0.03)
    },
  },
  // 躲藏中：屏息。低沉長音＋輕微心跳＋偶爾一聲鐘音
  stealth: {
    bpm: 62,
    step(v, i, t, beat) {
      if (i % 2 === 0) {
        v.kick(t, 0.16)
        v.kick(t + beat * 0.28, 0.1)
      }
      if (i % 16 === 0) v.pad(pick([[38, 50, 57], [38, 50, 58], [36, 48, 55]]), t, beat * 16 + 0.5, 0.035, 480)
      if (chance(0.09)) v.bell(pick(D_MINOR_PENTA), t, 0.035)
    },
  },
  // 鬼：追獵。推進的低音型＋大鼓
  hunt: {
    bpm: 112,
    step(v, i, t, beat) {
      const riff = [38, 38, 41, 38, 43, 38, 41, 40]
      v.bass(riff[i % 8], t, beat * 0.45, 0.13)
      if (i % 4 === 0) v.kick(t, 0.45)
      if (i % 2 === 1) v.tick(t, 0.04)
      if (i % 16 === 0) v.pad(Math.floor(i / 16) % 2 ? [46, 53, 58] : [50, 53, 57], t, beat * 8 + 0.4, 0.03, 800)
      if (i % 32 === 30) v.bell(pick([74, 77, 81]), t, 0.03)
    },
  },
  // 任務：急促。快速滴答＋上行琶音
  task: {
    bpm: 136,
    step(v, i, t, beat) {
      v.tick(t, i % 2 === 0 ? 0.08 : 0.04)
      if (i % 2 === 0) v.bass(i % 16 < 8 ? 33 : 31, t, beat * 0.4, 0.16)
      const arp = [57, 60, 64, 69, 72, 69, 64, 60]
      v.pluck(arp[i % 8] + (i % 32 >= 16 ? 2 : 0), t, 0.07)
      if (i % 8 === 0) v.kick(t, 0.3)
    },
  },
  // 結算：放鬆、明亮。C – G – Am – F
  results: {
    bpm: 84,
    step(v, i, t, beat) {
      const chords = [
        [60, 64, 67],
        [55, 59, 62],
        [57, 60, 64],
        [53, 57, 60],
      ]
      const c = chords[Math.floor(i / 8) % 4]
      if (i % 8 === 0) {
        v.pad(c, t, beat * 8 + 0.6, 0.035, 1500)
        v.bass(c[0] - 24, t, beat * 3.5, 0.09)
      }
      const up = [...c, c[0] + 12]
      v.pluck(up[i % 4] + 12, t, 0.05)
      if (i % 16 === 12) v.bell(c[1] + 24, t, 0.03)
    },
  },
}

// ───────────────────────── 播放器 ─────────────────────────

interface Playing {
  scene: Scene
  bus: GainNode
  timer: ReturnType<typeof setInterval>
}

let graph: { ctx: AudioContext; master: GainNode; duck: GainNode; send: AudioNode; noise: AudioBuffer } | null = null
let playing: Playing | null = null
let wanted: Scene | null = null
let enabled = localStorage.getItem(ENABLED_KEY) !== 'off'
const subs = new Set<() => void>()

function ensureGraph() {
  if (graph) return graph
  const ctx = getAudioCtx()
  if (!ctx || ctx.state !== 'running') return null

  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -18
  comp.ratio.value = 4
  comp.connect(ctx.destination)
  const master = ctx.createGain()
  master.gain.value = 0.0001
  const duck = ctx.createGain()
  master.connect(duck).connect(comp)

  // 殘響：用指數衰減的雜訊當脈衝響應
  const len = Math.floor(ctx.sampleRate * 2.8)
  const ir = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
  }
  const reverb = ctx.createConvolver()
  reverb.buffer = ir
  const wet = ctx.createGain()
  wet.gain.value = 0.6
  reverb.connect(wet).connect(master)

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const nd = noise.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1

  graph = { ctx, master, duck, send: reverb, noise }
  return graph
}

function ramp(param: AudioParam, to: number, sec: number) {
  const now = graph!.ctx.currentTime
  param.cancelScheduledValues(now)
  param.setValueAtTime(Math.max(param.value, 0.0001), now)
  param.exponentialRampToValueAtTime(Math.max(to, 0.0001), now + sec)
}

function startScene(scene: Scene) {
  const g = graph!
  const bus = g.ctx.createGain()
  bus.gain.value = 0.0001
  bus.connect(g.master)
  const voices = makeVoices(g.ctx, bus, g.send, g.noise)
  const track = TRACKS[scene]
  const beat = 60 / track.bpm / 2 // 八分音符長度
  let next = g.ctx.currentTime + 0.1
  let i = 0
  const timer = setInterval(() => {
    // 分頁被節流後回來時，不要一次補播一大串
    if (next < g.ctx.currentTime - 0.5) next = g.ctx.currentTime + 0.05
    while (next < g.ctx.currentTime + LOOKAHEAD) {
      track.step(voices, i, next, beat)
      next += beat
      i++
    }
  }, TICK_MS)
  ramp(bus.gain, 1, CROSSFADE)
  return { scene, bus, timer }
}

function stopScene(p: Playing, sec: number) {
  ramp(p.bus.gain, 0.0001, sec)
  setTimeout(() => {
    clearInterval(p.timer)
    p.bus.disconnect()
  }, sec * 1000 + 3000) // 多等幾秒讓殘響與長音自然結束
}

/** 依目前狀態決定要播什麼；任何狀態改變後呼叫 */
function sync() {
  const g = ensureGraph()
  if (!g) return
  const target = enabled && !document.hidden ? wanted : null
  if (playing?.scene === target) return
  if (playing) {
    stopScene(playing, target ? CROSSFADE : FADE)
    playing = null
  }
  if (target) {
    ramp(g.master.gain, MASTER_LEVEL, FADE)
    playing = startScene(target)
  }
}

audioHooks.onUnlock = sync
audioHooks.onBeep = () => {
  if (!graph) return
  const p = graph.duck.gain
  const now = graph.ctx.currentTime
  p.cancelScheduledValues(now)
  p.setValueAtTime(p.value, now)
  p.linearRampToValueAtTime(0.2, now + 0.08)
  p.setValueAtTime(0.2, now + 1.2)
  p.linearRampToValueAtTime(1, now + 2.4)
}
document.addEventListener('visibilitychange', sync)

export function setMusicScene(scene: Scene | null) {
  wanted = scene
  sync()
}

export function setMusicEnabled(on: boolean) {
  enabled = on
  localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off')
  subs.forEach((f) => f())
  sync()
}

/** 在畫面上宣告「現在該播哪段音樂」 */
export function useMusicScene(scene: Scene | null) {
  useEffect(() => setMusicScene(scene), [scene])
}

export function useMusicEnabled(): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => enabled,
  )
}
