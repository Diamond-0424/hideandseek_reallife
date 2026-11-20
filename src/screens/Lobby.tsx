import { useMemo, useState } from 'react'
import { MapView, type MapCircle, type MapDot } from '../components/MapView'
import { Avatar, Stepper } from '../components/ui'
import { IconAlert, IconDice, IconLocate, IconPin } from '../components/icons'
import type { GeoFix } from '../hooks/device'
import { drawAndStart, leaveRoom, updateSettings } from '../lib/room'
import type { Player, Room, Settings } from '../types'

interface Props {
  room: Room
  players: Player[]
  me: Player
  isHost: boolean
  fix: GeoFix | null
  onExit: () => void
}

interface Field {
  key: keyof Settings
  label: string
  unit: string
  /** 存檔值 = 顯示值 × scale */
  scale: number
  step: number
  min: number
  max: number
}

const MAIN: Field[] = [
  { key: 'ghostCount', label: '鬼', unit: '隻', scale: 1, step: 1, min: 1, max: 10 },
  { key: 'hideSec', label: '躲藏時間', unit: '分', scale: 60, step: 1, min: 1, max: 30 },
  { key: 'gameMin', label: '遊戲時長', unit: '分', scale: 1, step: 5, min: 5, max: 180 },
  { key: 'taskIntervalSec', label: '任務間隔', unit: '分', scale: 60, step: 1, min: 1, max: 30 },
  { key: 'boundaryRadius', label: '邊界半徑', unit: '公尺', scale: 1, step: 50, min: 50, max: 3000 },
]
const ADVANCED: Field[] = [
  { key: 'taskLimitSec', label: '任務限時', unit: '秒', scale: 1, step: 15, min: 30, max: 600 },
  { key: 'awayToleranceSec', label: '離開頁面容許', unit: '秒', scale: 1, step: 5, min: 10, max: 300 },
]

export function Lobby({ room, players, me, isHost, fix, onExit }: Props) {
  const s = room.settings
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const save = (patch: Partial<Settings>) =>
    updateSettings(room.code, { ...s, ...patch }).catch((e) => setError(e.message))

  const circles = useMemo<MapCircle[]>(
    () => (s.boundaryCenter ? [{ id: 'boundary', center: s.boundaryCenter, radius: s.boundaryRadius, tone: 'boundary' }] : []),
    [s.boundaryCenter, s.boundaryRadius],
  )
  const dots = useMemo<MapDot[]>(() => (fix ? [{ id: 'me', at: fix, kind: 'self' }] : []), [fix])

  const canStart = players.length >= 2 && Boolean(s.boundaryCenter)
  const maxGhosts = Math.max(1, players.length - 1)

  const row = (f: Field) => (
    <div className="setting" key={f.key}>
      <span>{f.label}</span>
      <Stepper
        value={(s[f.key] as number) / f.scale}
        min={f.min}
        max={f.key === 'ghostCount' ? maxGhosts : f.max}
        step={f.step}
        disabled={!isHost}
        onChange={(v) => save({ [f.key]: v * f.scale })}
      />
      <span className="unit">{f.unit}</span>
    </div>
  )

  async function start() {
    setBusy(true)
    try {
      await drawAndStart(room, players)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <main className="screen lobby">
      <header className="lobby-head rise">
        <button
          className={`room-code ${copied ? 'is-copied' : ''}`}
          onClick={() => {
            navigator.clipboard?.writeText(room.code).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          <span className="eyebrow">{copied ? '已複製' : '房間代碼 · 點一下複製'}</span>
          <span className="digits">
            {[...room.code].map((d, i) => (
              <b key={i}>{d}</b>
            ))}
          </span>
        </button>
        <button
          className="btn subtle sm"
          onClick={async () => {
            await leaveRoom(me.id, room.code)
            onExit()
          }}
        >
          離開
        </button>
      </header>

      <section className="card rise" style={{ animationDelay: '60ms' }}>
        <h2>
          玩家 <span className="count">{players.length}</span>
        </h2>
        <ul className="roster">
          {players.map((p) => (
            <li key={p.id} className="pop">
              <Avatar id={p.id} name={p.name} />
              <span className="who">
                <span className="name">{p.name}</span>
                {(p.id === room.hostId || p.id === me.id) && (
                  <span className="tags">
                    {p.id === room.hostId && <span className="badge">房主</span>}
                    {p.id === me.id && <span className="badge dim">你</span>}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card rise" style={{ animationDelay: '120ms' }}>
        <h2>規則設定{!isHost && <span> · 由房主設定</span>}</h2>
        <div className="settings">{MAIN.map(row)}</div>
        <details className="advanced">
          <summary>進階</summary>
          <div className="settings">{ADVANCED.map(row)}</div>
        </details>
      </section>

      <section className="card map-card rise" style={{ animationDelay: '180ms' }}>
        <div className="map-card-head">
          <h2>遊戲邊界</h2>
          {isHost && (
            <button
              className="btn subtle sm"
              disabled={!fix}
              onClick={() => fix && save({ boundaryCenter: { lat: fix.lat, lng: fix.lng } })}
            >
              <IconLocate size={16} /> 用我的位置
            </button>
          )}
        </div>
        <MapView
          className="map-lobby"
          circles={circles}
          dots={dots}
          focus={s.boundaryCenter ?? fix}
          onClick={isHost ? (p) => save({ boundaryCenter: p }) : undefined}
        />
        <p className={`sm map-hint ${s.boundaryCenter ? 'is-set' : 'muted'}`}>
          <IconPin size={16} />
          {s.boundaryCenter ? `半徑 ${s.boundaryRadius} 公尺，出界會曝光` : isHost ? '點地圖設定邊界中心' : '等待房主設定邊界'}
        </p>
      </section>

      <div className="dock">
        {error && (
          <p className="alert">
            <IconAlert size={16} /> {error}
          </p>
        )}
        {isHost ? (
          <button className="btn primary lg block" disabled={!canStart || busy} onClick={start}>
            {players.length < 2 ? (
              '等待更多玩家加入…'
            ) : !s.boundaryCenter ? (
              '先設定遊戲邊界'
            ) : busy ? (
              '抽鬼中…'
            ) : (
              <>
                <IconDice size={20} /> 抽鬼開始
              </>
            )}
          </button>
        ) : (
          <p className="waiting">
            <span className="dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            等待房主開始
          </p>
        )}
      </div>
    </main>
  )
}
