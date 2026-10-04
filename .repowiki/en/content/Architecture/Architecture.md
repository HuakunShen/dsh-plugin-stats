# Architecture

**Updated: 2026-10-03** — initial wiki build.

## Monorepo layout

pnpm workspace (`pnpm-workspace.yaml`), TypeScript throughout, zod v4 at every boundary:

```text
dsh-plugin-stats/
├── DESIGN.md                      # requirements source of truth
├── README.md / PUBLISHING.md      # user + release docs
├── packages/
│   ├── core/                      # @dsh-stats/core — portable stats engine (zero DSH deps)
│   │   └── src/{schemas,sampling,aggregate,store,csv,index}.ts
│   ├── pricing/                   # @dsh-stats/pricing — price lookup + USD math (zero DSH deps)
│   │   └── src/{schema,lookup,index}.ts + src/data/pricing.json (models.dev snapshot)
│   │   └── scripts/update-pricing.ts   # pnpm --filter @dsh-stats/pricing update
│   └── plugin/                    # dsh-plugin-stats — the DSH bundle
│       └── src/{host,collectors,harness,loader-config,cli}.ts
│       └── src/client/{panel.tsx, Distributions.tsx, Scatter.tsx, chartkit, data, i18n, points, tables, react, jsx-runtime}.ts(x)
├── .github/workflows/{ci,publish}.yml
└── references/                    # gitignored local reference (old tokspeed checkout)
```

**Dependency direction**: `plugin → core, pricing` only. `core` and `pricing` are workspace-internal (`"private": true`, never published) and could be lifted out and reused by any project unchanged.

## Type-safety strategy (zero `any`)

Enforced by [tsconfig.base.json](../../../tsconfig.base.json) (`strict` + `noUncheckedIndexedAccess`) and a CI no-any grep gate over `packages/*/src` and `packages/*/test`:

- The Harness has **no official plugin TS package**. `plugin/src/harness.ts` declares the smallest structural interfaces the plugin touches (`DshPluginContext`, `DshSession`, `DshWebServer`, request/response); every payload crossing the boundary is validated with zod `safeParse` — anything the Harness changes shape on fails closed (event skipped, never thrown).
- `unknown` + type predicates are the only allowed "dynamic" tool; `JSON.parse` output always passes through zod (`parseSampleLine`).
- Interior business logic uses standard `zod` v4 schemas (core `ConfigSchema`, `SampleSchema`, …).

### Loader interop (schemastery vs zod) — verified on a real Host

The Harness Loader resolves entry configs through **schemastery's calling convention** (callable function + prototype surface). A plain zod schema is an ordinary object and fails activation with `expected object, received undefined`; a hand-written wrapper function fails for lack of `.validate`-family prototype methods. Therefore:

- `plugin/src/loader-config.ts` holds the workspace's **only** `@deepseek-ai/schemastery` import and mirrors the core zod `ConfigSchema` field-for-field.
- The bundle's exported `Config` is that genuine schemastery schema; `apply` immediately re-parses the Loader's output through the zod `ConfigSchema` to get back the canonical `StatsConfig`.
- `packages/plugin/test/config-schema.test.ts` locks the two definitions together: same defaults, same rejections.

## Build & bundling

`tsdown` ([tsdown.config.ts](../../../packages/plugin/tsdown.config.ts)) produces **single-file bundles**:

- `dist/host.mjs` — Host half (ESM), inlining `@dsh-stats/core`, `@dsh-stats/pricing`, `zod`, `@deepseek-ai/schemastery`
- `dist/client.js` — Web panel (IIFE-ish ESM for `window.__ModuleLoader__`), inlining the same libraries
- `dist/cli.js` — the `dsh-stats` bin
- `dts` only for core/pricing types

Because everything is inlined, the published plugin declares **no runtime dependencies**; `pnpm pack` rewrites the `workspace:*` protocol so the manifest stays clean.

## Config precedence

Three-way (see [Data Routes](../Infrastructure/Data%20Routes.md)): schema defaults ← deployment entry `config:` block ← user `config.json` in the data directory. `dataDir` cannot come from the user file (the file lives inside it) and cannot be changed live — reload required.

## Decisions worth remembering

| Decision | Rationale |
|---|---|
| New name/routes/globals, no compat | `dsh-plugin-stats`, `/dsh-stats/*`, `<dsh home>/stats/`, `window.__DSH_STATS__`; old tokspeed archived |
| JSONL single file store | Append-friendly, line-parseable, rotation + sweep retention without a DB |
| models.dev snapshot bundled | Cost math fully offline; refresh via `pnpm -F @dsh-stats/pricing update` |
| Price never guessed | Unresolvable model → `costUsd: null` + listed in `unknownModels` |
| Measurability rule ported | Short windows / implausible rates flagged, not aggregated |

## Diagrams

Interactive Archify diagrams (source-backed at revision `728c568`, all gates passed) live under [`.repowiki/en/assets/diagrams/`](../../assets/diagrams/):

- [System architecture](../../assets/diagrams/architecture-dsh-plugin-stats.html) — components, boundaries (bundle / browser / disk store), and data routes
- [Sample pipeline (dataflow)](../../assets/diagrams/dataflow-sample-pipeline.html) — events → collectors → `samples.jsonl` → served assets → consumers

Each diagram keeps its authoring spec (`*.json`) beside the rendered HTML; only JSON and HTML are git-tracked, never generated images.

## Related pages

- [System Overview](../System%20Overview.md) · [Data Pipeline](Data%20Pipeline.md)
- [Core Package](../Packages/Core%20Package.md) · [Pricing Package](../Packages/Pricing%20Package.md) · [Plugin Package](../Packages/Plugin%20Package.md)
- [CI and Release](../Infrastructure/CI%20and%20Release.md)
