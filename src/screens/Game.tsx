import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { updateDoc } from 'firebase/firestore'
import { MapView, type MapCircle, type MapDot } from '../components/MapView'
import { Avatar, Ring, fmtClock } from '../components/ui'
import { useAwayReport, useNow, type GeoFix } from '../hooks/device'
import type { RoomData } from '../hooks/useRoomData'
import { hostStale } from '../host/useHostLoop'
import { nowMs } from '../lib/clock'
import { completeTask, reportCaught, roomRef } from '../lib/room'
import { GHOST_COOLDOWN_MS, HEARTBEAT_MS, REVEAL_MS, leakRadius } from '../lib/rules'
import { beep } from '../lib/sound'
import { TaskPanel } from '../tasks/TaskPanel'
import type { Player, Room } from '../types'

interface Props {
  data: RoomData
  me: Player
  isHost: boolean
  geo: { fix: GeoFix | null; error: string | null }
  wakeSupported: boolean
}

export function Game({ data, me, isHost, geo, wakeSupported }: Props) {
  const room = data.room!
  const now = useNow(500)
  const paused = !isHost && hostStale(room, now)

  if (now < room.revealUntil) return <Reveal room={room} players={data.players} me={me} now={now} />

  return (
    <main className={`game role-${me.role}`}>
      {me.role === 'hider' ? (
        <HiderView data={data} me={me} now={now} fix={geo.fix} />
      ) : (
        <GhostView data={data} me={me} now={now} fix={geo.fix} />
      )}
      <TopBar room={room} me={me} now={now} isHost={isHost} />
      <div className="notices">
        {!wakeSupported && <p className="notice">此瀏覽器不支援螢幕常亮，請手動關閉自動鎖定</p>}
        {geo.error && <p className="notice">{geo.error}</p>}
      </div>
      {paused && (
        <div className="overlay">
          <div className="sheet-card center">
            <span className="spinner" />
            <p className="title">房主離線，遊戲暫停中</p>
            <p className="muted">房主回來後計時會自動順延</p>
          </div>
        </div>
      )}
    </main>
  )
}

function Reveal({ room, players, me, now }: { room: Room; players: Player[]; me: Player; now: number }) {
  const ghosts = players.filter((p) => p.role === 'ghost')
  const rolling = room.revealUntil - now > REVEAL_MS / 2
  return (
    <main className={`screen reveal ${rolling ? '' : `is-${me.role}`}`}>
      {rolling ? (
        <div className="shuffle">
          {players.slice(0, 6).map((p, i) => (
            <span key={p.id} style={{ animationDelay: `${i * 90}ms` }}>
              <Avatar id={p.id} name={p.name} size={52} />
            </span>
          ))}
          <p className="title">抽鬼中…</p>
        </div>
      ) : (
        <div className="reveal-card">
          <span className="reveal-emoji">{me.role === 'ghost' ? '👻' : '🙈'}</span>
          <p className="reveal-title">{me.role === 'ghost' ? '你是鬼' : '你是躲藏者'}</p>
          <p className="muted">{me.role === 'ghost' ? '等大家躲好，就出發抓人' : '快去找地方躲好！'}</p>
          <div className="ghost-list">
            {ghosts.map((g) => (
              <span key={g.id} className="chip">
                <Avatar id={g.id} name={g.name} size={22} ghost /> {g.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </main>
  )
}

function TopBar({ room, me, now, isHost }: { room: Room; me: Player; now: number; isHost: boolean }) {
  const hiding = room.status === 'hiding'
  const end = hiding ? room.hideEndsAt : room.endsAt
  const total = hiding ? room.settings.hideSec * 1000 : room.settings.gameMin * 60_000
  const left = end - now
  return (
    <header className="hud-top glass">
      <span className={`role-pill ${me.role}`}>{me.role === 'ghost' ? '👻 鬼' : '🙈 躲藏者'}</span>
      <div className="timer">
        <span className="eyebrow">{hiding ? '躲藏倒數' : '剩餘時間'}</span>
        <span className={`clock ${left < 60_000 ? 'is-danger' : ''}`}>{fmtClock(left)}</span>
      </div>
      <Ring value={left / total} size={36} stroke={3} danger={left < 60_000} />
      {isHost && (
        <button
          className="icon-btn"
          aria-label="提前結束"
          onClick={() =>
            confirm('確定要提前結束這局？') &&
            updateDoc(roomRef(room.code), { status: 'ended', endedAt: nowMs() })
          }
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      )}
    </header>
  )
}

function useToast() {
  const [toast, setToast] = useState<{ text: string; kind: string; id: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback((text: string, kind = 'info', ms = 5000) => {
    setToast({ text, kind, id: Date.now() })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), ms)
  }, [])
  const node = toast && (
    <div key={toast.id} className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
      {toast.text}
    </div>
  )
  return { show, node }
}

// ───────────────────────── 躲藏者 ─────────────────────────

function HiderView({ data, me, now, fix }: { data: RoomData; me: Player; now: number; fix: GeoFix | null }) {
  const room = data.room!
  const s = room.settings
  const playing = room.status === 'playing'
  const task = playing ? data.myTasks[0] : undefined
  const { show, node } = useToast()
  const [flash, setFlash] = useState(false)
  const [catching, setCatching] = useState(false)

  // 新任務：提示音 + 閃爍
  const lastTask = useRef<string | null>(null)
  useEffect(() => {
    if (task && task.id !== lastTask.current) {
      lastTask.current = task.id
      beep()
      setFlash(true)
      const id = setTimeout(() => setFlash(false), 1500)
      return () => clearTimeout(id)
    }
  }, [task])

  // 自己曝光的通知（只通知進入畫面後產生的）
  const mountedAt = useRef(nowMs())
  const seenLeaks = useRef(new Set<string>())
  useEffect(() => {
    for (const l of data.leaks) {
      if (l.playerId !== me.id || seenLeaks.current.has(l.id)) continue
      seenLeaks.current.add(l.id)
      if (l.createdAt < mountedAt.current) continue
      const why = { task: '任務失敗', away: '離開頁面太久', boundary: '跑出邊界' }[l.reason]
      const range = l.radius ? `${l.radius} 公尺範圍` : '精確位置'
      beep()
      show(`你曝光了！${why} · 第 ${l.level} 次 · ${range}`, 'danger', 8000)
    }
  }, [data.leaks, me.id, show])

  useAwayReport(playing, (sec) => {
    // 心跳每 8 秒一次，房主看到的中斷時間可能比實際離開多幾秒
    const margin = HEARTBEAT_MS / 1000
    if (sec > s.awayToleranceSec) show(`你離開了 ${sec} 秒，超過 ${s.awayToleranceSec} 秒，已觸發洩漏`, 'danger', 8000)
    else if (sec > s.awayToleranceSec - margin) show(`你離開了 ${sec} 秒，接近上限，可能已觸發洩漏`, 'danger', 8000)
    else if (sec >= 3) show(`你離開了 ${sec} 秒（上限 ${s.awayToleranceSec} 秒）`, 'info')
  })

  const onDone = useCallback(() => {
    if (!task) return
    completeTask(room.code, task)
      .then((ok) => show(ok ? '任務完成 +3' : '太晚了，任務已失效', ok ? 'ok' : 'danger'))
      .catch((e) => show(`送出失敗：${e.message}`, 'danger'))
  }, [task, room.code, show])

  const circles = useMemo<MapCircle[]>(() => {
    const c: MapCircle[] = []
    if (s.boundaryCenter) c.push({ id: 'boundary', center: s.boundaryCenter, radius: s.boundaryRadius, tone: 'boundary' })
    if (task?.type === 'goto' && task.point) c.push({ id: 'target', center: task.point, radius: 15, tone: 'target', label: '目標' })
    if (task?.type === 'move' && task.point) c.push({ id: 'zone', center: task.point, radius: 50, tone: 'zone' })
    return c
  }, [s.boundaryCenter, s.boundaryRadius, task])
  const dots = useMemo<MapDot[]>(() => (fix ? [{ id: 'me', at: fix, kind: 'self' }] : []), [fix])

  const ghosts = data.players.filter((p) => p.role === 'ghost' && p.id !== me.id)
  const next = leakRadius(me.leaks + 1)

  return (
    <>
      <MapView className="map-full" circles={circles} dots={dots} focus={fix} />
      {flash && <div className="flash" aria-hidden />}
      <div className="hud-chips">
        <span className="chip">✅ 任務 {me.tasksDone}</span>
        <span className={`chip ${me.leaks ? 'warn' : ''}`}>📡 曝光 {me.leaks}</span>
        <span className="chip dim">下次：{next ? `${next}m 範圍` : '精確位置'}</span>
      </div>
      {!playing && <div className="pill-banner">趁現在快去躲好，躲藏期間沒有任務</div>}
      {task && <TaskPanel key={task.id} task={task} now={now} fix={fix} onDone={onDone} />}
      {!task && (
        <div className="hud-bottom">
          <button className="btn danger lg caught" onClick={() => setCatching(true)}>
            我被抓到了
          </button>
        </div>
      )}
      {catching && (
        <div className="overlay" onClick={() => setCatching(false)}>
          <div className="sheet-card" onClick={(e) => e.stopPropagation()}>
            <p className="title">被誰抓到？</p>
            <p className="muted sm">按下後你會變成鬼，60 秒後可以開始抓人</p>
            <div className="pick-list">
              {ghosts.map((g) => (
                <button
                  key={g.id}
                  className="pick"
                  onClick={() => {
                    setCatching(false)
                    reportCaught(room.code, me.id, g.id).catch((e) => show(e.message, 'danger'))
                  }}
                >
                  <Avatar id={g.id} name={g.name} ghost />
                  <span>{g.name}</span>
                </button>
              ))}
            </div>
            <button className="btn subtle block" onClick={() => setCatching(false)}>
              取消
            </button>
          </div>
        </div>
      )}
      {node}
    </>
  )
}

// ───────────────────────── 鬼 ─────────────────────────

function GhostView({ data, me, now, fix }: { data: RoomData; me: Player; now: number; fix: GeoFix | null }) {
  const room = data.room!
  const s = room.settings
  const { show, node } = useToast()

  // 新的洩漏：提示音
  const seen = useRef(new Set<string>())
  const first = useRef(true)
  useEffect(() => {
    for (const l of data.leaks) {
      if (seen.current.has(l.id)) continue
      seen.current.add(l.id)
      if (!first.current && l.expiresAt > nowMs()) {
        beep()
        show(`${l.playerName} 曝光了！${l.radius ? `${l.radius}m 範圍` : '精確位置'}`, 'ok')
      }
    }
    first.current = false
  }, [data.leaks, show])

  const sec = Math.ceil(now / 1000)
  const activeLeaks = useMemo(() => data.leaks.filter((l) => l.expiresAt > sec * 1000), [data.leaks, sec])
  const circles = useMemo<MapCircle[]>(() => {
    const c: MapCircle[] = []
    if (s.boundaryCenter) c.push({ id: 'boundary', center: s.boundaryCenter, radius: s.boundaryRadius, tone: 'boundary' })
    for (const l of activeLeaks)
      c.push({
        id: l.id,
        center: l.center,
        radius: l.radius,
        tone: 'leak',
        label: `${l.playerName} · ${Math.max(0, Math.ceil(l.expiresAt / 1000 - sec))}s`,
      })
    return c
  }, [s.boundaryCenter, s.boundaryRadius, activeLeaks, sec])

  const bucket = Math.floor(now / 5000)
  const dots = useMemo<MapDot[]>(() => {
    const d: MapDot[] = []
    for (const p of data.players) {
      if (p.role !== 'ghost' || p.id === me.id) continue
      const loc = data.locations[p.id]
      if (loc && bucket * 5000 - loc.seenAt < 60_000) d.push({ id: p.id, at: loc, kind: 'ghost', label: p.name })
    }
    if (fix) d.push({ id: 'me', at: fix, kind: 'self' })
    return d
  }, [data.players, data.locations, fix, me.id, bucket])

  if (room.status === 'hiding')
    return (
      <div className="wait-screen">
        <Ring value={(room.hideEndsAt - now) / (s.hideSec * 1000)} size={200} stroke={8}>
          <span className="clock xl">{fmtClock(room.hideEndsAt - now)}</span>
        </Ring>
        <p className="title">原地等待</p>
        <p className="muted">躲藏者正在找地方躲，倒數結束才能出發</p>
      </div>
    )

  if (now < me.ghostReadyAt)
    return (
      <div className="wait-screen">
        <Ring value={(me.ghostReadyAt - now) / GHOST_COOLDOWN_MS} size={200} stroke={8} danger>
          <span className="clock xl">{fmtClock(me.ghostReadyAt - now)}</span>
        </Ring>
        <p className="title">你變成鬼了 👻</p>
        <p className="muted">冷卻結束後才能開始抓人</p>
      </div>
    )

  const hiders = data.players.filter((p) => p.role === 'hider')
  return (
    <>
      <MapView className="map-full" circles={circles} dots={dots} focus={fix} />
      <div className="hud-chips">
        <span className="chip">🎯 抓到 {me.catches}</span>
        {activeLeaks.length > 0 && <span className="chip warn">📡 {activeLeaks.length} 個曝光中</span>}
      </div>
      {activeLeaks.length === 0 && <div className="pill-banner">等待躲藏者曝光…</div>}
      <div className="hud-bottom">
        <div className="glass remaining">
          <span className="eyebrow">還沒被抓 · {hiders.length}</span>
          <div className="remaining-list">
            {hiders.map((h) => (
              <span key={h.id} className="chip">
                <Avatar id={h.id} name={h.name} size={22} /> {h.name}
              </span>
            ))}
          </div>
        </div>
      </div>
      {node}
    </>
  )
}
