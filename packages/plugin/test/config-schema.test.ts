/**
 * Loader/zod config parity: the schemastery `Config` (Loader boundary) and
 * the zod `ConfigSchema` (everything interior) must accept the same inputs
 * and produce the same effective config. A drift here fails plugin
 * activation or silently changes retention/pricing behavior.
 */
import { ConfigSchema } from '@dsh-stats/core'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/host.js'

function throughLoader(input: unknown): Record<string, unknown> {
  const called = (Config as unknown as (value: unknown) => unknown)(input ?? {})
  return ConfigSchema.parse(called) as unknown as Record<string, unknown>
}

describe('loader/zod config parity', () => {
  it('produces identical defaults', () => {
    const fromLoader = throughLoader(undefined)
    const fromZod = ConfigSchema.parse({}) as unknown as Record<string, unknown>
    expect(fromLoader).toEqual(fromZod)
  })

  it('applies partial entry configs identically', () => {
    const partial = { maxAgeDays: 3, customPricing: { 'model-a': 10 }, dataDir: '/tmp/x' }
    expect(throughLoader(partial)).toEqual(
      ConfigSchema.parse(partial) as unknown as Record<string, unknown>,
    )
  })

  it('rejects the same invalid inputs', () => {
    for (const bad of [{ maxAgeDays: -1 }, { sweepIntervalMinutes: 0 }, { maxPlausibleTps: 0 }]) {
      expect(() => throughLoader(bad)).toThrow()
      expect(() => ConfigSchema.parse(bad)).toThrow()
    }
  })
})
