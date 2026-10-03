/**
 * @dsh-stats/pricing — model price lookup and tokens-to-USD math.
 *
 * Zero DSH dependencies. Ships a compressed models.dev snapshot
 * (`src/data/pricing.json`) so cost math works fully offline; refresh with
 * `pnpm --filter @dsh-stats/pricing update`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PricingSnapshotSchema, type PricingSnapshot } from './schema.js'

const snapshotPath = join(dirname(fileURLToPath(import.meta.url)), 'data', 'pricing.json')

/** Raw bundled JSON (kept separate so the bundler never tries to type it). */
export function loadSnapshotData(path: string = snapshotPath): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

/** Validated bundled snapshot (throws at call time if corrupted). */
export function loadSnapshot(path?: string): PricingSnapshot {
  return PricingSnapshotSchema.parse(loadSnapshotData(path))
}

/** Validated bundled snapshot, loaded eagerly. */
export const snapshot: PricingSnapshot = loadSnapshot()

export * from './schema.js'
export { costOf, lookupPrice, priceSample } from './lookup.js'
