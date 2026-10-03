/**
 * Stats panel: overview cards + throughput charts + costs/tools/activity.
 * Data: summary.json (aggregates) + samples.jsonl (chart points), both
 * validated with core zod schemas at the boundary.
 */
import type { Summary } from '@dsh-stats/core'
import { BoxPlotChart, HistogramChart, HourlyChart, type BoxEntry } from './Distributions.jsx'
import { ScatterChart } from './Scatter.jsx'
import { STYLES } from './chartkit.js'
import { colorModels, fetchSummary, readEndpoints, shortTime } from './data.js'
import type { Endpoints } from './data.js'
import type { DictKey, Locale, Translate } from './i18n.js'
import { formatDict } from './i18n.js'
import { fetchPoints, type ChartPoint } from './points.js'
import type { ReactNode, ReactRuntime } from './react.js'
import {
  renderCostsTable,
  renderOverview,
  renderStatsTable,
  renderToolsTable,
  renderVerbosityTable,
  verbosityRows,
} from './tables.js'

const DEFAULT_CEILING = 500

type Status = 'loading' | 'ready' | 'error'

interface PanelState {
  status: Status
  summary: Summary | null
  points: ChartPoint[]
  message: string | null
}

interface SettingsForm {
  mb: string
  days: string
  interval: string
  tps: string
}

export function StatsPanel(
  props: { React: ReactRuntime; t: Translate; endpoints: Endpoints | null },
): ReactNode {
  const { React, t, endpoints: initialEndpoints } = props
  const [state, setState] = React.useState<PanelState>({ status: 'loading', summary: null, points: [], message: null })
  const [hidden, setHidden] = React.useState<Set<string>>(() => new Set())
  const [settings, setSettings] = React.useState<SettingsForm | null>(null)
  const [ceiling, setCeiling] = React.useState<number>(DEFAULT_CEILING)
  const [settingsStatus, setSettingsStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const endpoints = readEndpoints() ?? initialEndpoints
  const url = endpoints?.url
  const summaryUrl = endpoints?.summaryUrl
  const configUrl = endpoints?.configUrl

  const load = React.useCallback(() => {
    if (typeof url !== 'string' || typeof summaryUrl !== 'string') {
      setState({ status: 'error', summary: null, points: [], message: 'reload' })
      return
    }
    setState((current) => ({ ...current, status: 'loading' }))
    Promise.all([fetchSummary(summaryUrl), fetchPoints(url, ceiling)])
      .then(([summary, points]) => setState({ status: 'ready', summary, points, message: null }))
      .catch((error: unknown) => setState({
        status: 'error',
        summary: null,
        points: [],
        message: error instanceof Error ? error.message : String(error),
      }))
  }, [url, summaryUrl, ceiling])

  const loadSettings = React.useCallback(() => {
    if (typeof configUrl !== 'string') return
    fetch(configUrl, { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<Record<string, unknown>>) : null))
      .then((config) => {
        if (config === null) return
        const maxPlausible = typeof config['maxPlausibleTps'] === 'number' ? config['maxPlausibleTps'] : DEFAULT_CEILING
        setCeiling(maxPlausible)
        const maxFileBytes = typeof config['maxFileBytes'] === 'number' ? config['maxFileBytes'] : 0
        const maxAgeDays = typeof config['maxAgeDays'] === 'number' ? config['maxAgeDays'] : 0
        const intervalMs = typeof config['sampleMinIntervalMs'] === 'number' ? config['sampleMinIntervalMs'] : 0
        setSettings({
          mb: String(Math.round(maxFileBytes / 1_048_576)),
          days: String(maxAgeDays),
          interval: String(Math.round(intervalMs / 1000)),
          tps: config['maxPlausibleTps'] === undefined ? '' : String(maxPlausible),
        })
      })
      .catch(() => undefined)
  }, [configUrl])

  React.useEffect(() => {
    load()
    loadSettings()
  }, [load, loadSettings])

  const saveSettings = (): void => {
    if (typeof configUrl !== 'string' || settings === null) return
    setSettingsStatus('saving')
    fetch(configUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        maxFileBytes: Math.max(0, Number(settings.mb) || 0) * 1_048_576,
        maxAgeDays: Math.max(0, Number(settings.days) || 0),
        sampleMinIntervalMs: Math.max(0, Number(settings.interval) || 0) * 1000,
        ...(settings.tps === '' ? {} : { maxPlausibleTps: Math.max(1, Number(settings.tps) || 500) }),
      }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setSettingsStatus('saved')
        load()
      })
      .catch(() => setSettingsStatus('error'))
  }

  const summary = state.summary
  const allNames = summary === null ? [] : summary.models.map((entry) => entry.model)
  const colors = colorModels(summary?.models ?? [])
  const visiblePoints = state.points.filter((sample) => !hidden.has(sample.displayName))
  const visibleModels = (summary?.models ?? []).filter((entry) => !hidden.has(entry.model))

  const toggle = (name: string): void => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }
  const solo = (name: string): void => {
    setHidden((current) => {
      const next = new Set<string>()
      for (const entry of allNames) if (entry !== name) next.add(entry)
      return next.size === current.size ? new Set<string>() : next
    })
  }

  const boxEntries: BoxEntry[] = visibleModels.map((entry) => ({
    name: entry.model,
    color: colors.get(entry.model) ?? '#888888',
    count: entry.tpsN,
    q1: entry.tpsQ1,
    median: entry.tpsMedian,
    q3: entry.tpsQ3,
    min: entry.tpsMin,
    max: entry.tpsMax,
  }))

  const totals =
    summary === null
      ? null
      : {
          steps: summary.activity.steps,
          tokens: summary.models.reduce((acc, entry) => acc + entry.inputTokens + entry.outputTokens, 0),
          cost: summary.models.reduce((acc, entry) => acc + (entry.costUsd ?? 0), 0),
          busyMs: summary.models.reduce((acc, entry) => acc + entry.busyMs, 0),
          toolCalls: summary.activity.toolCalls,
          sessions: summary.activity.sessions,
        }

  const chartsReady = state.status === 'ready' && visiblePoints.length > 0
  const countLabel =
    `${t('samplesCount', { n: state.points.length })}` +
    (hidden.size > 0 ? ` · ${t('shown', { shown: visiblePoints.length, n: state.points.length })}` : '')

  return (
    <div className="tps-root">
      <style>{STYLES}</style>
      <div className="tps-head">
        <h2 className="tps-title">{t('title')}</h2>
        <span className="tps-count">{countLabel}</span>
        <button className="tps-btn" onClick={load}>
          {t('refresh')}
        </button>
      </div>
      <p className="tps-hint">{t('hint')}</p>
      {state.status === 'loading' && state.points.length === 0 && <p className="tps-note">{t('loading')}</p>}
      {state.status === 'error' && (
        <p className="tps-note">{state.message === 'reload' ? t('reload') : `${t('error')}: ${state.message ?? ''}`}</p>
      )}
      {state.status === 'ready' && state.points.length === 0 && <p className="tps-note">{t('empty')}</p>}
      {allNames.length > 0 && (
        <div className="tps-chips">
          <button className="tps-chip" onClick={() => setHidden(new Set())} title={t('all')}>
            {t('all')}
          </button>
          {allNames.map((name) => (
            <button
              key={name}
              className="tps-chip"
              data-off={hidden.has(name) ? '1' : '0'}
              onClick={() => toggle(name)}
            >
              <span
                className="tps-dot"
                style={{ background: colors.get(name) ?? '#888888', opacity: hidden.has(name) ? 0.3 : 1 }}
              />
              <span className="tps-chip-name">{`${name} (${summary?.models.find((entry) => entry.model === name)?.steps ?? 0})`}</span>
              <span
                className="tps-solo"
                title={t('solo')}
                onClick={(event) => {
                  event.stopPropagation()
                  solo(name)
                }}
              >
                ◎
              </span>
            </button>
          ))}
        </div>
      )}
      {totals !== null && (
        <section className="tps-card" style={{ marginTop: 12 }}>
          <h3 className="tps-card-title">{t('overview')}</h3>
          {renderOverview({ totals, t })}
        </section>
      )}
      {chartsReady && (
        <div className="tps-grid">
          <section className="tps-card tps-card-wide">
            <h3 className="tps-card-title">{t('overTime')}</h3>
            {React.createElement(ScatterChart, { React, samples: visiblePoints, colors, t })}
          </section>
          <section className="tps-card">
            <h3 className="tps-card-title">{t('hist')}</h3>
            {React.createElement(HistogramChart, { React, samples: visiblePoints })}
          </section>
          <section className="tps-card">
            <h3 className="tps-card-title">{t('box')}</h3>
            {React.createElement(BoxPlotChart, { React, entries: boxEntries, samples: visiblePoints })}
          </section>
          <section className="tps-card">
            <h3 className="tps-card-title">{t('hourly')}</h3>
            {React.createElement(HourlyChart, { React, samples: visiblePoints })}
          </section>
          <section className="tps-card tps-card-wide">
            <h3 className="tps-card-title">{t('costs')}</h3>
            {renderCostsTable({ models: visibleModels, t })}
            {summary !== null && (
              <p className="tps-hint" style={{ margin: '6px 0 2px' }}>
                {t('pricingNote', {
                  source: summary.pricing.source,
                  version: summary.pricing.version,
                  unknown: summary.pricing.unknownModels.length,
                })}
              </p>
            )}
          </section>
          {summary !== null && summary.tools.length > 0 && (
            <section className="tps-card tps-card-wide">
              <h3 className="tps-card-title">{t('tools')}</h3>
              {renderToolsTable({ tools: summary.tools, t })}
            </section>
          )}
          <section className="tps-card tps-card-wide">
            <h3 className="tps-card-title">{t('verbosity')}</h3>
            {renderVerbosityTable({ rows: verbosityRows(visiblePoints), t })}
            <p className="tps-hint" style={{ margin: '6px 0 2px' }}>
              {t('verbosityHint')}
            </p>
          </section>
          <section className="tps-card tps-card-wide">
            <h3 className="tps-card-title">{t('table')}</h3>
            {renderStatsTable({ models: visibleModels, colors, t })}
          </section>
        </div>
      )}
      {summary !== null && (
        <p className="tps-hint" style={{ marginTop: 14, borderTop: '1px solid rgba(128,128,128,.2)', paddingTop: 10 }}>
          {t('footer', {
            mb: (summary.retention.maxFileBytes / 1_048_576).toFixed(0),
            days: String(summary.retention.maxAgeDays),
            interval: String(Math.round(summary.retention.sampleMinIntervalMs / 1000)),
            n: summary.samples,
            date: summary.oldest !== null ? shortTime(summary.oldest) : '—',
            kb: String(Math.round(summary.fileBytes / 1024)),
            excluded: String(state.points.filter((sample) => sample.unmeasurable).length),
          })}
        </p>
      )}
      {settings !== null && (
        <details className="tps-card" style={{ marginTop: 12 }}>
          <summary className="tps-card-title" style={{ cursor: 'pointer' }}>
            {t('settingsSummary')}
          </summary>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 6 }}>
            {(
              [
                [t('daysLabel'), 'days'],
                [t('mbLabel'), 'mb'],
                [t('intervalLabel'), 'interval'],
                [t('tpsLabel'), 'tps'],
              ] as const
            ).map(([label, key]) => (
              <label
                key={key}
                style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, opacity: 0.85 }}
              >
                {label}
                <input
                  type="number"
                  min={0}
                  value={settings[key]}
                  onChange={(event) => setSettings((current) => (current === null ? current : { ...current, [key]: event.target.value }))}
                  style={{
                    width: 110,
                    padding: '4px 8px',
                    fontSize: 13,
                    borderRadius: 6,
                    border: '1px solid rgba(128,128,128,.4)',
                    background: 'transparent',
                    color: 'inherit',
                  }}
                />
              </label>
            ))}
          </div>
          <button className="tps-btn" style={{ marginLeft: 0 }} onClick={saveSettings}>
            {settingsStatus === 'saving' ? t('saving') : t('save')}
          </button>
          {settingsStatus === 'saved' && <span style={{ fontSize: 12, opacity: 0.6 }}>{t('saved')}</span>}
          {settingsStatus === 'error' && <span style={{ fontSize: 12, opacity: 0.7 }}>{t('saveFailed')}</span>}
        </details>
      )}
    </div>
  )
}

export function boundTranslate(locale: Locale): Translate {
  return (key: DictKey, params?: Record<string, string | number>) => formatDict(locale, key, params)
}
