/**
 * Client data layer: fetch the summary payload, validate with zod, and fold
 * chart-ready views with the shared core math (`quantile`/`mean`/`std`).
 * The panel never trusts the wire: `SummarySchema.safeParse` gates everything.
 */
import { mean, quantile, std } from '@dsh-stats/core/aggregate'
import { SummarySchema, type Summary } from '@dsh-stats/core/schemas'

export type { Summary }
export { mean, quantile, std }

export const PALETTE = ['#4e8fd6', '#d68f4e', '#5fbf8f', '#c25fb0', '#bfb35f', '#8f5fd6', '#5fbfc8', '#d65f5f']

export interface Endpoints {
  url: string
  summaryUrl: string
  configUrl: string
}

export function readEndpoints(): Endpoints | null {
  const injected = (globalThis as unknown as Record<string, unknown>)['__DSH_STATS__'] as
    | { url?: unknown; summaryUrl?: unknown; configUrl?: unknown }
    | null
    | undefined
  if (injected === null || injected === undefined || typeof injected !== 'object') return null
  const url = typeof injected.url === 'string' ? injected.url : undefined
  if (url === undefined) return null
  const summaryUrl =
    typeof injected.summaryUrl === 'string'
      ? injected.summaryUrl
      : url.replace('samples.jsonl', 'summary.json')
  const configUrl =
    typeof injected.configUrl === 'string' ? injected.configUrl : url.replace('samples.jsonl', 'config')
  return { url, summaryUrl, configUrl }
}

export async function fetchSummary(summaryUrl: string): Promise<Summary> {
  const response = await fetch(summaryUrl, { cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const parsed = SummarySchema.safeParse(await response.json() as unknown)
  if (!parsed.success) throw new Error('summary payload failed validation')
  return parsed.data
}

export interface ModelColor {
  name: string
  color: string
}

/** Stable per-model colors in summary order (matches server sort). */
export function colorModels(models: readonly { model: string }[]): Map<string, string> {
  const map = new Map<string, string>()
  models.forEach((entry, index) => {
    map.set(entry.model, PALETTE[index % PALETTE.length] ?? '#888888')
  })
  return map
}

export function formatTps(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1)
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value === 0) return '0'
  if (value >= 100) return value.toFixed(2)
  if (value >= 1) return value.toFixed(3)
  return value.toFixed(4)
}

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}

export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 10_000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.round(value)}ms`
}

export function formatBusy(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}min`
  return `${(ms / 3_600_000).toFixed(2)}h`
}

export function shortTime(time: number): string {
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
