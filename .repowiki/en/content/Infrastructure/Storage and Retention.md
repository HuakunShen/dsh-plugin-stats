# Storage and Retention

**Updated: 2026-10-03** — initial wiki build. Source: [packages/core/src/store.ts](../../../packages/core/src/store.ts).

## Location & format

- Single JSONL file: `<dataDir>/samples.jsonl`, where `dataDir` = config `dataDir` (verbatim) or `$DSH_PROFILE_DIR/stats/` or `~/.dsh/stats/`.
- One JSON object per line — a `Sample` from the zod discriminated union (`kind: step | tool | session-join | session-leave`). `config.json` lives beside it.
- The host creates the directory on apply (`mkdir -p`); a missing directory recreated at runtime self-heals (append retries once on `ENOENT`).

## Serialized writes (promise queue)

All mutations (`append`, `sweep`, `initialize`, rewrites) chain through `enqueue` — a promise tail so concurrent async batches can never interleave reads and writes. Host collectors call `store.enqueue(() => store.append(...))` for every sample; failures log, never crash the Host.

## Retention — bounded two ways, whichever hits first

| Mechanism | Config | Default | Behavior |
|---|---|---|---|
| Size rotation | `maxFileBytes` | 5 MB (5 242 880) | When the next append would exceed the cap, rewrite keeping the **newest lines that fit in 75% of the cap** (`ROTATE_TARGET_FRACTION = 0.75` — hysteresis so rewrites stay rare). `0` disables. |
| Age sweep | `maxAgeDays`, `sweepIntervalMinutes` | 30 days, every 60 min | Periodic sweep drops parsed samples older than the cutoff, then enforces the size target. `0` disables. |
| Step sampling rate | `sampleMinIntervalMs` | 0 (every step) | Limits how often step samples are recorded at all (applied in `collectStep`). |

Rewrites are atomic: write `${file}.tmp`, then `rename` over the target.

## Data integrity invariants

- **Bad lines are counted, never destroyed**: reads `safeParse` each line; unparseable lines increment `skippedLines` (surfaced in `summary.json`) and are **kept in the file** — the store never destroys foreign content it can't understand.
- `initialize` on apply drops only samples older than the age cap; everything else is preserved byte-for-byte.
- `readParsed` returns `{samples, skippedLines}` for the summary fold; `readAll` returns the raw body for the JSONL route.

## What is stored (privacy)

Model/provider names, token counts, timings, costs, and (by default) session ids. **No prompt or response content is ever recorded.** Disable `includeSessionIds` when the data directory is shared.

## Maintenance

`dsh-stats recompute` (CLI) rewrites the file to re-derive `tps`/`costUsd` under new rules — it backs up first (`samples.jsonl.bak-<timestamp>`) and must run with the plugin stopped.

## Related pages

- [Core Package](../Packages/Core%20Package.md) · [Data Pipeline](../Architecture/Data%20Pipeline.md)
- [Data Routes](Data%20Routes.md) · [Plugin Package](../Packages/Plugin%20Package.md)
