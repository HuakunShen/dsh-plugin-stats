/**
 * @dsh-stats/pricing — price table schemas.
 *
 * All rates are USD per million tokens ($/Mtok), matching models.dev
 * `cost` blocks. A snapshot carries its provenance so the summary route can
 * report exactly which price table produced each cost figure.
 */
import { z } from 'zod'

/** Per-model rates in USD per million tokens; every leg optional. */
export const PriceEntrySchema = z.looseObject({
  input: z.number().min(0).optional(),
  output: z.number().min(0).optional(),
  reasoning: z.number().min(0).optional(),
  cacheRead: z.number().min(0).optional(),
  cacheWrite: z.number().min(0).optional(),
})
export type PriceEntry = z.infer<typeof PriceEntrySchema>

/**
 * Compressed snapshot: provider -> model id -> rates, plus provenance.
 * Built by `scripts/update-pricing.ts` from models.dev; shipped inside the
 * package so cost math works fully offline.
 */
export const PricingSnapshotSchema = z.looseObject({
  source: z.string(),
  version: z.string(),
  updatedAt: z.string(),
  providers: z.record(z.string(), z.record(z.string(), PriceEntrySchema)),
})
export type PricingSnapshot = z.infer<typeof PricingSnapshotSchema>

/** User config overrides: model id (case-insensitive) -> full output $/Mtok. */
export const CustomPricingSchema = z.record(z.string(), z.number().min(0))
export type CustomPricing = z.infer<typeof CustomPricingSchema>

export type CostSourceKind = 'custom' | 'snapshot' | 'unknown'

export interface PricedCost {
  costUsd: number | null
  /** Machine tag for the summary: `custom:<id>`, `snapshot:<provider>/<id>`, or `unknown`. */
  costSource: string | null
  kind: CostSourceKind
}
