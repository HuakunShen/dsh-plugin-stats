/**
 * Local JSX runtime for the stats panel.
 *
 * `tsconfig` sets `jsx: react-jsx` + `jsxImportSource` to this directory, so
 * JSX compiles to `jsx()`/`jsxs()` calls here. At runtime these delegate to
 * the Host-provided React `createElement` (installed per factory call).
 * Zero `any`: props and children are `unknown`-typed at the boundary and
 * narrowed where consumed.
 */
import type { ReactRuntime } from './react.js'

let runtime: ReactRuntime | null = null

/** Host React.Fragment, installed alongside the runtime. */
export let Fragment: ComponentType = (props) => props['children'] as ReactNode

/** Install the Host React runtime for subsequent `jsx()` calls. */
export function installRuntime(next: ReactRuntime): void {
  runtime = next
  const hostFragment = (next as unknown as Record<string, unknown>)['Fragment'] as ComponentType | undefined
  if (typeof hostFragment === 'function' || typeof hostFragment === 'object') {
    Fragment = hostFragment as ComponentType
  }
}

export type ComponentType<P = never> = [P] extends [never]
  ? (props: Record<string, unknown>) => ReactNode
  : (props: P) => ReactNode

export interface ReactElement {
  readonly __brand: 'stats-react-element'
}

export type ReactNode =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReactElement
  | readonly ReactNode[]
  | { readonly [key: string]: unknown }

function create(
  type: string | ComponentType,
  props: Record<string, unknown> | null | undefined,
  key: string | number | undefined,
  children: readonly ReactNode[],
): ReactElement {
  const host = runtime
  if (host === null) throw new Error('dsh-plugin-stats: JSX runtime used before install')
  const merged: Record<string, unknown> = { ...(props ?? {}) }
  if (children.length === 1) merged['children'] = children[0]
  else if (children.length > 1) merged['children'] = children
  return host.createElement(
    type,
    key === undefined ? merged : { ...merged, key },
    ...(children as unknown[] as []),
  ) as unknown as ReactElement
}

export function jsx(
  type: string | ComponentType,
  props?: Record<string, unknown> | null,
  key?: string | number,
): ReactElement {
  const { children, ...rest } = props ?? {}
  const list = children === undefined ? [] : Array.isArray(children) ? (children as ReactNode[]) : [children as ReactNode]
  return create(type, rest, key, list)
}

export function jsxs(
  type: string | ComponentType,
  props?: Record<string, unknown> | null,
  key?: string | number,
): ReactElement {
  return jsx(type, props, key)
}

