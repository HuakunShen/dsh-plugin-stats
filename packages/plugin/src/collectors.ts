/**
 * Event collectors: Harness events -> core samples.
 *
 * Stateless folds (pure functions over validated views) so they are trivially
 * unit-testable without a Host. Rate limiting and session bookkeeping live in
 * the host entry; pricing enrichment happens here where the snapshot is in
 * scope.
 */
import {
  sampleOf,
  type Sample,
  type StatsConfig,
  type StepSample,
  type ToolSample,
} from '@dsh-stats/core'
import { priceSample, type PricingSnapshot } from '@dsh-stats/pricing'
import {
  viewSessionEvent,
  viewToolResult,
  type AssistantMessageView,
} from './harness.js'

export interface CollectorContext {
  config: StatsConfig
  snapshot: PricingSnapshot
}

export interface StepOutcome {
  sample: StepSample
  record: boolean
}

/**
 * Fold one validated assistant message into a priced step sample.
 * `record: false` means "below the sample interval — skip".
 */
export function collectStep(
  sessionId: string,
  view: AssistantMessageView,
  stepStartTime: number | undefined,
  lastRecordedAt: number,
  ctx: CollectorContext,
): StepOutcome | null {
  if (view.eventTime - lastRecordedAt < ctx.config.sampleMinIntervalMs) {
    return null
  }
  const sample = sampleOf({
    sessionId,
    eventTime: view.eventTime,
    turn: view.turn,
    step: view.step,
    interrupted: view.interrupted,
    source: view.source,
    stream: view.stream,
    usage: view.usage,
    stepStartTime,
    config: ctx.config,
  })
  if (sample === null) return null
  const priced = priceSample({
    model: sample.model,
    provider: sample.provider,
    inputTokens: sample.inputTokens,
    outputTokens: sample.outputTokens,
    reasoningTokens: sample.reasoningTokens,
    customPricing: ctx.config.customPricing,
    snapshot: ctx.snapshot,
  })
  sample.costUsd = priced.costUsd
  sample.costSource = priced.costSource
  return { sample, record: true }
}

/** Fold one tools/result emission into a tool sample. */
export function collectTool(
  time: number,
  sessionId: string | undefined,
  exec: unknown,
  result: unknown,
  includeSessionIds: boolean,
): ToolSample | null {
  const observation = viewToolResult(exec, result)
  if (observation === null) return null
  const sample: ToolSample = {
    kind: 'tool',
    time,
    tool: observation.tool,
    durationMs: observation.durationMs,
    ok: observation.ok,
    errorKind: observation.errorKind,
  }
  if (includeSessionIds && sessionId !== undefined) sample.sessionId = sessionId
  return sample
}

export type SessionEventOutcome =
  | { kind: 'step-start'; sessionId: string; time: number }
  | { kind: 'step'; outcome: StepOutcome }
  | { kind: 'ignore' }

/** Route one raw `session/event` payload through validation + collection. */
export function collectSessionEvent(
  sessionId: string,
  event: unknown,
  stepStartTime: number | undefined,
  lastRecordedAt: number,
  ctx: CollectorContext,
): SessionEventOutcome {
  const viewed = viewSessionEvent(event)
  if (viewed === null) return { kind: 'ignore' }
  if (viewed.kind === 'step-start') {
    return { kind: 'step-start', sessionId, time: viewed.time }
  }
  const outcome = collectStep(sessionId, viewed.view, stepStartTime, lastRecordedAt, ctx)
  if (outcome === null) return { kind: 'ignore' }
  return { kind: 'step', outcome }
}

export function isRecordableSample(value: Sample): value is StepSample | ToolSample {
  return value.kind === 'step' || value.kind === 'tool'
}
