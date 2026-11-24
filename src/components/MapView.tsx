import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet'
import { setWorkerUrl } from 'maplibre-gl'
// MapLibre 預設用 new URL(變數, import.meta.url) 找 worker，打包工具追不到，改由 Vite 打包後指定
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(maplibreWorkerUrl)
import type { LatLng } from '../types'
import { IconLayers, IconLocate } from './icons'

export type MapTone = 'boundary' | 'shrink' | 'leak' | 'ping' | 'target' | 'zone' | 'trail'

export interface MapCircle {
  id: string
  center: LatLng
  /** 0 = 精確位置（畫成脈動點） */
  radius: number
  tone: MapTone
  label?: string
}

export interface MapPolygon {
  id: string
  points: LatLng[]
  tone: MapTone
  label?: string
  /** 編輯中：畫出頂點；不足 3 點時以折線顯示 */
  vertices?: boolean
}

/** 移動軌跡：依序連起各點，終點畫箭頭 */
export interface MapLine {
  id: string
  points: LatLng[]
  tone: MapTone
}

export type DotKind = 'self' | 'ghost' | 'hider'

export interface MapDot {
  id: string
  at: LatLng
  kind: DotKind
  label?: string
}

interface Props {
  circles?: MapCircle[]
  polygons?: MapPolygon[]
  lines?: MapLine[]
  dots?: MapDot[]
  /** 第一次有座標時置中到這裡；「回到我的位置」按鈕也用它 */
  focus?: LatLng | null
  onClick?: (p: LatLng) => void
  className?: string
}

// 底圖一：OpenFreeMap 深色向量地圖（免 key、任何螢幕密度都清晰）
const VECTOR_STYLE = 'https://tiles.openfreemap.org/styles/dark'
const VECTOR_ATTR =
  '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OSM</a>'
// 底圖二：Esri 衛星影像（看得到建築、樹叢，找躲藏點用）
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const SAT_ATTR = 'Esri, Maxar, Earthstar Geographics'

export type BaseMap = 'vector' | 'satellite'
const BASE_KEY = 'hs.basemap'

const TONE: Record<MapTone, L.PathOptions> = {
  boundary: { color: '#f2ede4', weight: 2.5, opacity: 0.85, fillColor: '#f2ede4', fillOpacity: 0.03, dashArray: '1 7', lineCap: 'round' },
  shrink: { color: '#ff3b2f', weight: 2.5, opacity: 0.9, fillOpacity: 0, dashArray: '8 6' },
  ping: { color: '#ffb800', weight: 2, opacity: 0.9, fillColor: '#ffb800', fillOpacity: 0.14 },
  leak: { color: '#ff3b2f', weight: 2.5, opacity: 1, fillColor: '#ff3b2f', fillOpacity: 0.22 },
  target: { color: '#0b0b0c', weight: 2.5, opacity: 1, fillColor: '#ffb800', fillOpacity: 0.75 },
  zone: { color: '#ffc400', weight: 2.5, opacity: 1, fillOpacity: 0, dashArray: '6 6' },
  trail: { color: '#ff3b2f', weight: 3, opacity: 0.95, fill: false, dashArray: '2 8', lineCap: 'round' },
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function dotIcon(kind: DotKind, label?: string) {
  return L.divIcon({
    className: 'mk-wrap',
    iconSize: [0, 0],
    html: `<div class="mk mk-${kind}"><i></i>${label ? `<span>${esc(label)}</span>` : ''}</div>`,
  })
}

function exactIcon(label?: string) {
  return L.divIcon({
    className: 'mk-wrap',
    iconSize: [0, 0],
    html: `<div class="mk mk-exact"><i></i>${label ? `<span>${esc(label)}</span>` : ''}</div>`,
  })
}

/** 從 a 指向 b 的方位角（度，北 = 0、順時針），距離短，用平面近似即可 */
function bearing(a: LatLng, b: LatLng): number {
  const dx = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180)
  const dy = b.lat - a.lat
  return (Math.atan2(dx, dy) * 180) / Math.PI
}

function arrowIcon(deg: number) {
  return L.divIcon({
    className: 'mk-wrap',
    iconSize: [0, 0],
    html: `<div class="mk-arrow" style="transform: rotate(${deg.toFixed(1)}deg)"></div>`,
  })
}

type CircleEntry = { key: string; layer: L.Circle | L.Marker; tip?: L.Tooltip }
type PolyEntry = { key: string; group: L.LayerGroup }
type DotEntry = { key: string; marker: L.Marker }

/**
 * 直接用 Leaflet。圖層依 id 增量更新（不整批重畫），標記的動畫才不會每秒重來。
 */
export function MapView({ circles = [], polygons = [], lines = [], dots = [], focus, onClick, className = '' }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const circleLayers = useRef(new Map<string, CircleEntry>())
  const polyLayers = useRef(new Map<string, PolyEntry>())
  const lineLayers = useRef(new Map<string, PolyEntry>())
  const dotLayers = useRef(new Map<string, DotEntry>())
  const focused = useRef(false)
  const clickRef = useRef(onClick)
  const [offCenter, setOffCenter] = useState(false)
  const [base, setBase] = useState<BaseMap>(() => (localStorage.getItem(BASE_KEY) as BaseMap) || 'vector')
  const attribution = useRef<L.Control.Attribution | null>(null)

  useEffect(() => {
    clickRef.current = onClick
  }, [onClick])

  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, {
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.5,
      maxZoom: 20,
    }).setView([25.0173, 121.5397], 17)
    L.control.zoom({ position: 'bottomleft' }).addTo(m)
    attribution.current = L.control.attribution({ position: 'bottomright', prefix: false }).addTo(m)
    m.on('click', (e) => clickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
    m.on('dragstart', () => setOffCenter(true))
    map.current = m
    const circlesNow = circleLayers.current
    const polysNow = polyLayers.current
    const linesNow = lineLayers.current
    const dotsNow = dotLayers.current
    return () => {
      m.remove()
      map.current = null
      circlesNow.clear()
      polysNow.clear()
      linesNow.clear()
      dotsNow.clear()
    }
  }, [])

  // ── 底圖切換 ──
  useEffect(() => {
    const m = map.current
    if (!m) return
    localStorage.setItem(BASE_KEY, base)
    const layer =
      base === 'vector'
        ? maplibreGL({ style: VECTOR_STYLE, attributionControl: false })
        : L.tileLayer(SAT_URL, { maxZoom: 20, maxNativeZoom: 19, detectRetina: true })
    const credit = base === 'vector' ? VECTOR_ATTR : SAT_ATTR
    layer.addTo(m)
    attribution.current?.addAttribution(credit)
    m.getContainer().dataset.base = base
    return () => {
      layer.remove()
      attribution.current?.removeAttribution(credit)
    }
  }, [base])

  useEffect(() => {
    if (focus && map.current && !focused.current) {
      map.current.setView([focus.lat, focus.lng], 17.5)
      focused.current = true
    }
  }, [focus])

  // ── 圓圈 ──
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<string>()
    for (const c of circles) {
      seen.add(c.id)
      const exact = c.radius === 0
      const key = `${c.tone}|${exact}`
      let entry = circleLayers.current.get(c.id)
      if (entry && entry.key !== key) {
        entry.layer.remove()
        entry = undefined
      }
      if (!entry) {
        const layer = exact
          ? L.marker([c.center.lat, c.center.lng], { icon: exactIcon(c.label), interactive: false })
          : L.circle([c.center.lat, c.center.lng], { radius: c.radius, interactive: false, ...TONE[c.tone] })
        layer.addTo(m)
        entry = { key, layer }
        circleLayers.current.set(c.id, entry)
      }
      const { layer } = entry
      layer.setLatLng([c.center.lat, c.center.lng])
      if (layer instanceof L.Circle) {
        layer.setRadius(c.radius)
        if (c.label) {
          if (!entry.tip) {
            entry.tip = L.tooltip({ permanent: true, direction: 'center', className: `map-chip tone-${c.tone}` })
            layer.bindTooltip(entry.tip)
          }
          layer.setTooltipContent(esc(c.label))
        }
      } else if (c.label) {
        const span = layer.getElement()?.querySelector('span')
        if (span) span.textContent = c.label
      }
    }
    for (const [id, entry] of circleLayers.current)
      if (!seen.has(id)) {
        entry.layer.remove()
        circleLayers.current.delete(id)
      }
  }, [circles])

  // ── 多邊形：形狀沒變就不重畫（遊戲畫面每秒都會重新產生陣列）──
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<string>()
    for (const p of polygons) {
      seen.add(p.id)
      const key = JSON.stringify([p.tone, p.label ?? '', p.vertices ?? false, p.points])
      const entry = polyLayers.current.get(p.id)
      if (entry?.key === key) continue
      entry?.group.remove()
      const latlngs = p.points.map((a) => [a.lat, a.lng] as L.LatLngTuple)
      const group = L.layerGroup()
      const style = { interactive: false, ...TONE[p.tone] }
      const shape =
        latlngs.length >= 3 ? L.polygon(latlngs, style) : latlngs.length === 2 ? L.polyline(latlngs, style) : null
      if (shape) {
        if (p.label)
          shape.bindTooltip(esc(p.label), { permanent: true, direction: 'center', className: `map-chip tone-${p.tone}` })
        group.addLayer(shape)
      }
      if (p.vertices)
        for (const ll of latlngs)
          group.addLayer(
            L.circleMarker(ll, { radius: 5, interactive: false, color: '#0b0b0c', weight: 2, fillColor: '#f2ede4', fillOpacity: 1 }),
          )
      group.addTo(m)
      polyLayers.current.set(p.id, { key, group })
    }
    for (const [id, entry] of polyLayers.current)
      if (!seen.has(id)) {
        entry.group.remove()
        polyLayers.current.delete(id)
      }
  }, [polygons])

  // ── 移動軌跡 ──
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<string>()
    for (const l of lines) {
      if (l.points.length < 2) continue
      seen.add(l.id)
      const key = JSON.stringify([l.tone, l.points])
      const entry = lineLayers.current.get(l.id)
      if (entry?.key === key) continue
      entry?.group.remove()
      const latlngs = l.points.map((a) => [a.lat, a.lng] as L.LatLngTuple)
      const [a, b] = l.points.slice(-2)
      const group = L.layerGroup([
        L.polyline(latlngs, { interactive: false, ...TONE[l.tone] }),
        L.marker([b.lat, b.lng], { icon: arrowIcon(bearing(a, b)), interactive: false }),
      ])
      group.addTo(m)
      lineLayers.current.set(l.id, { key, group })
    }
    for (const [id, entry] of lineLayers.current)
      if (!seen.has(id)) {
        entry.group.remove()
        lineLayers.current.delete(id)
      }
  }, [lines])

  // ── 人物標記 ──
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<string>()
    for (const d of dots) {
      seen.add(d.id)
      const key = `${d.kind}|${d.label ?? ''}`
      const entry = dotLayers.current.get(d.id)
      if (entry) {
        entry.marker.setLatLng([d.at.lat, d.at.lng])
        if (entry.key !== key) {
          entry.marker.setIcon(dotIcon(d.kind, d.label))
          entry.key = key
        }
      } else {
        const marker = L.marker([d.at.lat, d.at.lng], {
          icon: dotIcon(d.kind, d.label),
          interactive: false,
          zIndexOffset: d.kind === 'self' ? 1000 : 0,
        }).addTo(m)
        dotLayers.current.set(d.id, { key, marker })
      }
    }
    for (const [id, entry] of dotLayers.current)
      if (!seen.has(id)) {
        entry.marker.remove()
        dotLayers.current.delete(id)
      }
  }, [dots])

  return (
    <div className={`map ${className}`}>
      <div ref={el} className="map-canvas" />
      <button
        className="map-base"
        aria-label="切換底圖"
        onClick={() => setBase((b) => (b === 'vector' ? 'satellite' : 'vector'))}
      >
        <IconLayers size={16} />
        {base === 'vector' ? '衛星' : '地圖'}
      </button>
      {focus && offCenter && (
        <button
          className="map-recenter"
          aria-label="回到我的位置"
          onClick={() => {
            map.current?.flyTo([focus.lat, focus.lng], Math.max(map.current.getZoom(), 17), { duration: 0.6 })
            setOffCenter(false)
          }}
        >
          <IconLocate size={22} />
        </button>
      )}
    </div>
  )
}
