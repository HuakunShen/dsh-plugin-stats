# dsh-plugin-stats

General usage stats for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): a sidebar
panel that charts **decode throughput, tokens, cost in USD, tool calls, and activity** across every session
the Host has run — plus the recorder that collects them.

Successor of [`dsh-plugin-tokspeed`](https://github.com/HuakunShen/dsh-plugin-tokspeed) (archived);
throughput and verbosity are a strict subset of what this records.

## Install

From the Harness Web UI: **Settings → Plugins → install bundle**, with:

```text
dsh-plugin-stats
```

Then reload the Web page once. The recorder starts immediately; the panel appears in the sidebar.

## What it records

The Host half subscribes to the process-wide `session/event` feed and observes `tools/result`, folding them
into typed samples (one JSON object per line in `samples.jsonl`):

| Collector | Source | Fields |
|---|---|---|
| Step (throughput + verbosity) | `assistant/message` | `tps` (output ÷ decode window), `ttftMs`, `decodeMs`, `output/input/reasoningTokens`, `textChars/reasoningChars`, `costUsd`, `interrupted` |
| Cost | step × pricing | USD per step from the bundled [models.dev](https://models.dev) snapshot, custom overrides first |
| Tool calls | `tools/result` | per-tool `calls / ok / err / durationMs` |
| Activity | `session/created` + `session/disposed` | sessions, steps, tool calls, 24-hour distribution |

`tps` is only reported when the decode window can carry the measurement: windows shorter than 250 ms, or
rates above `maxPlausibleTps` (default 500 tok/s), are marked `unmeasurable` instead of skewing aggregates.
An unpriced model keeps its tokens with `costUsd: null` and is listed under `pricing.unknownModels` — an
absent price is never treated as free.

## Panel

Overview cards (steps · tokens · cost · busy · tools · sessions), throughput charts (scatter over time,
distribution with a normal fit, per-model IQR box plot, hour-of-day medians), and tables for costs, tool
calls, verbosity, and per-model statistics. Model chips toggle which models the charts include.

## Configuration

**Settings → Plugins → stats**, or set `config` on the bundle row in your profile patch:

| Option | Default | Meaning |
|---|---|---|
| `maxFileBytes` | `5242880` (5 MB) | File size cap; oldest lines rotate out down to 75%. `0` disables. |
| `maxAgeDays` | `30` | Sample age cap in days; a periodic sweep drops older lines. `0` disables. |
| `sampleMinIntervalMs` | `0` | Minimum gap between step samples. `60000` ≈ one sample per minute. |
| `maxPlausibleTps` | `500` | Ceiling on a credible decode rate; faster readings are `unmeasurable`. |
| `sweepIntervalMinutes` | `60` | How often the age sweep runs. |
| `includeSessionIds` | `true` | Write `sessionId` into each sample. Turn off for shared data directories. |
| `customPricing` | `{}` | Model id → flat output $/Mtok override (case-insensitive), wins over the snapshot. |
| `dataDir` | *(empty)* | Directory for `samples.jsonl`; empty uses `<dsh home>/stats/`. Changing it requires a reload. |

## Data & routes

All routes are read-only and same-origin with the Web UI:

| Route | Content |
|---|---|
| `/dsh-stats/samples.jsonl` | Raw store: one JSON object per line. |
| `/dsh-stats/samples.csv` | CSV projection of step rows. |
| `/dsh-stats/summary.json` | Per-model aggregates, per-tool stats, activity, and pricing provenance. |
| `GET/POST /dsh-stats/config` | Live settings (`dataDir` requires a reload). |

## CLI

```sh
dsh-stats recompute [--floor 250] [--cap 500] [--dry-run]  # re-derive tps + cost (backup first)
dsh-stats export [--out out.csv]                            # CSV projection
```

Stop the plugin (or the Host) before `recompute`: it rewrites the file the recorder appends to.

## Privacy

Samples contain model/provider names, token counts, timings, costs, and (by default) session ids. No prompt
or response content is ever recorded. Disable `includeSessionIds` if the data directory is shared.

## Development

This package is one of three in the [dsh-plugin-stats monorepo](https://github.com/HuakunShen/dsh-plugin-stats);
`dist/` is built from `src/` by tsdown, with the two library packages inlined into the bundle, which is why
the published package declares no runtime dependencies.

```sh
pnpm install
pnpm --filter dsh-plugin-stats typecheck
pnpm --filter dsh-plugin-stats test
pnpm --filter dsh-plugin-stats build
```

Releases are tag-driven and publish with npm provenance — see
[PUBLISHING.md](https://github.com/HuakunShen/dsh-plugin-stats/blob/main/PUBLISHING.md).

## License

[MIT](./LICENSE) © Huakun Shen
