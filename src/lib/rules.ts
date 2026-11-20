import type { LatLng, Player, Room, Settings, TaskType } from '../types'
import { distance, insideCircle, offset, randomPointWithin } from './geo'

export const DEFAULT_SETTINGS: Settings = {
  ghostCount: 1,
  hideSec: 300,
  gameMin: 45,
  taskIntervalSec: 300,
  taskJitterSec: 60,
  taskLimitSec: 120,
  awayToleranceSec: 30,
  boundaryCenter: null,
  boundaryRadius: 300,
}

export const REVEAL_MS = 5000
export const LEAK_SHOW_MS = 60_000
export const GHOST_COOLDOWN_MS = 60_000
export const BOUNDARY_LEAK_COOLDOWN_MS = 60_000
export const HEARTBEAT_MS = 8000
/** 房主心跳超過這麼久沒更新，客戶端顯示「遊戲暫停」 */
export const HOST_STALE_MS = 10_000
/** 任務截止後的寬限，吸收各手機時鐘與網路延遲 */
export const TASK_GRACE_MS = 3000

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

export function pickTaskType(hasLocation: boolean, rand = Math.random): TaskType {
  // 約三分之一機率出現實任務
  if (hasLocation && rand() < 0.34) return rand() < 0.5 ? 'goto' : 'move'
  return MINIGAMES[Math.floor(rand() * MINIGAMES.length)]
}

/** 在 30–80 公尺外找一個仍在邊界內的目標點；找不到回傳 null */
export function gotoTarget(
  from: LatLng,
  boundaryCenter: LatLng | null,
  boundaryRadius: number,
  rand = Math.random,
): LatLng | null {
  for (let i = 0; i < 30; i++) {
    const p = offset(from, 30 + rand() * 50, rand() * 2 * Math.PI)
    if (!boundaryCenter || insideCircle(p, boundaryCenter, boundaryRadius * 0.95)) return p
  }
  return null
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
  total: number
}

export function score(p: Player, room: Room, now: number): ScoreLine {
  const survival = survivalMinutes(p, room, now)
  const tasks = p.tasksDone * 3
  const leaks = p.leaks * -2
  const catches = p.catches * 10
  return { survival, tasks, leaks, catches, total: survival + tasks + leaks + catches }
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
