import { useEffect, useRef, useState } from 'react'
import { nowMs } from '../lib/clock'
import { writeLocation } from '../lib/room'
import { HEARTBEAT_MS } from '../lib/rules'
import type { Role } from '../types'

export interface GeoFix {
  lat: number
  lng: number
  acc: number
  t: number
}

/** 先要一次定位權限；加入房間前呼叫，拒絕就不能加入 */
export function requestLocation(): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('這個瀏覽器不支援定位'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? '需要允許定位才能玩。請到瀏覽器設定開啟此網站的定位權限。'
              : '暫時拿不到定位，請到室外或稍後再試。',
          ),
        ),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  })
}

export function useGeolocation(active: boolean): { fix: GeoFix | null; error: string | null } {
  const [fix, setFix] = useState<GeoFix | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!active || !('geolocation' in navigator)) return
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null)
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() })
      },
      (e) => setError(e.code === e.PERMISSION_DENIED ? '定位權限被關閉了' : '定位訊號不穩'),
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [active])
  return { fix, error }
}

/** 遊戲期間持續回報位置（心跳）。頁面不在前景時不送，房主就會判定離線。 */
export function useHeartbeat(code: string, uid: string, role: Role | undefined, fix: GeoFix | null, active: boolean) {
  const latest = useRef({ fix, role })
  latest.current = { fix, role }
  useEffect(() => {
    if (!active) return
    const beat = () => {
      const { fix, role } = latest.current
      if (!fix || !role || document.visibilityState !== 'visible') return
      writeLocation(code, uid, { lat: fix.lat, lng: fix.lng, acc: fix.acc, role, seenAt: nowMs() }).catch(
        (e) => console.warn('heartbeat', e),
      )
    }
    beat()
    const id = setInterval(beat, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', beat)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', beat)
    }
  }, [code, uid, active])
  // 角色改變（被抓變鬼）時立刻送一次，讓鬼的位置馬上對其他鬼可見
  useEffect(() => {
    if (!active || !fix || !role) return
    writeLocation(code, uid, { lat: fix.lat, lng: fix.lng, acc: fix.acc, role, seenAt: nowMs() }).catch(() => {})
  }, [role])
}

/** 螢幕常亮；回到前景時自動重新取得 */
export function useWakeLock(active: boolean): boolean {
  const [supported] = useState(() => 'wakeLock' in navigator)
  useEffect(() => {
    if (!active || !supported) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || cancelled) return
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        /* 省電模式等情況會失敗，下次回前景再試 */
      }
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      lock?.release().catch(() => {})
    }
  }, [active, supported])
  return supported
}

/** 記錄離開頁面多久，回來時回傳秒數讓畫面提示 */
export function useAwayReport(active: boolean, onBack: (seconds: number) => void) {
  const cb = useRef(onBack)
  cb.current = onBack
  useEffect(() => {
    if (!active) return
    let hiddenAt = 0
    const onChange = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now()
      else if (hiddenAt) {
        cb.current(Math.round((Date.now() - hiddenAt) / 1000))
        hiddenAt = 0
      }
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [active])
}

export function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(nowMs)
  useEffect(() => {
    const id = setInterval(() => setNow(nowMs()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
