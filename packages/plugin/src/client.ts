/**
 * Client half of dsh-plugin-stats: the "Stats" panel.
 *
 * Loaded through the Harness `window.__ModuleLoader__` with the Host React
 * runtime (`require('react')`). Registers the sidebar entry + main panel
 * through the `slots` service and dictionaries through `locale`.
 * Zero `any`: every boundary value is validated or structurally checked.
 */
import { DICTS, type DictKey, type Translate } from './client/i18n.js'
import { installRuntime } from './client/jsx-runtime.js'
import { StatsPanel } from './client/panel.js'
import { loadReact, type ReactRuntime } from './client/react.js'
import { readEndpoints } from './client/data.js'

const NS = 'stats'
const PANEL_ID = 'stats'

interface ModuleLoader {
  load(module: {
    id: string
    factory(require: (id: string) => unknown): {
      inject: string[]
      apply(ctx: ClientContext): void
    }
  }): void
}

interface LocaleService {
  register(ns: string, dicts: Record<string, Record<string, string>>): void
  bind(
    ns: string,
  ): (key: string, params?: Record<string, string | number>) => string
}

interface SlotRegistration {
  name: string
  key?: string
  id?: string
  order?: number
  label?: () => string
  locale?: string
}

interface SlotsService {
  register(slot: SlotRegistration, component: (props: Record<string, unknown>) => unknown): void
  inject(slot: string, factory: () => void): void
}

interface ClientContext {
  locale: LocaleService
  slots: SlotsService
}

function isModuleLoader(value: unknown): value is ModuleLoader {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { load?: unknown }).load === 'function'
  )
}

function GaugeIcon(React: ReactRuntime): (props: { size?: number }) => unknown {
  const h = React.createElement
  return ({ size }: { size?: number }) =>
    h(
      'svg',
      {
        viewBox: '0 0 24 24',
        width: size ?? 18,
        height: size ?? 18,
        'aria-hidden': true,
        style: { display: 'block' },
        fill: 'none',
        stroke: 'currentColor',
      },
      h('path', { d: 'M4.5 17.5a7.5 7.5 0 1 1 15 0', 'stroke-width': 2, 'stroke-linecap': 'round' }),
      h('line', { x1: 12, y1: 17.5, x2: 16.2, y2: 10.5, 'stroke-width': 2, 'stroke-linecap': 'round' }),
      h('circle', { cx: 12, cy: 17.5, r: 1.6, fill: 'currentColor', stroke: 'none' }),
    )
}

const loader = (globalThis as unknown as Record<string, unknown>)['__ModuleLoader__']
if (isModuleLoader(loader)) {
  loader.load({
    id: 'dsh-plugin-stats',
    factory(require) {
      const React = loadReact(require)
      installRuntime(React)
      const Icon = GaugeIcon(React)
      return {
        inject: ['slots', 'locale'],
        apply(ctx: ClientContext) {
          ctx.locale.register(NS, DICTS as unknown as Record<string, Record<string, string>>)
          const bound = ctx.locale.bind(NS)
          const t = (key: DictKey, params?: Record<string, string | number>): string =>
            bound(key, params)

          function Panel(props: Record<string, unknown>): unknown {
            const endpoints = readEndpoints()
            const translate = (props?.t as Translate) ?? t
            return React.createElement(StatsPanel, { React, t: translate, endpoints })
          }

          ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, Panel),
          )
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 60, label: () => t('panel'), locale: NS },
              Icon,
            ),
          )
        },
      }
    },
  })
}
