
import * as React from "react";
import {
  Badge as DsBadge,
  Button as DsButton,
  Checkbox as DsCheckbox,
  Input,
  Note,
  Panel,
  Select as DsSelect,
  Separator as DsSeparator,
  Spinner as DsSpinner,
  Table as DsTable,
  Textarea,
} from "@/components/ds/surface";
import { Box, Flex, Grid, Measure } from "@/components/ds/layout";
import {
  Caps,
  Heading as DsHeading,
  Link as DsLink,
  Text as DsText,
  VisuallyHidden as DsVisuallyHidden,
} from "@/components/ds/type";
import { cx, type Responsive } from "@/lib/ds/props";
import type { Space, Tone } from "@/lib/ds/scales";

/**
 * THE MIGRATION SEAM.
 *
 * Stage 4 of docs/design/INSTRUMENT.md. Radix Themes is gone; this file is
 * what makes the ~89 files that still import from "@/components/ui" render on
 * INSTRUMENT instead, unchanged.
 *
 * WHY A SEAM RATHER THAN 105 REWRITTEN SCREENS IN ONE COMMIT — two reasons,
 * both about being able to tell what broke:
 *
 *   1. Rewriting every screen at the same time as replacing every component
 *      underneath them makes a compile error and a design regression
 *      indistinguishable. With the seam, the design change lands on its own,
 *      and anything that looks wrong is a mapping bug in ONE file.
 *   2. It is reversible. A wrong mapping is fixed here, once, rather than in
 *      the forty screens that inherited it.
 *
 * THIS FILE IS TEMPORARY AND SHOULD SHRINK. Stage 6 rewrites call sites onto
 * the native INSTRUMENT API — `tone` not `color`, `Panel` not `Card`, `Note`
 * not `Callout` — deleting the matching entry here as it goes.
 *
 * WHAT IS DELIBERATELY LOST, each an improvement rather than a gap:
 *
 *   Radix's 12-step colour scales  INSTRUMENT has three ink steps and four
 *                                  semantic tones. A twelve-step text ramp
 *                                  sounds flexible and means nobody can tell
 *                                  which step a given label should be.
 *   color="amber" and friends      Mapped to tone-by-meaning. The table below
 *                                  is the LAST place a hue name appears in
 *                                  this product.
 *   Radix Select's styled listbox  Now a native <select>: correct keyboard
 *                                  and screen-reader semantics for free, and
 *                                  the OS picker on a phone.
 *   Radix sizes 7-9                Clamped to 7. Nothing here used them.
 */

/* ── SCALE TRANSLATION ──────────────────────────────────────────────────
   The one place a Radix hue name still appears. Each entry is a reading of
   what the colour MEANT at the call sites that used it, checked against real
   usage rather than guessed:
     gray  (441 uses) secondary / tertiary copy          → muted
     red   (129)      overdue, failed, destructive       → warn
     amber (56)       needs attention, expiring, draft   → caution
     green (20)       paid, current, reconciled          → ok
     blue  (7)        informational                      → signal */
const TONE_FOR_COLOR: Record<string, Tone> = {
  gray: "muted",
  red: "warn",
  amber: "caution",
  green: "ok",
  blue: "signal",
  indigo: "signal",
};

function toneOf(color?: string, highContrast?: boolean): Tone | undefined {
  if (!color) return undefined;
  // Radix's `highContrast` on a gray meant "this is primary copy after all".
  // INSTRUMENT says that with the default ink rather than a modifier.
  if (color === "gray" && highContrast) return "default";
  return TONE_FOR_COLOR[color];
}

type Step = "1" | "2" | "3" | "4" | "5" | "6" | "7";

/** Radix put margin props on every component, so the seam has to take them
 *  everywhere too. They pass straight through to the INSTRUMENT primitive,
 *  which understands a scale position or a breakpoint object.
 *
 *  Typed to the actual Space scale (plus "auto", for `mt="auto"`-style
 *  pinning) rather than bare `string` — an untyped seam let `py="9"` (off
 *  the 0-8 scale) compile, emit a var(--i-py-…) reference nothing declares,
 *  and resolve to no padding at all (app/(auth)/loading.tsx,
 *  app/(marketing)/loading.tsx: a spinner sitting flush at the viewport
 *  top). lib/ds/props.ts's own claim that "p="17" is a compile error" only
 *  holds for files importing components/ds directly; the ~89 files still on
 *  this seam need the same scale enforced here. */
type Spacing = Responsive<Space | "auto">;
type SpacingProps = {
  m?: Spacing; mt?: Spacing; mb?: Spacing; ml?: Spacing; mr?: Spacing;
  mx?: Spacing; my?: Spacing;
  p?: Spacing; pt?: Spacing; pb?: Spacing; pl?: Spacing; pr?: Spacing;
  px?: Spacing; py?: Spacing;
};

/**
 * Radix ran 1-9; INSTRUMENT runs 1-7. Nothing here used 8 or 9.
 *
 * A RESPONSIVE size object narrows to its `initial` step, and that is a
 * deliberate, documented degradation rather than a silent one: INSTRUMENT's
 * type scale is a class per step, not a custom property, so it has no
 * per-breakpoint form yet. Narrowing DOWN (to initial) rather than up means a
 * marketing heading is a step smaller on desktop than it was — never oversized
 * on a phone, which is the failure that would actually hurt. Twelve call
 * sites, all on the marketing pages. Stage 6 either gives the type scale a
 * responsive form or sets these explicitly.
 */
function sizeOf(size?: string | Record<string, string>): Step | undefined {
  if (!size) return undefined;
  const raw = typeof size === "string" ? size : size.initial;
  if (!raw) return undefined;
  return String(Math.min(7, Math.max(1, Number(raw) || 3))) as Step;
}

/** Control sizes clamp to the three INSTRUMENT has. */
function controlSize(size?: string): "1" | "2" | "3" {
  return String(Math.min(3, Math.max(1, Number(size) || 2))) as "1" | "2" | "3";
}

/* ── LAYOUT ──────────────────────────────────────────────────────────── */
export { Box, Flex, Grid };

/** Radix's Container took a fixed size step; INSTRUMENT's measure is a ladder
 *  that opens up on large screens. See docs/RESPONSIVE-CONTRACT.md. */
export function Container({
  size: _size,
  children,
  ...rest
}: { size?: string; children?: React.ReactNode } & Record<string, unknown>) {
  return <Measure {...(rest as Record<string, never>)}>{children}</Measure>;
}

/* ── TYPE ────────────────────────────────────────────────────────────── */
type TextLike = Omit<React.HTMLAttributes<HTMLElement>, "color"> & {
  align?: string;
  size?: string | Record<string, string>;
  color?: string;
  highContrast?: boolean;
  weight?: string;
  trim?: string;
  truncate?: boolean;
  as?: React.ElementType;
  asChild?: boolean;
  htmlFor?: string;
  mt?: Spacing;
  mb?: Spacing;
  my?: Spacing;
  mx?: Spacing;
  ml?: Spacing;
  mr?: Spacing;
  p?: Spacing;
  wrap?: string;
};

export const Text = React.forwardRef<HTMLElement, TextLike>(function Text(
  { size, color, highContrast, weight, trim: _trim, align, ...rest },
  ref
) {
  return (
    <DsText
      ref={ref}
      size={sizeOf(size)}
      tone={toneOf(color, highContrast)}
      weight={weight as never}
      // Radix's `align` on Text meant TEXT alignment. On the INSTRUMENT
      // primitive `align` is align-items (it is a layout prop), so this has
      // to be translated or every centred caption would silently become a
      // flex alignment that does nothing to the text.
      textAlign={align as never}
      {...(rest as Record<string, never>)}
    />
  );
});

export const Heading = React.forwardRef<HTMLElement, TextLike>(function Heading(
  { size, color, highContrast, weight, trim: _trim, align, ...rest },
  ref
) {
  return (
    <DsHeading
      ref={ref}
      size={sizeOf(size)}
      tone={toneOf(color, highContrast)}
      weight={weight as never}
      textAlign={align as never}
      {...(rest as Record<string, never>)}
    />
  );
});

export function Code({
  children,
  ...rest
}: { children?: React.ReactNode } & Record<string, unknown>) {
  return (
    <code className="i-figure" {...(rest as Record<string, never>)}>
      {children}
    </code>
  );
}

export function Link({
  href,
  color: _color,
  underline: _underline,
  size,
  asChild,
  weight,
  children,
  className,
  ...rest
}: Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "color"> &
  SpacingProps & {
    href?: string;
    color?: string;
    underline?: string;
    size?: string;
    asChild?: boolean;
    weight?: string;
  }) {
  const cls = cx("i-link", size && `i-t${sizeOf(size)}`, weight && `i-w-${weight}`, className);

  // asChild is the DOMINANT shape here (~70 call sites), because the product
  // wraps next/link for client-side navigation:
  //     <Link asChild><NextLink href="/trips">Trips</NextLink></Link>
  // Cloning the child rather than rendering an anchor around it is what keeps
  // that a single <a>. Rendering both would nest an anchor inside an anchor,
  // which is invalid HTML and makes the inner one unreachable by keyboard.
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ className?: string }>;
    return React.cloneElement(child, {
      ...rest,
      className: cx(cls, child.props.className),
    } as never);
  }

  // A Radix <Link> with no href was a styled span. Kept, rather than emitting
  // an anchor that goes nowhere — which is worse than useless to a screen
  // reader, since it announces a link the user cannot follow.
  if (!href) {
    return (
      <span className={className} {...(rest as React.HTMLAttributes<HTMLSpanElement>)}>
        {children}
      </span>
    );
  }

  return (
    <DsLink href={href} className={cls} {...(rest as Record<string, never>)}>
      {children}
    </DsLink>
  );
}

export const VisuallyHidden = DsVisuallyHidden;

/* ── SURFACE ─────────────────────────────────────────────────────────── */
/** Radix's Card is INSTRUMENT's Panel with no header. */
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & SpacingProps & { size?: string; variant?: string; asChild?: boolean }
>(function Card({ size: _size, variant: _variant, asChild, className, style, children, ...rest }, ref) {
  // asChild was declared in the prop type but never handled: the flag fell
  // through to Panel's own rest spread and onto the DOM as an invalid
  // `asChild` attribute, and the child rendered INSIDE the panel body
  // instead of the panel becoming the child — on
  // `<Card asChild><NextLink>…</NextLink></Card>`, only the text inside the
  // body padding was clickable; the border and padding around it were dead
  // space. Panel itself always renders a real <div>, so asChild is handled
  // here by skipping Panel's own header/body wrapper structure (this Card
  // has never taken title/aside) and merging its two classes directly onto
  // the single child, same as the "i-panel i-panel-body" combination Panel
  // would otherwise apply across two nested elements.
  if (asChild) {
    if (!React.isValidElement(children)) {
      throw new Error(
        `<Card asChild> needs exactly one element child; received ` +
          `${Array.isArray(children) ? `${children.length} children` : typeof children}.`
      );
    }
    const child = children as React.ReactElement<{
      className?: string;
      style?: React.CSSProperties;
    }>;
    return React.cloneElement(child, {
      ...(rest as object),
      className: cx("i-panel", "i-panel-body", className, child.props.className),
      style: { ...(style as object), ...(child.props.style as object) },
    } as never);
  }
  return (
    <Panel ref={ref} className={className} style={style} {...(rest as Record<string, never>)}>
      {children}
    </Panel>
  );
});

/**
 * Radix's variant x colour matrix collapses onto INSTRUMENT's four roles.
 *
 * The load-bearing lines are `solid` → primary (INK) and anything red →
 * danger. Under the old system "solid" meant "filled with the accent"; here
 * the primary action is ink and the accent is reserved for live state, which
 * is the system's central colour decision.
 */
function buttonVariant(variant?: string, color?: string) {
  if (color === "red") return "danger" as const;
  // NO VARIANT MEANS PRIMARY, because Radix's own Button default was "solid".
  // Defaulting to outline here made every unmarked button — Sign in, Save,
  // Create invoice — render as a quiet bordered box, so screens had no
  // visible primary action at all. Checked against the real call sites: the
  // ones that wanted a secondary look already say so.
  if (variant === undefined || variant === "solid") return "primary" as const;
  if (variant === "ghost" || variant === "soft") return "quiet" as const;
  return "outline" as const;
}

export const Button = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color"> & SpacingProps & {
    variant?: string;
    color?: string;
    size?: string;
    highContrast?: boolean;
    asChild?: boolean;
    /** Radix's Button showed a spinner for this; INSTRUMENT disables and lets
     *  the call site's own label say what is happening ("Saving…"), which is
     *  more informative than a spinner that could mean anything. */
    loading?: boolean;
  }
>(function Button(
  { variant, color, size, highContrast: _hc, loading, disabled, asChild, className, children, ...rest },
  ref
) {
  const cls = cx(
    "i-btn",
    `i-btn-${buttonVariant(variant, color)}`,
    `i-btn-${controlSize(size)}`,
    className
  );

  // asChild: the child IS the control. Used across the marketing pages to
  // give a next/link the button's appearance. Cloning rather than wrapping is
  // not cosmetic — a <button> around an <a> is invalid HTML and gives the
  // element two conflicting roles, so a screen reader announces a button that
  // behaves like a link. This keeps it a single <a>.
  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<{ className?: string }>;
    return React.cloneElement(child, {
      ...rest,
      className: cx(cls, child.props.className),
    } as never);
  }

  return (
    <DsButton
      ref={ref}
      variant={buttonVariant(variant, color)}
      size={controlSize(size)}
      disabled={disabled || loading}
      className={className}
      {...(rest as Record<string, never>)}
    >
      {children}
    </DsButton>
  );
});

export const Badge = React.forwardRef<
  HTMLSpanElement,
  Omit<React.HTMLAttributes<HTMLSpanElement>, "color"> & SpacingProps & {
    color?: string;
    variant?: string;
    highContrast?: boolean;
    size?: string;
  }
>(function Badge({ color, variant: _v, highContrast: _hc, ...rest }, ref) {
  return (
    <DsBadge ref={ref} tone={toneOf(color) ?? "default"} {...(rest as Record<string, never>)} />
  );
});

export function Separator({
  size: _size,
  orientation,
  className,
  ...rest
}: { size?: string; orientation?: string; className?: string } & SpacingProps &
  Record<string, unknown>) {
  // MARGINS HAVE TO SURVIVE. The first version took only `vertical` and
  // `className`, so the my/mb/mt on twelve separators was silently dropped and
  // every rule sat flush against the content above and below it. The
  // INSTRUMENT Separator is not a layout primitive, so the spacing is applied
  // by a Box around it rather than by adding layout props to a <hr>.
  return (
    <Box {...(rest as Record<string, never>)}>
      <DsSeparator vertical={orientation === "vertical"} className={className} />
    </Box>
  );
}

export function Spinner({ size, ...rest }: { size?: string } & Record<string, unknown>) {
  return <DsSpinner size={controlSize(size)} {...(rest as { label?: string })} />;
}

/* ── CALLOUT → NOTE ──────────────────────────────────────────────────── */
const CalloutRoot = React.forwardRef<
  HTMLDivElement,
  Omit<React.HTMLAttributes<HTMLDivElement>, "color"> & SpacingProps & {
    color?: string;
    size?: string;
    variant?: string;
  }
>(function CalloutRoot({ color, children, ...rest }, ref) {
  return (
    <Note ref={ref} tone={toneOf(color) ?? "default"} {...(rest as Record<string, never>)}>
      {children}
    </Note>
  );
});

export const Callout = {
  Root: CalloutRoot,
  Text: function CalloutText({ children }: { children?: React.ReactNode }) {
    return <span>{children}</span>;
  },
  // INSTRUMENT's Note carries its tone on a left rule rather than an icon, so
  // this slot renders nothing. Kept as a component so the call sites that
  // pass one still compile; stage 6 removes them.
  Icon: function CalloutIcon(_props: { children?: React.ReactNode }) {
    return null;
  },
};

/* ── FIELDS ──────────────────────────────────────────────────────────── */
const TextFieldRoot = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "color"> & {
    size?: string;
    variant?: string;
    color?: string;
  }
>(function TextFieldRoot({ size, variant: _v, color: _c, children: _kids, ...rest }, ref) {
  return <Input ref={ref} size={controlSize(size)} {...(rest as Record<string, never>)} />;
});

export const TextField = {
  Root: TextFieldRoot,
  // Radix's Slot rendered an adornment inside the input's border. INSTRUMENT
  // has no adornment slot; rendering the children plainly keeps any icon or
  // unit label visible instead of silently dropping it.
  Slot: function TextFieldSlot({
    children,
  }: {
    children?: React.ReactNode;
    side?: string;
    px?: string;
    color?: string;
  }) {
    return <>{children}</>;
  },
};

export const TextArea = React.forwardRef<
  HTMLTextAreaElement,
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> & {
    size?: string;
    variant?: string;
  }
>(function TextArea({ size: _s, variant: _v, ...rest }, ref) {
  return <Textarea ref={ref} {...(rest as Record<string, never>)} />;
});

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "onChange"> & {
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
    size?: string;
  }
>(function Checkbox({ checked, onCheckedChange, size: _s, ...rest }, ref) {
  return (
    <DsCheckbox
      ref={ref}
      checked={checked}
      // Radix handed the boolean straight to the callback; a native checkbox
      // hands over an event. Translated here so no call site has to change.
      onChange={onCheckedChange ? (e) => onCheckedChange(e.currentTarget.checked) : undefined}
      {...(rest as Record<string, never>)}
    />
  );
});

/** A switch is a checkbox with a different skin and identical semantics. */
export const Switch = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
    size?: string;
  }
>(function Switch({ checked, onCheckedChange, ...rest }, ref) {
  return (
    <DsCheckbox
      ref={ref}
      role="switch"
      checked={checked}
      onChange={onCheckedChange ? (e) => onCheckedChange(e.currentTarget.checked) : undefined}
      {...(rest as Record<string, never>)}
    />
  );
});

/* ── SELECT → NATIVE ─────────────────────────────────────────────────────
   The most involved mapping, because the shapes genuinely differ: Radix
   composed Root > Trigger + Content > Item, while a native select is one
   element whose children are <option>s.

   Root therefore walks its own children, finds the Items, and emits options.
   That is a render-time walk over a handful of nodes, not a hot path.

   PLACEHOLDER: Radix put it on the Trigger. A native select has no such
   concept, so it becomes a disabled, hidden first option — the standard
   technique, and `disabled` is what stops it being chosen back. */
type ItemProps = { value: string; children?: React.ReactNode };

function collectItems(node: React.ReactNode, out: ItemProps[]) {
  React.Children.forEach(node, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as ItemProps & { children?: React.ReactNode };
    if (typeof props.value === "string") {
      out.push({ value: props.value, children: props.children });
      return;
    }
    if (props.children) collectItems(props.children, out);
  });
}

const SelectRoot = React.forwardRef<
  HTMLSelectElement,
  Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size" | "onChange"> & {
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    size?: string;
  }
>(function SelectRoot({ value, defaultValue, onValueChange, size, children, ...rest }, ref) {
  const items: ItemProps[] = [];
  collectItems(children, items);

  // Pull the Trigger's props up onto the select. aria-labelledby especially
  // HAS to travel: call sites wired it to a <label> by id, and losing it
  // would leave ~48 fields unlabelled to a screen reader.
  let placeholder: string | undefined;
  let triggerProps: Record<string, unknown> = {};
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const t = child.type as { displayName?: string };
    if (t?.displayName === "SelectTrigger") {
      triggerProps = child.props as Record<string, unknown>;
      placeholder = triggerProps.placeholder as string | undefined;
    }
  });

  return (
    <DsSelect
      ref={ref}
      size={controlSize(size)}
      value={value}
      defaultValue={defaultValue}
      onChange={onValueChange ? (e) => onValueChange(e.currentTarget.value) : undefined}
      // EVERY LABELLING ATTRIBUTE THE TRIGGER CARRIED HAS TO TRAVEL. The
      // first version forwarded only aria-labelledby and aria-label, which
      // dropped the `id` on twenty fields — and an id is what a
      // <label htmlFor> points at, so those labels stopped being associated
      // with any control. aria-invalid and aria-describedby matter for the
      // same reason: they are the error state a screen reader announces.
      id={triggerProps.id as string | undefined}
      aria-labelledby={triggerProps["aria-labelledby"] as string | undefined}
      aria-label={triggerProps["aria-label"] as string | undefined}
      aria-invalid={triggerProps["aria-invalid"] as boolean | undefined}
      aria-describedby={triggerProps["aria-describedby"] as string | undefined}
      {...(rest as Record<string, never>)}
    >
      {placeholder ? (
        <option value="" disabled hidden>
          {placeholder}
        </option>
      ) : null}
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {/* An <option> can hold only text, so a rich Item child flattens.
              Every Item in this product is already a plain string. */}
          {typeof item.children === "string"
            ? item.children
            : String(item.children ?? item.value)}
        </option>
      ))}
    </DsSelect>
  );
});

const SelectTrigger = React.forwardRef<HTMLElement, Record<string, unknown>>(
  function SelectTrigger() {
    // Rendered by SelectRoot, which reads this element's props and emits the
    // native select itself. Returning null is what stops a second, stray
    // control appearing beside it.
    return null;
  }
);
SelectTrigger.displayName = "SelectTrigger";

export const Select = {
  Root: SelectRoot,
  Trigger: SelectTrigger,
  Content: function SelectContent({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
  Item: function SelectItem(_props: ItemProps) {
    return null;
  },
  Group: function SelectGroup({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
  Label: function SelectLabel({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
  Separator: function SelectSeparatorItem() {
    return null;
  },
};

/* ── TABLE ───────────────────────────────────────────────────────────── */
/* Radix's Table took presentational props INSTRUMENT expresses structurally:
   `variant`/`size` on Root (the panel around it decides that now) and
   `justify` on a cell (which is `numeric`, since the only thing this product
   right-aligns is a figure). Absorbed here rather than left to fail at ~78
   call sites. */
const TableRoot = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement> & SpacingProps & {
    variant?: string;
    size?: string;
    layout?: string;
  }
>(function TableRoot({ variant: _v, size: _s, layout: _l, ...rest }, ref) {
  return <DsTable.Root ref={ref} {...rest} />;
});

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement> & SpacingProps & {
    justify?: string;
    numeric?: boolean;
    wrap?: boolean;
    width?: string;
    minWidth?: string;
  }
>(function TableCell({ justify, numeric, width, minWidth, style, ...rest }, ref) {
  return (
    <DsTable.Cell
      ref={ref}
      numeric={numeric ?? justify === "end"}
      // `justify` has THREE values in this codebase — end (302), between (55)
      // and center (8) — and the first version only understood "end", so the
      // other 63 cells silently lost their alignment. `end` maps to the
      // numeric treatment (right-aligned tabular figures, which is the only
      // thing this product right-aligns); the rest set text-align directly.
      style={justifyStyle(justify, style, width, minWidth)}
      {...rest}
    />
  );
});

/** Shared by Table.Cell and Table.ColumnHeaderCell. */
function justifyStyle(
  justify: string | undefined,
  style: React.CSSProperties | undefined,
  width?: string,
  minWidth?: string
): React.CSSProperties | undefined {
  const extra: React.CSSProperties = {};
  if (justify === "center") extra.textAlign = "center";
  // `between` on a cell meant "spread the cell's own children", which is a
  // flex arrangement, not a text alignment.
  if (justify === "between") {
    extra.display = "flex";
    extra.justifyContent = "space-between";
    extra.alignItems = "center";
    extra.gap = "var(--space-2)";
  }
  if (width) extra.width = width;
  if (minWidth) extra.minWidth = minWidth;
  return Object.keys(extra).length || style ? { ...style, ...extra } : undefined;
}

const TableColumnHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement> & SpacingProps & {
    justify?: string;
    numeric?: boolean;
    width?: string;
    minWidth?: string;
  }
>(function TableColumnHead({ justify, numeric, width, minWidth, style, ...rest }, ref) {
  return (
    <DsTable.ColumnHead
      ref={ref}
      numeric={numeric ?? justify === "end"}
      style={justifyStyle(justify, style, width, minWidth)}
      {...rest}
    />
  );
});

export const Table = {
  Root: TableRoot,
  Header: DsTable.Header,
  Body: DsTable.Body,
  Row: DsTable.Row,
  Cell: TableCell,
  ColumnHeaderCell: TableColumnHead,
  // A <th scope="row"> is what makes a screen reader announce "INV-2044" when
  // you land on a cell in that row. Preserved rather than downgraded to a td.
  RowHeaderCell: React.forwardRef<HTMLTableCellElement, React.ComponentPropsWithoutRef<"th">>(
    function RowHeaderCell(props, ref) {
      return <th ref={ref} scope="row" {...props} />;
    }
  ),
};

/* The stateful components — AlertDialog, Tabs, the radio family, DataList,
   Section and Skeleton — live in ./interactive because they need
   "use client", and putting that directive on THIS file made every asChild
   child cross the RSC boundary and arrive as a lazy reference instead of an
   element. Re-exported so call sites still import everything from one path. */
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogRoot,
  AlertDialogTitle,
  AlertDialogTrigger,
  DataListItem,
  DataListLabel,
  DataListRoot,
  DataListValue,
  RadioGroupRoot,
  RadioItem,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
} from "./interactive";

export { Section, Skeleton } from "./interactive";

/* THE COMPOUND OBJECTS ARE ASSEMBLED HERE, in a SERVER module, from the
   individually-exported parts — NOT exported as objects from ./interactive.
   A "use client" module's exports cross the boundary as client references:
   a function survives, an object arrives as an opaque proxy whose properties
   read undefined from a server component. Assembling here makes each of these
   a real object whose values are client references, which is what works in
   both directions. */
export const AlertDialog = {
  Root: AlertDialogRoot,
  Trigger: AlertDialogTrigger,
  Content: AlertDialogContent,
  Title: AlertDialogTitle,
  Description: AlertDialogDescription,
  Cancel: AlertDialogCancel,
  Action: AlertDialogAction,
};

export const Tabs = {
  Root: TabsRoot,
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
};

export const DataList = {
  Root: DataListRoot,
  Item: DataListItem,
  Label: DataListLabel,
  Value: DataListValue,
};

export const RadioGroup = { Root: RadioGroupRoot, Item: RadioItem };
export const RadioCards = { Root: RadioGroupRoot, Item: RadioItem };
export const SegmentedControl = { Root: RadioGroupRoot, Item: RadioItem };

/* The native INSTRUMENT names, re-exported so a screen being migrated off the
   seam can start using them without a second import path. */
export { Caps, Panel, Note };
