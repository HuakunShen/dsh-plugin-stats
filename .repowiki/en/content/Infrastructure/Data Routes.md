# Data Routes & Configuration

**Updated: 2026-10-03** — initial wiki build. Source: [packages/plugin/src/host.ts](../../../packages/plugin/src/host.ts).

## HTTP routes (read-only, same-origin)

Registered through the `webServer` service (`kind: 'exact'`), each with a dispose function:

| Route | Methods | Content |
|---|---|---|
| `/dsh-stats/samples.jsonl` | GET | Raw store body (one JSON object per line; `text/plain`) |
| `/dsh-stats/samples.csv` | GET | CSV projection of step rows (`text/csv`, header + rows) |
| `/dsh-stats/summary.json` | GET | `summarize()` fold: per-model aggregates, per-tool stats, activity, pricing provenance, retention snapshot, `skippedLines`, `fileBytes` |
| `/dsh-stats/config` | GET, POST | Live settings view / patch (below) |

Non-matching methods get `405 method not allowed`. If the `webServer` service is absent, the host logs a warning and keeps recording — only the panel loses its data route.

## Index injection

`webserver/index-inject` publishes `{kind: 'global', name: '__DSH_STATS__', value: {url, summaryUrl, configUrl}}` — the client panel discovers its endpoints through `window.__DSH_STATS__` (`client/data.ts`), with a reload hint when missing.

## Settings precedence

Three layers, merged in order (later wins):

```text
schema defaults  ←  deployment entry config (bundle row `config:`)  ←  user config.json
```

- The Loader resolves the entry config through the **schemastery `Config`** export; `apply` re-parses through the zod `ConfigSchema` (`ConfigSchema.parse(entryConfig ?? {})`) so the interior always runs on the canonical type.
- The user `config.json` (in the data dir) is merged on initialize; **`dataDir` is excluded** from the file merge (the file lives inside the dir it would change).
- `POST /dsh-stats/config` applies a JSON patch the same way: parse `{...effective, ...patch}` through `ConfigSchema` (invalid → 400 with the zod message), assign into the live config, and persist `{...user, ...patch}` back to `config.json`. `dataDir` in a POST body is dropped — **moving the data location live would strand the store; reload to change it**.
- A successful POST re-arms the sweep timer (`sweepIntervalMinutes` may have changed).
- Malformed `config.json` on disk falls back to `{}` with a warning, never crashes.

## Options (zod `ConfigSchema` defaults)

| Option | Default | Meaning |
|---|---|---|
| `maxFileBytes` | `5242880` | Size cap; oldest lines rotate out to 75%. `0` disables |
| `maxAgeDays` | `30` | Age cap in days. `0` disables |
| `sampleMinIntervalMs` | `0` | Min gap between recorded step samples |
| `sweepIntervalMinutes` | `60` | Age-sweep cadence (min 1) |
| `maxPlausibleTps` | `500` | Credible decode ceiling; faster readings are `unmeasurable` (min 1) |
| `includeSessionIds` | `true` | Write `sessionId` per sample; off for shared data dirs |
| `customPricing` | `{}` | Model id → flat output $/Mtok override (case-insensitive) |
| `dataDir` | *(empty)* | Sample dir; empty → `<dsh home>/stats/`. **Reload required** |
| `currency` | `USD` | Display only; costs always computed in USD |

The panel's settings form POSTs `maxFileBytes`/`maxAgeDays`/`sampleMinIntervalMs`/`maxPlausibleTps` (MB/day/seconds converted to bytes/days/ms).

## Related pages

- [System Overview](../System%20Overview.md) · [Data Pipeline](../Architecture/Data%20Pipeline.md)
- [Storage and Retention](Storage%20and%20Retention.md) · [Pricing Package](../Packages/Pricing%20Package.md)
