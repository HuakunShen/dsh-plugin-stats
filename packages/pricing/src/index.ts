/**
 * @dsh-stats/pricing — model price lookup and tokens-to-USD math.
 *
 * Zero DSH dependencies. Ships a compressed models.dev snapshot
 * (`src/data/pricing.json`) so cost math works fully offline; refresh with
 * `pnpm --filter @dsh-stats/pricing update`.
 */
import snapshotData from './data/pricing.json' with { type: 'json' }
import { PricingSnapshotSchema, type PricingSnapshot } from './schema.js'

/** Validated bundled snapshot (throws at import time if corrupted). */
export const snapshot: PricingSnapshot = PricingSnapshotSchema.parse(snapshotData)

/** Validated bundled snapshot (throws at call time if corrupted). */
export function loadSnapshot(): PricingSnapshot {
  return snapshot
}

export * from './schema.js'
export { costOf, lookupPrice, priceSample } from './lookup.js'
