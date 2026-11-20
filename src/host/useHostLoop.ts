import { useEffect, useRef } from 'react'
import { doc, increment, runTransaction, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from '../firebase'
import { nowMs } from '../lib/clock'
import { distance } from '../lib/geo'
import { leaksCol, playerRef, roomRef, tasksCol } from '../lib/room'
import {
  BOUNDARY_LEAK_COOLDOWN_MS,
  HOST_STALE_MS,
  IDLE_MOVE_M,
  LEAK_SHOW_MS,
  PING_RADIUS_M,
  PING_SHOW_MS,
  TASK_GRACE_MS,
  TRACK_MS,
  gotoTarget,
  leakCenter,
  leakRadius,
  nextTaskDelayMs,
  pickTaskType,
  boundaryAt,
  outsideBy,
  radarRound,
} from '../lib/rules'
import type { LatLng, Leak, LeakReason, Player, PlayerLocation, Room, Task } from '../types'

export interface HostData {
  room: Room
  players: Player[]
  locations: Record<string, PlayerLocation>
  pendingTasks: Task[]
  leaks: Leak[]
}

const TICK_MS = 1000
const HOST_BEAT_MS = 3000

/**
 * 房主的瀏覽器擔任主持人。只有房主會掛這個 hook。
 * 每秒用最新快照判斷：階段切換、派任務、任務逾時、離線、出界。
 */
export function useHostLoop(data: HostData | null, enabled: boolean) {
  const latest = useRef(data)
  latest.current = data
  /** 已送出但快照還沒反映的動作，避免同一件事重複觸發 */
  const inflight = useRef(new Map<string, number>())
  /** 每局每人已發出的洩漏數（可能比快照新），用來算正確的洩漏等級 */
  const issuedLeaks = useRef(new Map<string, number>())
  const busy = useRef(false)
  /** 靜止偵測：每局每人「開始沒移動」的位置與時間（只存在房主記憶體，房主重整就重算） */
  const anchors = useRef(new Map<string, LatLng & { at: number }>())

  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => {
      if (busy.current || !latest.current) return
      busy.current = true
      tick(latest.current).catch((e) => console.error('host tick', e)).finally(() => {
        busy.current = false
      })
    }, TICK_MS)
    return () => clearInterval(id)
  }, [enabled])

  function once(key: string, ttl = 15_000): boolean {
    const now = Date.now()
    for (const [k, exp] of inflight.current) if (exp < now) inflight.current.delete(k)
    if (inflight.current.has(key)) return false
    inflight.current.set(key, now + ttl)
    return true
  }

  function nextLeakLevel(room: Room, p: Player): number {
    const key = `${room.round}:${p.id}`
    const level = Math.max(issuedLeaks.current.get(key) ?? 0, p.leaks) + 1
    issuedLeaks.current.set(key, level)
    return level
  }

  async function leak(room: Room, p: Player, loc: PlayerLocation | undefined, reason: LeakReason) {
    const level = nextLeakLevel(room, p)
    const now = nowMs()
    const batch = writeBatch(db)
    batch.update(playerRef(room.code, p.id), {
      leaks: increment(1),
      ...(reason === 'boundary' ? { lastOutOfBoundsLeak: now } : {}),
    })
    if (loc) {
      // 任務失敗：直接精確位置 + 即時追蹤；離線、出界才走 80 → 30 → 精確 的升級
      const track = reason === 'task'
      const radius = track ? 0 : leakRadius(level)
      const ref = doc(leaksCol(room.code))
      const l: Leak = {
        id: ref.id,
        playerId: p.id,
        playerName: p.name,
        level,
        center: leakCenter({ lat: loc.lat, lng: loc.lng }, radius),
        radius,
        reason,
        createdAt: now,
        expiresAt: now + (track ? TRACK_MS : LEAK_SHOW_MS),
        ...(track ? { live: true, seenAt: loc.seenAt } : {}),
      }
      batch.set(ref, l)
    }
    await batch.commit()
  }

  async function tick({ room, players, locations, pendingTasks, leaks }: HostData) {
    const now = nowMs()
    const code = room.code
    const s = room.settings
    const live = room.status === 'hiding' || room.status === 'playing'

    // ── 房主心跳／暫停補償 ──
    if (live && room.hostSeen && now - room.hostSeen > HOST_STALE_MS) {
      if (!once(`resume:${room.hostSeen}`)) return
      const gap = now - room.hostSeen
      const batch = writeBatch(db)
      batch.update(roomRef(code), {
        hostSeen: now,
        hideEndsAt: room.hideEndsAt + gap,
        ...(room.status === 'playing' ? { endsAt: room.endsAt + gap } : {}),
        ...(room.nextPingAt ? { nextPingAt: room.nextPingAt + gap } : {}),
      })
      for (const a of anchors.current.values()) a.at += gap
      for (const t of pendingTasks) batch.update(doc(tasksCol(code), t.id), { deadline: t.deadline + gap })
      for (const p of players)
        if (p.nextTaskAt) batch.update(playerRef(code, p.id), { nextTaskAt: p.nextTaskAt + gap })
      await batch.commit()
      return
    }
    if (now - room.hostSeen >= HOST_BEAT_MS && once(`beat:${room.hostSeen}`)) {
      await updateDoc(roomRef(code), { hostSeen: now })
    }

    if (room.status === 'hiding') {
      if (now >= room.hideEndsAt && once(`play:${room.round}`)) {
        const batch = writeBatch(db)
        const playStartAt = room.hideEndsAt
        batch.update(roomRef(code), {
          status: 'playing',
          playStartAt,
          endsAt: playStartAt + s.gameMin * 60_000,
          nextPingAt: s.pingEveryMin ? playStartAt + s.pingEveryMin * 60_000 : 0,
        })
        for (const p of players)
          if (p.role === 'hider')
            batch.update(playerRef(code, p.id), { nextTaskAt: playStartAt + nextTaskDelayMs(s) })
        await batch.commit()
      }
      return
    }

    if (room.status !== 'playing') return

    const hiders = players.filter((p) => p.role === 'hider')
    if ((now >= room.endsAt || hiders.length === 0) && once(`end:${room.round}`)) {
      const batch = writeBatch(db)
      batch.update(roomRef(code), { status: 'ended', endedAt: Math.min(now, room.endsAt) })
      for (const t of pendingTasks) batch.update(doc(tasksCol(code), t.id), { status: 'cancelled' })
      await batch.commit()
      return
    }

    const byId = new Map(players.map((p) => [p.id, p]))

    // ── 即時追蹤：把追蹤中的洩漏點移到最新位置 ──
    for (const l of leaks) {
      if (!l.live || l.expiresAt <= now) continue
      const loc = locations[l.playerId]
      if (!loc || loc.seenAt <= (l.seenAt ?? 0) || !once(`track:${l.id}:${loc.seenAt}`)) continue
      await updateDoc(doc(leaksCol(code), l.id), { center: { lat: loc.lat, lng: loc.lng }, seenAt: loc.seenAt })
    }

    // ── 任務逾時／取消 ──
    for (const t of pendingTasks) {
      const p = byId.get(t.playerId)
      if (!p || p.role !== 'hider') {
        if (once(`cancel:${t.id}`)) await updateDoc(doc(tasksCol(code), t.id), { status: 'cancelled' })
        continue
      }
      if (now > t.deadline + TASK_GRACE_MS && once(`fail:${t.id}`)) {
        const failed = await runTransaction(db, async (tx) => {
          const ref = doc(tasksCol(code), t.id)
          const snap = await tx.get(ref)
          if ((snap.data() as Task | undefined)?.status !== 'pending') return false
          tx.update(ref, { status: 'failed' })
          return true
        })
        if (failed) await leak(room, p, locations[p.id], 'task')
      }
    }

    // ── 定期廣播：公布全體躲藏者的粗略範圍（不扣分、不算曝光次數）──
    if (room.nextPingAt && now >= room.nextPingAt && once(`ping:${room.nextPingAt}`)) {
      const batch = writeBatch(db)
      batch.update(roomRef(code), { nextPingAt: s.pingEveryMin ? room.nextPingAt + s.pingEveryMin * 60_000 : 0 })
      for (const p of hiders) {
        const loc = locations[p.id]
        if (!loc) continue
        const ref = doc(leaksCol(code))
        batch.set(ref, {
          id: ref.id,
          playerId: p.id,
          playerName: p.name,
          level: 0,
          center: leakCenter({ lat: loc.lat, lng: loc.lng }, PING_RADIUS_M),
          radius: PING_RADIUS_M,
          reason: 'ping',
          createdAt: now,
          expiresAt: now + PING_SHOW_MS,
        } satisfies Leak)
      }
      await batch.commit()
    }

    // ── 鬼的雷達：回報最近躲藏者的距離 ──
    for (const g of players) {
      if (g.role !== 'ghost' || !g.radarAt || g.radarAt <= (g.radarDoneAt ?? 0)) continue
      if (!once(`radar:${g.id}:${g.radarAt}`)) continue
      const me = locations[g.id]
      let best = Infinity
      for (const h of hiders) {
        const loc = locations[h.id]
        if (me && loc && now - loc.seenAt < 60_000) best = Math.min(best, distance(me, loc))
      }
      await updateDoc(playerRef(code, g.id), {
        radarDoneAt: g.radarAt,
        radarDist: Number.isFinite(best) ? radarRound(best) : -1,
        radarReadyAt: now + s.radarCooldownMin * 60_000,
      })
    }

    const boundaryNow = boundaryAt(s, room.playStartAt, now)
    const hasPending = new Set(pendingTasks.map((t) => t.playerId))

    // ── 抓人獎勵：抓到人的鬼雷達立即就緒，其餘躲藏者立刻出任務 ──
    for (const c of players) {
      if (!c.caughtAt || c.caughtAt < room.playStartAt || (c.catchRewardedAt ?? 0) >= c.caughtAt) continue
      if (!once(`reward:${c.id}:${c.caughtAt}`)) continue
      const batch = writeBatch(db)
      batch.update(playerRef(code, c.id), { catchRewardedAt: c.caughtAt })
      if (players.some((g) => g.id === c.caughtBy)) batch.update(playerRef(code, c.caughtBy), { radarReadyAt: 0 })
      for (const h of hiders)
        if (h.id !== c.id && !hasPending.has(h.id)) batch.update(playerRef(code, h.id), { nextTaskAt: now })
      await batch.commit()
    }

    for (const p of hiders) {
      const loc = locations[p.id]

      // ── 派任務 ──
      if (!hasPending.has(p.id) && p.nextTaskAt && now >= p.nextTaskAt && once(`task:${p.id}:${p.nextTaskAt}`)) {
        let type = pickTaskType(Boolean(loc), s.realTaskPct)
        let point = null
        if (type === 'goto' && loc) {
          // 目標點要落在任務結束時（可能已縮圈）的邊界內
          point = gotoTarget(loc, boundaryAt(s, room.playStartAt, now + s.taskLimitSec * 1000))
          if (!point) type = 'move'
        }
        if (type === 'move' && loc) point = { lat: loc.lat, lng: loc.lng }
        const ref = doc(tasksCol(code))
        const task: Task = {
          id: ref.id,
          playerId: p.id,
          type,
          seed: Math.floor(Math.random() * 2 ** 31),
          point,
          issuedAt: now,
          deadline: now + s.taskLimitSec * 1000,
          status: 'pending',
        }
        const batch = writeBatch(db)
        batch.set(ref, task)
        batch.update(playerRef(code, p.id), { nextTaskAt: now + nextTaskDelayMs(s) })
        await batch.commit()
      }

      // ── 離線（心跳中斷）──
      const seen = loc?.seenAt ?? -1
      const lastAlive = Math.max(seen, room.playStartAt)
      if (
        now - lastAlive > s.awayToleranceSec * 1000 &&
        p.awayPenalizedSeen !== seen &&
        once(`away:${p.id}:${seen}`)
      ) {
        await updateDoc(playerRef(code, p.id), { awayPenalizedSeen: seen })
        await leak(room, p, loc, 'away')
      }

      // ── 出界 ──
      if (
        boundaryNow &&
        loc &&
        now - loc.seenAt < 20_000 &&
        outsideBy(loc, boundaryNow) > Math.min(loc.acc, 30) &&
        now - p.lastOutOfBoundsLeak > BOUNDARY_LEAK_COOLDOWN_MS &&
        once(`bound:${p.id}`, BOUNDARY_LEAK_COOLDOWN_MS)
      ) {
        await leak(room, p, loc, 'boundary')
      }

      // ── 靜止太久 ──
      if (s.idleLeakMin && loc && now - loc.seenAt < 20_000) {
        const key = `${room.round}:${p.id}`
        const a = anchors.current.get(key)
        if (!a || distance(a, loc) > IDLE_MOVE_M) {
          anchors.current.set(key, { lat: loc.lat, lng: loc.lng, at: Math.max(now, room.playStartAt) })
        } else if (now - a.at >= s.idleLeakMin * 60_000) {
          a.at = now
          await leak(room, p, loc, 'idle')
        }
      }
    }
  }
}

/** 給非房主用：房主心跳過期就顯示暫停 */
export function hostStale(room: Room, now: number): boolean {
  return (room.status === 'hiding' || room.status === 'playing') && now - room.hostSeen > HOST_STALE_MS
}
