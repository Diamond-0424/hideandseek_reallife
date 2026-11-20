import { useState } from 'react'
import { leaveRoom, rematch } from '../lib/room'
import { score } from '../lib/rules'
import type { Player, Room } from '../types'

interface Props {
  room: Room
  players: Player[]
  me: Player
  isHost: boolean
  onExit: () => void
}

export function Results({ room, players, me, isHost, onExit }: Props) {
  const [busy, setBusy] = useState(false)
  const rows = players
    .map((p) => ({ p, s: score(p, room, room.endedAt) }))
    .sort((a, b) => b.s.total - a.s.total)
  const hidersWon = players.some((p) => p.role === 'hider')

  return (
    <main className="page results">
      <h1>{hidersWon ? '🙈 躲藏方撐到最後！' : '👻 鬼抓到所有人！'}</h1>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>玩家</th>
            <th>存活</th>
            <th>任務</th>
            <th>曝光</th>
            <th>抓人</th>
            <th>總分</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, s }, i) => (
            <tr key={p.id} className={p.id === me.id ? 'me' : ''}>
              <td>{i + 1}</td>
              <td>
                {p.name}
                {p.startedAsGhost ? ' 👻' : ''}
              </td>
              <td>{s.survival}</td>
              <td>{s.tasks}</td>
              <td>{s.leaks}</td>
              <td>{s.catches}</td>
              <td>
                <b>{s.total}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">存活每分鐘 +1、任務 +3、曝光 −2、抓到一人 +10</p>
      {isHost ? (
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await rematch(room, players).finally(() => setBusy(false))
          }}
        >
          再來一局
        </button>
      ) : (
        <p className="muted center">等待房主開下一局…</p>
      )}
      <button
        className="ghost-btn"
        onClick={async () => {
          await leaveRoom(me.id, room.code)
          onExit()
        }}
      >
        離開房間
      </button>
    </main>
  )
}
