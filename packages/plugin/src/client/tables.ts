/**
 * Panel tables + overview cards, folded from the summary payload.
 * Verbosity rows are derived per model from step points (same math as the
 * old tokspeed panel); everything else reads the server summary directly.
 *
 * Written with explicit `jsx()` calls (no JSX syntax) so the file stays
 * plain TypeScript; component functions in `*.tsx` files use JSX syntax.
 */
import { quantile } from '@dsh-stats/core/aggregate'
import { type ModelSummary, type ToolSummary } from '@dsh-stats/core/schemas'
import { jsx } from './jsx-runtime.js'
import { formatBusy, formatInt, formatMs, formatTps, formatUsd } from './data.js'
import type { DictKey, Translate } from './i18n.js'
import { modelDisplayName, type ChartPoint } from './points.js'

type El = ReturnType<typeof jsx>

function head(labels: DictKey[], t: Translate): El {
  return jsx('thead', {
    children: jsx('tr', {
      children: labels.map((key, index) => jsx('th', { children: t(key) }, index)),
    }),
  }, 'head')
}

export interface TableProps {
  models: ModelSummary[]
  colors: Map<string, string>
  t: Translate
}

export function renderStatsTable(props: TableProps): El {
  const { models, colors, t } = props
  const full: DictKey[] = ['colModel', 'colN', 'colMean', 'colMedian', 'colQ1', 'colQ3', 'colMin', 'colMax']
  return jsx('table', {
    className: 'tps-table',
    children: [
      head(full, t),
      jsx('tbody', {
        children: models.map((entry) =>
          jsx('tr', {
            children: [
              jsx('td', {
                children: jsx('span', {
                  className: 'tps-model',
                  children: [
                    jsx('span', {
                      className: 'tps-dot',
                      style: { background: colors.get(entry.model) ?? '#888888' },
                    }, 'dot'),
                    entry.model,
                  ],
                }),
              }, 'name'),
              ...[entry.tpsN, entry.tpsMean, entry.tpsMedian, entry.tpsQ1, entry.tpsQ3, entry.tpsMin, entry.tpsMax].map(
                (value, index) =>
                  jsx('td', { children: typeof value === 'number' ? formatTps(value) : String(value ?? '—') }, index),
              ),
            ],
          }, entry.model)),
      }, 'body'),
    ],
  })
}

export interface VerbosityRow {
  name: string
  n: number
  medOutput: number | null
  medText: number | null
  medThink: number | null
  medOutIn: number | null
  medShare: number | null
  shareEstimated: boolean
}

export function verbosityRows(samples: ChartPoint[]): VerbosityRow[] {
  const byModel = new Map<string, {
    outTok: number[]
    text: number[]
    think: number[]
    outIn: number[]
    share: number[]
    estimated: number
  }>()
  for (const sample of samples) {
    const name = modelDisplayName(sample)
    let entry = byModel.get(name)
    if (entry === undefined) {
      entry = { outTok: [], text: [], think: [], outIn: [], share: [], estimated: 0 }
      byModel.set(name, entry)
    }
    if (typeof sample.outputTokens === 'number' && sample.outputTokens > 0) entry.outTok.push(sample.outputTokens)
    if (typeof sample.textChars === 'number') entry.text.push(sample.textChars)
    if (typeof sample.reasoningChars === 'number' && sample.reasoningChars > 0) entry.think.push(sample.reasoningChars)
    if (typeof sample.outputTokens === 'number' && typeof sample.inputTokens === 'number' && sample.inputTokens > 0) {
      entry.outIn.push(sample.outputTokens / sample.inputTokens)
    }
    if (typeof sample.reasoningTokens === 'number' && typeof sample.outputTokens === 'number' && sample.outputTokens > 0) {
      entry.share.push(sample.reasoningTokens / sample.outputTokens)
    } else if (sample.reasoningChars > 0) {
      const total = sample.reasoningChars + sample.textChars
      if (total > 0) {
        entry.share.push(sample.reasoningChars / total)
        entry.estimated += 1
      }
    }
  }
  return [...byModel.entries()].map(([name, entry]) => ({
    name,
    n: entry.outTok.length,
    medOutput: quantile([...entry.outTok].sort((a, b) => a - b), 0.5),
    medText: quantile([...entry.text].sort((a, b) => a - b), 0.5),
    medThink: quantile([...entry.think].sort((a, b) => a - b), 0.5),
    medOutIn: quantile([...entry.outIn].sort((a, b) => a - b), 0.5),
    medShare: quantile([...entry.share].sort((a, b) => a - b), 0.5),
    shareEstimated: entry.share.length > 0 && entry.estimated === entry.share.length,
  }))
}

export function renderVerbosityTable(props: { rows: VerbosityRow[]; t: Translate }): El {
  const { rows, t } = props
  const labels: DictKey[] = ['colModel', 'colN', 'colOutTok', 'colThinkShare', 'colText', 'colThink', 'colOutIn']
  const fmtPct = (value: number | null, estimated: boolean): string =>
    value === null ? '—' : `${(value * 100).toFixed(1)}%${estimated ? '*' : ''}`
  const fmtRatio = (value: number | null): string =>
    value === null ? '—' : value.toFixed(value < 0.1 ? 3 : 2)
  return jsx('table', {
    className: 'tps-table',
    children: [
      head(labels, t),
      jsx('tbody', {
        children: rows.map((row) =>
          jsx('tr', {
            children: [
              jsx('td', { children: row.name }, 'name'),
              jsx('td', { children: formatInt(row.n) }, 'n'),
              jsx('td', { children: formatInt(row.medOutput) }, 'out'),
              jsx('td', { children: fmtPct(row.medShare, row.shareEstimated) }, 'share'),
              jsx('td', { children: formatInt(row.medText) }, 'text'),
              jsx('td', { children: formatInt(row.medThink) }, 'think'),
              jsx('td', { children: fmtRatio(row.medOutIn) }, 'outin'),
            ],
          }, row.name)),
      }, 'body'),
    ],
  })
}

export function renderCostsTable(props: { models: ModelSummary[]; t: Translate }): El {
  const { models, t } = props
  const labels: DictKey[] = ['colModel', 'colInTok', 'colOutTok', 'colReasonTok', 'colCost', 'colUnpriced', 'colBusy']
  return jsx('table', {
    className: 'tps-table',
    children: [
      head(labels, t),
      jsx('tbody', {
        children: models.map((entry) =>
          jsx('tr', {
            children: [
              jsx('td', { children: entry.model }, 'name'),
              jsx('td', { children: formatInt(entry.inputTokens) }, 'in'),
              jsx('td', { children: formatInt(entry.outputTokens) }, 'out'),
              jsx('td', { children: formatInt(entry.reasoningTokens) }, 'reason'),
              jsx('td', { children: formatUsd(entry.costUsd) }, 'cost'),
              jsx('td', { children: entry.unpricedSteps === 0 ? '—' : String(entry.unpricedSteps) }, 'unpriced'),
              jsx('td', { children: formatBusy(entry.busyMs) }, 'busy'),
            ],
          }, entry.model)),
      }, 'body'),
    ],
  })
}

export function renderToolsTable(props: { tools: ToolSummary[]; t: Translate }): El {
  const { tools, t } = props
  const labels: DictKey[] = ['colTool', 'colCalls', 'colOk', 'colErr', 'colErrRate', 'colMeanMs', 'colP50Ms']
  return jsx('table', {
    className: 'tps-table',
    children: [
      head(labels, t),
      jsx('tbody', {
        children: tools.map((entry) =>
          jsx('tr', {
            children: [
              jsx('td', { children: entry.tool }, 'name'),
              jsx('td', { children: String(entry.calls) }, 'calls'),
              jsx('td', { children: String(entry.ok) }, 'ok'),
              jsx('td', { children: String(entry.err) }, 'err'),
              jsx('td', { children: entry.errRate === null ? '—' : `${(entry.errRate * 100).toFixed(1)}%` }, 'rate'),
              jsx('td', { children: formatMs(entry.meanMs) }, 'mean'),
              jsx('td', { children: formatMs(entry.p50Ms) }, 'p50'),
            ],
          }, entry.tool)),
      }, 'body'),
    ],
  })
}

export interface OverviewTotals {
  steps: number
  tokens: number
  cost: number | null
  busyMs: number
  toolCalls: number
  sessions: number
}

export function renderOverview(props: { totals: OverviewTotals; t: Translate }): El {
  const { totals, t } = props
  const cards: { label: DictKey; value: string }[] = [
    { label: 'ovSteps', value: formatInt(totals.steps) },
    { label: 'ovTokens', value: formatInt(totals.tokens) },
    { label: 'ovCost', value: formatUsd(totals.cost) },
    { label: 'ovBusy', value: formatBusy(totals.busyMs) },
    { label: 'ovTools', value: formatInt(totals.toolCalls) },
    { label: 'ovSessions', value: formatInt(totals.sessions) },
  ]
  return jsx('div', {
    className: 'tps-ov',
    children: cards.map((card) =>
      jsx('div', {
        className: 'tps-ov-card',
        children: [
          jsx('div', { className: 'tps-ov-num', children: card.value }, 'num'),
          jsx('div', { className: 'tps-ov-label', children: t(card.label) }, 'label'),
        ],
      }, card.label)),
  })
}
