/**
 * Loader-facing config schema (`@deepseek-ai/schemastery`).
 *
 * The Harness Loader only accepts schemastery schemas as the bundle `Config`
 * export (calling convention + prototype surface). This module holds the only
 * schemastery import in the workspace; every other schema is standard zod.
 * Field-for-field mirror of the core zod `ConfigSchema` — locked by
 * `test/config-schema.test.ts`.
 */
import z from '@deepseek-ai/schemastery'

export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024
export const DEFAULT_MAX_AGE_DAYS = 30
export const DEFAULT_MAX_PLAUSIBLE_TPS = 500

/** Opaque loader schema: callable validator owned by schemastery. */
export interface LoaderConfigSchema {
  (input: unknown): Record<string, unknown>
}

export function createLoaderConfig(): LoaderConfigSchema {
  return z.object({
    /** File size cap in bytes; oldest lines rotate out. 0 disables. */
    maxFileBytes: z.natural().default(DEFAULT_MAX_FILE_BYTES),
    /** Sample age cap in days; older lines are swept periodically. 0 disables. */
    maxAgeDays: z.number().min(0).default(DEFAULT_MAX_AGE_DAYS),
    /** Minimum ms between recorded step samples; 0 records every step. */
    sampleMinIntervalMs: z.natural().default(0),
    /** How often the age sweep runs, in minutes. */
    sweepIntervalMinutes: z.natural().min(1).default(60),
    /** Ceiling on a credible decode rate; faster readings are `unmeasurable`. */
    maxPlausibleTps: z.natural().min(1).default(DEFAULT_MAX_PLAUSIBLE_TPS),
    /** Write sessionId into each sample; disable on shared data directories. */
    includeSessionIds: z.boolean().default(true),
    /** Directory for samples.jsonl; empty uses `<dsh home>/stats`. Reload to change. */
    dataDir: z.string().default(''),
    /** Custom model pricing overrides, keyed by model id (case-insensitive). */
    customPricing: z.dict(z.number().min(0)).default({}),
    /** Currency display only; costs are always computed in USD. */
    currency: z.string().default('USD'),
  }) as unknown as LoaderConfigSchema
}
