export interface LatLng {
  lat: number
  lng: number
}

export interface Settings {
  ghostCount: number
  hideSec: number
  gameMin: number
  taskIntervalSec: number
  taskJitterSec: number
  taskLimitSec: number
  awayToleranceSec: number
  boundaryCenter: LatLng | null
  boundaryRadius: number
}

export type RoomStatus = 'lobby' | 'hiding' | 'playing' | 'ended'

export interface Room {
  code: string
  hostId: string
  status: RoomStatus
  settings: Settings
  round: number
  /** 抽鬼結果揭曉的時間點；之後才開始躲藏倒數 */
  revealUntil: number
  hideEndsAt: number
  playStartAt: number
  endsAt: number
  endedAt: number
  /** 房主主持迴圈最後一次心跳 */
  hostSeen: number
}

export type Role = 'hider' | 'ghost'

export interface Player {
  id: string
  name: string
  role: Role
  /** 是否開局就是鬼 */
  startedAsGhost: boolean
  joinedAt: number
  caughtAt: number
  caughtBy: string
  ghostReadyAt: number
  tasksDone: number
  leaks: number
  catches: number
  nextTaskAt: number
  /** 房主用：已因離線處罰過的那次心跳時間，避免重複處罰 */
  awayPenalizedSeen: number
  lastOutOfBoundsLeak: number
}

/** locations/{uid}：與 player 分開存放，方便用 rules 限制讀取 */
export interface PlayerLocation {
  lat: number
  lng: number
  acc: number
  role: Role
  seenAt: number
}

export type TaskType = 'math' | 'reaction' | 'memory' | 'typing' | 'goto' | 'move'

export interface Task {
  id: string
  playerId: string
  type: TaskType
  seed: number
  /** goto：目標點；move：出發點 */
  point: LatLng | null
  issuedAt: number
  deadline: number
  status: 'pending' | 'done' | 'failed' | 'cancelled'
}

export type LeakReason = 'task' | 'away' | 'boundary'

export interface Leak {
  id: string
  playerId: string
  playerName: string
  level: number
  center: LatLng
  /** 0 = 精確位置 */
  radius: number
  reason: LeakReason
  createdAt: number
  expiresAt: number
}
