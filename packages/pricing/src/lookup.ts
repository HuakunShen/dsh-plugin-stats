/**
 * @dsh-stats/pricing — price lookup and tokens-to-USD math.
 *
 * Resolution order (agentsview-style: custom first, then catalog, then
 * unknown — never throw, never guess):
 *   1. `customPricing` exact id match (case-insensitive) — flat output rate.
 *   2. Snapshot exact model-id match across all providers (case-insensitive).
 *   3. `provider`-scoped match when the sample names its provider.
 *   4. Unknown: `costUsd: null`, `costSource: null`, caller lists the model.
 *
 * Reasoning tokens bill at the `reasoning` leg when present, else at the
 * `output` leg (most providers bill thinking as output).
 */
import {
  type CostSourceKind,
  type CustomPricing,
  type PriceEntry,
  type PricedCost,
  type PricingSnapshot,
} from './schema.js'

export interface TokenCounts {
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
}

export interface LookupInput extends TokenCounts {
  model: string | null
  provider: string | null
  customPricing: CustomPricing
  snapshot: PricingSnapshot
}

const normalize = (value: string): string => value.toLowerCase()

/** Resolve the rate entry for a model, or `null` when unpriced. */
export function lookupPrice(
  model: string | null,
  provider: string | null,
  snapshot: PricingSnapshot,
): { entry: PriceEntry; source: string } | null {
  if (model === null) return null
  const want = normalize(model)
  // Provider-scoped first: the same model id can be priced differently
  // across providers (e.g. third-party mirrors).
  if (provider !== null) {
    const table = snapshot.providers[provider] ?? snapshot.providers[normalize(provider)]
    if (table !== undefined) {
      for (const [id, entry] of Object.entries(table)) {
        if (normalize(id) === want) return { entry, source: `snapshot:${provider}/${id}` }
      }
    }
  }
  // Global exact-id sweep.
  for (const [providerId, table] of Object.entries(snapshot.providers)) {
    for (const [id, entry] of Object.entries(table)) {
      if (normalize(id) === want) return { entry, source: `snapshot:${providerId}/${id}` }
    }
  }
  return null
}

function leg(tokens: number | null | undefined, rate: number | undefined): number {
  if (tokens === null || tokens === undefined || rate === undefined) return 0
  return (tokens * rate) / 1_000_000
}

/** Convert token counts to USD under a rate entry. */
export function costOf(tokens: TokenCounts, entry: PriceEntry): number {
  const reasoningRate = entry.reasoning ?? entry.output
  const total =
    leg(tokens.inputTokens, entry.input) +
    leg(tokens.outputTokens, entry.output) +
    leg(tokens.reasoningTokens, reasoningRate) +
    leg(tokens.cacheReadTokens, entry.cacheRead) +
    leg(tokens.cacheWriteTokens, entry.cacheWrite)
  return Number(total.toFixed(6))
}

/** Full pricing: custom override wins, then snapshot, then unknown. */
export function priceSample(input: LookupInput): PricedCost {
  if (input.model !== null) {
    const custom = input.customPricing[input.model] ?? input.customPricing[normalize(input.model)]
    if (custom !== undefined && (input.outputTokens !== null || input.inputTokens !== null)) {
      // Custom overrides are flat output $/Mtok applied to output tokens;
      // input tokens without a snapshot rate cannot be priced, so a custom
      // rate on an output-less sample stays unknown rather than zero.
      if (input.outputTokens !== null) {
        return {
          costUsd: Number(((input.outputTokens * custom) / 1_000_000).toFixed(6)),
          costSource: `custom:${input.model}`,
          kind: 'custom' as CostSourceKind,
        }
      }
    }
  }
  const found = lookupPrice(input.model, input.provider, input.snapshot)
  if (found === null) return { costUsd: null, costSource: null, kind: 'unknown' as CostSourceKind }
  const hasBillable =
    input.inputTokens !== null ||
    input.outputTokens !== null ||
    input.reasoningTokens !== null
  if (!hasBillable) return { costUsd: null, costSource: null, kind: 'unknown' as CostSourceKind }
  return { costUsd: costOf(input, found.entry), costSource: found.source, kind: 'snapshot' as CostSourceKind }
}
