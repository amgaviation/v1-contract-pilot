import * as React from "react";
import { cx, layoutStyle, splitLayoutProps, type LayoutProps } from "@/lib/ds/props";

/**
 * INSTRUMENT — the three layout primitives.
 *
 * Box, Flex and Grid are the same component with a different default
 * `display`. They exist as three names rather than one because
 * `<Flex direction="column">` says what the arrangement IS at the call site,
 * and `<Box display="flex" direction="column">` makes the reader assemble it.
 *
 * ── THE `display` DEFAULT, AND WHY IT IS WRITTEN AS A CUSTOM PROPERTY ──
 *
 * Each primitive writes its own `--i-d-initial` unless the call site passed
 * `display`. The obvious alternative — a `.i-flex { display: flex }` rule in
 * the stylesheet — was tried first and is subtly broken: the generated layout
 * rule declares `display: var(--i-d-initial, initial)` at the same
 * specificity, so whichever rule came later in the file won for EVERY
 * element, and an explicit `display={{ initial: "none", md: "flex" }}` (the
 * app shell's header uses exactly that) silently did nothing.
 *
 * Routing the default through the same custom property the prop uses means
 * there is only ever one declaration to win, and "the call site passed one"
 * simply replaces "the component supplied one". No specificity involved.
 */

type El = React.ElementType;

export interface BoxOwnProps extends LayoutProps {
  /** Render as a different element — `as="section"`, `as="aside"`. */
  as?: El;
  /**
   * Render the child element instead of a wrapper, merging class and style
   * onto it. Used where a layout has to BE the semantic element rather than
   * wrap it — `<Flex asChild><nav>…</nav></Flex>`.
   */
  asChild?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

function useLayout(
  props: Record<string, unknown>,
  baseClass: string,
  defaultDisplay: string
) {
  const { as, asChild, className, style, children, ...others } = props as BoxOwnProps &
    Record<string, unknown>;
  const [layout, rest] = splitLayoutProps(others as Record<string, unknown>);
  const resolved = layoutStyle(layout, style);

  // The default only applies when the call site did not ask for a display at
  // any breakpoint. Checking `initial` alone would be wrong: a call site that
  // passes `display={{ md: "flex" }}` and nothing else still wants the
  // component's own default below md, not `initial`.
  if (layout.display === undefined) {
    (resolved as Record<string, string>)["--i-d-initial"] = defaultDisplay;
  }

  return {
    as,
    asChild,
    className: cx(baseClass, className),
    style: resolved,
    children,
    rest,
  };
}

/**
 * `asChild` merges onto the single child element. Deliberately minimal — it
 * merges className and style and nothing else, because the primitives never
 * need to forward handlers or refs through this path, and a fuller
 * implementation would be a slot system nobody asked for.
 */
function renderAsChild(
  children: React.ReactNode,
  className: string,
  style: React.CSSProperties,
  rest: Record<string, unknown>
) {
  const child = React.Children.only(children) as React.ReactElement<{
    className?: string;
    style?: React.CSSProperties;
  }>;
  return React.cloneElement(child, {
    ...rest,
    className: cx(className, child.props.className),
    style: { ...style, ...child.props.style },
  } as never);
}

function makeLayoutComponent(baseClass: string, defaultDisplay: string, displayName: string) {
  const Component = React.forwardRef<HTMLElement, BoxOwnProps & Record<string, unknown>>(
    function LayoutComponent(props, ref) {
      const { as, asChild, className, style, children, rest } = useLayout(
        props,
        baseClass,
        defaultDisplay
      );
      if (asChild) return renderAsChild(children, className, style, rest);
      const Tag = (as ?? "div") as El;
      return (
        <Tag ref={ref} className={className} style={style} {...rest}>
          {children}
        </Tag>
      );
    }
  );
  Component.displayName = displayName;
  return Component;
}

export const Box = makeLayoutComponent("i-box", "block", "Box");
export const Flex = makeLayoutComponent("i-flex", "flex", "Flex");
export const Grid = makeLayoutComponent("i-grid", "grid", "Grid");

/**
 * A vertical stack — the arrangement most screens in this product are built
 * from, given a name so it stops being written out as
 * `<Flex direction="column">` a few hundred times.
 */
export const Stack = React.forwardRef<HTMLElement, BoxOwnProps & Record<string, unknown>>(
  function Stack({ gap = "4", ...props }, ref) {
    return <Flex ref={ref} direction="column" gap={gap} {...props} />;
  }
);
Stack.displayName = "Stack";

/**
 * The reading-measure wrapper. The ladder is a token
 * (--measure-md/lg/xl) rather than a number here, and it exists because this
 * product is data-dense: a settings form wants a narrow measure, and a
 * twelve-column report on a 1920px monitor wants the screen.
 * See docs/RESPONSIVE-CONTRACT.md.
 */
export const Measure = React.forwardRef<HTMLElement, BoxOwnProps & Record<string, unknown>>(
  function Measure(props, ref) {
    return (
      <Box
        ref={ref}
        mx="auto"
        width="100%"
        maxWidth={{
          initial: "100%",
          md: "var(--measure-md)",
          lg: "var(--measure-lg)",
          xl: "var(--measure-xl)",
        }}
        {...props}
      />
    );
  }
);
Measure.displayName = "Measure";
