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
  /** 鬼的雷達冷卻（分），0 = 關閉 */
  radarCooldownMin: number
  /** 每隔幾分鐘縮一次圈，0 = 不縮 */
  shrinkEveryMin: number
  /** 每隔幾分鐘公布全體躲藏者的粗略範圍，0 = 關閉 */
  pingEveryMin: number
  /** 躲藏者幾乎沒移動超過幾分鐘就曝光，0 = 關閉 */
  idleLeakMin: number
  /** 現實任務（走到指定點／移動）佔任務的百分比 */
  realTaskPct: number
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
  /** 下一次定期廣播的時間，0 = 不廣播 */
  nextPingAt?: number
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
  /** 趁躲藏者曝光時抓到的次數（額外加分） */
  bonusCatches: number
  /** 鬼按下雷達的時間（鬼自己寫） */
  radarAt: number
  /** 以下由房主寫：雷達結果與冷卻 */
  radarDoneAt: number
  /** 最近躲藏者的距離（公尺），-1 = 沒有可偵測的躲藏者 */
  radarDist: number
  radarReadyAt: number
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

export type LeakReason = 'task' | 'away' | 'boundary' | 'idle' | 'ping'

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
  /** 即時追蹤：期間內房主持續把 center 更新成最新位置 */
  live?: boolean
  /** live 時，center 對應的位置回報時間 */
  seenAt?: number
}
