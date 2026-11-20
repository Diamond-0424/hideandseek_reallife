import { describe, expect, it } from 'vitest'
import { distance, insidePolygon, offset, polygonCentroid } from './geo'
import {
  DEFAULT_SETTINGS,
  gotoTarget,
  leakCenter,
  leakRadius,
  nextTaskDelayMs,
  boundaryAt,
  nextShrink,
  outsideBy,
  type Boundary,
  pickGhosts,
  score,
  seeded,
} from './rules'
import type { Player, Room } from '../types'

const campus = { lat: 25.0173, lng: 121.5397 }

describe('geo', () => {
  it('offset then distance round-trips', () => {
    const p = offset(campus, 100, 1.2)
    expect(distance(campus, p)).toBeCloseTo(100, 0)
  })
})

describe('leaks', () => {
  it('escalates 80 → 30 → exact', () => {
    expect([1, 2, 3, 7].map(leakRadius)).toEqual([80, 30, 0, 0])
  })

  it('keeps the real location inside the circle', () => {
    const rand = seeded(42)
    for (let i = 0; i < 200; i++) {
      const c = leakCenter(campus, 80, rand)
      expect(distance(c, campus)).toBeLessThanOrEqual(80)
    }
  })
})

describe('tasks', () => {
  it('delay stays within interval ± jitter', () => {
    const rand = seeded(1)
    for (let i = 0; i < 100; i++) {
      const ms = nextTaskDelayMs(DEFAULT_SETTINGS, rand)
      expect(ms).toBeGreaterThanOrEqual(240_000)
      expect(ms).toBeLessThanOrEqual(360_000)
    }
  })

  it('goto target lies 30–80 m away and inside boundary', () => {
    const rand = seeded(7)
    for (let i = 0; i < 50; i++) {
      const t = gotoTarget(campus, { kind: 'circle', center: campus, radius: 300 }, rand)!
      const d = distance(campus, t)
      expect(d).toBeGreaterThanOrEqual(29)
      expect(d).toBeLessThanOrEqual(81)
    }
  })
})

describe('shrinking boundary', () => {
  const T0 = 1_700_000_000_000
  const s = { ...DEFAULT_SETTINGS, boundaryCenter: campus, boundaryRadius: 400, shrinkEveryMin: 10 }
  const min = (m: number) => T0 + m * 60_000
  const radius = (b: Boundary | null) => (b?.kind === 'circle' ? b.radius : NaN)

  it('shrinks 15% of the original radius per step, down to 40%', () => {
    expect([0, 9.9, 10, 20, 40, 90].map((m) => radius(boundaryAt(s, T0, min(m))))).toEqual([400, 400, 340, 280, 160, 160])
  })

  it('reports the next shrink until the minimum is reached', () => {
    const a = nextShrink(s, T0, min(3))!
    expect([a.at, radius(a.boundary)]).toEqual([min(10), 340])
    const b = nextShrink(s, T0, min(35))!
    expect([b.at, radius(b.boundary)]).toEqual([min(40), 160])
    expect(nextShrink(s, T0, min(45))).toBeNull()
  })

  it('does nothing when disabled', () => {
    expect(radius(boundaryAt({ ...s, shrinkEveryMin: 0 }, T0, min(60)))).toBe(400)
    expect(nextShrink({ ...s, shrinkEveryMin: 0 }, T0, min(1))).toBeNull()
  })
})

describe('polygon boundary', () => {
  // 以 campus 為西南角、東西 400 m × 南北 200 m 的長方形
  const sw = campus
  const se = offset(sw, 400, Math.PI / 2)
  const ne = offset(se, 200, 0)
  const nw = offset(sw, 200, 0)
  const rect = [sw, se, ne, nw]
  const mid = offset(offset(sw, 200, Math.PI / 2), 100, 0)
  const s = { ...DEFAULT_SETTINGS, boundaryShape: 'polygon' as const, boundaryPolygon: rect, shrinkEveryMin: 10 }
  const T0 = 1_700_000_000_000

  it('is unset until there are 3 points', () => {
    expect(boundaryAt({ ...s, boundaryPolygon: rect.slice(0, 2) }, 0, 0)).toBeNull()
    expect(boundaryAt(s, 0, 0)?.kind).toBe('polygon')
  })

  it('measures signed distance to the edge', () => {
    const b = boundaryAt(s, 0, 0)!
    expect(outsideBy(mid, b)).toBeCloseTo(-100, 0)
    expect(outsideBy(offset(sw, 30, Math.PI), b)).toBeCloseTo(30, 0)
    expect(outsideBy(offset(nw, 50, 0), b)).toBeCloseTo(50, 0)
  })

  it('shrinks proportionally around the centroid', () => {
    expect(distance(polygonCentroid(rect), mid)).toBeLessThan(1)
    const b = boundaryAt(s, T0, T0 + 10 * 60_000)!
    if (b.kind !== 'polygon') throw new Error('expected polygon')
    // 縮 15%：重心到角落的距離剩 85%
    expect(distance(b.points[0], mid) / distance(sw, mid)).toBeCloseTo(0.85, 3)
    expect(insidePolygon(offset(sw, 5, Math.PI / 4), b.points)).toBe(false)
    expect(insidePolygon(mid, b.points)).toBe(true)
  })

  it('handles concave shapes (L shape)', () => {
    const o = campus
    const at = (e: number, n: number) => offset(offset(o, e, Math.PI / 2), n, 0)
    const L = [at(0, 0), at(200, 0), at(200, 100), at(100, 100), at(100, 200), at(0, 200)]
    expect(insidePolygon(at(50, 150), L)).toBe(true)
    expect(insidePolygon(at(150, 150), L)).toBe(false)
  })

  it('keeps goto targets inside the polygon', () => {
    const rand = seeded(3)
    const b = boundaryAt(s, 0, 0)!
    for (let i = 0; i < 50; i++) {
      const t = gotoTarget(mid, b, rand)
      if (t) expect(outsideBy(t, b)).toBeLessThanOrEqual(-10)
    }
  })
})

describe('pickGhosts', () => {
  it('always leaves at least one hider', () => {
    expect(pickGhosts(['a', 'b'], 5)).toHaveLength(1)
    expect(pickGhosts(['a', 'b', 'c', 'd'], 2)).toHaveLength(2)
  })
})

describe('score', () => {
  const T0 = 1_700_000_000_000
  const room = { playStartAt: T0, endsAt: T0 + 45 * 60000, endedAt: 0 } as Room
  const base: Player = {
    id: 'x', name: 'x', role: 'hider', startedAsGhost: false, joinedAt: 0, caughtAt: 0,
    caughtBy: '', ghostReadyAt: 0, tasksDone: 0, leaks: 0, catches: 0, nextTaskAt: 0,
    awayPenalizedSeen: 0, lastOutOfBoundsLeak: 0, bonusCatches: 0, radarAt: 0, radarDoneAt: 0,
    radarDist: 0, radarReadyAt: 0,
  }

  it('ghost bonus catches add 5 each', () => {
    expect(score({ ...base, startedAsGhost: true, catches: 2, bonusCatches: 1 }, room, T0).total).toBe(25)
  })

  it('hider: survival + tasks − leaks', () => {
    const s = score({ ...base, tasksDone: 4, leaks: 2 }, room, T0 + 10 * 60000 + 5000)
    expect(s).toMatchObject({ survival: 10, tasks: 12, leaks: -4, total: 18 })
  })

  it('caught hider stops accruing survival and gains catches as ghost', () => {
    const s = score({ ...base, caughtAt: T0 + 5 * 60000, catches: 1 }, room, T0 + 30 * 60000)
    expect(s.survival).toBe(5)
    expect(s.total).toBe(15)
  })

  it('starting ghost has no survival', () => {
    expect(score({ ...base, startedAsGhost: true, catches: 2 }, room, T0 + 30 * 60000).total).toBe(20)
  })
})
