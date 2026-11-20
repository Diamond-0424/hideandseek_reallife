import type { ReactNode } from 'react'
import { IconGhost } from './icons'

const PALETTE = ['#3d6bff', '#00a3c4', '#8b5cf6', '#e0a000', '#1fb46b', '#ff7a3d', '#5b82ff', '#e0559b']

export function playerColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export function Avatar({ id, name, size = 36, ghost = false }: { id: string; name: string; size?: number; ghost?: boolean }) {
  return (
    <span
      className={`avatar ${ghost ? 'is-ghost' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.42, ['--c' as string]: playerColor(id) }}
    >
      {ghost ? <IconGhost size={size * 0.6} /> : [...name][0]?.toUpperCase()}
    </span>
  )
}

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 圓環倒數 */
export function Ring({ value, size = 44, stroke = 4, danger = false, children }: {
  value: number
  size?: number
  stroke?: number
  danger?: boolean
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <span className={`ring ${danger ? 'is-danger' : ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="ring-track" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="ring-bar"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))}
        />
      </svg>
      <span className="ring-label">{children}</span>
    </span>
  )
}

export function Stepper({ value, min, max, step = 1, disabled, onChange }: {
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)))
  return (
    <span className="stepper">
      <button type="button" disabled={disabled || value <= min} onClick={() => set(value - step)} aria-label="減少">
        −
      </button>
      <b>{value}</b>
      <button type="button" disabled={disabled || value >= max} onClick={() => set(value + step)} aria-label="增加">
        ＋
      </button>
    </span>
  )
}

export function Splash({ text }: { text: string }) {
  return (
    <main className="screen splash">
      <span className="spinner" />
      <p className="muted">{text}</p>
    </main>
  )
}
