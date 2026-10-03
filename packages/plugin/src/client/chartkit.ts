/** Shared chart primitives: styles, tooltip, pointer math. */
import type { MouseEventLike, SvgTarget } from './react.js'
import { jsx } from './jsx-runtime.js'

export const GRID_STROKE = 'rgba(128,128,128,.16)'
export const TICK_FILL = 'rgba(128,128,128,.75)'

export const STYLES = `
.tps-root { max-width: 1180px; margin: 0 auto; padding: 16px 18px 32px; box-sizing: border-box; }
.tps-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.tps-title { margin: 0; font-size: 16px; }
.tps-count { font-size: 12px; opacity: .6; }
.tps-btn { padding: 4px 12px; font-size: 13px; border-radius: 6px; border: 1px solid rgba(128,128,128,.45);
  background: transparent; color: inherit; cursor: pointer; margin-left: auto; }
.tps-btn:hover { border-color: currentColor; }
.tps-hint { font-size: 12px; opacity: .55; margin: 8px 0 0; max-width: 760px; }
.tps-note { font-size: 13px; opacity: .65; }
.tps-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 4px; align-items: center; }
.tps-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 3px 10px;
  border-radius: 999px; border: 1px solid rgba(128,128,128,.4); cursor: pointer; user-select: none;
  background: transparent; color: inherit; }
.tps-chip[data-off="1"] { opacity: .45; }
.tps-chip[data-off="1"] .tps-chip-name { text-decoration: line-through; }
.tps-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.tps-solo { border: 0; background: transparent; color: inherit; opacity: 0; cursor: pointer;
  font-size: 11px; padding: 0 2px; }
.tps-chip:hover .tps-solo { opacity: .7; }
.tps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 14px; margin-top: 12px; }
.tps-card { border: 1px solid rgba(128,128,128,.28); border-radius: 10px; padding: 12px 14px 10px; min-width: 0; }
.tps-card-wide { grid-column: 1 / -1; }
.tps-card-title { font-size: 12.5px; margin: 0 0 8px; opacity: .75; font-weight: 600; }
.tps-chart { width: 100%; display: block; }
.tps-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.tps-table th, .tps-table td { text-align: right; padding: 5px 10px; border-bottom: 1px solid rgba(128,128,128,.18); }
.tps-table th:first-child, .tps-table td:first-child { text-align: left; }
.tps-table th { opacity: .6; font-weight: 600; }
.tps-chartbox { position: relative; }
.tps-chartbox svg { cursor: crosshair; }
.tps-tip { position: absolute; pointer-events: none; z-index: 6; white-space: nowrap;
  background: rgba(24,24,27,.94); color: #f4f4f5; border: 1px solid rgba(255,255,255,.14);
  border-radius: 7px; padding: 5px 10px; font-size: 11.5px; line-height: 1.55;
  box-shadow: 0 4px 16px rgba(0,0,0,.4); }
.tps-tip div:first-child { font-weight: 600; }
.tps-zoombar { display: flex; gap: 10px; align-items: center; font-size: 11px; opacity: .55; margin-top: 3px; }
.tps-zoomreset { border: 1px solid rgba(128,128,128,.45); background: transparent; color: inherit;
  border-radius: 5px; font-size: 11px; padding: 1px 10px; cursor: pointer; }
.tps-zoomreset:hover { border-color: currentColor; }
.tps-table td:first-child .tps-model { display: inline-flex; align-items: center; gap: 6px; }
.tps-ov { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-top: 12px; }
.tps-ov-card { border: 1px solid rgba(128,128,128,.28); border-radius: 10px; padding: 10px 12px; }
.tps-ov-num { font-size: 20px; font-weight: 700; }
.tps-ov-label { font-size: 11.5px; opacity: .6; margin-top: 2px; }
@media (max-width: 720px) { .tps-root { padding: 12px 10px 24px; } }
`

export interface TipState {
  px: number
  py: number
  flip: boolean
  lines: string[]
}

export function Tip(props: { tip: TipState | null }): ReturnType<typeof jsx> | null {
  const { tip } = props
  if (tip === null || tip.lines.length === 0) return null
  const style = {
    top: tip.py,
    left: tip.px,
    transform: tip.flip ? 'translate(calc(-100% - 10px), -108%)' : 'translate(10px, -108%)',
  }
  return jsx('div', {
    className: 'tps-tip',
    style,
    children: tip.lines.map((line, index) => jsx('div', { children: line }, index)),
  })
}

export interface PlotPos {
  vx: number
  vy: number
  px: number
  py: number
  sx: number
  sy: number
  flip: boolean
}

/** Pointer position -> view-box units, css pixels (tooltip), and edge flag. */
export function svgPos(event: MouseEventLike<SvgTarget>, width: number, height: number): PlotPos {
  const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget
  const rect = svg.getBoundingClientRect()
  const px = event.clientX - rect.left
  return {
    vx: (px / rect.width) * width,
    vy: ((event.clientY - rect.top) / rect.height) * height,
    px,
    py: event.clientY - rect.top,
    sx: rect.width / width,
    sy: rect.height / height,
    flip: px > rect.width * 0.6,
  }
}

export { jsx }
