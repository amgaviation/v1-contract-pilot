/**
 * INSTRUMENT — the responsive prop engine.
 *
 * Turns a primitive's layout props into the CSS custom properties that
 * app/design/system.generated.css reads back through its media-query ladder.
 * See docs/design/INSTRUMENT.md, "How responsive props work".
 *
 * The whole mechanism is: a prop value becomes `--i-<stem>-<breakpoint>` in
 * the element's inline style, and the generated stylesheet declares the real
 * CSS property once per breakpoint with a descending fallback chain. That
 * keeps the runtime to a few string concatenations, produces no class-name
 * explosion, and — because both this file and the generator read
 * lib/ds/scales.ts — makes a prop with no rule behind it impossible.
 */
import {
  ALIGN_CSS,
  JUSTIFY_CSS,
  LAYOUT_PROPS,
  type Breakpoint,
  type Space,
} from "./scales";

/** A prop value is either one value for all widths, or one per breakpoint. */
export type Responsive<T> = T | Partial<Record<Breakpoint, T>>;

type SpaceValue = Responsive<Space | "auto">;
type RawValue = Responsive<string>;

/**
 * The layout props every primitive accepts.
 *
 * Space-scaled props are typed to the scale, so `p="17"` is a compile error
 * rather than a padding of 17px that no token authorises. The raw props take
 * strings because their values are CSS keywords or lengths the scale does not
 * enumerate — `width="240px"`, `position="sticky"`.
 */
export interface LayoutProps {
  p?: SpaceValue;
  px?: SpaceValue;
  py?: SpaceValue;
  pt?: SpaceValue;
  pb?: SpaceValue;
  pl?: SpaceValue;
  pr?: SpaceValue;
  m?: SpaceValue;
  mx?: SpaceValue;
  my?: SpaceValue;
  mt?: SpaceValue;
  mb?: SpaceValue;
  ml?: SpaceValue;
  mr?: SpaceValue;
  gap?: SpaceValue;
  display?: RawValue;
  direction?: RawValue;
  align?: RawValue;
  justify?: RawValue;
  wrap?: RawValue;
  flexGrow?: RawValue;
  flexShrink?: RawValue;
  width?: RawValue;
  minWidth?: RawValue;
  maxWidth?: RawValue;
  height?: RawValue;
  minHeight?: RawValue;
  maxHeight?: RawValue;
  columns?: RawValue;
  gridColumn?: RawValue;
  position?: RawValue;
  overflow?: RawValue;
  overflowX?: RawValue;
  overflowY?: RawValue;
  textAlign?: RawValue;
}

/** Fast lookup from prop name to its stem and scale kind. */
const PROP_META = new Map(
  LAYOUT_PROPS.map((p) => [p.prop as string, p] as const)
);

/** Every layout prop name, so primitives can split them out of their rest props. */
export const LAYOUT_PROP_NAMES: ReadonlySet<string> = new Set(
  LAYOUT_PROPS.map((p) => p.prop as string)
);

function toCssValue(scale: string, prop: string, value: string): string {
  if (scale === "space") {
    // `auto` is not a scale position and never will be, but it is the only
    // way to express "push this to the far end" on a margin — the rail's
    // account block (`mt="auto"`) and every centred wrapper (`mx="auto"`)
    // need it. Passed through verbatim rather than looked up, because
    // var(--space-auto) is not a token and would resolve to nothing, which
    // is precisely the silent-no-op class of bug this system is built to
    // make impossible.
    if (value === "auto") return "auto";
    return `var(--space-${value})`;
  }
  if (scale === "columns") return `repeat(${value}, minmax(0, 1fr))`;
  // `align` and `justify` take friendly names — "start", "between" — because
  // "flex-start" and "space-between" are flexbox spellings a call site should
  // not have to remember, and because they read wrong on a grid. Translated
  // here rather than in the stylesheet so the same prop works on both.
  if (prop === "align") return ALIGN_CSS[value] ?? value;
  if (prop === "justify") return JUSTIFY_CSS[value] ?? value;
  return value;
}

/**
 * Build the inline style object for a set of layout props.
 *
 * Returns a plain object of custom properties, merged over any `style` the
 * call site passed. The call site's own style wins on collision, which is
 * deliberate: `style` is the documented escape hatch for the handful of
 * properties the system does not model, and a system that silently overrode
 * it would send people to `!important` instead.
 */
export function layoutStyle(
  props: Record<string, unknown>,
  style?: React.CSSProperties
): React.CSSProperties {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    const meta = PROP_META.get(key);
    if (!meta) continue;

    if (typeof value === "string" || typeof value === "number") {
      out[`--i-${meta.varName}-initial`] = toCssValue(
        meta.scale,
        key,
        String(value)
      );
      continue;
    }

    if (typeof value === "object") {
      for (const [bp, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined || v === null) continue;
        out[`--i-${meta.varName}-${bp}`] = toCssValue(
          meta.scale,
          key,
          String(v)
        );
      }
    }
  }

  return { ...out, ...style } as React.CSSProperties;
}

/**
 * Split a primitive's props into the layout ones and everything else, so the
 * remainder can be spread onto the DOM element without React warning about
 * unknown attributes like `gap` or `justify` landing on a <div>.
 */
export function splitLayoutProps<T extends Record<string, unknown>>(
  props: T
): [Record<string, unknown>, Record<string, unknown>] {
  const layout: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (LAYOUT_PROP_NAMES.has(k)) layout[k] = v;
    else rest[k] = v;
  }
  return [layout, rest];
}

/** Join class names, dropping the falsy ones. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Props for a primitive that renders element `E`, plus its own props, plus
 * the layout props.
 *
 * WHY THIS EXISTS RATHER THAN `& Record<string, unknown>`. The obvious way to
 * say "and any other DOM attribute" is to intersect with an index signature.
 * It compiles, and it is silently destructive: React's `forwardRef` puts the
 * props type through `PropsWithoutRef`, which is an `Omit`, and `Omit` over a
 * type carrying a string index signature collapses the whole thing to that
 * index signature. Every named prop — `className`, `title`, `href` — becomes
 * `unknown` at both the implementation and the call site, so the component
 * type-checks against literally any object and catches nothing.
 *
 * Omitting the overlap keys is what keeps `size` and `align` meaning the
 * system's scale positions rather than the HTML attributes of the same name.
 */
export type WithLayout<
  E extends keyof React.JSX.IntrinsicElements,
  Own = Record<never, never>,
> = Own &
  LayoutProps &
  Omit<
    React.ComponentPropsWithoutRef<E>,
    keyof Own | keyof LayoutProps
  >;
