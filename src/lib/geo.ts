import type { LatLng } from '../types'

const EARTH_R = 6371000

const rad = (d: number) => (d * Math.PI) / 180

/** 兩點距離（公尺） */
export function distance(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(h))
}

/** 從某點往某方位移動若干公尺（小距離近似） */
export function offset(p: LatLng, meters: number, bearingRad: number): LatLng {
  const dLat = (meters * Math.cos(bearingRad)) / EARTH_R
  const dLng = (meters * Math.sin(bearingRad)) / (EARTH_R * Math.cos(rad(p.lat)))
  return { lat: p.lat + (dLat * 180) / Math.PI, lng: p.lng + (dLng * 180) / Math.PI }
}

/** 圓內均勻隨機一點 */
export function randomPointWithin(center: LatLng, radius: number, rand = Math.random): LatLng {
  return offset(center, radius * Math.sqrt(rand()), rand() * 2 * Math.PI)
}

// ── 多邊形（以第一個頂點為原點投影成平面公尺座標；校園尺度誤差可忽略）──

interface XY {
  x: number
  y: number
}

function toXY(p: LatLng, o: LatLng): XY {
  return { x: rad(p.lng - o.lng) * EARTH_R * Math.cos(rad(o.lat)), y: rad(p.lat - o.lat) * EARTH_R }
}

function fromXY(q: XY, o: LatLng): LatLng {
  return {
    lat: o.lat + (q.y / EARTH_R) * (180 / Math.PI),
    lng: o.lng + (q.x / (EARTH_R * Math.cos(rad(o.lat)))) * (180 / Math.PI),
  }
}

/** 射線法判斷點是否在多邊形內 */
export function insidePolygon(p: LatLng, poly: LatLng[]): boolean {
  if (poly.length < 3) return false
  const o = poly[0]
  const q = toXY(p, o)
  const v = poly.map((a) => toXY(a, o))
  let inside = false
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const a = v[i]
    const b = v[j]
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** 點到多邊形最近一條邊的距離（公尺） */
export function distanceToPolygonEdge(p: LatLng, poly: LatLng[]): number {
  const o = poly[0]
  const q = toXY(p, o)
  const v = poly.map((a) => toXY(a, o))
  let best = Infinity
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const a = v[j]
    const b = v[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy)))
  }
  return best
}

/** 多邊形的面積重心；面積趨近 0（點幾乎共線）時退回頂點平均 */
export function polygonCentroid(poly: LatLng[]): LatLng {
  const o = poly[0]
  const v = poly.map((a) => toXY(a, o))
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    const cross = v[j].x * v[i].y - v[i].x * v[j].y
    area += cross
    cx += (v[j].x + v[i].x) * cross
    cy += (v[j].y + v[i].y) * cross
  }
  if (Math.abs(area) < 1e-6) {
    const n = v.length
    return fromXY({ x: v.reduce((s, a) => s + a.x, 0) / n, y: v.reduce((s, a) => s + a.y, 0) / n }, o)
  }
  return fromXY({ x: cx / (3 * area), y: cy / (3 * area) }, o)
}

/** 以重心為中心等比例縮放多邊形 */
export function scalePolygon(poly: LatLng[], k: number): LatLng[] {
  if (k === 1 || poly.length < 3) return poly
  const c = polygonCentroid(poly)
  return poly.map((a) => {
    const q = toXY(a, c)
    return fromXY({ x: q.x * k, y: q.y * k }, c)
  })
}
