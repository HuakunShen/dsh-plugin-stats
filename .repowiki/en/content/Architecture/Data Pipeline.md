# Data Pipeline

**Updated: 2026-10-03** — initial wiki build. How a Harness event becomes a chart point.

> Interactive diagram: [Sample pipeline (dataflow)](../../assets/diagrams/dataflow-sample-pipeline.html) — the full event → sample → summary → panel flow with per-edge evidence.

## End-to-end flow

```text
DSH Host ──session/event──▶ harness.ts (zod boundary) ──▶ collectors.ts ──▶ @dsh-stats/core sampling ──▶ @dsh-stats/pricing ──▶ core store ──▶ samples.jsonl
DSH Host ──tools/result────▶ harness.ts (zod boundary) ──▶ collectors.ts ─────────────────────────────────────────────▶ core store ──▶ samples.jsonl
DSH Host ──session/created|disposed──▶ host.ts ─────────────────────────────────────────────────────────────────────────▶ core store ──▶ samples.jsonl
                                                                    samples.jsonl ──▶ routes (summary/csv/jsonl) ──▶ Web panel
```

## Step path (throughput + verbosity + cost)

1. **`ctx.on('session/event')`** (`packages/plugin/src/host.ts`) receives `(session, event)` per session, Host-wide.
2. **`viewSessionEvent`** (`packages/plugin/src/harness.ts`) — the zod boundary. Recognizes two shapes:
   - `step/start` → returns the wall time; host records it in `stepStarts` per session id (for TTFT).
   - `assistant/message` → validates stream records, usage block, and `message.source`; irrelevant/unparseable events return `null` and are skipped. Never throws.
3. **`collectSessionEvent` → `collectStep`** (`packages/plugin/src/collectors.ts`) — pure fold. Applies the `sampleMinIntervalMs` rate limit first (skip below interval), then calls core `sampleOf`.
4. **`sampleOf`** (`packages/core/src/sampling.ts`) — only `source.kind === 'model'` messages sample. Folds compact stream records (`text-chunks` / `reasoning-chunks` runs: first-delta absolute time in `time0`, per-delta gaps in `dt`; raw `chunk` records carry `time`) into a decode window (`firstTime..lastTime`) via `streamWindow`, and counts visible/thinking characters via `streamTextShares`. Derives `ttftMs` = window start − step start, `decodeMs` = window length.
5. **Measurability** — `measuredTps`: `decodeMs < 250` (delivery granularity, `MIN_DECODE_MS`) or rate > `maxPlausibleTps` → `tps: null` (+ `unmeasurable: true` when a raw rate existed). No usage → `tps: null` distinguishes "no usage" from "never streamed".
6. **Pricing** — `priceSample` (`packages/pricing/src/lookup.ts`) fills `costUsd` + `costSource` (see [Pricing Package](../Packages/Pricing%20Package.md) for the resolution chain).
7. **Persist** — `store.enqueue(() => store.append(sample, effective))` (`host.ts`); all writes serialize through the store's promise queue (see [Storage and Retention](../Infrastructure/Storage%20and%20Retention.md)).

## Tool path

`ctx.on('tools/result')` → `viewToolResult` validates exec + result (tool name from `tool`/`name`; duration from `durationMs`, else `endedAt − startedAt`, else 0; `ok`/`errorKind` classification) → `ToolSample` appended. Read-only observation — the plugin never interferes with tool execution.

## Session lifecycle path

`session/created` → `session-join` sample; `session/disposed` → `session-leave` sample + `stepStarts.delete(id)`. Only when `includeSessionIds` is on.

## Read path (routes → panel)

- `GET /dsh-stats/samples.jsonl` — raw store; the client `fetchPoints` parses rows, re-validating each with the zod `SampleSchema`.
- `GET /dsh-stats/summary.json` — `store.readParsed()` → core `summarize()` fold: per-model aggregates (tokens, cost, tps quantiles mean/median/q1/q3/p10/p90, busy, verbosity medians), per-tool stats, 24-hour activity fold, pricing provenance, retention snapshot. Rows recorded before a rule change are re-checked under the current measurability rule so old data can't skew aggregates.
- `GET /dsh-stats/samples.csv` — CSV projection of step rows.
- `GET/POST /dsh-stats/config` — live settings (see [Data Routes](../Infrastructure/Data%20Routes.md)).
- The panel discovers routes via the `window.__DSH_STATS__` global injected through `webserver/index-inject`.

## Validation invariants

- Nothing unvalidated ever reaches the sampling math (boundary `safeParse` everywhere).
- Bad JSONL lines are skipped and counted (`skippedLines`), never dropped from the file.
- Stream-record union accepts unknown future record kinds (forward-compat); strict per-kind schemas gate the math so it only sees exact shapes.

## Related pages

- [System Overview](../System%20Overview.md) · [Architecture](Architecture.md)
- [Core Package](../Packages/Core%20Package.md) · [Plugin Package](../Packages/Plugin%20Package.md)
