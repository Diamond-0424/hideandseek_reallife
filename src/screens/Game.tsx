import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { updateDoc } from 'firebase/firestore'
import { MapView, type MapCircle, type MapDot, type MapPolygon, type MapTone } from '../components/MapView'
import { Avatar, MusicToggle, Ring, fmtClock } from '../components/ui'
import { useMusicScene, type Scene } from '../lib/music'
import { IconAlert, IconCheck, IconGhost, IconHider, IconInfo, IconStop } from '../components/icons'
import { useAwayReport, useNow, type GeoFix } from '../hooks/device'
import type { RoomData } from '../hooks/useRoomData'
import { hostStale } from '../host/useHostLoop'
import { nowMs } from '../lib/clock'
import { completeTask, reportCaught, requestRadar, roomRef } from '../lib/room'
import {
  BONUS_POINTS,
  BONUS_WINDOW_MS,
  GHOST_COOLDOWN_MS,
  HEARTBEAT_MS,
  IDLE_MOVE_M,
  REVEAL_MS,
  SHRINK_WARN_MS,
  boundaryAt,
  leakRadius,
  nextShrink,
  type Boundary,
} from '../lib/rules'
import { distance } from '../lib/geo'
import { beep } from '../lib/sound'
import { TaskPanel } from '../tasks/TaskPanel'
import type { LatLng, Leak, Player, Room } from '../types'

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
  useMusicScene(musicFor(room, me, now, data.myTasks.length > 0))

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
        {!wakeSupported && (
          <p className="notice">
            <IconAlert size={16} /> 此瀏覽器不支援螢幕常亮，請手動關閉自動鎖定
          </p>
        )}
        {geo.error && (
          <p className="notice">
            <IconAlert size={16} /> {geo.error}
          </p>
        )}
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

/** 依遊戲情境挑背景音樂 */
function musicFor(room: Room, me: Player, now: number, hasTask: boolean): Scene {
  if (now < room.revealUntil) return 'reveal'
  if (room.status === 'hiding') return 'hiding'
  if (me.role === 'hider') return hasTask ? 'task' : 'stealth'
  return now < me.ghostReadyAt ? 'hiding' : 'hunt'
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
          <span className="reveal-mark">{me.role === 'ghost' ? <IconGhost size={84} /> : <IconHider size={84} />}</span>
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
      <span className={`role-block ${me.role}`}>
        {me.role === 'ghost' ? <IconGhost size={26} /> : <IconHider size={26} />}
        {me.role === 'ghost' ? '鬼' : '躲藏者'}
      </span>
      <div className="timer">
        <span className="eyebrow">{hiding ? '躲藏倒數' : '剩餘時間'}</span>
        <span className={`clock ${left < 60_000 ? 'is-danger' : ''}`}>{fmtClock(left)}</span>
      </div>
      <Ring value={left / total} size={40} stroke={4} danger={left < 60_000} />
      <MusicToggle />
      {isHost && (
        <button
          className="icon-btn"
          aria-label="提前結束"
          onClick={() =>
            confirm('確定要提前結束這局？') &&
            updateDoc(roomRef(room.code), { status: 'ended', endedAt: nowMs() })
          }
        >
          <IconStop size={18} />
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
    <div key={toast.id} className={`toast ${toast.kind}`} onClick={() => setToast(null)} role="status">
      {toast.kind === 'danger' ? <IconAlert size={22} /> : toast.kind === 'ok' ? <IconCheck size={22} /> : <IconInfo size={22} />}
      <span>{toast.text}</span>
    </div>
  )
  return { show, node }
}

const LEAK_WHY: Record<Leak['reason'], string> = {
  task: '任務失敗',
  away: '離開頁面太久',
  boundary: '跑出邊界',
  idle: '太久沒移動',
  ping: '定期廣播',
}

/** 邊界（含縮圈）：目前的邊界、縮圈前 60 秒預告的新邊界、倒數用的資訊 */
function useBoundary(room: Room, now: number) {
  const s = room.settings
  const sec = Math.floor(now / 1000)
  return useMemo(() => {
    const t = sec * 1000
    const current = boundaryAt(s, room.playStartAt, t)
    const next = room.status === 'playing' ? nextShrink(s, room.playStartAt, t) : null
    const warn = Boolean(next && next.at - t <= SHRINK_WARN_MS)
    const circles: MapCircle[] = []
    const polygons: MapPolygon[] = []
    const draw = (b: Boundary, id: string, tone: MapTone, label?: string) => {
      if (b.kind === 'circle') circles.push({ id, center: b.center, radius: b.radius, tone, label })
      else polygons.push({ id, points: b.points, tone, label })
    }
    if (current) draw(current, 'boundary', 'boundary')
    if (next && warn) draw(next.boundary, 'shrink', 'shrink', '新邊界')
    return { circles, polygons, next, warn }
  }, [s, room.playStartAt, room.status, sec])
}

function ShrinkStat({ next, now }: { next: { at: number } | null; now: number }) {
  if (!next) return null
  const left = next.at - now
  return (
    <span className={`stat ${left <= SHRINK_WARN_MS ? 'is-danger' : ''}`}>
      <span>縮圈</span>
      <b>{fmtClock(left)}</b>
    </span>
  )
}

/** 躲藏者自己算的靜止時間，跟房主的判定大致同步（房主曝光後重新計時，所以用取餘數） */
function useIdleLeft(fix: GeoFix | null, limitMin: number, active: boolean, now: number): number | null {
  const [anchor, setAnchor] = useState<(LatLng & { at: number }) | null>(null)
  useEffect(() => {
    if (!active || !fix) {
      setAnchor(null)
      return
    }
    setAnchor((a) => (!a || distance(a, fix) > IDLE_MOVE_M ? { lat: fix.lat, lng: fix.lng, at: nowMs() } : a))
  }, [fix, active])
  if (!active || !limitMin || !anchor) return null
  const limit = limitMin * 60_000
  return limit - (Math.max(0, now - anchor.at) % limit)
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
      beep()
      if (l.reason === 'ping') {
        show(`定期廣播：你附近 ${l.radius} 公尺範圍已公布給鬼`, 'info', 8000)
        continue
      }
      const range = l.live ? `精確位置，即時追蹤 ${Math.round((l.expiresAt - l.createdAt) / 1000)} 秒` : l.radius ? `${l.radius} 公尺範圍` : '精確位置'
      show(`你曝光了：${LEAK_WHY[l.reason]} · ${range}`, 'danger', 8000)
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

  const boundary = useBoundary(room, now)
  const idleLeft = useIdleLeft(fix, s.idleLeakMin, playing, now)
  const circles = useMemo<MapCircle[]>(() => {
    const c: MapCircle[] = [...boundary.circles]
    if (task?.type === 'goto' && task.point) c.push({ id: 'target', center: task.point, radius: 15, tone: 'target', label: '目標' })
    if (task?.type === 'move' && task.point) c.push({ id: 'zone', center: task.point, radius: 50, tone: 'zone' })
    return c
  }, [boundary.circles, task])
  const dots = useMemo<MapDot[]>(() => (fix ? [{ id: 'me', at: fix, kind: 'self' }] : []), [fix])

  const ghosts = data.players.filter((p) => p.role === 'ghost' && p.id !== me.id)
  const next = leakRadius(me.leaks + 1)

  return (
    <>
      <MapView className="map-full" circles={circles} polygons={boundary.polygons} dots={dots} focus={fix} />
      {flash && <div className="flash" aria-hidden />}
      <div className="hud-chips stats">
        <span className="stat is-ok">
          <span>任務完成</span>
          <b>{me.tasksDone}</b>
        </span>
        <span className={`stat ${me.leaks ? 'is-danger' : ''}`}>
          <span>已曝光</span>
          <b>
            {me.leaks}
            <small>次</small>
          </b>
        </span>
        <span className={`stat ${next ? '' : 'is-warn'}`}>
          <span>其他曝光</span>
          <b>
            {next ? (
              <>
                {next}
                <small>m</small>
              </>
            ) : (
              '精確'
            )}
          </b>
        </span>
        <ShrinkStat next={boundary.next} now={now} />
      </div>
      {!playing && <div className="pill-banner">趁現在快去躲好，躲藏期間沒有任務</div>}
      {playing && !task && boundary.warn && <div className="pill-banner danger">邊界即將縮小，移到紅色虛線內</div>}
      {playing && !task && !boundary.warn && idleLeft !== null && idleLeft <= 60_000 && (
        <div className="pill-banner danger">太久沒移動，{fmtClock(idleLeft)} 後曝光</div>
      )}
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
                    const t = nowMs()
                    const exposed = data.leaks.some((l) => l.playerId === me.id && l.expiresAt + BONUS_WINDOW_MS > t)
                    reportCaught(room.code, me.id, g.id, exposed).catch((e) => show(e.message, 'danger'))
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
        const range = l.live ? '即時位置，快追！' : l.radius ? `${l.radius}m 範圍` : '精確位置'
        show(
          l.reason === 'ping'
            ? `定期廣播：${l.playerName} 在 ${l.radius}m 範圍內`
            : `${l.playerName} 曝光了（${LEAK_WHY[l.reason]}）：${range}`,
          'ok',
        )
      }
    }
    first.current = false
  }, [data.leaks, show])

  const sec = Math.ceil(now / 1000)
  const activeLeaks = useMemo(() => data.leaks.filter((l) => l.expiresAt > sec * 1000), [data.leaks, sec])
  const boundary = useBoundary(room, now)
  const circles = useMemo<MapCircle[]>(() => {
    const c: MapCircle[] = [...boundary.circles]
    for (const l of activeLeaks)
      c.push({
        id: l.id,
        center: l.center,
        radius: l.radius,
        tone: l.reason === 'ping' ? 'ping' : 'leak',
        label: `${l.playerName}${l.live ? ' · 追蹤中' : ''} · ${Math.max(0, Math.ceil(l.expiresAt / 1000 - sec))}s`,
      })
    return c
  }, [boundary.circles, activeLeaks, sec])

  // 雷達結果出爐：提示
  const lastRadar = useRef(me.radarDoneAt)
  useEffect(() => {
    if (!me.radarDoneAt || me.radarDoneAt === lastRadar.current) return
    lastRadar.current = me.radarDoneAt
    beep()
    show(me.radarDist < 0 ? '雷達：目前偵測不到躲藏者' : `雷達：最近的躲藏者在 ${me.radarDist} 公尺內`, 'ok', 8000)
  }, [me.radarDoneAt, me.radarDist, show])

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
      <div className="wait-screen is-cooldown">
        <Ring value={(me.ghostReadyAt - now) / GHOST_COOLDOWN_MS} size={200} stroke={8}>
          <span className="clock xl">{fmtClock(me.ghostReadyAt - now)}</span>
        </Ring>
        <p className="title">
          <IconGhost size={28} /> 你變成鬼了
        </p>
        <p className="muted">冷卻結束後才能開始抓人</p>
      </div>
    )

  const hiders = data.players.filter((p) => p.role === 'hider')
  return (
    <>
      <MapView className="map-full" circles={circles} polygons={boundary.polygons} dots={dots} focus={fix} />
      <div className="hud-chips stats">
        <span className="stat">
          <span>已抓到</span>
          <b>
            {me.catches}
            <small>人</small>
          </b>
        </span>
        <span className={`stat ${activeLeaks.length ? 'is-danger' : ''}`}>
          <span>曝光中</span>
          <b>{activeLeaks.length}</b>
        </span>
        {s.radarCooldownMin > 0 && <RadarStat code={room.code} me={me} now={now} />}
        <ShrinkStat next={boundary.next} now={now} />
      </div>
      {activeLeaks.length === 0 && (
        <div className="pill-banner">
          {s.radarCooldownMin > 0 ? '等待曝光，或用雷達找人' : '等待躲藏者曝光…'} · 曝光中抓到 +{BONUS_POINTS}
        </div>
      )}
      <div className="hud-bottom">
        <div className="glass remaining">
          <span className="remaining-head">
            <b>{hiders.length}</b>
            <span className="eyebrow">人還沒被抓</span>
          </span>
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

function RadarStat({ code, me, now }: { code: string; me: Player; now: number }) {
  const pending = (me.radarAt ?? 0) > (me.radarDoneAt ?? 0)
  const cooling = !pending && now < (me.radarReadyAt ?? 0)
  const hasResult = me.radarDoneAt > 0 && me.radarDist >= 0
  return (
    <button
      type="button"
      className={`stat radar ${!pending && !cooling ? 'is-warn' : ''}`}
      disabled={pending || cooling}
      onClick={() => requestRadar(code, me.id).catch(() => {})}
    >
      <span>{hasResult ? `雷達 · 上次 ${me.radarDist}m` : '雷達'}</span>
      <b>{pending ? '掃描中' : cooling ? fmtClock(me.radarReadyAt - now) : '掃描'}</b>
    </button>
  )
}
