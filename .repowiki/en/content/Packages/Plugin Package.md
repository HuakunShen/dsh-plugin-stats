# Plugin Package (dsh-plugin-stats)

**Updated: 2026-10-03** — initial wiki build. Source: [packages/plugin](../../../packages/plugin) — the only package that depends on the Harness, and the only one published (v0.1.1, 2026-10-03).

## Host half (`src/host.ts`)

`apply(ctx, entryConfig)` wires everything, riding the plugin fiber (`ctx.effect`):

- Re-parses the Loader's output through the zod `ConfigSchema` (canonical `StatsConfig`), then merges the user `config.json` (except `dataDir`, which can't come from the file that lives inside it).
- `inject: ['webServer']` — waits for the webServer service so routes register regardless of activation order; recording continues even without it (warns).
- Subscriptions: `session/event` (steps + step starts), `session/created`/`session/disposed` (lifecycle), `tools/result` (tool calls), `webserver/index-inject` (publishes `window.__DSH_STATS__` route table).
- Retention sweep on `setInterval(sweepIntervalMinutes)`; re-arms when settings change.
- Registers the four read-only/data routes (see [Data Routes](../Infrastructure/Data%20Routes.md)).
- Data location: `dataDir` verbatim, else `$DSH_PROFILE_DIR/stats/` or `~/.dsh/stats/` (`samplesFile`).

Exports: `apply`, `Config` (the schemastery loader schema), `ConfigSchema` (zod), `ROUTE_*` constants.

## Boundary adapter (`src/harness.ts`)

Minimal structural interfaces for the untyped Host surface (`DshPluginContext`, `DshSession`, `DshWebServer`, `DshRequest/Response`, `DshLogger`) — no official plugin `@types` exists. Payload validators (`viewSessionEvent`, `viewToolResult`) zod-parse everything; failure = skip, never throw. See [Architecture §Type safety](../Architecture/Architecture.md).

## Collectors (`src/collectors.ts`)

Stateless pure folds (trivially unit-testable without a Host): `collectStep` (rate limit → `sampleOf` → `priceSample` enrichment), `collectTool`, `collectSessionEvent` (router). Session bookkeeping and pricing scope live in the host entry; enrichment happens here because the snapshot is in scope.

## Loader config (`src/loader-config.ts`)

The workspace's only `@deepseek-ai/schemastery` import — a genuine schemastery schema mirroring the zod `ConfigSchema` field-for-field; locked by `test/config-schema.test.ts` (same defaults, same rejections). Required because the Loader activates configs through schemastery's callable convention (see [Architecture §Loader interop](../Architecture/Architecture.md)).

## Client half (`src/client.ts` + `src/client/`)

Loaded through the Harness `window.__ModuleLoader__` with the Host React runtime (`require('react')`); registers the sidebar panel via `slots` and dictionaries via `locale` (en/zh). Hand-written minimal React types — zero `any`.

- `panel.tsx` — the Stats panel: overview cards, model chips (toggle/solo), scatter / histogram+normal / box plot / hourly charts, costs + tools + verbosity + stats tables, settings form (retention + tps cap), refresh. Fetches `summary.json` + `samples.jsonl`, boundary-validated with core zod schemas.
- `Distributions.tsx` / `Scatter.tsx` — SVG chart components; `chartkit.ts` shared styles/theme.
- `data.ts` — endpoint discovery via `window.__DSH_STATS__`, `fetchSummary`, model colors; `points.ts` — chart point fold with measurability ceiling.
- `tables.ts` — all table renderers; `i18n.ts` — EN/ZH dictionaries.
- `jsx-runtime.ts` / `jsx-types.ts` / `react.ts` — hand-rolled JSX pragma + `React.createElement` runtime adapter.

Two fixes worth remembering (2026-10-03, commits `44d29ee`, `bdb12bb`): panel/chart components must be rendered as real React elements (`React.createElement`), and `.tps-root` needs `overflow-y: auto` for the stats page to scroll.

## CLI (`src/cli.ts`, bin `dsh-stats`)

- `dsh-stats recompute [file] [--floor 250] [--cap 500] [--dry-run]` — re-derives `tps` (measurability) and `costUsd` (current snapshot) for every step row; backs up first. **Stop the plugin/Host first** — it rewrites the file the recorder appends to.
- `dsh-stats export [file] [--out out.csv]` — CSV projection of step rows.

Default file: `$DSH_PROFILE_DIR/stats/samples.jsonl` → `~/.dsh/stats/samples.jsonl`.

## Tests

16 vitest cases: `host.test.ts` (13 — fake Host driving `apply()` end-to-end: collectors, routes, retention, config precedence; ports the tokspeed 14-assertion contract), `config-schema.test.ts` (3 — schemastery/zod mirror lock).

## Bundle manifest

`dsh` section declares the web client platform (`immediately: true`), `cordis.patch.yml`, `icon.svg`; `files` ships only `dist/{host,client,cli}` + patch + license + README. Published artifact declares **no runtime dependencies** (everything inlined).

## Related pages

- [System Overview](../System%20Overview.md) · [Data Pipeline](../Architecture/Data%20Pipeline.md)
- [Storage and Retention](../Infrastructure/Storage%20and%20Retention.md) · [Data Routes](../Infrastructure/Data%20Routes.md) · [CI and Release](../Infrastructure/CI%20and%20Release.md)
