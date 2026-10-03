/** Aggregate fold tests: quantiles, model/tool summaries, activity. */
import { describe, expect, it } from 'vitest'
import { quantile, summarize } from '../src/aggregate.js'
import type { Sample } from '../src/schemas.js'

const foldOptions = {
  maxPlausibleTps: 500,
  pricingSource: 'test',
  pricingVersion: 'v0',
  pricingUpdatedAt: '2026-01-01',
  retention: {
    maxFileBytes: 0,
    maxAgeDays: 0,
    sampleMinIntervalMs: 0,
    maxPlausibleTps: 500,
  },
  fileBytes: 0,
  skippedLines: 0,
}

const step = (partial: Record<string, number | string | boolean | null>): Sample =>
  ({
    kind: 'step',
    time: 1_000_000,
    provider: 'p',
    model: 'm',
    turn: 1,
    step: 1,
    ttftMs: 100,
    decodeMs: 1000,
    outputTokens: 50,
    inputTokens: 10,
    reasoningTokens: null,
    textChars: 100,
    reasoningChars: 0,
    tps: 50,
    costUsd: null,
    costSource: null,
    interrupted: false,
    ...partial,
  }) as Sample

describe('quantile', () => {
  it('returns null on empty input', () => {
    expect(quantile([], 0.5)).toBeNull()
  })

  it('interpolates linearly', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
  })
})

describe('summarize', () => {
  it('folds steps, tools, lifecycle, and hourly activity', () => {
    const summary = summarize(
      [
        step({ model: 'm-a', tps: 40, costUsd: 0.01, time: 1_000_000 }),
        step({ model: 'm-a', tps: 60, costUsd: 0.02, time: 1_003_600_000 }),
        step({ model: 'm-b', tps: null, unmeasurable: true, outputTokens: 900, time: 1_000_000 }),
        { kind: 'tool', time: 1_000_001, tool: 'bash', durationMs: 120, ok: true, errorKind: null },
        { kind: 'tool', time: 1_000_002, tool: 'bash', durationMs: 300, ok: false, errorKind: 'timeout' },
        { kind: 'session-join', time: 999_000, sessionId: 's-extra' },
      ] as Sample[],
      foldOptions,
    )
    expect(summary.samples).toBe(6)
    expect(summary.measurable).toBe(2)
    expect(summary.unmeasurable).toBe(1)
    const modelA = summary.models.find((entry) => entry.model === 'm-a')
    expect(modelA?.steps).toBe(2)
    expect(modelA?.tpsMean).toBe(50)
    expect(modelA?.costUsd).toBeCloseTo(0.03)
    expect(summary.tools[0]).toMatchObject({ tool: 'bash', calls: 2, ok: 1, err: 1 })
    expect(summary.activity.toolCalls).toBe(2)
    expect(summary.activity.byHour.reduce((a, b) => a + b, 0)).toBe(3)
    expect(summary.activity.sessions).toBe(1)
  })

  it('reports unknown-priced models', () => {
    const summary = summarize([step({ model: 'mystery' })], foldOptions)
    expect(summary.pricing.unknownModels).toContain('mystery')
  })
})
