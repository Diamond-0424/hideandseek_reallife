import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatLng } from '../types'

export interface MapCircle {
  center: LatLng
  radius: number
  color: string
  fill?: number
  dashed?: boolean
  label?: string
}

export interface MapDot {
  at: LatLng
  color: string
  label?: string
  /** 自己的位置畫大一點 */
  big?: boolean
}

interface Props {
  circles?: MapCircle[]
  dots?: MapDot[]
  /** 第一次有座標時置中到這裡 */
  focus?: LatLng | null
  onClick?: (p: LatLng) => void
  height?: string
}

/** 直接用 Leaflet（不透過 react-leaflet），每次 props 改變就重畫圖層 */
export function MapView({ circles = [], dots = [], focus, onClick, height = '100%' }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const focused = useRef(false)
  const clickRef = useRef(onClick)
  clickRef.current = onClick

  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([25.0173, 121.5397], 17)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    m.on('click', (e) => clickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    if (focus && map.current && !focused.current) {
      map.current.setView([focus.lat, focus.lng], 17)
      focused.current = true
    }
  }, [focus])

  useEffect(() => {
    const g = layer.current
    if (!g) return
    g.clearLayers()
    for (const c of circles) {
      const shape =
        c.radius > 0
          ? L.circle([c.center.lat, c.center.lng], {
              radius: c.radius,
              color: c.color,
              weight: 2,
              fillOpacity: c.fill ?? 0.15,
              dashArray: c.dashed ? '6 6' : undefined,
            })
          : // 半徑 0 = 精確位置
            L.circleMarker([c.center.lat, c.center.lng], { radius: 10, color: c.color, weight: 3, fillOpacity: 0.8 })
      if (c.label) shape.bindTooltip(c.label, { permanent: true, direction: 'top' })
      shape.addTo(g)
    }
    for (const d of dots) {
      const m = L.circleMarker([d.at.lat, d.at.lng], {
        radius: d.big ? 9 : 7,
        color: '#fff',
        weight: 2,
        fillColor: d.color,
        fillOpacity: 1,
      }).addTo(g)
      if (d.label) m.bindTooltip(d.label, { permanent: true, direction: 'bottom', className: 'dot-label' })
    }
  }, [circles, dots])

  return <div ref={el} style={{ height, width: '100%' }} />
}
