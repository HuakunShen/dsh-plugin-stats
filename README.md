# dsh-plugin-stats

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that records **general usage stats** across the whole Host and charts them in the Web UI: decode throughput, token totals, **cost in USD**, tool calls, and activity — per model, per hour, per session.

Successor of [`dsh-plugin-tokspeed`](https://github.com/HuakunShen/dsh-plugin-tokspeed) (archived): throughput + verbosity are a strict subset of what this plugin records.

```text
┌────────────────── Overview ──────────────────┐
│ steps · tokens · cost $ · busy · tools · N   │
├────────── Over time (tok/s, colored by model)┤
│   ·    ·· ·      ·· ·  ··     ·  ·    ··   ·  │
├──────────────┬──────────────────┬────────────┤
│ Distribution │ Per-model spread │ By hour    │
│ (normal fit) │ (IQR box plot)   │ (median)   │
├──────────────┴──────────────────┴────────────┤
│ Costs by model · Tool calls · Verbosity      │
├──────────────────────────────────────────────┤
│ Stats summary table                          │
└──────────────────────────────────────────────┘
```

English · [简体中文](#简体中文)

## What it records

The Host half subscribes to the process-wide `session/event` feed and `tools/result` observations, folding them into typed samples (one JSON object per line in `samples.jsonl`):

| Collector | Source | Fields |
|---|---|---|
| Step (throughput + verbosity) | `assistant/message` | `tps` (output ÷ decode window), `ttftMs`, `decodeMs`, `output/input/reasoningTokens`, `textChars/reasoningChars`, `costUsd`, `interrupted` |
| Cost | step × pricing | USD per step from the bundled [models.dev](https://models.dev) snapshot, custom overrides first |
| Tool calls | `tools/result` | per-tool `calls/ok/err/durationMs` |
| Activity | `session/created/disposed` + steps | sessions, turns/steps, per-model busy time (≈ Σ ttft+decode), 24-hour distribution |

`tps` measurability follows the tokspeed rule: windows shorter than 250 ms or rates above `maxPlausibleTps` (default 500 tok/s) are marked `unmeasurable` instead of polluting aggregates. Unknown models keep their tokens with `costUsd: null` and are listed under `pricing.unknownModels` — absence of a price never means free.

One sample per assistant step / tool call / session lifecycle event, across **all sessions** (main sessions, subagents, workflows), persisted as JSON lines.

## Install

From the Harness Web UI: **Settings → Plugins → install bundle**, with:

```text
dsh-plugin-stats
```

Or from a checkout:

```sh
git clone https://github.com/HuakunShen/dsh-plugin-stats.git
dsh bundle install ./dsh-plugin-stats/packages/plugin
```

Then reload the Web page once. The recorder starts immediately; the panel appears in the sidebar.

## Configuration

Open **Settings → Plugins → stats**, or set `config` on the bundle row in your profile patch:

| Option | Default | Meaning |
|---|---|---|
| `maxFileBytes` | `5242880` (5 MB) | File size cap; oldest lines rotate out down to 75%. `0` disables. |
| `maxAgeDays` | `30` | Sample age cap in days; periodic sweep drops older lines. `0` disables. |
| `sampleMinIntervalMs` | `0` | Minimum gap between step samples. `60000` ≈ one sample/minute. |
| `maxPlausibleTps` | `500` | Credible decode ceiling; faster readings are `unmeasurable`. |
| `sweepIntervalMinutes` | `60` | How often the age sweep runs. |
| `includeSessionIds` | `true` | Write `sessionId` into each sample. Off for shared data dirs. |
| `customPricing` | `{}` | Model id → flat output $/Mtok override (case-insensitive), wins over the snapshot. |
| `dataDir` | *(empty)* | Directory for `samples.jsonl`. Empty uses `<dsh home>/stats/`. Changing it requires a reload. |

## Data & routes

All routes are read-only, same-origin with the Web UI:

| Route | Content |
|---|---|
| `/dsh-stats/samples.jsonl` | Raw store: one JSON object per line. |
| `/dsh-stats/samples.csv` | CSV projection of step rows for spreadsheets/notebooks. |
| `/dsh-stats/summary.json` | Per-model aggregates (tokens, cost, tps, busy, verbosity), per-tool stats, activity, pricing provenance. |
| `GET/POST /dsh-stats/config` | Live settings (three-way precedence: schema defaults ← entry config ← user `config.json`). |

Sample shape:

```json
{"kind":"step","time":1790203495982,"provider":"zai-coding-cn","model":"glm-5.3-flash","turn":4,"step":47,"ttftMs":2420,"decodeMs":31995,"outputTokens":1478,"inputTokens":419,"reasoningTokens":320,"textChars":4200,"reasoningChars":900,"tps":46.19,"costUsd":0.004231,"costSource":"snapshot:zai/glm-5.3-flash","interrupted":false,"sessionId":"session-…"}
```

## Pricing

- Snapshot: compressed [models.dev](https://models.dev) catalog (`$/Mtok` legs), shipped in `@dsh-stats/pricing` — cost math works fully offline.
- Refresh: `pnpm --filter @dsh-stats/pricing update` rebuilds the snapshot (records `source/version/updatedAt`).
- Resolution: `customPricing` → snapshot exact id → provider-scoped → `unknown` (tokens kept, listed in summary).
- Reasoning tokens bill at the `reasoning` leg when present, else at `output`.

## CLI

```sh
dsh-stats recompute [--floor 250] [--cap 500] [--dry-run]  # re-derive tps + cost (backup first)
dsh-stats export [--out out.csv]                            # CSV projection
```

Stop the plugin (or the Host) before `recompute`: it rewrites the file the recorder appends to.

## Privacy

Samples contain model/provider names, token counts, timings, costs, and (by default) session ids. No prompt or response content is ever recorded. Disable `includeSessionIds` if the data directory is shared.

## Monorepo

```text
packages/core     @dsh-stats/core     schemas · sampling · aggregates · store · CSV (zero DSH deps)
packages/pricing  @dsh-stats/pricing  models.dev snapshot · lookup · USD math (zero DSH deps)
packages/plugin   dsh-plugin-stats    Host collectors + routes · Web panel · CLI (the DSH bundle)
```

`core` and `pricing` are independently published and reusable by any project.

## Development

TypeScript throughout, zod schemas at every boundary, zero `any` (CI-gated).

```sh
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

Releases publish via GitHub Actions → npm Trusted Publishing with provenance (`publish.yml`).

## License

[MIT](packages/plugin/LICENSE) © Huakun Shen

---

## 简体中文

记录 DeepSeek Harness 全 Host 的**通用使用统计**并在 Web UI 侧边栏展示：解码吞吐、token 总量、**USD 费用**、工具调用、活跃分布。是 [`dsh-plugin-tokspeed`](https://github.com/HuakunShen/dsh-plugin-tokspeed)（已归档）的超集。

- **记录内容**：每个 assistant step / 工具调用 / 会话生命周期事件一条记录 —— `tps`、token 数、按 models.dev 单价换算的 USD 费用、工具成功率与耗时、会话数与 24 小时分布
- **面板**：总览卡片（步数/tokens/费用/忙碌时长/工具/会话）＋ 吞吐四图（时间散点、直方图＋正态拟合、箱线图、小时中位）＋ 模型费用表 ＋ 工具调用表 ＋ 啰嗦度表 ＋ 统计表；模型 chip 可开关/单看
- **定价**：内置 models.dev 快照（离线可用），`customPricing` 可覆盖单价，查不到价的模型列入 `unknownModels`（绝不按免费算）
- **保留策略**：`maxFileBytes`（默认 5MB）与 `maxAgeDays`（默认 30 天）任一触发即清理

安装：Settings → Plugins → Install bundle，输入 `dsh-plugin-stats`，装完刷新页面。
