import { useEffect } from 'react'
import { Splash } from '../components/ui'
import { useGeolocation, useHeartbeat, useWakeLock } from '../hooks/device'
import { useRoomData } from '../hooks/useRoomData'
import { useHostLoop } from '../host/useHostLoop'
import { Game } from './Game'
import { Lobby } from './Lobby'
import { Results } from './Results'

interface Props {
  code: string
  uid: string
  onExit: () => void
}

export function RoomScreen({ code, uid, onExit }: Props) {
  const data = useRoomData(code, uid)
  const { room, players } = data
  const me = players.find((p) => p.id === uid)
  const isHost = room?.hostId === uid
  const live = room?.status === 'hiding' || room?.status === 'playing'

  const geo = useGeolocation(true)
  const wakeSupported = useWakeLock(live)
  // 自己正被即時追蹤時，心跳加快
  const trackedUntil = Math.max(0, ...data.leaks.filter((l) => l.live && l.playerId === uid).map((l) => l.expiresAt))
  useHeartbeat(code, uid, me?.role, geo.fix, live, trackedUntil)

  useHostLoop(
    room && isHost ? { room, players, locations: data.locations, pendingTasks: data.allPendingTasks, leaks: data.leaks } : null,
    Boolean(isHost && live),
  )

  useEffect(() => {
    if (data.gone) onExit()
  }, [data.gone, onExit])

  if (!room || !me) return <Splash text={`載入房間 ${code}…`} />

  if (room.status === 'lobby')
    return <Lobby room={room} players={players} me={me} isHost={isHost} fix={geo.fix} onExit={onExit} />
  if (room.status === 'ended')
    return <Results room={room} players={players} me={me} isHost={isHost} onExit={onExit} />
  return <Game data={data} me={me} isHost={isHost} geo={geo} wakeSupported={wakeSupported} onExit={onExit} />
}
