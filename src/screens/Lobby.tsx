import { useMemo, useState } from 'react'
import { MapView } from '../components/MapView'
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

/** 設定欄位：UI 單位 → 存檔單位的換算 */
const FIELDS: { key: keyof Settings; label: string; unit: string; scale: number; min: number; max: number }[] = [
  { key: 'ghostCount', label: '鬼的數量', unit: '隻', scale: 1, min: 1, max: 10 },
  { key: 'hideSec', label: '躲藏時間', unit: '分鐘', scale: 60, min: 1, max: 30 },
  { key: 'gameMin', label: '遊戲時長', unit: '分鐘', scale: 1, min: 5, max: 180 },
  { key: 'taskIntervalSec', label: '任務間隔', unit: '分鐘', scale: 60, min: 1, max: 30 },
  { key: 'taskLimitSec', label: '任務限時', unit: '秒', scale: 1, min: 30, max: 600 },
  { key: 'awayToleranceSec', label: '離開頁面容許', unit: '秒', scale: 1, min: 10, max: 300 },
  { key: 'boundaryRadius', label: '邊界半徑', unit: '公尺', scale: 1, min: 50, max: 3000 },
]

export function Lobby({ room, players, me, isHost, fix, onExit }: Props) {
  const s = room.settings
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = (patch: Partial<Settings>) => updateSettings(room.code, { ...s, ...patch }).catch((e) => setError(e.message))

  const circles = useMemo(
    () => (s.boundaryCenter ? [{ center: s.boundaryCenter, radius: s.boundaryRadius, color: '#4ea1ff', fill: 0.08 }] : []),
    [s.boundaryCenter, s.boundaryRadius],
  )
  const dots = useMemo(() => (fix ? [{ at: fix, color: '#4ea1ff', big: true, label: '你' }] : []), [fix])

  const canStart = players.length >= 2 && Boolean(s.boundaryCenter)

  async function start() {
    setBusy(true)
    try {
      await drawAndStart(room, players)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page lobby">
      <header className="row between">
        <div>
          <p className="muted small">房間代碼</p>
          <p className="code">{room.code}</p>
        </div>
        <button
          className="ghost-btn"
          onClick={async () => {
            await leaveRoom(me.id, room.code)
            onExit()
          }}
        >
          離開
        </button>
      </header>

      <section>
        <h2>玩家（{players.length}）</h2>
        <ul className="players">
          {players.map((p) => (
            <li key={p.id}>
              {p.name}
              {p.id === room.hostId && <span className="tag">房主</span>}
              {p.id === me.id && <span className="tag">你</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>設定</h2>
        <div className="settings">
          {FIELDS.map((f) => (
            <label key={f.key}>
              <span>{f.label}</span>
              <NumberInput
                value={(s[f.key] as number) / f.scale}
                min={f.min}
                max={f.key === 'ghostCount' ? Math.max(1, players.length - 1) : f.max}
                disabled={!isHost}
                onCommit={(v) => save({ [f.key]: v * f.scale })}
              />
              <span className="muted">{f.unit}</span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2>遊戲邊界</h2>
        {isHost && (
          <div className="row">
            <button disabled={!fix} onClick={() => fix && save({ boundaryCenter: { lat: fix.lat, lng: fix.lng } })}>
              用我的位置當中心
            </button>
            <span className="muted small">或直接點地圖</span>
          </div>
        )}
        <div className="map-box">
          <MapView
            circles={circles}
            dots={dots}
            focus={s.boundaryCenter ?? fix}
            onClick={isHost ? (p) => save({ boundaryCenter: p }) : undefined}
          />
        </div>
      </section>

      {error && <p className="danger">{error}</p>}
      {isHost ? (
        <button className="primary" disabled={!canStart || busy} onClick={start}>
          {players.length < 2 ? '至少要 2 人' : !s.boundaryCenter ? '先設定邊界' : '抽鬼開始！'}
        </button>
      ) : (
        <p className="muted center">等待房主開始…</p>
      )}
    </main>
  )
}

function NumberInput({
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  value: number
  min: number
  max: number
  disabled: boolean
  onCommit: (v: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const n = Number(draft)
    if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, Math.round(n))))
    setDraft(null)
  }
  return (
    <input
      type="number"
      inputMode="numeric"
      value={draft ?? String(value)}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}
