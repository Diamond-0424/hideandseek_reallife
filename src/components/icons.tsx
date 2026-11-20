import type { ReactElement, SVGProps } from 'react'
import type { Task } from '../types'

/**
 * 自製幾何圖示：統一 24×24、2px 線條或純色塊，不使用表情符號。
 * 顏色一律吃 currentColor，由外層 CSS 決定。
 */
type P = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 20, children, ...rest }: P) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden {...rest}>
      {children}
    </svg>
  )
}

const line = { stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** 躲藏者：一顆圓躲在方塊後面 */
export const IconHider = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="10" r="6" fill="currentColor" opacity="0.45" />
    <rect x="9" y="9" width="12" height="12" rx="2.5" fill="currentColor" />
  </Svg>
)

/** 鬼：圓頂、波浪底、兩個鏤空眼睛 */
export const IconGhost = (p: P) => (
  <Svg {...p}>
    <path
      fillRule="evenodd"
      fill="currentColor"
      d="M4 11a8 8 0 0 1 16 0v10l-2.7-2-2.6 2-2.7-2-2.7 2-2.6-2L4 21V11Zm5-1.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"
    />
  </Svg>
)

export const IconPin = (p: P) => (
  <Svg {...p}>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" {...line} />
    <circle cx="12" cy="9.5" r="2.5" fill="currentColor" />
  </Svg>
)

export const IconSun = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" fill="currentColor" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" {...line} />
  </Svg>
)

export const IconHeadphones = (p: P) => (
  <Svg {...p}>
    <path d="M4 15v-3a8 8 0 0 1 16 0v3" {...line} />
    <rect x="3" y="14" width="5" height="7" rx="1.5" fill="currentColor" />
    <rect x="16" y="14" width="5" height="7" rx="1.5" fill="currentColor" />
  </Svg>
)

/** 曝光：中心點加兩道訊號波 */
export const IconSignal = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" {...line} />
  </Svg>
)

export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" {...line} strokeWidth={2.5} />
  </Svg>
)

export const IconTarget = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" {...line} />
    <circle cx="12" cy="12" r="5" {...line} />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </Svg>
)

export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 2.5 20h19L12 3Z" fill="currentColor" />
    <path d="M12 9.5v4.5" stroke="var(--icon-cut, #fff)" strokeWidth={2.2} strokeLinecap="round" />
    <circle cx="12" cy="17" r="1.2" fill="var(--icon-cut, #fff)" />
  </Svg>
)

export const IconInfo = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" fill="currentColor" />
    <path d="M12 11v6" stroke="var(--icon-cut, #fff)" strokeWidth={2.2} strokeLinecap="round" />
    <circle cx="12" cy="7.5" r="1.3" fill="var(--icon-cut, #fff)" />
  </Svg>
)

export const IconLayers = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 2.5 8 12 13l9.5-5L12 3Z" fill="currentColor" />
    <path d="M2.5 12.5 12 17.5l9.5-5M2.5 16.5 12 21.5l9.5-5" {...line} />
  </Svg>
)

export const IconLocate = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="6.5" {...line} />
    <circle cx="12" cy="12" r="2.5" fill="currentColor" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" {...line} />
  </Svg>
)

export const IconStop = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </Svg>
)

export const IconDice = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" />
    <g fill="var(--icon-cut, #fff)">
      <circle cx="8" cy="8" r="1.6" />
      <circle cx="16" cy="8" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="8" cy="16" r="1.6" />
      <circle cx="16" cy="16" r="1.6" />
    </g>
  </Svg>
)

export const IconRepeat = (p: P) => (
  <Svg {...p}>
    <path d="M4 11V9a3 3 0 0 1 3-3h12m0 0-3-3m3 3-3 3M20 13v2a3 3 0 0 1-3 3H5m0 0 3 3m-3-3 3-3" {...line} />
  </Svg>
)

// ── 任務圖示 ──
const TASK_ICONS: Record<Task['type'], (p: P) => ReactElement> = {
  math: (p) => (
    <Svg {...p}>
      <path d="M7 3v8M3 7h8M14 6h7M14 9h7M4 15l5 5M9 15l-5 5" {...line} strokeWidth={2.4} />
      <rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" />
    </Svg>
  ),
  reaction: (p) => (
    <Svg {...p}>
      <path d="M13.5 2 4 14h7l-1.5 8L20 10h-7l.5-8Z" fill="currentColor" />
    </Svg>
  ),
  memory: (p) => (
    <Svg {...p}>
      <rect x="3" y="5" width="11" height="15" rx="2.5" fill="currentColor" opacity="0.45" transform="rotate(-8 8.5 12.5)" />
      <rect x="10" y="4" width="11" height="15" rx="2.5" fill="currentColor" />
    </Svg>
  ),
  typing: (p) => (
    <Svg {...p}>
      <rect x="2" y="6" width="20" height="12" rx="2.5" {...line} />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" {...line} strokeWidth={2.4} />
    </Svg>
  ),
  goto: (p) => <IconTarget {...p} />,
  move: (p) => (
    <Svg {...p}>
      <circle cx="7" cy="17" r="4" fill="currentColor" opacity="0.45" />
      <path d="M10 14 20 4m0 0h-6m6 0v6" {...line} strokeWidth={2.4} />
    </Svg>
  ),
}

export function TaskIcon({ type, ...p }: P & { type: Task['type'] }) {
  const I = TASK_ICONS[type]
  return <I {...p} />
}

// ── 記憶翻牌用的幾何圖案（形狀＋顏色都不同，一眼可辨）──
export const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'ring', 'cross', 'half', 'bars'] as const
export type ShapeName = (typeof SHAPES)[number]
const SHAPE_COLOR: Record<ShapeName, string> = {
  circle: '#3d6bff',
  square: '#ff3b2f',
  triangle: '#ffc400',
  diamond: '#2fd27f',
  ring: '#8b5cf6',
  cross: '#f2ede4',
  half: '#ff7ab8',
  bars: '#00a3c4',
}

export function Shape({ name, size = 36 }: { name: ShapeName; size?: number }) {
  const c = SHAPE_COLOR[name]
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      {name === 'circle' && <circle cx="12" cy="12" r="9" fill={c} />}
      {name === 'square' && <rect x="3.5" y="3.5" width="17" height="17" rx="2" fill={c} />}
      {name === 'triangle' && <path d="M12 3 21.5 20h-19L12 3Z" fill={c} />}
      {name === 'diamond' && <path d="M12 2 22 12 12 22 2 12 12 2Z" fill={c} />}
      {name === 'ring' && <circle cx="12" cy="12" r="7.5" fill="none" stroke={c} strokeWidth="4" />}
      {name === 'cross' && <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z" fill={c} />}
      {name === 'half' && <path d="M3 14a9 9 0 0 1 18 0H3Z" fill={c} />}
      {name === 'bars' && (
        <g fill={c}>
          <rect x="3" y="4" width="4.5" height="16" rx="1" />
          <rect x="9.75" y="4" width="4.5" height="16" rx="1" />
          <rect x="16.5" y="4" width="4.5" height="16" rx="1" />
        </g>
      )}
    </svg>
  )
}

/** 品牌標誌：藍色方塊（躲藏者）擋住紅色圓（鬼的視線） */
export function Logo({ size = 72 }: { size?: number }) {
  return (
    <svg viewBox="0 0 72 72" width={size} height={size} aria-hidden>
      <rect width="72" height="72" rx="8" fill="#f2ede4" />
      <circle cx="28" cy="30" r="14" fill="#ff3b2f" />
      <rect x="30" y="30" width="26" height="26" rx="3" fill="#3d6bff" />
    </svg>
  )
}

export const IconMusic = (p: P) => (
  <Svg {...p}>
    <path d="M9 18V6l11-2v12" {...line} />
    <circle cx="6.5" cy="18" r="2.8" fill="currentColor" />
    <circle cx="17.5" cy="16" r="2.8" fill="currentColor" />
  </Svg>
)

export const IconMusicOff = (p: P) => (
  <Svg {...p}>
    <path d="M9 18V6l11-2v12" {...line} opacity="0.4" />
    <circle cx="6.5" cy="18" r="2.8" fill="currentColor" opacity="0.4" />
    <circle cx="17.5" cy="16" r="2.8" fill="currentColor" opacity="0.4" />
    <path d="M3 3l18 18" {...line} strokeWidth={2.4} />
  </Svg>
)
