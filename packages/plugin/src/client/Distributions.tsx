/**
 * Histogram of visible tok/s readings with a normal-fit reference curve.
 * If decode speeds are roughly normal, the bars peak at the mean and the
 * dashed curve tracks them.
 */
import type { ReactNode, ReactRuntime } from './react.js'
import { GRID_STROKE, svgPos, TICK_FILL, Tip, type TipState } from './chartkit.js'
import { formatTps, mean, quantile, std } from './data.js'
import type { ChartPoint } from './points.js'

export function HistogramChart(
  props: { React: ReactRuntime; samples: ChartPoint[] },
): ReactNode {
  const { React, samples } = props
  const [tip, setTip] = React.useState<(TipState & { bin: number }) | null>(null)
  const values = samples
    .map((sample) => sample.tps)
    .filter((value): value is number => typeof value === 'number' && value > 0)
    .sort((a, b) => a - b)
  if (values.length < 5) return null
  const lo = quantile(values, 0.02) ?? values[0] ?? 0
  const hi = quantile(values, 0.98) ?? values[values.length - 1] ?? 1
  const span = hi > lo ? hi - lo : (values[values.length - 1] ?? 1) - (values[0] ?? 0) || 1
  const bins = Math.min(24, Math.max(10, Math.round(Math.sqrt(values.length))))
  const binWidth = span / bins
  const counts = new Array<number>(bins).fill(0)
  for (const value of values) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value - lo) / binWidth)))
    counts[index] = (counts[index] ?? 0) + 1
  }
  const mu = mean(values)
  const sd = std(values)
  const width = 560
  const height = 220
  const m = { left: 40, right: 12, top: 10, bottom: 22 }
  const innerWidth = width - m.left - m.right
  const innerHeight = height - m.top - m.bottom
  const maxCount = Math.max(...counts, 1)
  const barWidth = innerWidth / bins
  const x = (value: number): number => m.left + ((value - lo) / span) * innerWidth
  const y = (count: number): number => m.top + innerHeight * (1 - count / (maxCount * 1.12))
  // Expected bin count under a normal fit: n · binWidth · pdf(x).
  const curve =
    sd !== null && sd > 0 && mu !== null
      ? Array.from({ length: 80 }, (_, index) => {
          const value = lo + (index / 79) * span
          const expected =
            (values.length * binWidth * Math.exp(-((value - mu) ** 2) / (2 * sd * sd))) /
            (sd * Math.sqrt(2 * Math.PI))
          return { value, expected }
        })
      : []
  const hovered = tip?.bin ?? -1
  return (
    <div className="tps-chartbox">
      <svg className="tps-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="histogram">
        {[0.5, 1].map((fraction) => (
          <line
            key={String(fraction)}
            x1={m.left}
            x2={width - m.right}
            y1={y(maxCount * fraction)}
            y2={y(maxCount * fraction)}
            stroke={GRID_STROKE}
          />
        ))}
        <text x={m.left - 6} y={y(maxCount) + 4} textAnchor="end" fontSize={11} fill={TICK_FILL}>
          {String(maxCount)}
        </text>
        <text x={m.left - 6} y={height - m.bottom + 4} textAnchor="end" fontSize={11} fill={TICK_FILL}>
          0
        </text>
        {counts.map((count, index) => (
          <rect
            key={index}
            x={m.left + index * barWidth + 1}
            y={y(count)}
            width={Math.max(1, barWidth - 2)}
            height={m.top + innerHeight - y(count)}
            rx={2}
            fill="currentColor"
            fillOpacity={hovered === index ? 0.55 : 0.3}
            onMouseMove={(event) => {
              const p = svgPos(event, width, height)
              setTip({
                px: p.px,
                py: p.py,
                flip: p.flip,
                bin: index,
                lines: [
                  `${formatTps(lo + index * binWidth)}–${formatTps(lo + (index + 1) * binWidth)} tok/s`,
                  `n = ${count} (${Math.round((count / values.length) * 100)}%)`,
                ],
              })
            }}
            onMouseLeave={() => setTip(null)}
          />
        ))}
        {curve.length > 0 && (
          <path
            d={curve
              .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.value).toFixed(1)},${y(point.expected).toFixed(1)}`)
              .join('')}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.8}
            strokeWidth={1.4}
            strokeDasharray="5 4"
          />
        )}
        <text x={m.left} y={height - 6} fontSize={11} fill={TICK_FILL}>
          {formatTps(lo)}
        </text>
        <text x={width - m.right} y={height - 6} textAnchor="end" fontSize={11} fill={TICK_FILL}>
          {formatTps(hi)}
        </text>
      </svg>
      <Tip tip={tip} />
    </div>
  )
}

/** Per-model quantile entry for the box plot. */
export interface BoxEntry {
  name: string
  color: string
  count: number
  q1: number | null
  median: number | null
  q3: number | null
  min: number | null
  max: number | null
}

/** Horizontal IQR box plot, one row per model: 1.5·IQR whiskers, outlier dots. */
export function BoxPlotChart(
  props: { React: ReactRuntime; entries: BoxEntry[]; samples: ChartPoint[] },
): ReactNode {
  const { React, entries, samples } = props
  const [tip, setTip] = React.useState<(TipState & { row: string }) | null>(null)
  const rows = entries.filter((entry) => entry.count >= 4)
  if (rows.length === 0) return null
  const first = rows[0]
  if (first?.q1 === null || first?.q3 === null) return null
  const pointsByModel = new Map<string, number[]>()
  for (const entry of rows) pointsByModel.set(entry.name, [])
  for (const sample of samples) {
    if (typeof sample.tps !== 'number' || (sample.tps ?? 0) <= 0) continue
    pointsByModel.get(sample.displayName)?.push(sample.tps ?? 0)
  }
  const ready = rows.filter(
    (entry): entry is BoxEntry & { q1: number; median: number; q3: number; min: number; max: number } =>
      entry.q1 !== null && entry.median !== null && entry.q3 !== null && entry.min !== null && entry.max !== null,
  )
  if (ready.length === 0) return null
  const width = 560
  const rowHeight = 34
  const height = 30 + ready.length * rowHeight
  const m = { left: 12, right: 14, top: 8 }
  const innerWidth = width - m.left - m.right
  const scaleMax = Math.max(...ready.map((entry) => entry.q3 + 1.5 * (entry.q3 - entry.q1))) * 1.08
  const x = (value: number): number => m.left + (value / scaleMax) * innerWidth
  return (
    <div className="tps-chartbox">
      <svg className="tps-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="box plot">
        {[0, 0.5, 1].map((fraction) => {
          const value = fraction * scaleMax
          return (
            <g key={String(fraction)}>
              <line x1={x(value)} x2={x(value)} y1={m.top} y2={height - 16} stroke={GRID_STROKE} />
              <text x={x(value)} y={height - 4} textAnchor="middle" fontSize={10} fill={TICK_FILL}>
                {formatTps(value)}
              </text>
            </g>
          )
        })}
        {ready.map((entry, index) => {
          const points = [...(pointsByModel.get(entry.name) ?? [])].sort((a, b) => a - b)
          const iqr = entry.q3 - entry.q1
          const loWhisker = Math.max(entry.min, entry.q1 - 1.5 * iqr)
          const hiWhisker = Math.min(entry.max, entry.q3 + 1.5 * iqr)
          const outliers = points.filter((value) => value < loWhisker || value > hiWhisker)
          const cy = m.top + index * rowHeight + 22
          const hovered = tip?.row === entry.name
          return (
            <g
              key={entry.name}
              onMouseMove={(event) => {
                const p = svgPos(event, width, height)
                setTip({
                  px: p.px,
                  py: p.py,
                  flip: p.flip,
                  row: entry.name,
                  lines: [
                    `${entry.name} (n=${points.length})`,
                    `median ${formatTps(entry.median)} · Q1 ${formatTps(entry.q1)} · Q3 ${formatTps(entry.q3)}`,
                    `whiskers ${formatTps(loWhisker)}–${formatTps(hiWhisker)} (1.5·IQR) · outliers ${outliers.length}`,
                  ],
                })
              }}
              onMouseLeave={() => setTip(null)}
            >
              <text x={m.left} y={cy - 11} fontSize={11} fill={TICK_FILL}>
                {entry.name}
              </text>
              <line x1={x(loWhisker)} x2={x(hiWhisker)} y1={cy} y2={cy} stroke={entry.color} strokeOpacity={hovered ? 0.9 : 0.55} />
              <line x1={x(loWhisker)} x2={x(loWhisker)} y1={cy - 4} y2={cy + 4} stroke={entry.color} strokeOpacity={0.7} />
              <line x1={x(hiWhisker)} x2={x(hiWhisker)} y1={cy - 4} y2={cy + 4} stroke={entry.color} strokeOpacity={0.7} />
              <rect
                x={x(entry.q1)}
                y={cy - 7}
                width={Math.max(2, x(entry.q3) - x(entry.q1))}
                height={14}
                rx={3}
                fill={entry.color}
                fillOpacity={hovered ? 0.55 : 0.35}
                stroke={entry.color}
              />
              <line x1={x(entry.median)} x2={x(entry.median)} y1={cy - 7} y2={cy + 7} stroke={entry.color} strokeWidth={2.2} />
              {outliers.map((value, outlierIndex) => (
                <circle
                  key={outlierIndex}
                  cx={x(value)}
                  cy={cy}
                  r={hovered ? 3 : 2.2}
                  fill={entry.color}
                  fillOpacity={0.7}
                  onMouseMove={(event) => {
                    event.stopPropagation()
                    const p = svgPos(event, width, height)
                    setTip({
                      px: p.px,
                      py: p.py,
                      flip: p.flip,
                      row: entry.name,
                      lines: [entry.name, `outlier ${formatTps(value)} tok/s`],
                    })
                  }}
                />
              ))}
              <rect x={m.left} y={cy - 15} width={innerWidth} height={30} fill="transparent" style={{ cursor: 'default' }} />
            </g>
          )
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  )
}

/** Median tokens/second per hour of day (local time), across visible samples. */
export function HourlyChart(
  props: { React: ReactRuntime; samples: ChartPoint[] },
): ReactNode {
  const { React, samples } = props
  const [tip, setTip] = React.useState<(TipState & { hour: number }) | null>(null)
  const buckets: number[][] = Array.from({ length: 24 }, () => [])
  for (const sample of samples) {
    if (typeof sample.tps === 'number' && (sample.tps ?? 0) > 0) {
      buckets[new Date(sample.time).getHours()]?.push(sample.tps ?? 0)
    }
  }
  const medians = buckets.map((values) => quantile([...values].sort((a, b) => a - b), 0.5))
  const nonNull = medians.filter((value): value is number => value !== null)
  if (nonNull.length === 0) return null
  const max = Math.max(...nonNull) * 1.15
  const width = 560
  const height = 190
  const m = { left: 40, right: 12, top: 10, bottom: 20 }
  const innerWidth = width - m.left - m.right
  const innerHeight = height - m.top - m.bottom
  const slot = innerWidth / 24
  const barWidth = slot * 0.66
  const y = (value: number): number => m.top + innerHeight * (1 - value / max)
  return (
    <div className="tps-chartbox">
      <svg className="tps-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="hourly">
        {[0.5, 1].map((fraction) => (
          <line
            key={String(fraction)}
            x1={m.left}
            x2={width - m.right}
            y1={y((max * fraction) / 1.15)}
            y2={y((max * fraction) / 1.15)}
            stroke={GRID_STROKE}
          />
        ))}
        {medians.map((value, hour) => {
          if (value === null) return null
          const barHeight = innerHeight - (y(value) - m.top)
          const hovered = tip?.hour === hour
          const count = buckets[hour]?.length ?? 0
          return (
            <g
              key={hour}
              onMouseMove={(event) => {
                const p = svgPos(event, width, height)
                setTip({
                  px: p.px,
                  py: p.py,
                  flip: p.flip,
                  hour,
                  lines: [`${String(hour).padStart(2, '0')}:00`, `median ${formatTps(value)} tok/s`, `n = ${count}`],
                })
              }}
              onMouseLeave={() => setTip(null)}
            >
              <rect
                x={m.left + hour * slot + (slot - barWidth) / 2}
                y={y(value)}
                width={barWidth}
                height={barHeight}
                rx={2}
                fill="currentColor"
                fillOpacity={hovered ? 0.6 : 0.35}
              />
              {hour % 3 === 0 && (
                <text x={m.left + hour * slot + slot / 2} y={height - 5} textAnchor="middle" fontSize={10} fill={TICK_FILL}>
                  {String(hour)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <Tip tip={tip} />
    </div>
  )
}
