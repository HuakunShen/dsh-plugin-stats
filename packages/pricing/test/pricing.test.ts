/** Pricing lookup + cost math tests. */
import { describe, expect, it } from 'vitest'
import { costOf, lookupPrice, priceSample, snapshot } from '../src/index.js'
import type { PricingSnapshot } from '../src/schema.js'

const tiny: PricingSnapshot = {
  source: 'test',
  version: 'v0',
  updatedAt: '2026-01-01',
  providers: {
    testprov: {
      'model-a': { input: 1, output: 4, reasoning: 4 },
    },
  },
}

describe('snapshot', () => {
  it('loads the bundled models.dev snapshot', () => {
    expect(Object.keys(snapshot.providers).length).toBeGreaterThan(100)
    expect(snapshot.source).toBe('models.dev')
  })
})

describe('lookupPrice', () => {
  it('matches case-insensitively, provider-scoped first', () => {
    const found = lookupPrice('MODEL-A', 'testprov', tiny)
    expect(found?.source).toBe('snapshot:testprov/model-a')
  })

  it('returns null for unknown models', () => {
    expect(lookupPrice('nope', null, tiny)).toBeNull()
    expect(lookupPrice(null, null, tiny)).toBeNull()
  })
})

describe('costOf', () => {
  it('prices input/output/reasoning legs per million tokens', () => {
    const cost = costOf(
      { inputTokens: 1_000_000, outputTokens: 500_000, reasoningTokens: 100_000 },
      { input: 1, output: 4, reasoning: 2 },
    )
    expect(cost).toBeCloseTo(1 + 2 + 0.2, 6)
  })

  it('falls back to output rate for reasoning', () => {
    const cost = costOf(
      { inputTokens: null, outputTokens: null, reasoningTokens: 1_000_000 },
      { output: 5 },
    )
    expect(cost).toBe(5)
  })
})

describe('priceSample', () => {
  const base = { model: 'model-a', provider: 'testprov', customPricing: {}, snapshot: tiny }

  it('prices a sample from the snapshot', () => {
    const priced = priceSample({ ...base, inputTokens: 1000, outputTokens: 2000, reasoningTokens: null })
    expect(priced.kind).toBe('snapshot')
    expect(priced.costUsd).toBeCloseTo((1000 * 1 + 2000 * 4) / 1_000_000, 6)
  })

  it('prefers custom overrides', () => {
    const priced = priceSample({
      ...base,
      outputTokens: 1_000_000,
      inputTokens: null,
      reasoningTokens: null,
      customPricing: { 'model-a': 10 },
    })
    expect(priced.kind).toBe('custom')
    expect(priced.costUsd).toBe(10)
  })

  it('reports unknown instead of guessing', () => {
    const priced = priceSample({
      ...base,
      model: 'mystery',
      inputTokens: 100,
      outputTokens: 100,
      reasoningTokens: null,
    })
    expect(priced).toEqual({ costUsd: null, costSource: null, kind: 'unknown' })
  })
})
