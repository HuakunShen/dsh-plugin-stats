#!/usr/bin/env tsx
/**
 * Rebuild `src/data/pricing.json` from models.dev.
 *
 * Usage: `pnpm --filter @dsh-stats/pricing update`
 *
 * Downloads the full models.dev catalog (`$/Mtok` cost blocks), compresses
 * it to provider -> model -> rate legs, and writes the snapshot with
 * provenance (`source/version/updatedAt`). Models without any cost block are
 * dropped — absence from the snapshot means "unpriced", never "free".
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const API_URL = 'https://models.dev/api.json'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'pricing.json')

const CostBlockSchema = z.looseObject({
  input: z.number().optional(),
  output: z.number().optional(),
  reasoning: z.number().optional(),
  cache_read: z.number().optional(),
  cache_write: z.number().optional(),
})

const CatalogSchema = z.record(
  z.string(),
  z.looseObject({ models: z.record(z.string(), z.looseObject({ cost: CostBlockSchema.nullable().optional() })) }),
)

const response = await fetch(API_URL)
if (!response.ok) throw new Error(`models.dev fetch failed: HTTP ${response.status}`)
const catalog = CatalogSchema.parse(await response.json() as unknown)

const providers: Record<string, Record<string, Record<string, number>>> = {}
let models = 0
let priced = 0
for (const [providerId, provider] of Object.entries(catalog)) {
  const table: Record<string, Record<string, number>> = {}
  for (const [modelId, model] of Object.entries(provider.models)) {
    models += 1
    if (model.cost === null || model.cost === undefined) continue
    const legs: Record<string, number> = {}
    if (typeof model.cost.input === 'number') legs['input'] = model.cost.input
    if (typeof model.cost.output === 'number') legs['output'] = model.cost.output
    if (typeof model.cost.reasoning === 'number') legs['reasoning'] = model.cost.reasoning
    if (typeof model.cost.cache_read === 'number') legs['cacheRead'] = model.cost.cache_read
    if (typeof model.cost.cache_write === 'number') legs['cacheWrite'] = model.cost.cache_write
    if (Object.keys(legs).length === 0) continue
    table[modelId] = legs
    priced += 1
  }
  if (Object.keys(table).length > 0) providers[providerId] = table
}

const snapshot = {
  source: 'models.dev',
  version: `api-${new Date().toISOString().slice(0, 10)}`,
  updatedAt: new Date().toISOString(),
  providers,
}
await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, `${JSON.stringify(snapshot)}\n`, 'utf8')
console.log(`pricing: ${models} models scanned, ${priced} priced, ${Object.keys(providers).length} providers -> ${OUT}`)
