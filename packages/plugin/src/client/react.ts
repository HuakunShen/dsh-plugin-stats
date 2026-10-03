/**
 * Minimal React types for the stats client panel.
 *
 * The Harness Web runtime provides `react` through its ModuleLoader
 * (`require('react')`); there is no bundled `@types/react` in the plugin.
 * This module declares exactly the surface the panel uses — nothing more —
 * so the client compiles with zero `any` and no external type packages.
 */
import type { ComponentType, ReactElement, ReactNode } from './jsx-runtime.js'

export type { ReactNode }

export interface CSSProperties {
  [key: string]: string | number | undefined
}

export type MouseHandler<T = Element> = (event: MouseEventLike<T>) => void

export interface MouseEventLike<T = Element> {
  readonly button: number
  readonly clientX: number
  readonly clientY: number
  readonly currentTarget: T
  stopPropagation(): void
}

export interface ChangeEventLike {
  readonly target: { readonly value: string }
}

export interface ReactRuntime {
  createElement(type: string | ComponentType, props?: Record<string, unknown> | null, ...children: ReactNode[]): ReactElement
  useState<S>(initial: S | (() => S)): [S, (next: S | ((current: S) => S)) => void]
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps?: readonly unknown[]): T
  useRef<T>(initial: T): { current: T }
}

/** SVG element facade for pointer math (no DOM lib in the plugin build). */
export interface SvgFacade {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number }
  readonly ownerSVGElement?: SvgFacade | null
}

export type SvgTarget = Element & {
  readonly ownerSVGElement?: SvgFacade | null
  getBoundingClientRect(): { left: number; top: number; width: number; height: number }
}

/** Load the Host-provided React runtime; throws when absent. */
export function loadReact(requireFn: (id: string) => unknown): ReactRuntime {
  const runtime = requireFn('react') as Partial<ReactRuntime> | null | undefined
  if (
    runtime === null ||
    runtime === undefined ||
    typeof runtime.createElement !== 'function' ||
    typeof runtime.useState !== 'function' ||
    typeof runtime.useEffect !== 'function' ||
    typeof runtime.useCallback !== 'function' ||
    typeof runtime.useRef !== 'function'
  ) {
    throw new Error('dsh-plugin-stats: Host react runtime unavailable')
  }
  return runtime as ReactRuntime
}
