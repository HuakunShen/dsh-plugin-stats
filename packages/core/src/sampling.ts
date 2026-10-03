/**
 * @dsh-stats/core — sampling math.
 *
 * Ports the tokspeed derivation into typed, dependency-free functions:
 * fold compact stream records into a decode window, count visible/thinking
 * characters, and derive one {@link StepSample} per assistant step.
 */
import {
  type MessageSource,
  RawChunkSchema,
  ReasoningChunksSchema,
  type StatsConfig,
  type StepSample,
  type StreamRecord,
  TextChunksSchema,
  type Usage,
} from './schemas.js'

/** Decode windows shorter than this measure delivery granularity, not decoding. */
export const MIN_DECODE_MS = 250

/** Minimal structural view of an assistant/message event payload. */
export interface AssistantMessageInput {
  eventTime: number
  turn: number | null
  step: number | null
  interrupted: boolean
  source: MessageSource | null
  stream: readonly StreamRecord[]
  usage: Usage | null
}

export interface StreamWindow {
  firstTime: number
  lastTime: number
}

/**
 * Fold one compact attempt stream into its first- and last-chunk times.
 * Run records (`text-chunks` and kin) store the first delta's absolute time
 * in `time0` and per-delta gaps in `dt`; raw `chunk` records carry `time`.
 * Each record is validated with a strict schema first: the boundary union
 * accepts unknown future kinds, and `safeParse` doubles as the type guard
 * that gives the math exact shapes. Returns `null` for an empty stream.
 */
export function streamWindow(stream: readonly StreamRecord[]): StreamWindow | null {
  let firstTime: number | undefined
  let lastTime: number | undefined
  for (const record of stream) {
    const text = TextChunksSchema.safeParse(record)
    if (text.success) {
      const start = text.data.time0
      if (!Number.isFinite(start)) continue
      let end = start
      for (const gap of text.data.dt) {
        if (typeof gap === 'number' && Number.isFinite(gap)) end += gap
      }
      firstTime = firstTime === undefined ? start : Math.min(firstTime, start)
      lastTime = lastTime === undefined ? end : Math.max(lastTime, end)
      continue
    }
    const reasoning = ReasoningChunksSchema.safeParse(record)
    if (reasoning.success) {
      const start = reasoning.data.time0
      if (!Number.isFinite(start)) continue
      let end = start
      for (const gap of reasoning.data.dt) {
        if (typeof gap === 'number' && Number.isFinite(gap)) end += gap
      }
      firstTime = firstTime === undefined ? start : Math.min(firstTime, start)
      lastTime = lastTime === undefined ? end : Math.max(lastTime, end)
      continue
    }
    const raw = RawChunkSchema.safeParse(record)
    if (raw.success) {
      const start = raw.data.time
      if (!Number.isFinite(start)) continue
      firstTime = firstTime === undefined ? start : Math.min(firstTime, start)
      lastTime = lastTime === undefined ? start : Math.max(lastTime, start)
    }
    // Unknown future record kinds contribute no timing.
  }
  if (firstTime === undefined || lastTime === undefined) return null
  return { firstTime, lastTime }
}

export interface TextShares {
  textChars: number
  reasoningChars: number
}

/**
 * Total visible-answer and thinking characters over the compact stream.
 * Providers that never report `reasoningTokens` still stream
 * `reasoning-chunks`, so character counts are the portable fallback for the
 * verbosity view; `text-chunks` covers the reply the user actually reads.
 */
export function streamTextShares(stream: readonly StreamRecord[]): TextShares {
  let textChars = 0
  let reasoningChars = 0
  for (const record of stream) {
    const text = TextChunksSchema.safeParse(record)
    if (text.success) {
      for (const piece of text.data.texts) textChars += piece.length
      continue
    }
    const reasoning = ReasoningChunksSchema.safeParse(record)
    if (reasoning.success) {
      for (const piece of reasoning.data.texts) reasoningChars += piece.length
      continue
    }
    const raw = RawChunkSchema.safeParse(record)
    if (raw.success) {
      const chunk = raw.data.chunk
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        textChars += chunk.text.length
      } else if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string') {
        reasoningChars += chunk.text.length
      }
    }
  }
  return { textChars, reasoningChars }
}

export interface MeasurabilityOptions {
  maxPlausibleTps: number
  minDecodeMs?: number
}

/**
 * Re-derive one reading's reportable rate under the measurability rule:
 * a window shorter than `minDecodeMs` reflects delivery granularity, and a
 * rate above `maxPlausibleTps` means the provider delivered the completion in
 * one burst rather than a stream. Returns `null` when unmeasurable.
 */
export function measuredTps(
  outputTokens: number | null,
  decodeMs: number,
  options: MeasurabilityOptions,
): number | null {
  if (outputTokens === null || decodeMs <= 0) return null
  const rate = outputTokens / (decodeMs / 1000)
  const floor = options.minDecodeMs ?? MIN_DECODE_MS
  if (decodeMs < floor || rate > options.maxPlausibleTps) return null
  return Number(rate.toFixed(2))
}

export interface SampleInput extends AssistantMessageInput {
  sessionId: string
  stepStartTime: number | undefined
  config: Pick<StatsConfig, 'maxPlausibleTps' | 'includeSessionIds'>
}

/**
 * Derive one step sample from an assistant/message event.
 * Only model-sourced messages sample (`null` otherwise); steps without
 * usage still record their timing with a `null` tps so the data distinguishes
 * "no usage" from "never streamed".
 */
export function sampleOf(input: SampleInput): StepSample | null {
  const { source, stream, usage } = input
  if (source?.kind !== 'model') return null
  const window = streamWindow(stream)
  if (window === null) return null
  const outputTokens = usage?.outputTokens ?? null
  const decodeMs = Math.max(0, window.lastTime - window.firstTime)
  const tps =
    outputTokens === null
      ? null
      : measuredTps(outputTokens, decodeMs, { maxPlausibleTps: input.config.maxPlausibleTps })
  const measurable = tps !== null
  const rate =
    outputTokens !== null && decodeMs > 0 ? outputTokens / (decodeMs / 1000) : null
  const shares = streamTextShares(stream)
  const sample: StepSample = {
    kind: 'step',
    time: input.eventTime,
    provider: source.provider ?? null,
    model: source.model ?? null,
    turn: input.turn,
    step: input.step,
    ttftMs:
      input.stepStartTime === undefined
        ? null
        : Math.max(0, window.firstTime - input.stepStartTime),
    decodeMs,
    outputTokens,
    inputTokens: usage?.inputTokens ?? null,
    reasoningTokens: usage?.reasoningTokens ?? null,
    textChars: shares.textChars,
    reasoningChars: shares.reasoningChars,
    tps,
    costUsd: null,
    costSource: null,
    interrupted: input.interrupted,
  }
  if (rate !== null && !measurable) sample.unmeasurable = true
  if (input.config.includeSessionIds) sample.sessionId = input.sessionId
  return sample
}
