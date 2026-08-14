import * as React from "react";
import NextLink from "next/link";
import { cx, layoutStyle, splitLayoutProps, type LayoutProps, type WithLayout } from "@/lib/ds/props";
import type { TextSize, Tone, Weight } from "@/lib/ds/scales";

/**
 * INSTRUMENT — type primitives.
 *
 * Three faces, each with one job (docs/design/INSTRUMENT.md, "Type"):
 * Archivo for headings and labels, Inter for body copy, JetBrains Mono for
 * every figure. `Figure` is a component rather than a utility class because
 * "which things are numbers" is a decision the system should make once, not
 * something ~40 screens each remember to tag.
 */

interface TypeProps extends LayoutProps {
  size?: TextSize;
  /** Semantic tone. Named by meaning — `caution`, never `amber`. */
  tone?: Tone;
  weight?: Weight;
  align?: LayoutProps["align"];
  truncate?: boolean;
  as?: React.ElementType;
  asChild?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  title?: string;
}

function useType(props: Record<string, unknown>, base: string, defaultSize: TextSize) {
  const {
    size = defaultSize,
    tone,
    weight,
    truncate,
    as,
    asChild,
    className,
    style,
    children,
    ...others
  } = props as TypeProps & Record<string, unknown>;
  const [layout, rest] = splitLayoutProps(others as Record<string, unknown>);
  return {
    as,
    asChild,
    children,
    rest,
    style: layoutStyle(layout, style),
    className: cx(
      base,
      `i-t${size}`,
      tone && `i-tone-${tone}`,
      weight && `i-w-${weight}`,
      truncate && "i-truncate",
      className
    ),
  };
}

function render(
  who: string,
  as: React.ElementType | undefined,
  asChild: boolean | undefined,
  fallbackTag: React.ElementType,
  className: string,
  style: React.CSSProperties,
  rest: Record<string, unknown>,
  children: React.ReactNode,
  ref: React.Ref<HTMLElement>
) {
  if (asChild) {
    // Checked rather than relying on React.Children.only, whose message does
    // not name the offending component — which turned a one-line fix into a
    // hunt through a 700-line page during the Radix removal.
    if (!React.isValidElement(children)) {
      throw new Error(
        `<${who} asChild> needs exactly one element child; received ` +
          `${Array.isArray(children) ? `${children.length} children` : JSON.stringify(children)?.slice(0, 200) ?? typeof children}.`
      );
    }
    const child = children as React.ReactElement<{
      className?: string;
      style?: React.CSSProperties;
    }>;
    return React.cloneElement(child, {
      ...rest,
      className: cx(className, child.props.className),
      style: { ...style, ...child.props.style },
    } as never);
  }
  const Tag = (as ?? fallbackTag) as React.ElementType;
  return (
    <Tag ref={ref} className={className} style={style} {...rest}>
      {children}
    </Tag>
  );
}

/** Body copy and everything conversational. Defaults to size 3 (15px). */
export const Text = React.forwardRef<HTMLElement, TypeProps & Record<string, unknown>>(
  function Text(props, ref) {
    const { as, asChild, className, style, children, rest } = useType(props, "i-text", "3");
    return render("Text", as, asChild, "span", className, style, rest, children, ref);
  }
);
Text.displayName = "Text";

/**
 * Headings. `size` is the visual step and `as` is the document level; they
 * are separate on purpose, because the right heading LEVEL is a document-
 * structure question (and a screen-reader one) while the right SIZE is a
 * layout question, and forcing them to agree makes people pick the wrong
 * level to get the right size.
 */
export const Heading = React.forwardRef<HTMLElement, TypeProps & Record<string, unknown>>(
  function Heading(props, ref) {
    const { as, asChild, className, style, children, rest } = useType(props, "i-heading", "5");
    return render("Heading", as, asChild, "h2", className, style, rest, children, ref);
  }
);
Heading.displayName = "Heading";

/**
 * The small uppercase label: table column heads, eyebrows, group headers.
 * A component rather than `<Text size="1" transform="uppercase">` because the
 * tracking is not optional — caps at 11px set solid are genuinely hard to
 * read, and leaving that to the call site guarantees some of them forget.
 */
export const Caps = React.forwardRef<HTMLElement, TypeProps & Record<string, unknown>>(
  function Caps(props, ref) {
    const { as, asChild, className, style, children, rest } = useType(props, "i-caps", "1");
    return render("Text", as, asChild, "span", className, style, rest, children, ref);
  }
);
Caps.displayName = "Caps";

/**
 * Every number in the product: money, decimal hours, tail numbers, ICAO
 * codes, invoice numbers, payment references.
 *
 * This exists because "use tabular figures on numbers" is a rule that decays
 * the moment it depends on memory. Under the previous system it was a utility
 * class, and the classes went missing on new screens exactly as often as you
 * would expect. A component cannot be forgotten halfway down a table — the
 * cell either renders a Figure or it does not, and that is visible in review.
 */
export const Figure = React.forwardRef<HTMLElement, TypeProps & Record<string, unknown>>(
  function Figure(props, ref) {
    const { as, asChild, className, style, children, rest } = useType(
      props,
      "i-text i-figure",
      "2"
    );
    return render("Text", as, asChild, "span", className, style, rest, children, ref);
  }
);
Figure.displayName = "Figure";

/**
 * Links. Wraps next/link so client-side navigation is the default rather
 * than something each call site opts into, and carries the underline —
 * underlined by default, because a link in a paragraph identified by colour
 * alone fails WCAG 1.4.1 for anyone who cannot separate the two hues.
 *
 * `plain` drops the link styling for the cases where the whole row or card is
 * the target and an underline would be noise. It keeps the focus ring, which
 * is the part that must never be dropped.
 */
export const Link = React.forwardRef<
  HTMLAnchorElement,
  WithLayout<"a", { href: string; plain?: boolean }>
>(function Link({ href, plain, className, style, children, ...others }, ref) {
  const [layout, rest] = splitLayoutProps(others as Record<string, unknown>);
  return (
    <NextLink
      ref={ref}
      href={href}
      className={cx(plain ? "i-link-plain" : "i-link", className)}
      style={layoutStyle(layout, style)}
      {...rest}
    >
      {children}
    </NextLink>
  );
});
Link.displayName = "Link";

/** Screen-reader-only, but still focusable — skip links depend on that. */
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="i-vh">{children}</span>;
}
