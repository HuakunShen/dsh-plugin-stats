# System Overview

**Updated: 2026-10-03** — initial wiki build (all 9 commits, v0.1.1 released).

## What this is

`dsh-plugin-stats` is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that records **general usage stats across the whole Host** — decode throughput, token totals, USD cost, tool calls, and activity — and charts them in a Web UI sidebar panel. It is the TypeScript superset of (and successor to) the archived [`dsh-plugin-tokspeed`](https://github.com/HuakunShen/dsh-plugin-tokspeed): everything tokspeed recorded (throughput + verbosity) is a strict subset of what this plugin records.

Design intent and requirements live in [DESIGN.md](../../../DESIGN.md) — the single source of truth for requirements; user-facing docs in [README.md](../../../README.md) (EN + 简体中文).

## What it records

The Host half subscribes to the process-wide `session/event` feed and `tools/result` observations, folding them into typed samples — one JSON object per line in `samples.jsonl`:

| Collector | Source | Fields |
|---|---|---|
| Step (throughput + verbosity) | `assistant/message` events | `tps` (output ÷ decode window), `ttftMs`, `decodeMs`, output/input/reasoning tokens, `textChars`/`reasoningChars`, `costUsd`, `interrupted` |
| Cost | step × pricing | USD per step from the bundled [models.dev](https://models.dev) snapshot; `customPricing` overrides win |
| Tool calls | `tools/result` (read-only observation) | per-tool `calls/ok/err/durationMs/errorKind` |
| Activity | `session/created` + `session/disposed` + steps | sessions, turns/steps, per-model busy time (≈ Σ ttft+decode), 24-hour distribution |

Key rule — **measurability** (inherited from tokspeed): decode windows shorter than 250 ms or rates above `maxPlausibleTps` (default 500 tok/s) are marked `unmeasurable` instead of polluting aggregates. Unknown models keep their tokens with `costUsd: null` and are listed under `pricing.unknownModels` — absence of a price never means free.

One sample per assistant step / tool call / session lifecycle event, across **all sessions** (main sessions, subagents, workflows).

## The Web panel

Registered through the `slots` service, bilingual (`en`/`zh` via the `locale` service):

- **Overview** — steps · tokens · cost $ · busy · tools · sessions cards
- **Throughput** — over-time scatter (colored by model), histogram + normal fit, IQR box plot, hourly median
- **Costs** — per-model cost table + pricing provenance note
- **Tools** — per-tool calls/ok/err/errRate/mean/p50 table
- **Verbosity** — median output, think share (character-estimated `*` when no reasoning tokens), out/in
- **Stats summary table** — full per-model metrics
- Model chips toggle/solo each model; a settings form edits retention live

## Architecture at a glance

pnpm workspace, three packages, one dependency direction — `plugin → core, pricing`; `core` and `pricing` have zero DSH dependencies:

```text
packages/core     @dsh-stats/core     schemas · sampling · aggregates · JSONL store · CSV
packages/pricing  @dsh-stats/pricing  models.dev snapshot · price lookup · tokens→USD
packages/plugin   dsh-plugin-stats    Host collectors + routes · Web panel · CLI
```

See [Architecture](Architecture/Architecture.md) for the full layout and type-safety strategy, and [Data Pipeline](Architecture/Data%20Pipeline.md) for how an event becomes a chart point.

## Install & configure

From the Harness Web UI: **Settings → Plugins → install bundle**, name `dsh-plugin-stats`; or `dsh bundle install ./dsh-plugin-stats/packages/plugin` from a checkout. Reload the page once — the recorder starts immediately, the panel appears in the sidebar.

Settings live at **Settings → Plugins → stats** with three-way precedence (schema defaults ← entry `config:` ← user `config.json`); see [Data Routes](Infrastructure/Data%20Routes.md). Key options: `maxFileBytes` (5 MB), `maxAgeDays` (30), `sampleMinIntervalMs`, `maxPlausibleTps` (500), `includeSessionIds` (true), `customPricing` ({}), `dataDir` (empty → `<dsh home>/stats/`, reload required).

## Current status

- All six design milestones (M0–M6, [DESIGN.md §8](../../../DESIGN.md)) are implemented: workspace, core, pricing, plugin host + client, CLI, CI/publish, published repo.
- **v0.1.1** published to npm on 2026-10-03 via tag `plugin-v0.1.1` with provenance attestation (trusted publishing, OIDC).
- CI (commit `728c568`, 2026-10-03): runner pinned to `ubuntu-24.04`, `pnpm/action-setup@v6`, esbuild postinstall allow-listed (`pnpm.onlyBuiltDependencies`), docs-only pushes skipped. Gates: `tsc --noEmit` everywhere, zero-`any` grep, vitest (45 cases across core/pricing/plugin), single-file bundle build. See [CI and Release](Infrastructure/CI%20and%20Release.md).

## Related pages

- [Architecture](Architecture/Architecture.md) — monorepo, type safety, loader interop
- [Data Pipeline](Architecture/Data%20Pipeline.md) — event → sample → route → panel
- [Core Package](Packages/Core%20Package.md) · [Pricing Package](Packages/Pricing%20Package.md) · [Plugin Package](Packages/Plugin%20Package.md)
- [Storage and Retention](Infrastructure/Storage%20and%20Retention.md) · [Data Routes](Infrastructure/Data%20Routes.md)
