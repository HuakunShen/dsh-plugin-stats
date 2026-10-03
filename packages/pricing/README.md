# @dsh-stats/pricing

Model price lookup and tokens-to-USD math for LLM usage telemetry — with a bundled
[models.dev](https://models.dev) snapshot, so cost math works fully offline.
**Zero DSH dependencies** — a plain library, reusable by any project.

Extracted from [`dsh-plugin-stats`](https://github.com/HuakunShen/dsh-plugin-stats), where it turns each
recorded step into a dollar figure.

## Source-only package

This package ships **TypeScript source, not compiled JavaScript** (`exports` points at `src/index.ts`).
That is deliberate — the consumer's bundler compiles it alongside its own code. It works with bundlers and
TypeScript-aware resolvers (tsdown, Vite, esbuild, tsup…); it is not importable by bare `node` without a
TypeScript loader.

```ts
import { priceSample, snapshot } from '@dsh-stats/pricing'

const priced = priceSample({
  model: 'deepseek-v4-flash',
  provider: 'deepseek',
  inputTokens: 12_000,
  outputTokens: 3_400,
  reasoningTokens: 800,
  customPricing: {},        // model id -> flat output $/Mtok, wins over the snapshot
  snapshot,
})
// -> { costUsd: 0.004164, costSource: 'snapshot:deepseek/deepseek-v4-flash', kind: 'snapshot' }
```

## Resolution order

Custom overrides → snapshot exact model id (case-insensitive) → provider-scoped snapshot match → `unknown`.
An unpriced model returns `costUsd: null` with `kind: 'unknown'`; the caller reports it rather than
treating an absent price as free.

Rates are **USD per million tokens** ($/Mtok). Reasoning tokens bill at the `reasoning` leg when the
catalog carries one, otherwise at the `output` leg (most providers bill thinking as output).

## Refreshing the snapshot

```sh
pnpm --filter @dsh-stats/pricing update     # re-download models.dev into src/data/pricing.json
```

The snapshot records its own provenance (`source`, `version`, `updatedAt`), which consumers surface in
their summaries so a cost figure can always be traced to the table that produced it.

## What is in it

| Module | Contents |
|---|---|
| `schema` | zod schemas: `PriceEntry`, `PricingSnapshot` (with provenance), `CustomPricing`, `PricedCost` |
| `lookup` | `lookupPrice`, `costOf`, `priceSample` |
| `data/pricing.json` | the compressed catalog: 216 providers, ~7,900 priced models |

## Development

```sh
pnpm --filter @dsh-stats/pricing typecheck
pnpm --filter @dsh-stats/pricing test
```

## License

[MIT](./LICENSE) © Huakun Shen
