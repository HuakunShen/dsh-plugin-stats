/**
 * Core sampling tests: stream windows, character shares, measurability,
 * and sample derivation. Ported from the tokspeed behavior contract.
 */
import { describe, expect, it } from 'vitest'
import {
  measuredTps,
  MIN_DECODE_MS,
  sampleOf,
  streamTextShares,
  streamWindow,
  type StreamRecord,
} from '../src/sampling.js'

const textRun = (time0: number, gaps: number[], texts: string[]): StreamRecord =>
  ({ type: 'text-chunks', time0, dt: gaps, texts }) as StreamRecord

describe('streamWindow', () => {
  it('folds time0 + dt gaps into first/last times', () => {
    const window = streamWindow([textRun(1000, [10, 10, 10], ['a', 'b', 'c'])])
    expect(window).toEqual({ firstTime: 1000, lastTime: 1030 })
  })

  it('spans multiple records and raw chunk records', () => {
    const window = streamWindow([
      textRun(2000, [5], ['x']),
      { type: 'chunk', time: 3000 } as StreamRecord,
    ])
    expect(window).toEqual({ firstTime: 2000, lastTime: 3000 })
  })

  it('returns null for an empty or timeless stream', () => {
    expect(streamWindow([])).toBeNull()
    expect(streamWindow([{ type: 'text-chunks' } as unknown as StreamRecord])).toBeNull()
  })

  it('skips non-finite gaps', () => {
    const window = streamWindow([textRun(100, [Number.NaN, 50], ['a'])])
    expect(window).toEqual({ firstTime: 100, lastTime: 150 })
  })
})

describe('streamTextShares', () => {
  it('counts visible and thinking characters separately', () => {
    const shares = streamTextShares([
      { type: 'reasoning-chunks', time0: 0, dt: [], texts: ['thinking…'] } as StreamRecord,
      { type: 'text-chunks', time0: 10, dt: [], texts: ['hello ', 'world'] } as StreamRecord,
    ])
    expect(shares).toEqual({ textChars: 11, reasoningChars: 9 })
  })

  it('counts raw delta chunks', () => {
    const shares = streamTextShares([
      { type: 'chunk', time: 0, chunk: { type: 'text-delta', text: 'ab' } } as StreamRecord,
      {
        type: 'chunk',
        time: 1,
        chunk: { type: 'reasoning-delta', text: 'c' },
      } as StreamRecord,
    ])
    expect(shares).toEqual({ textChars: 2, reasoningChars: 1 })
  })
})

describe('measuredTps', () => {
  it('reports rate inside the measurable window', () => {
    expect(measuredTps(50, 1000, { maxPlausibleTps: 500 })).toBe(50)
  })

  it('rejects short windows below the floor', () => {
    expect(measuredTps(10, MIN_DECODE_MS - 1, { maxPlausibleTps: 500 })).toBeNull()
  })

  it('rejects burst rates above the ceiling', () => {
    expect(measuredTps(900, 1000, { maxPlausibleTps: 500 })).toBeNull()
  })

  it('returns null without output tokens', () => {
    expect(measuredTps(null, 1000, { maxPlausibleTps: 500 })).toBeNull()
  })
})

describe('sampleOf', () => {
  const base = {
    sessionId: 's1',
    stepStartTime: 900,
    config: { maxPlausibleTps: 500, includeSessionIds: true },
  }

  it('derives a full step sample with tps', () => {
    const sample = sampleOf({
      ...base,
      eventTime: 1_000_000,
      turn: 1,
      step: 1,
      interrupted: false,
      source: { kind: 'model', provider: 'p', model: 'm' },
      stream: [textRun(1_000_000, [500, 300, 200], ['a'])],
      usage: { inputTokens: 10, outputTokens: 50 },
    })
    expect(sample?.tps).toBe(50)
    expect(sample?.decodeMs).toBe(1000)
    expect(sample?.sessionId).toBe('s1')
    expect(sample?.unmeasurable).toBeUndefined()
  })

  it('ignores non-model messages', () => {
    const sample = sampleOf({
      ...base,
      eventTime: 1,
      turn: 1,
      step: 1,
      interrupted: false,
      source: { kind: 'user' },
      stream: [textRun(1, [5], ['x'])],
      usage: null,
    })
    expect(sample).toBeNull()
  })

  it('marks short-window bursts unmeasurable but keeps timing', () => {
    const sample = sampleOf({
      ...base,
      eventTime: 5_000_000,
      turn: 1,
      step: 1,
      interrupted: false,
      source: { kind: 'model', provider: 'p', model: 'm' },
      stream: [textRun(5_000_000, [5], ['x'])],
      usage: { inputTokens: 1, outputTokens: 10 },
    })
    expect(sample?.tps).toBeNull()
    expect(sample?.unmeasurable).toBe(true)
    expect(sample?.decodeMs).toBe(5)
  })

  it('omits sessionId when disabled', () => {
    const sample = sampleOf({
      ...base,
      config: { maxPlausibleTps: 500, includeSessionIds: false },
      eventTime: 1_000_000,
      turn: 1,
      step: 1,
      interrupted: false,
      source: { kind: 'model', provider: 'p', model: 'm' },
      stream: [textRun(1_000_000, [500, 500], ['a'])],
      usage: { outputTokens: 25 },
    })
    expect(sample?.sessionId).toBeUndefined()
  })
})
