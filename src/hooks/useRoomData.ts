import { useEffect, useState } from 'react'
import { onSnapshot, query, where } from 'firebase/firestore'
import { leaksCol, locationsCol, playersCol, roomRef, tasksCol } from '../lib/room'
import type { Leak, Player, PlayerLocation, Room, Task } from '../types'

export interface RoomData {
  room: Room | null
  /** 房間不存在或自己已不在房內 */
  gone: boolean
  players: Player[]
  myTasks: Task[]
  /** 只有房主會有：全部待完成任務 */
  allPendingTasks: Task[]
  leaks: Leak[]
  /** 房主：全部；鬼：所有鬼；躲藏者：只有自己 */
  locations: Record<string, PlayerLocation>
}

const empty: RoomData = {
  room: null,
  gone: false,
  players: [],
  myTasks: [],
  allPendingTasks: [],
  leaks: [],
  locations: {},
}

export function useRoomData(code: string, uid: string): RoomData {
  const [data, setData] = useState<RoomData>(empty)
  const patch = (p: Partial<RoomData>) => setData((d) => ({ ...d, ...p }))

  const isHost = data.room?.hostId === uid
  const me = data.players.find((p) => p.id === uid)
  const role = me?.role

  // RoomScreen 以房號當 key，換房會整個重建，不需要在這裡重設狀態
  useEffect(() => {
    const unsubs = [
      onSnapshot(roomRef(code), (s) =>
        s.exists()
          ? patch({ room: s.data() as Room })
          : !s.metadata.fromCache && patch({ room: null, gone: true }),
      ),
      onSnapshot(playersCol(code), (s) => {
        const players = s.docs.map((d) => d.data() as Player).sort((a, b) => a.joinedAt - b.joinedAt)
        const kicked = !s.metadata.fromCache && !s.docs.some((d) => d.id === uid)
        patch({ players, ...(kicked ? { gone: true } : {}) })
      }),
      onSnapshot(
        query(tasksCol(code), where('playerId', '==', uid), where('status', '==', 'pending')),
        (s) => patch({ myTasks: s.docs.map((d) => d.data() as Task) }),
      ),
      onSnapshot(leaksCol(code), (s) =>
        patch({ leaks: s.docs.map((d) => d.data() as Leak).sort((a, b) => a.createdAt - b.createdAt) }),
      ),
    ]
    return () => unsubs.forEach((u) => u())
  }, [code, uid])

  useEffect(() => {
    if (!isHost) return
    return onSnapshot(query(tasksCol(code), where('status', '==', 'pending')), (s) =>
      patch({ allPendingTasks: s.docs.map((d) => d.data() as Task) }),
    )
  }, [code, isHost])

  useEffect(() => {
    if (!role) return
    const q = isHost
      ? locationsCol(code)
      : role === 'ghost'
        ? query(locationsCol(code), where('role', '==', 'ghost'))
        : null
    if (!q) {
      patch({ locations: {} })
      return
    }
    return onSnapshot(
      q,
      (s) => {
        const locations: Record<string, PlayerLocation> = {}
        for (const d of s.docs) locations[d.id] = d.data() as PlayerLocation
        patch({ locations })
      },
      (e) => console.warn('locations', e),
    )
  }, [code, isHost, role])

  return data
}
