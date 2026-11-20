import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { updateDoc } from 'firebase/firestore'
import { MapView, type MapCircle, type MapDot } from '../components/MapView'
import { useAwayReport, useNow, type GeoFix } from '../hooks/device'
import type { RoomData } from '../hooks/useRoomData'
import { hostStale } from '../host/useHostLoop'
import { nowMs } from '../lib/clock'
import { completeTask, reportCaught, roomRef } from '../lib/room'
import { HEARTBEAT_MS, REVEAL_MS, leakRadius } from '../lib/rules'
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

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function Game({ data, me, isHost, geo, wakeSupported }: Props) {
  const room = data.room!
  const now = useNow(500)
  const paused = !isHost && hostStale(room, now)

  if (now < room.revealUntil) return <Reveal room={room} players={data.players} me={me} now={now} />

  return (
    <main className="game">
      <TopBar room={room} me={me} now={now} isHost={isHost} />
      {!wakeSupported && <p className="warn">這個瀏覽器不支援螢幕常亮，請手動把自動鎖定關掉。</p>}
      {geo.error && <p className="warn">{geo.error}</p>}
      {me.role === 'hider' ? (
        <HiderView data={data} me={me} now={now} fix={geo.fix} />
      ) : (
        <GhostView data={data} me={me} now={now} fix={geo.fix} />
      )}
      {paused && (
        <div className="overlay">
          <p className="big">房主離線，遊戲暫停中</p>
          <p className="muted">房主回來後計時會自動順延</p>
        </div>
      )}
    </main>
  )
}

function Reveal({ room, players, me, now }: { room: Room; players: Player[]; me: Player; now: number }) {
  const ghosts = players.filter((p) => p.role === 'ghost')
  const rolling = room.revealUntil - now > REVEAL_MS / 2
  return (
    <main className="page center reveal">
      {rolling ? (
        <p className="big">抽鬼中…</p>
      ) : (
        <>
          <p className="big">{me.role === 'ghost' ? '👻 你是鬼！' : '🙈 你是躲藏者'}</p>
          <p>鬼：{ghosts.map((g) => g.name).join('、')}</p>
        </>
      )}
    </main>
  )
}

function TopBar({ room, me, now, isHost }: { room: Room; me: Player; now: number; isHost: boolean }) {
  const hiding = room.status === 'hiding'
  return (
    <header className="topbar">
      <span className={`role ${me.role}`}>{me.role === 'ghost' ? '👻 鬼' : '🙈 躲藏者'}</span>
      <span>
        {hiding ? '躲藏倒數 ' : '剩餘 '}
        <b>{fmt((hiding ? room.hideEndsAt : room.endsAt) - now)}</b>
      </span>
      {isHost && (
        <button
          className="ghost-btn small"
          onClick={() =>
            confirm('確定要提前結束這局？') &&
            updateDoc(roomRef(room.code), { status: 'ended', endedAt: nowMs() })
          }
        >
          結束
        </button>
      )}
    </header>
  )
}

function useToast() {
  const [toast, setToast] = useState<{ text: string; kind: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = useCallback((text: string, kind = 'info', ms = 5000) => {
    setToast({ text, kind })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), ms)
  }, [])
  const node = toast && (
    <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
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
      show(`⚠️ 你曝光了！（${why}，第 ${l.level} 次，${range}）`, 'danger', 8000)
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
      .then((ok) => show(ok ? '✅ 任務完成 +3' : '太晚了，任務已失效', ok ? 'ok' : 'danger'))
      .catch((e) => show(`送出失敗：${e.message}`, 'danger'))
  }, [task, room.code, show])

  const circles = useMemo<MapCircle[]>(() => {
    const c: MapCircle[] = []
    if (s.boundaryCenter) c.push({ center: s.boundaryCenter, radius: s.boundaryRadius, color: '#4ea1ff', fill: 0.05, dashed: true })
    if (task?.type === 'goto' && task.point) c.push({ center: task.point, radius: 15, color: '#ff9f1c', fill: 0.35, label: '目標' })
    if (task?.type === 'move' && task.point) c.push({ center: task.point, radius: 50, color: '#ff9f1c', fill: 0.05, dashed: true })
    return c
  }, [s.boundaryCenter, s.boundaryRadius, task])
  const dots = useMemo<MapDot[]>(() => (fix ? [{ at: fix, color: '#4ea1ff', big: true }] : []), [fix])

  const ghosts = data.players.filter((p) => p.role === 'ghost' && p.id !== me.id)

  return (
    <div className={`view ${flash ? 'flash' : ''}`}>
      <div className="stats">
        <span>完成任務 {me.tasksDone}</span>
        <span>已曝光 {me.leaks} 次</span>
        <span className="muted">下次曝光：{leakRadius(me.leaks + 1) ? `${leakRadius(me.leaks + 1)}m 範圍` : '精確位置'}</span>
      </div>
      <div className="map-fill">
        <MapView circles={circles} dots={dots} focus={fix} />
      </div>
      {!playing && <p className="banner">趁現在快去躲好！躲藏時間不會有任務。</p>}
      {task && <TaskPanel key={task.id} task={task} now={now} fix={fix} onDone={onDone} />}
      <button className="caught" onClick={() => setCatching(true)}>
        我被抓到了
      </button>
      {catching && (
        <div className="overlay">
          <p className="big">被誰抓到？</p>
          {ghosts.map((g) => (
            <button
              key={g.id}
              className="primary"
              onClick={() => {
                setCatching(false)
                reportCaught(room.code, me.id, g.id).catch((e) => show(e.message, 'danger'))
              }}
            >
              {g.name}
            </button>
          ))}
          <button className="ghost-btn" onClick={() => setCatching(false)}>
            取消
          </button>
        </div>
      )}
      {node}
    </div>
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
        show(`📍 ${l.playerName} 曝光了！${l.radius ? `（${l.radius}m 範圍）` : '（精確位置）'}`, 'ok')
      }
    }
    first.current = false
  }, [data.leaks, show])

  const activeLeaks = data.leaks.filter((l) => l.expiresAt > now)
  const circles = useMemo<MapCircle[]>(() => {
    const c: MapCircle[] = []
    if (s.boundaryCenter) c.push({ center: s.boundaryCenter, radius: s.boundaryRadius, color: '#4ea1ff', fill: 0.05, dashed: true })
    for (const l of activeLeaks)
      c.push({
        center: l.center,
        radius: l.radius,
        color: '#ff4d6d',
        fill: 0.25,
        label: `${l.playerName} ${Math.ceil((l.expiresAt - now) / 1000)}s`,
      })
    return c
    // now 每 0.5 秒變一次，只在秒數改變時重畫
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.boundaryCenter, s.boundaryRadius, activeLeaks.map((l) => l.id).join(), Math.ceil(now / 1000)])
  const dots = useMemo<MapDot[]>(() => {
    const d: MapDot[] = []
    for (const p of data.players) {
      if (p.role !== 'ghost' || p.id === me.id) continue
      const loc = data.locations[p.id]
      if (loc && now - loc.seenAt < 60_000) d.push({ at: loc, color: '#b5179e', label: p.name })
    }
    if (fix) d.push({ at: fix, color: '#ff4d6d', big: true })
    return d
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.players, data.locations, fix, me.id, Math.floor(now / 5000)])

  if (room.status === 'hiding')
    return (
      <div className="view center">
        <p className="big">原地等待</p>
        <p>躲藏者正在找地方躲，倒數結束才能出發。</p>
        <p className="countdown">{fmt(room.hideEndsAt - now)}</p>
      </div>
    )

  if (now < me.ghostReadyAt)
    return (
      <div className="view center">
        <p className="big">你被抓到了，變成鬼！</p>
        <p>冷卻中，結束後才能開始抓人</p>
        <p className="countdown">{fmt(me.ghostReadyAt - now)}</p>
      </div>
    )

  const hiders = data.players.filter((p) => p.role === 'hider')
  return (
    <div className="view">
      <div className="stats">
        <span>抓到 {me.catches} 人</span>
        <span>剩下：{hiders.map((h) => h.name).join('、') || '無'}</span>
      </div>
      <div className="map-fill">
        <MapView circles={circles} dots={dots} focus={fix} />
      </div>
      {activeLeaks.length === 0 && <p className="banner">等待躲藏者曝光…</p>}
      {node}
    </div>
  )
}
