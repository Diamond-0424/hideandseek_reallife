import type { LatLng, Leak, Player, Room, Settings, TaskType } from '../types'
import { distance, distanceToPolygonEdge, insidePolygon, offset, randomPointWithin, scalePolygon } from './geo'

export const DEFAULT_SETTINGS: Settings = {
  ghostCount: 1,
  hideSec: 300,
  gameMin: 45,
  taskIntervalSec: 300,
  taskJitterSec: 60,
  taskLimitSec: 120,
  awayToleranceSec: 30,
  boundaryShape: 'circle',
  boundaryCenter: null,
  boundaryRadius: 300,
  boundaryPolygon: [],
  radarCooldownMin: 5,
  shrinkEveryMin: 10,
  pingEveryMin: 10,
  idleLeakMin: 3,
  realTaskPct: 50,
  trackSec: 60,
  pingRadiusM: 100,
  pingShowSec: 30,
}

/** 舊房間的設定可能缺新欄位，一律補預設值 */
export function withDefaults(s: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...s }
}

export const REVEAL_MS = 5000
export const LEAK_SHOW_MS = 60_000
/** 被追蹤期間的心跳間隔，讓鬼看到的位置接近即時 */
export const TRACK_HEARTBEAT_MS = 2000
export const GHOST_COOLDOWN_MS = 60_000
export const BOUNDARY_LEAK_COOLDOWN_MS = 60_000
export const HEARTBEAT_MS = 8000
/** 房主心跳超過這麼久沒更新，客戶端顯示「遊戲暫停」 */
export const HOST_STALE_MS = 10_000
/** 任務截止後的寬限，吸收各手機時鐘與網路延遲 */
export const TASK_GRACE_MS = 3000

/** 每次縮圈縮掉原半徑的這個比例，最小縮到原半徑的 SHRINK_MIN */
export const SHRINK_STEP = 0.15
export const SHRINK_MIN = 0.4
/** 縮圈前多久開始預告新邊界 */
export const SHRINK_WARN_MS = 60_000

/** 同一人前後兩次洩漏相隔超過這麼久，就不畫移動方向（太舊沒參考價值） */
export const TRAIL_WINDOW_MS = 5 * 60_000
/** 位移小於這個距離視為 GPS 飄移，不畫移動方向 */
export const TRAIL_MIN_M = 10

/**
 * 前後兩次洩漏之間畫不畫移動箭頭。
 * 圓心各自隨機偏移最多 0.8 倍半徑，位移要大於兩邊偏移的總和，箭頭方向才不會被偏移蓋過。
 */
export function showsMovement(prev: Leak, next: Leak): boolean {
  if (next.createdAt - prev.createdAt > TRAIL_WINDOW_MS) return false
  const d = distance(prev.center, next.center)
  return d >= TRAIL_MIN_M && d > 0.8 * (prev.radius + next.radius)
}

/** 「35 秒前」「3 分鐘前」 */
export function fmtAgo(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  return sec < 60 ? `${sec} 秒前` : `${Math.floor(sec / 60)} 分鐘前`
}

/** 離最初位置不到這個距離都算「沒移動」（吸收 GPS 飄移） */
export const IDLE_MOVE_M = 25

/** 曝光中或曝光結束後這段時間內抓到人，鬼額外加分 */
export const BONUS_WINDOW_MS = 60_000
export const BONUS_POINTS = 5

export const GOTO_RADIUS_M = 15
export const MOVE_DISTANCE_M = 50

export const TASK_LABEL: Record<TaskType, string> = {
  math: '數學題',
  reaction: '反應測試',
  memory: '記憶翻牌',
  typing: '打字挑戰',
  goto: '走到指定點',
  move: '移動 50 公尺',
}

/** 第 n 次洩漏（從 1 起算）的圓半徑，0 表示精確位置 */
export function leakRadius(level: number): number {
  if (level <= 1) return 80
  if (level === 2) return 30
  return 0
}

/** 產生洩漏圓心：隨機偏移，但保證真實位置仍在圓內 */
export function leakCenter(loc: LatLng, radius: number, rand = Math.random): LatLng {
  if (radius === 0) return loc
  return randomPointWithin(loc, radius * 0.8, rand)
}

/** 下一個任務距今的毫秒數（間隔 ± 隨機抖動） */
export function nextTaskDelayMs(s: Settings, rand = Math.random): number {
  const jitter = (rand() * 2 - 1) * s.taskJitterSec
  return Math.max(30, s.taskIntervalSec + jitter) * 1000
}

const MINIGAMES: TaskType[] = ['math', 'reaction', 'memory', 'typing']

export function pickTaskType(hasLocation: boolean, realTaskPct = 50, rand = Math.random): TaskType {
  if (hasLocation && rand() * 100 < realTaskPct) return rand() < 0.5 ? 'goto' : 'move'
  return MINIGAMES[Math.floor(rand() * MINIGAMES.length)]
}

export type Boundary =
  | { kind: 'circle'; center: LatLng; radius: number }
  | { kind: 'polygon'; points: LatLng[] }

/** 縮圈後剩原本大小的比例（由開打時間推算，所有人算出來一樣） */
export function shrinkScaleAt(s: Settings, playStartAt: number, now: number): number {
  if (!s.shrinkEveryMin || !playStartAt || now < playStartAt) return 1
  const steps = Math.floor((now - playStartAt) / (s.shrinkEveryMin * 60_000))
  return Math.max(SHRINK_MIN, 1 - steps * SHRINK_STEP)
}

/** 依比例縮放的邊界；多邊形以重心為中心等比例縮小。尚未設定完成時回傳 null */
export function boundaryAt(s: Settings, playStartAt: number, now: number): Boundary | null {
  const k = shrinkScaleAt(s, playStartAt, now)
  if (s.boundaryShape === 'polygon') {
    const pts = s.boundaryPolygon ?? []
    return pts.length >= 3 ? { kind: 'polygon', points: scalePolygon(pts, k) } : null
  }
  return s.boundaryCenter ? { kind: 'circle', center: s.boundaryCenter, radius: Math.round(s.boundaryRadius * k) } : null
}

/** 在邊界外多少公尺；≤ 0 表示在邊界內（數值為到邊緣的距離取負） */
export function outsideBy(p: LatLng, b: Boundary): number {
  if (b.kind === 'circle') return distance(p, b.center) - b.radius
  const d = distanceToPolygonEdge(p, b.points)
  return insidePolygon(p, b.points) ? -d : d
}

/** 下一次縮圈的時間與縮完的邊界；已縮到最小或不縮時回傳 null */
export function nextShrink(s: Settings, playStartAt: number, now: number): { at: number; boundary: Boundary } | null {
  if (!s.shrinkEveryMin || !playStartAt) return null
  const every = s.shrinkEveryMin * 60_000
  const at = playStartAt + (Math.floor(Math.max(0, now - playStartAt) / every) + 1) * every
  if (shrinkScaleAt(s, playStartAt, at) >= shrinkScaleAt(s, playStartAt, now)) return null
  const boundary = boundaryAt(s, playStartAt, at)
  return boundary ? { at, boundary } : null
}

/** 在 30–80 公尺外找一個仍在邊界內（離邊緣留點餘裕）的目標點；找不到回傳 null */
export function gotoTarget(from: LatLng, boundary: Boundary | null, rand = Math.random): LatLng | null {
  const margin = boundary?.kind === 'circle' ? boundary.radius * 0.05 : 10
  for (let i = 0; i < 30; i++) {
    const p = offset(from, 30 + rand() * 50, rand() * 2 * Math.PI)
    if (!boundary || outsideBy(p, boundary) <= -margin) return p
  }
  return null
}

/** 雷達顯示用：往上取整到 10 公尺 */
export function radarRound(m: number): number {
  return Math.max(10, Math.ceil(m / 10) * 10)
}

export function gotoReached(loc: LatLng, target: LatLng): boolean {
  return distance(loc, target) <= GOTO_RADIUS_M
}

export function moveReached(loc: LatLng, origin: LatLng): boolean {
  return distance(loc, origin) >= MOVE_DISTANCE_M
}

/** 隨機抽 n 個鬼 */
export function pickGhosts(ids: string[], n: number, rand = Math.random): string[] {
  const arr = [...ids]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  // 至少留一個躲藏者
  const count = Math.max(1, Math.min(n, ids.length - 1))
  return arr.slice(0, count)
}

export function survivalMinutes(p: Player, room: Room, now: number): number {
  if (p.startedAsGhost || !room.playStartAt || now < room.playStartAt) return 0
  const end = p.caughtAt || room.endedAt || Math.min(now, room.endsAt)
  return Math.max(0, Math.floor((end - room.playStartAt) / 60000))
}

export interface ScoreLine {
  survival: number
  tasks: number
  leaks: number
  catches: number
  bonus: number
  total: number
}

export function score(p: Player, room: Room, now: number): ScoreLine {
  const survival = survivalMinutes(p, room, now)
  const tasks = p.tasksDone * 3
  const leaks = p.leaks * -2
  const catches = p.catches * 10
  const bonus = (p.bonusCatches ?? 0) * BONUS_POINTS
  return { survival, tasks, leaks, catches, bonus, total: survival + tasks + leaks + catches + bonus }
}

/** 可重現的亂數（小遊戲用 seed 產生題目） */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomRoomCode(rand = Math.random): string {
  return String(Math.floor(rand() * 10000)).padStart(4, '0')
}
