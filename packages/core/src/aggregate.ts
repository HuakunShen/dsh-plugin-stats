/**
 * @dsh-stats/core — aggregation folds.
 *
 * Pure functions over parsed samples: quantiles, per-model / per-tool
 * summaries, and the 24-hour activity fold. Shared by the Host summary route
 * and (via the summary payload) the client panel, so both always agree.
 */
import {
  type ModelSummary,
  type Sample,
  type StepSample,
  type Summary,
  type ToolSummary,
} from './schemas.js'

/** Linear-interpolated quantile over a pre-sorted array. */
export function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const upper = sorted[base + 1]
  const lower = sorted[base]
  if (lower === undefined) return null
  return upper !== undefined ? lower + rest * (upper - lower) : lower
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  let total = 0
  for (const value of values) total += value
  return total / values.length
}

export function std(values: readonly number[]): number | null {
  if (values.length < 2) return null
  const mu = mean(values)
  if (mu === null) return null
  let acc = 0
  for (const value of values) acc += (value - mu) * (value - mu)
  return Math.sqrt(acc / (values.length - 1))
}

const round2 = (value: number): number => Number(value.toFixed(2))

/** Display name for a step sample: model, else provider, else `unknown`. */
export function modelNameOf(sample: Pick<StepSample, 'model' | 'provider'>): string {
  return sample.model ?? sample.provider ?? 'unknown'
}

interface ModelAcc {
  provider: string | null
  steps: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  costUsd: number
  costPriced: boolean
  unpricedSteps: number
  busyMs: number
  tps: number[]
  outTok: number[]
  thinkShare: number[]
  shareEstimatedCount: number
  outIn: number[]
}

function newModelAcc(provider: string | null): ModelAcc {
  return {
    provider,
    steps: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    costUsd: 0,
    costPriced: false,
    unpricedSteps: 0,
    busyMs: 0,
    tps: [],
    outTok: [],
    thinkShare: [],
    shareEstimatedCount: 0,
    outIn: [],
  }
}

function foldStep(acc: ModelAcc, sample: StepSample): void {
  acc.steps += 1
  if (typeof sample.inputTokens === 'number') acc.inputTokens += sample.inputTokens
  if (typeof sample.outputTokens === 'number') {
    acc.outputTokens += sample.outputTokens
    acc.outTok.push(sample.outputTokens)
  }
  if (typeof sample.reasoningTokens === 'number') acc.reasoningTokens += sample.reasoningTokens
  if (typeof sample.costUsd === 'number') {
    acc.costUsd += sample.costUsd
    acc.costPriced = true
  } else if (typeof sample.outputTokens === 'number' || typeof sample.inputTokens === 'number') {
    acc.unpricedSteps += 1
  }
  if (typeof sample.ttftMs === 'number') acc.busyMs += sample.ttftMs
  acc.busyMs += sample.decodeMs
  if (typeof sample.tps === 'number' && sample.tps > 0) acc.tps.push(sample.tps)
  if (typeof sample.outputTokens === 'number' && typeof sample.inputTokens === 'number' && sample.inputTokens > 0) {
    acc.outIn.push(sample.outputTokens / sample.inputTokens)
  }
  if (typeof sample.reasoningTokens === 'number' && typeof sample.outputTokens === 'number' && sample.outputTokens > 0) {
    acc.thinkShare.push(sample.reasoningTokens / sample.outputTokens)
  } else if (sample.reasoningChars > 0) {
    const total = sample.reasoningChars + sample.textChars
    if (total > 0) {
      acc.thinkShare.push(sample.reasoningChars / total)
      acc.shareEstimatedCount += 1
    }
  }
}

function toModelSummary(name: string, acc: ModelAcc): ModelSummary {
  const tpsSorted = [...acc.tps].sort((a, b) => a - b)
  const mu = mean(acc.tps)
  const medShareSorted = [...acc.thinkShare].sort((a, b) => a - b)
  return {
    model: name,
    provider: acc.provider,
    steps: acc.steps,
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    reasoningTokens: acc.reasoningTokens,
    costUsd: acc.costPriced ? round2(acc.costUsd) : null,
    unpricedSteps: acc.unpricedSteps,
    busyMs: Math.round(acc.busyMs),
    tpsN: acc.tps.length,
    tpsMean: mu === null ? null : round2(mu),
    tpsMedian: round2If(quantile(tpsSorted, 0.5)),
    tpsQ1: round2If(quantile(tpsSorted, 0.25)),
    tpsQ3: round2If(quantile(tpsSorted, 0.75)),
    tpsMin: tpsSorted[0] ?? null,
    tpsMax: tpsSorted[tpsSorted.length - 1] ?? null,
    tpsP10: round2If(quantile(tpsSorted, 0.1)),
    tpsP90: round2If(quantile(tpsSorted, 0.9)),
    medOutputTokens: round2If(quantile([...acc.outTok].sort((a, b) => a - b), 0.5)),
    medThinkShare: round2If4(quantile(medShareSorted, 0.5)),
    thinkShareEstimated:
      acc.thinkShare.length > 0 && acc.shareEstimatedCount === acc.thinkShare.length,
    medOutIn: round2If4(quantile([...acc.outIn].sort((a, b) => a - b), 0.5)),
  }
}

function round2If(value: number | null): number | null {
  return value === null ? null : round2(value)
}

function round2If4(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(4))
}

interface ToolAcc {
  calls: number
  ok: number
  durations: number[]
}

function toToolSummary(tool: string, acc: ToolAcc): ToolSummary {
  const sorted = [...acc.durations].sort((a, b) => a - b)
  const err = acc.calls - acc.ok
  return {
    tool,
    calls: acc.calls,
    ok: acc.ok,
    err,
    errRate: acc.calls === 0 ? null : Number((err / acc.calls).toFixed(4)),
    meanMs: round2If(mean(acc.durations)),
    p50Ms: round2If(quantile(sorted, 0.5)),
  }
}

export interface FoldOptions {
  maxPlausibleTps: number
  pricingSource: string
  pricingVersion: string
  pricingUpdatedAt: string
  retention: Summary['retention']
  fileBytes: number
  skippedLines: number
}

/**
 * Fold parsed samples into the summary payload served at
 * `/dsh-stats/summary.json`. Rows with `tps: null` are re-checked under the
 * current measurability rule so data recorded before the guard cannot skew
 * aggregates; unknown-model pricing is reported, never thrown.
 */
export function summarize(samples: readonly Sample[], options: FoldOptions): Summary {
  const byModel = new Map<string, ModelAcc>()
  const byTool = new Map<string, ToolAcc>()
  const byHour: number[] = Array.from({ length: 24 }, () => 0)
  const sessions = new Set<string>()
  let measurable = 0
  let unmeasurable = 0
  let toolCalls = 0

  for (const sample of samples) {
    if (sample.kind === 'step') {
      const name = modelNameOf(sample)
      let acc = byModel.get(name)
      if (acc === undefined) {
        acc = newModelAcc(sample.provider)
        byModel.set(name, acc)
      }
      foldStep(acc, sample)
      if (typeof sample.tps === 'number' && sample.tps > 0) measurable += 1
      else if (sample.unmeasurable === true) unmeasurable += 1
      if (sample.sessionId !== undefined) sessions.add(sample.sessionId)
      const hour = new Date(sample.time).getHours()
      const slot = byHour[hour]
      if (slot !== undefined) byHour[hour] = slot + 1
    } else if (sample.kind === 'tool') {
      let acc = byTool.get(sample.tool)
      if (acc === undefined) {
        acc = { calls: 0, ok: 0, durations: [] }
        byTool.set(sample.tool, acc)
      }
      acc.calls += 1
      if (sample.ok) acc.ok += 1
      acc.durations.push(sample.durationMs)
      toolCalls += 1
      if (sample.sessionId !== undefined) sessions.add(sample.sessionId)
    } else {
      sessions.add(sample.sessionId)
    }
  }

  const models = [...byModel.entries()].map(([name, acc]) => toModelSummary(name, acc))
  models.sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.steps - a.steps)
  const tools = [...byTool.entries()].map(([tool, acc]) => toToolSummary(tool, acc))
  tools.sort((a, b) => b.calls - a.calls)
  const unknownModels = models
    .filter((entry) => entry.unpricedSteps > 0)
    .map((entry) => entry.model)
  const times = samples.map((sample) => sample.time).sort((a, b) => a - b)

  return {
    samples: samples.length,
    skippedLines: options.skippedLines,
    measurable,
    unmeasurable,
    oldest: times[0] ?? null,
    newest: times[times.length - 1] ?? null,
    fileBytes: options.fileBytes,
    retention: options.retention,
    pricing: {
      source: options.pricingSource,
      version: options.pricingVersion,
      updatedAt: options.pricingUpdatedAt,
      unknownModels,
    },
    models,
    tools,
    activity: {
      sessions: sessions.size,
      steps: [...byModel.values()].reduce((total, acc) => total + acc.steps, 0),
      toolCalls,
      byHour: byHour as Summary['activity']['byHour'],
    },
  }
}
