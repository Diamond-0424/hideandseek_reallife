import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
  deleteDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Player, PlayerLocation, Room, Settings, Task } from '../types'
import { nowMs } from './clock'
import { DEFAULT_SETTINGS, GHOST_COOLDOWN_MS, REVEAL_MS, TASK_GRACE_MS, pickGhosts, randomRoomCode } from './rules'

export const roomRef = (code: string) => doc(db, 'rooms', code)
export const playersCol = (code: string) => collection(db, 'rooms', code, 'players')
export const playerRef = (code: string, uid: string) => doc(db, 'rooms', code, 'players', uid)
export const tasksCol = (code: string) => collection(db, 'rooms', code, 'tasks')
export const leaksCol = (code: string) => collection(db, 'rooms', code, 'leaks')
export const locationsCol = (code: string) => collection(db, 'rooms', code, 'locations')
export const locationRef = (code: string, uid: string) => doc(db, 'rooms', code, 'locations', uid)

const ROOM_KEY = 'hs.room'
export const savedRoom = () => localStorage.getItem(ROOM_KEY)
export const saveRoom = (code: string | null) =>
  code ? localStorage.setItem(ROOM_KEY, code) : localStorage.removeItem(ROOM_KEY)

/** 重新開局時要歸零的玩家欄位 */
function freshPlayerFields(): Omit<Player, 'id' | 'name' | 'joinedAt'> {
  return {
    role: 'hider',
    startedAsGhost: false,
    caughtAt: 0,
    caughtBy: '',
    ghostReadyAt: 0,
    tasksDone: 0,
    leaks: 0,
    catches: 0,
    nextTaskAt: 0,
    awayPenalizedSeen: 0,
    lastOutOfBoundsLeak: 0,
  }
}

export async function createRoom(uid: string, name: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomRoomCode()
    const created = await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef(code))
      if (snap.exists()) return false
      const room: Room = {
        code,
        hostId: uid,
        status: 'lobby',
        settings: DEFAULT_SETTINGS,
        round: 0,
        revealUntil: 0,
        hideEndsAt: 0,
        playStartAt: 0,
        endsAt: 0,
        endedAt: 0,
        hostSeen: nowMs(),
      }
      tx.set(roomRef(code), room)
      return true
    })
    if (created) {
      await setDoc(playerRef(code, uid), {
        id: uid,
        name,
        joinedAt: nowMs(),
        ...freshPlayerFields(),
      } satisfies Player)
      return code
    }
  }
  throw new Error('找不到可用的房間代碼，請再試一次')
}

export async function joinRoom(uid: string, code: string, name: string): Promise<void> {
  const snap = await getDoc(roomRef(code))
  if (!snap.exists()) throw new Error('找不到這個房間')
  const room = snap.data() as Room
  const existing = await getDoc(playerRef(code, uid))
  if (existing.exists()) {
    await updateDoc(playerRef(code, uid), { name })
    return
  }
  if (room.status !== 'lobby') throw new Error('遊戲已經開始，等這局結束再加入')
  await setDoc(playerRef(code, uid), {
    id: uid,
    name,
    joinedAt: nowMs(),
    ...freshPlayerFields(),
  } satisfies Player)
}

export async function leaveRoom(uid: string, code: string): Promise<void> {
  await deleteDoc(playerRef(code, uid)).catch(() => {})
  await deleteDoc(locationRef(code, uid)).catch(() => {})
}

export function updateSettings(code: string, settings: Settings) {
  return updateDoc(roomRef(code), { settings })
}

/** 房主：抽鬼並開始（揭曉 → 躲藏倒數） */
export async function drawAndStart(room: Room, players: Player[]): Promise<void> {
  const now = nowMs()
  const ghosts = new Set(pickGhosts(players.map((p) => p.id), room.settings.ghostCount))
  const batch = writeBatch(db)
  for (const p of players) {
    const isGhost = ghosts.has(p.id)
    batch.update(playerRef(room.code, p.id), {
      ...freshPlayerFields(),
      role: isGhost ? 'ghost' : 'hider',
      startedAsGhost: isGhost,
    })
  }
  const revealUntil = now + REVEAL_MS
  batch.update(roomRef(room.code), {
    status: 'hiding',
    round: room.round + 1,
    revealUntil,
    hideEndsAt: revealUntil + room.settings.hideSec * 1000,
    playStartAt: 0,
    endsAt: 0,
    endedAt: 0,
    hostSeen: now,
  })
  await batch.commit()
}

async function clearRoomData(code: string) {
  for (const col of [tasksCol(code), leaksCol(code)]) {
    const snap = await getDocs(col)
    let batch = writeBatch(db)
    let n = 0
    for (const d of snap.docs) {
      batch.delete(d.ref)
      if (++n % 400 === 0) {
        await batch.commit()
        batch = writeBatch(db)
      }
    }
    await batch.commit()
  }
}

/** 房主：再來一局（回到大廳，同一批人） */
export async function rematch(room: Room, players: Player[]): Promise<void> {
  await clearRoomData(room.code)
  const batch = writeBatch(db)
  for (const p of players) batch.update(playerRef(room.code, p.id), freshPlayerFields())
  batch.update(roomRef(room.code), { status: 'lobby', endedAt: 0, playStartAt: 0, endsAt: 0 })
  await batch.commit()
}

/** 躲藏者：完成任務（截止 + 寬限前才算數） */
export async function completeTask(code: string, task: Task): Promise<boolean> {
  return runTransaction(db, async (tx) => {
    const ref = doc(tasksCol(code), task.id)
    const snap = await tx.get(ref)
    const t = snap.data() as Task | undefined
    if (!t || t.status !== 'pending' || nowMs() > t.deadline + TASK_GRACE_MS) return false
    tx.update(ref, { status: 'done' })
    tx.update(playerRef(code, task.playerId), { tasksDone: increment(1) })
    return true
  })
}

/** 躲藏者：回報自己被抓（良心制） */
export async function reportCaught(code: string, uid: string, ghostId: string): Promise<void> {
  const now = nowMs()
  const batch = writeBatch(db)
  batch.update(playerRef(code, uid), {
    role: 'ghost',
    caughtAt: now,
    caughtBy: ghostId,
    ghostReadyAt: now + GHOST_COOLDOWN_MS,
  })
  batch.update(playerRef(code, ghostId), { catches: increment(1) })
  await batch.commit()
}

export function writeLocation(code: string, uid: string, loc: PlayerLocation) {
  return setDoc(locationRef(code, uid), loc)
}
