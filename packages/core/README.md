# @dsh-stats/core

Portable stats core for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) usage telemetry:
zod schemas, the sampling math, aggregation folds, a serialized JSONL store, and the CSV projection.
**Zero DSH dependencies** — it is a plain library, reusable by any project.

Extracted from [`dsh-plugin-stats`](https://github.com/HuakunShen/dsh-plugin-stats), where it is the engine
behind the Host half; published separately so the same math and schemas can be reused elsewhere.

## Source-only package

This package ships **TypeScript source, not compiled JavaScript** (`exports` points at `src/*.ts`).
That is deliberate: there is nothing to build twice, and the consumer's bundler compiles it with the rest
of its own code. It works with bundlers and TypeScript-aware resolvers (tsdown, Vite, esbuild, tsup…);
it is not importable by bare `node` without a TypeScript loader.

```ts
import { ConfigSchema, sampleOf, summarize, createFileStore } from '@dsh-stats/core'
```

## What is in it

| Module | Contents |
|---|---|
| `schemas` | zod schemas + inferred types for every persisted row: the `Sample` discriminated union (`step` / `tool` / `session-join` / `session-leave`), config, and the summary payload |
| `sampling` | decode-window folding from compact stream records, visible/thinking character counts, the measurability rule, and `sampleOf` (one assistant step → one sample) |
| `aggregate` | `quantile` / `mean` / `std`, per-model and per-tool summaries, the 24-hour activity fold |
| `store` | serialized JSONL file store: append, size rotation with hysteresis, age sweep, tolerant parsing that counts bad lines instead of throwing |
| `csv` | CSV projection of step rows |

Subpath imports are available for consumers that want one module without the rest:

```ts
import { measuredTps } from '@dsh-stats/core/sampling'
```

## Design notes

- **Nothing unvalidated crosses a boundary.** Raw Harness events and file lines go through `safeParse`;
  a failed parse is counted as a skipped line, never thrown.
- **Zero `any`.** The package is strict TypeScript; `unknown` plus type predicates is the only dynamic escape.
- **Derived, not assumed.** `tps` is only reported when the decode window can carry the measurement
  (≥ 250 ms and ≤ the configured ceiling); unusable rows keep their timing and token counts and are marked
  `unmeasurable`, so the rate stays derivable while aggregates stay honest.

## Development

```sh
pnpm --filter @dsh-stats/core typecheck
pnpm --filter @dsh-stats/core test
```

## License

[MIT](./LICENSE) © Huakun Shen
