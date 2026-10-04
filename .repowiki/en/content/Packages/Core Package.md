# Core Package (@dsh-stats/core)

**Updated: 2026-10-03** — initial wiki build. Source: [packages/core](../../../packages/core).

Portable stats engine — **zero DSH dependencies**, reusable by any project. Exports TS source directly (`main: ./src/index.ts`). Consumed by the plugin (inlined at build) and independently testable.

## Modules

### schemas.ts — types at every boundary

- `StreamRecordSchema` — union of compact stream records: `text-chunks` / `reasoning-chunks` runs (`time0` + `dt[]` gaps + `texts[]`), raw `chunk` records, and a `looseObject` catch-all so **unknown future record kinds parse but are ignored by the math** (forward-compatible, never breaks).
- Strict per-kind schemas (`TextChunksSchema`, `ReasoningChunksSchema`, `RawChunkSchema`) double as runtime type guards for the sampling math.
- `UsageSchema` — provider-reported token usage block (`inputTokens/outputTokens/reasoningTokens/cacheRead/cacheWrite`, all optional counts).
- **Persisted samples** — `SampleSchema`, a zod discriminated union on `kind`:
  - `StepSampleSchema` (`step`) — one assistant step: model/provider, turn/step, `ttftMs`, `decodeMs`, token counts, `textChars`/`reasoningChars`, `tps` (nullable), `unmeasurable?`, `costUsd`/`costSource` (filled by pricing), `interrupted`, `sessionId?`.
  - `ToolSampleSchema` (`tool`) — `tool`, `durationMs`, `ok`, `errorKind`.
  - `LifecycleSampleSchema` (`session-join` | `session-leave`) — `sessionId`.
- `parseSampleLine` — JSON.parse + `safeParse`; `null` = "skip this row" (caller counts it).
- `ConfigSchema` — plugin settings with defaults: `maxFileBytes` (5 MB), `maxAgeDays` (30), `sampleMinIntervalMs` (0), `sweepIntervalMinutes` (60), `maxPlausibleTps` (500), `includeSessionIds` (true), `dataDir` (''), `customPricing` ({}), `currency` ('USD', display only).
- `SummarySchema` — the exact payload served at `/dsh-stats/summary.json`: per-model (`ModelSummary`), per-tool (`ToolSummary`), `activity.byHour[24]`, `pricing` provenance, `retention` snapshot, `counts`.

### sampling.ts — throughput derivation (tokspeed port, typed)

- `streamWindow(stream)` — folds records into first/last chunk times (non-finite gaps skipped). `null` for an empty stream.
- `streamTextShares(stream)` — visible vs reasoning character counts (portable verbosity fallback when providers don't report reasoning tokens).
- `measuredTps(outputTokens, decodeMs, {maxPlausibleTps, minDecodeMs=250})` — the measurability rule: window < 250 ms (`MIN_DECODE_MS`) or rate > cap → `null`.
- `sampleOf(input)` — one `StepSample` per model-sourced assistant message; non-model sources → `null`.

### aggregate.ts — pure folds

- `quantile` (linear-interpolated), `mean`, `std`.
- `summarize(samples, options)` — the summary fold: per-model accumulators (steps, tokens, cost with `unpricedSteps`, busyMs = Σ(ttft+decode), tps stats, think share with character-estimated flagging, out/in), per-tool stats, 24-hour activity, session set. Models sort by cost desc; tools by calls desc; `unknownModels` = models with unpriced steps.

### store.ts — serialized JSONL file store

`createFileStore(file)` — see [Storage and Retention](../Infrastructure/Storage%20and%20Retention.md) for the retention design (promise queue, 75% rotation hysteresis, age sweep, ENOENT self-heal).

### csv.ts — CSV projection

`CSV_HEADER` + `toCsvRow(stepSample)` — one row per step sample (17 columns, ISO time); tool/lifecycle rows stay JSONL-only.

## Tests

21 vitest cases: `sampling.test.ts` (14 — the tokspeed contract), `aggregate.test.ts` (4), `store.test.ts` (3).

## Related pages

- [Architecture](../Architecture/Architecture.md) · [Data Pipeline](../Architecture/Data%20Pipeline.md)
- [Pricing Package](Pricing%20Package.md) · [Plugin Package](Plugin%20Package.md)
