# Pricing Package (@dsh-stats/pricing)

**Updated: 2026-10-03** — initial wiki build. Source: [packages/pricing](../../../packages/pricing).

Model price lookup and tokens→USD math — **zero DSH dependencies**, ships a compressed [models.dev](https://models.dev) snapshot so cost math works fully offline.

## Snapshot

- `src/data/pricing.json` — built by [scripts/update-pricing.ts](../../../packages/pricing/scripts/update-pricing.ts) (`pnpm --filter @dsh-stats/pricing update`) from `https://models.dev/api.json`, compressed to provider → model id → rates. Models.dev catalogs 226 providers / 8383 models (design-time survey).
- Provenance travels with the data: `source`, `version`, `updatedAt` — validated by `PricingSnapshotSchema` at import time (corrupt snapshot throws rather than mis-pricing).
- All rates are **USD per million tokens ($/Mtok)**, matching models.dev `cost` blocks; every leg optional (`input`, `output`, `reasoning`, `cacheRead`, `cacheWrite`).

## Resolution chain (`priceSample`)

Never throw, never guess — highest priority first:

1. **`customPricing`** exact id match (case-insensitive) — a flat output $/Mtok applied to output tokens. An output-less sample under a custom rate stays `unknown` rather than zero. Source tag: `custom:<id>`.
2. **Snapshot exact model-id match** — provider-scoped first (same id can price differently across providers), then a global sweep. Source tag: `snapshot:<provider>/<id>`.
3. **Unknown** — `costUsd: null`, `costSource: null`, `kind: 'unknown'`. Tokens are still recorded; the summary lists the model in `pricing.unknownModels`. Absence of a price never means free.

## Cost math (`costOf`)

```
USD = (inputTokens·input + outputTokens·output + reasoningTokens·(reasoning ?? output)
       + cacheReadTokens·cacheRead + cacheWriteTokens·cacheWrite) / 1e6
```

Reasoning tokens bill at the `reasoning` leg when the provider has one, else at `output` (most providers bill thinking as output). Rounded to 6 decimals per step.

## API

- `snapshot` / `loadSnapshot()` — validated bundled snapshot.
- `lookupPrice(model, provider, snapshot)` → `{entry, source} | null`.
- `priceSample({model, provider, tokens…, customPricing, snapshot})` → `PricedCost {costUsd, costSource, kind}`.
- `costOf(tokens, entry)` — raw math under a rate entry.

## Tests

8 vitest cases (`test/pricing.test.ts`): resolution order, case-insensitivity, provider scoping, reasoning-leg fallback, unknown handling, custom-rate edge cases.

## Related pages

- [Architecture](../Architecture/Architecture.md) · [Data Pipeline](../Architecture/Data%20Pipeline.md)
- [Core Package](Core%20Package.md) · [Plugin Package](Plugin%20Package.md)
