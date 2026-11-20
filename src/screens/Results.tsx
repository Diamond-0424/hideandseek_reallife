import { useState } from 'react'
import { Avatar, MusicToggle } from '../components/ui'
import { useMusicScene } from '../lib/music'
import { IconGhost, IconHider, IconRepeat } from '../components/icons'
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
  useMusicScene('results')
  const rows = players
    .map((p) => ({ p, s: score(p, room, room.endedAt) }))
    .sort((a, b) => b.s.total - a.s.total)
  const hidersWon = players.some((p) => p.role === 'hider')

  return (
    <main className="screen results">
      <MusicToggle className="corner" />
      <section className={`results-hero rise ${hidersWon ? '' : 'ghost-win'}`}>
        <span className="results-mark">{hidersWon ? <IconHider size={32} /> : <IconGhost size={32} />}</span>
        <h1>{hidersWon ? '躲藏方撐到最後' : '鬼抓到所有人'}</h1>
        <p className="muted">第 {room.round} 局結算</p>
      </section>

      <ol className="ranking">
        {rows.map(({ p, s }, i) => (
          <li
            key={p.id}
            className={`rank-row rise ${p.id === me.id ? 'is-me' : ''} ${i === 0 ? 'is-first' : ''}`}
            style={{ animationDelay: `${80 + i * 60}ms` }}
          >
            <span className={`rank ${i < 3 ? `r${i + 1}` : ''}`}>{i + 1}</span>
            <Avatar id={p.id} name={p.name} ghost={p.role === 'ghost'} />
            <div className="rank-main">
              <span className="name">
                {p.name}
                {p.startedAsGhost && <span className="badge">開局鬼</span>}
              </span>
              <span className="breakdown">
                {s.survival > 0 && <span>存活 +{s.survival}</span>}
                {s.tasks > 0 && <span>任務 +{s.tasks}</span>}
                {s.catches > 0 && <span>抓人 +{s.catches}</span>}
                {s.leaks < 0 && <span className="neg">曝光 {s.leaks}</span>}
              </span>
            </div>
            <span className="total">{s.total}</span>
          </li>
        ))}
      </ol>
      <p className="rule-line">
        <span>
          存活每分鐘 <b>+1</b>
        </span>
        <span>
          任務 <b>+3</b>
        </span>
        <span>
          曝光 <b>−2</b>
        </span>
        <span>
          抓到一人 <b>+10</b>
        </span>
      </p>

      <div className="dock">
        {isHost ? (
          <button
            className="btn primary lg block"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await rematch(room, players).finally(() => setBusy(false))
            }}
          >
            <IconRepeat size={20} /> 再來一局
          </button>
        ) : (
          <p className="waiting">等待房主開下一局</p>
        )}
        <button
          className="btn subtle block"
          onClick={async () => {
            await leaveRoom(me.id, room.code)
            onExit()
          }}
        >
          離開房間
        </button>
      </div>
    </main>
  )
}
