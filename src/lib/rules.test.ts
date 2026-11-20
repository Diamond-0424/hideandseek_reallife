import { describe, expect, it } from 'vitest'
import { distance, offset } from './geo'
import {
  DEFAULT_SETTINGS,
  gotoTarget,
  leakCenter,
  leakRadius,
  nextTaskDelayMs,
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
      const t = gotoTarget(campus, campus, 300, rand)!
      const d = distance(campus, t)
      expect(d).toBeGreaterThanOrEqual(29)
      expect(d).toBeLessThanOrEqual(81)
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
    awayPenalizedSeen: 0, lastOutOfBoundsLeak: 0,
  }

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
