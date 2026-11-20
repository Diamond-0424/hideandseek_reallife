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

export function insideCircle(p: LatLng, center: LatLng, radius: number): boolean {
  return distance(p, center) <= radius
}
