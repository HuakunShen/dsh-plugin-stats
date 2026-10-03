/**
 * @dsh-stats/core — zod schemas and their inferred types.
 *
 * Every sample persisted to `samples.jsonl` is a member of the
 * {@link Sample} discriminated union (`kind` field). Raw event payloads from
 * the Harness are validated at the boundary with `safeParse` — nothing
 * unvalidated ever reaches the sampling math. Zero `any` by policy.
 */
import { z } from 'zod'

/** Non-negative integer token / character counts. */
const count = z.number().int().min(0)

/** Milliseconds; negative durations are clamped to 0 downstream, never stored. */
const millis = z.number().min(0)

/* ------------------------------------------------------------------ */
/* Stream records (compact form carried on assistant/message events)   */
/* ------------------------------------------------------------------ */

/**
 * Compact text/reasoning chunk run: first delta absolute time in `time0`,
 * per-delta gaps in `dt`, payload in `texts`. Raw `chunk` records carry
 * `time` directly. `passthrough` keeps forward-compat with new record kinds
 * the Harness may add: unknown records are ignored by the math, not dropped.
 */
export const StreamRecordSchema = z.union([
  z.looseObject({
    type: z.literal('text-chunks'),
    time0: z.number(),
    dt: z.array(z.number()).default([]),
    texts: z.array(z.string()).default([]),
  }),
  z.looseObject({
    type: z.literal('reasoning-chunks'),
    time0: z.number(),
    dt: z.array(z.number()).default([]),
    texts: z.array(z.string()).default([]),
  }),
  z.looseObject({
    type: z.literal('chunk'),
    time: z.number(),
    chunk: z
      .looseObject({
        type: z.string(),
        text: z.string().optional(),
      })
      .optional(),
  }),
  // Unknown future record kinds: accept (so parsing never breaks) but the
  // sampling math only reads the three shapes above.
  z.looseObject({ type: z.string() }),
])
export type StreamRecord = z.infer<typeof StreamRecordSchema>

/**
 * Strict per-kind schemas for the sampling math. The boundary
 * {@link StreamRecordSchema} must accept unknown future record kinds (so
 * parsing never breaks), which pollutes the union for narrowing; these
 * strict schemas are applied via `safeParse` as combined runtime
 * validation + type guards, so the math only ever sees exact shapes.
 */
export const TextChunksSchema = z.object({
  type: z.literal('text-chunks'),
  time0: z.number(),
  // Gaps arrive from live Harness objects (not JSON), so individual entries
  // may be non-finite; the math skips those entries instead of the record.
  dt: z.array(z.unknown()).default([]),
  texts: z.array(z.string()).default([]),
})
export type TextChunks = z.infer<typeof TextChunksSchema>

export const ReasoningChunksSchema = z.object({
  type: z.literal('reasoning-chunks'),
  time0: z.number(),
  dt: z.array(z.unknown()).default([]),
  texts: z.array(z.string()).default([]),
})
export type ReasoningChunks = z.infer<typeof ReasoningChunksSchema>

export const RawChunkSchema = z.object({
  type: z.literal('chunk'),
  time: z.number(),
  chunk: z
    .object({
      type: z.string(),
      text: z.string().optional(),
    })
    .optional(),
})
export type RawChunk = z.infer<typeof RawChunkSchema>

/** Provider-reported token usage block on an assistant message. */
export const UsageSchema = z.looseObject({
  inputTokens: count.optional(),
  outputTokens: count.optional(),
  reasoningTokens: count.optional(),
  cacheReadTokens: count.optional(),
  cacheWriteTokens: count.optional(),
})
export type Usage = z.infer<typeof UsageSchema>

/** `source` block identifying a model-authored message. */
export const MessageSourceSchema = z.looseObject({
  kind: z.string(),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
})
export type MessageSource = z.infer<typeof MessageSourceSchema>

/* ------------------------------------------------------------------ */
/* Persisted samples                                                   */
/* ------------------------------------------------------------------ */

/**
 * One assistant step: decode throughput + verbosity + raw token counts.
 * `tps` is `null` when the window cannot carry the measurement (see
 * measurability); derivable rate rows additionally carry `unmeasurable: true`.
 * `costUsd` is filled by the pricing package, `null` when unpriced.
 */
export const StepSampleSchema = z.looseObject({
  kind: z.literal('step'),
  time: z.number(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  turn: z.number().nullable(),
  step: z.number().nullable(),
  ttftMs: z.number().nullable(),
  decodeMs: millis,
  outputTokens: count.nullable(),
  inputTokens: count.nullable(),
  reasoningTokens: count.nullable(),
  textChars: count,
  reasoningChars: count,
  tps: z.number().nullable(),
  unmeasurable: z.literal(true).optional(),
  costUsd: z.number().nullable(),
  costSource: z.string().nullable(),
  interrupted: z.boolean(),
  sessionId: z.string().optional(),
})
export type StepSample = z.infer<typeof StepSampleSchema>

/**
 * One tool dispatch result observed via `tools/result`.
 * `durationMs` is the dispatch wall time; `ok` distinguishes success from
 * failure; `errorKind` is a short machine tag (e.g. `timeout`, `denied`).
 */
export const ToolSampleSchema = z.looseObject({
  kind: z.literal('tool'),
  time: z.number(),
  tool: z.string(),
  durationMs: millis,
  ok: z.boolean(),
  errorKind: z.string().nullable(),
  sessionId: z.string().optional(),
})
export type ToolSample = z.infer<typeof ToolSampleSchema>

/** Session lifecycle marker for activity accounting. */
export const LifecycleSampleSchema = z.looseObject({
  kind: z.union([z.literal('session-join'), z.literal('session-leave')]),
  time: z.number(),
  sessionId: z.string(),
})
export type LifecycleSample = z.infer<typeof LifecycleSampleSchema>

/** Any persisted row. */
export const SampleSchema = z.discriminatedUnion('kind', [
  StepSampleSchema,
  ToolSampleSchema,
  LifecycleSampleSchema,
])
export type Sample = z.infer<typeof SampleSchema>

/** Parse one JSONL line; `null` means "skip this row" (caller counts it). */
export function parseSampleLine(line: string): Sample | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line) as unknown
  } catch {
    return null
  }
  const result = SampleSchema.safeParse(parsed)
  return result.success ? result.data : null
}

/* ------------------------------------------------------------------ */
/* Plugin config                                                       */
/* ------------------------------------------------------------------ */

export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024
export const DEFAULT_MAX_AGE_DAYS = 30
export const DEFAULT_MAX_PLAUSIBLE_TPS = 500

/** Validated plugin settings. Every field optional at the boundary. */
export const ConfigSchema = z.object({
  /** File size cap in bytes; oldest lines rotate out. 0 disables. */
  maxFileBytes: z.number().int().min(0).default(DEFAULT_MAX_FILE_BYTES),
  /** Sample age cap in days; older lines are swept periodically. 0 disables. */
  maxAgeDays: z.number().min(0).default(DEFAULT_MAX_AGE_DAYS),
  /** Minimum ms between recorded step samples; 0 records every step. */
  sampleMinIntervalMs: z.number().int().min(0).default(0),
  /** How often the age sweep runs, in minutes. */
  sweepIntervalMinutes: z.number().int().min(1).default(60),
  /** Ceiling on a credible decode rate; faster readings are `unmeasurable`. */
  maxPlausibleTps: z.number().int().min(1).default(DEFAULT_MAX_PLAUSIBLE_TPS),
  /** Write sessionId into each sample; disable on shared data directories. */
  includeSessionIds: z.boolean().default(true),
  /** Directory for samples.jsonl; empty uses `<dsh home>/stats`. Reload to change. */
  dataDir: z.string().default(''),
  /** Custom model pricing overrides, keyed by model id (case-insensitive). */
  customPricing: z.record(z.string(), z.number().min(0)).default({}),
  /** Currency display only; costs are always computed in USD. */
  currency: z.string().default('USD'),
})
export type StatsConfig = z.infer<typeof ConfigSchema>
export type StatsConfigInput = z.input<typeof ConfigSchema>

/** Summary payload served at `/dsh-stats/summary.json` and drawn by the panel. */
export const ModelSummarySchema = z.object({
  model: z.string(),
  provider: z.string().nullable(),
  steps: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  reasoningTokens: z.number().int().min(0),
  costUsd: z.number().nullable(),
  unpricedSteps: z.number().int().min(0),
  busyMs: millis,
  tpsN: z.number().int().min(0),
  tpsMean: z.number().nullable(),
  tpsMedian: z.number().nullable(),
  tpsQ1: z.number().nullable(),
  tpsQ3: z.number().nullable(),
  tpsMin: z.number().nullable(),
  tpsMax: z.number().nullable(),
  tpsP10: z.number().nullable(),
  tpsP90: z.number().nullable(),
  medOutputTokens: z.number().nullable(),
  medThinkShare: z.number().nullable(),
  thinkShareEstimated: z.boolean(),
  medOutIn: z.number().nullable(),
})
export type ModelSummary = z.infer<typeof ModelSummarySchema>

export const ToolSummarySchema = z.object({
  tool: z.string(),
  calls: z.number().int().min(0),
  ok: z.number().int().min(0),
  err: z.number().int().min(0),
  errRate: z.number().nullable(),
  meanMs: z.number().nullable(),
  p50Ms: z.number().nullable(),
})
export type ToolSummary = z.infer<typeof ToolSummarySchema>

export const SummarySchema = z.object({
  samples: z.number().int().min(0),
  skippedLines: z.number().int().min(0),
  measurable: z.number().int().min(0),
  unmeasurable: z.number().int().min(0),
  oldest: z.number().nullable(),
  newest: z.number().nullable(),
  fileBytes: z.number().int().min(0),
  retention: z.object({
    maxFileBytes: z.number().int().min(0),
    maxAgeDays: z.number().min(0),
    sampleMinIntervalMs: z.number().int().min(0),
    maxPlausibleTps: z.number().int().min(1),
  }),
  pricing: z.object({
    source: z.string(),
    version: z.string(),
    updatedAt: z.string(),
    unknownModels: z.array(z.string()),
  }),
  models: z.array(ModelSummarySchema),
  tools: z.array(ToolSummarySchema),
  activity: z.object({
    sessions: z.number().int().min(0),
    steps: z.number().int().min(0),
    toolCalls: z.number().int().min(0),
    byHour: z.array(z.number().int().min(0)).length(24),
  }),
})
export type Summary = z.infer<typeof SummarySchema>
