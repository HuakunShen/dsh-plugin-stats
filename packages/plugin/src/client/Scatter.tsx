/**
 * Scatter chart: every visible sample over wall time, per-model colors.
 * Interactive: hover snaps to the nearest point; drag zooms both axes;
 * double-click (or the reset chip) restores the full domain.
 */
import type { ReactNode, ReactRuntime } from './react.js'
import { GRID_STROKE, svgPos, TICK_FILL, Tip, type TipState } from './chartkit.js'
import { formatTps, shortTime } from './data.js'
import type { Translate } from './i18n.js'
import type { ChartPoint } from './points.js'

interface Zoom {
  t0: number
  t1: number
  v0: number
  v1: number
}

interface DragStart {
  vx: number
  vy: number
}

export function ScatterChart(
  React: ReactRuntime,
  props: { samples: ChartPoint[]; colors: Map<string, string>; t: Translate },
): ReactNode {
  const { samples, colors, t } = props
  const [zoom, setZoom] = React.useState<Zoom | null>(null)
  const [tip, setTip] = React.useState<(TipState & { sample: ChartPoint }) | null>(null)
  const [sel, setSel] = React.useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const dragRef = React.useRef<DragStart | null>(null)

  const all = samples.filter((sample) => typeof sample.tps === 'number' && (sample.tps ?? 0) > 0)
  if (all.length === 0) return null
  const first = all[0]
  const last = all[all.length - 1]
  if (first === undefined || last === undefined) return null
  const width = 920
  const height = 260
  const m = { left: 46, right: 14, top: 12, bottom: 26 }
  const innerWidth = width - m.left - m.right
  const innerHeight = height - m.top - m.bottom
  const full: Zoom = {
    t0: first.time,
    t1: Math.max(last.time, first.time + 60_000),
    v0: 0,
    v1: Math.max(...all.map((sample) => sample.tps ?? 0)) * 1.1,
  }
  const dom = zoom ?? full
  const points = all.filter(
    (sample) =>
      sample.time >= dom.t0 &&
      sample.time <= dom.t1 &&
      (sample.tps ?? 0) >= dom.v0 &&
      (sample.tps ?? 0) <= dom.v1,
  )
  const x = (time: number): number => m.left + ((time - dom.t0) / (dom.t1 - dom.t0)) * innerWidth
  const y = (value: number): number => m.top + innerHeight * (1 - (value - dom.v0) / (dom.v1 - dom.v0))
  const xToTime = (vx: number): number => dom.t0 + ((vx - m.left) / innerWidth) * (dom.t1 - dom.t0)
  const yToValue = (vy: number): number => dom.v0 + (1 - (vy - m.top) / innerHeight) * (dom.v1 - dom.v0)
  const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value))
  const inPlot = (p: { vx: number; vy: number }): boolean =>
    p.vx >= m.left && p.vx <= width - m.right && p.vy >= m.top && p.vy <= m.top + innerHeight
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => dom.v0 + fraction * (dom.v1 - dom.v0))
  const xTicks = [0, 1 / 3, 2 / 3, 1].map((fraction) => dom.t0 + fraction * (dom.t1 - dom.t0))

  const reset = (): void => {
    setZoom(null)
    setTip(null)
  }

  return (
    <div className="tps-chartbox">
      <svg
        className="tps-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('overTime')}
        onMouseDown={(event) => {
          if (event.button !== 0) return
          const p = svgPos(event, width, height)
          if (!inPlot(p)) return
          dragRef.current = { vx: p.vx, vy: p.vy }
          setTip(null)
          setSel({ x0: p.vx, y0: p.vy, x1: p.vx, y1: p.vy })
        }}
        onMouseMove={(event) => {
          const p = svgPos(event, width, height)
          const drag = dragRef.current
          if (drag !== null) {
            setSel({
              x0: Math.min(drag.vx, p.vx),
              x1: Math.max(drag.vx, p.vx),
              y0: Math.min(drag.vy, p.vy),
              y1: Math.max(drag.vy, p.vy),
            })
            return
          }
          if (!inPlot(p)) {
            setTip(null)
            return
          }
          let best: ChartPoint | null = null
          let bestD = 30
          for (const sample of points) {
            const dx = (x(sample.time) - p.vx) * p.sx
            const dy = (y(sample.tps ?? 0) - p.vy) * p.sy
            const d = Math.hypot(dx, dy)
            if (d < bestD) {
              bestD = d
              best = sample
            }
          }
          setTip(
            best === null
              ? null
              : {
                  px: p.px,
                  py: p.py,
                  flip: p.flip,
                  sample: best,
                  lines: [
                    best.displayName,
                    `${formatTps(best.tps)} tok/s · ${shortTime(best.time)}`,
                    `${best.outputTokens ?? '—'} tok out · ${Math.round(best.decodeMs)} ms decode`,
                  ],
                },
          )
        }}
        onMouseUp={(event) => {
          const drag = dragRef.current
          if (drag === null) return
          dragRef.current = null
          setSel(null)
          const p = svgPos(event, width, height)
          if (Math.abs(p.vx - drag.vx) < 12 || Math.abs(p.vy - drag.vy) < 12) return
          const tA = clamp(xToTime(drag.vx), dom.t0, dom.t1)
          const tB = clamp(xToTime(p.vx), dom.t0, dom.t1)
          const vA = clamp(yToValue(drag.vy), dom.v0, dom.v1)
          const vB = clamp(yToValue(p.vy), dom.v0, dom.v1)
          setZoom({ t0: Math.min(tA, tB), t1: Math.max(tA, tB), v0: Math.min(vA, vB), v1: Math.max(vA, vB) })
          setTip(null)
        }}
        onMouseLeave={() => {
          dragRef.current = null
          setSel(null)
          setTip(null)
        }}
        onDoubleClick={reset}
      >
        <defs>
          <clipPath id="tps-scatter-clip">
            <rect x={m.left} y={m.top} width={innerWidth} height={innerHeight} />
          </clipPath>
        </defs>
        {yTicks.map((value, index) => (
          <g key={`y${index}`}>
            <line x1={m.left} x2={width - m.right} y1={y(value)} y2={y(value)} stroke={GRID_STROKE} />
            <text x={m.left - 6} y={y(value) + 4} textAnchor="end" fontSize={11} fill={TICK_FILL}>
              {formatTps(value)}
            </text>
          </g>
        ))}
        {xTicks.map((time, index) => (
          <text
            key={`x${index}`}
            x={x(time)}
            y={height - 8}
            textAnchor={index === 0 ? 'start' : 'middle'}
            fontSize={11}
            fill={TICK_FILL}
          >
            {shortTime(time)}
          </text>
        ))}
        <g clipPath="url(#tps-scatter-clip)">
          {points.map((sample, index) => {
            const hovered = tip !== null && tip.sample === sample
            return (
              <circle
                key={index}
                cx={x(sample.time)}
                cy={y(sample.tps ?? 0)}
                r={hovered ? 4.6 : 3.2}
                fill={colors.get(sample.displayName) ?? '#888888'}
                fillOpacity={hovered ? 1 : 0.8}
                stroke={hovered ? '#f4f4f5' : 'none'}
                strokeWidth={1.4}
              />
            )
          })}
        </g>
        {sel !== null && (
          <rect
            x={Math.min(sel.x0, sel.x1)}
            y={Math.min(sel.y0, sel.y1)}
            width={Math.abs(sel.x1 - sel.x0)}
            height={Math.abs(sel.y1 - sel.y0)}
            fill="currentColor"
            fillOpacity={0.08}
            stroke="currentColor"
            strokeOpacity={0.7}
            strokeDasharray="4 3"
          />
        )}
      </svg>
      <div className="tps-zoombar">
        <span>{t('zoomHint')}</span>
        {zoom !== null && (
          <button className="tps-zoomreset" onClick={reset}>
            {t('resetZoom')}
          </button>
        )}
      </div>
      <Tip tip={tip} />
    </div>
  )
}
