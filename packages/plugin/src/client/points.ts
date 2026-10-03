/**
 * Client points layer: fetch raw JSONL, validate every row with the core
 * zod schemas, and re-derive measurability under the live ceiling — so rows
 * recorded before the Host applied the guard cannot skew the charts.
 */
import { measuredTps } from '@dsh-stats/core'
import { parseSampleLine, type StepSample } from '@dsh-stats/core'

export type { StepSample }

export interface ChartPoint extends StepSample {
  /** Display name: model ?? provider ?? 'unknown'. */
  displayName: string
}

export function modelDisplayName(sample: Pick<StepSample, 'model' | 'provider'>): string {
  return sample.model ?? sample.provider ?? 'unknown'
}

export async function fetchPoints(url: string, maxPlausibleTps: number): Promise<ChartPoint[]> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  const points: ChartPoint[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const sample = parseSampleLine(line)
    if (sample === null || sample.kind !== 'step') continue
    const tps =
      sample.outputTokens === null
        ? null
        : measuredTps(sample.outputTokens, sample.decodeMs, { maxPlausibleTps })
    points.push({
      ...sample,
      tps,
      unmeasurable:
        tps === null && sample.outputTokens !== null && sample.decodeMs > 0 ? true : sample.unmeasurable,
      displayName: modelDisplayName(sample),
    })
  }
  return points.sort((a, b) => a.time - b.time)
}
