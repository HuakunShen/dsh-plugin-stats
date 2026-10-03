/**
 * Global JSX typings for the stats panel.
 *
 * Every intrinsic element accepts an open props bag: the panel passes DOM
 * attributes (including SVG kebab-case via camelCase React props) straight
 * through to the Host React runtime. Values stay `unknown`-typed at the
 * boundary; event handlers are typed at each call site.
 */
import type { ReactNode } from './jsx-runtime.js'
import type { ChangeEventLike, MouseHandler, SvgTarget } from './react.js'

declare global {
  namespace JSX {
    interface ElementChildrenAttribute {
      children: object
    }
    type Element = import('./jsx-runtime.js').ReactElement
    interface IntrinsicElements {
      [tag: string]: {
        children?: ReactNode
        onMouseDown?: MouseHandler<SvgTarget>
        onMouseMove?: MouseHandler<SvgTarget>
        onMouseUp?: MouseHandler<SvgTarget>
        onMouseLeave?: MouseHandler<SvgTarget>
        onDoubleClick?: MouseHandler<SvgTarget>
        onClick?: MouseHandler<SvgTarget>
        onChange?: (event: ChangeEventLike) => void
        [prop: string]: unknown
      }
    }
  }
}

export {}
