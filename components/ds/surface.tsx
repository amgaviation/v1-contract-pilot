import * as React from "react";
import { cx, layoutStyle, splitLayoutProps, type WithLayout } from "@/lib/ds/props";
import type { ControlSize, Tone } from "@/lib/ds/scales";

/**
 * INSTRUMENT — surface and control primitives.
 *
 * Every component here is built from a plain element plus a class from
 * app/design/system.generated.css. There is no runtime style engine, no
 * variant library, and no third-party component underneath any of them.
 */

/* ── PANEL ────────────────────────────────────────────────────────────────
   The product's one surface. Bordered, never shadowed — on a canvas a
   hairline is structure and a drop shadow is decoration, and the single
   elevation token this system has is reserved for the top layer (dialogs).

   `title` renders the header bar. Passing children alone gives a bare
   padded panel, which is what most call sites want. */
export const Panel = React.forwardRef<
  HTMLDivElement,
  WithLayout<
    "div",
    {
      title?: React.ReactNode;
      /** Right-aligned content in the header — a count, a filter, an action. */
      aside?: React.ReactNode;
      /** Drop the body padding, for a panel whose only child is a table. */
      flush?: boolean;
    }
  >
>(function Panel({ title, aside, flush, className, style, children, ...others }, ref) {
  const [layout, rest] = splitLayoutProps(others as Record<string, unknown>);
  return (
    <div
      ref={ref}
      className={cx("i-panel", className)}
      style={layoutStyle(layout, style)}
      {...rest}
    >
      {title !== undefined || aside !== undefined ? (
        <div className="i-panel-head">
          <span className="i-heading i-t4">{title}</span>
          {aside !== undefined ? <span>{aside}</span> : null}
        </div>
      ) : null}
      <div className={flush ? "i-panel-flush" : "i-panel-body"}>{children}</div>
    </div>
  );
});
Panel.displayName = "Panel";

/* ── BUTTON ───────────────────────────────────────────────────────────────
   `variant` is the ROLE, not the look: primary / outline / quiet / danger.

   Primary is ink, not accent. That is the system's central colour decision
   (docs/design/INSTRUMENT.md): --signal is reserved for things that are live,
   and if it is also every submit button on every screen it stops carrying
   that meaning.

   Size defaults to "2" — a 32px control, which clears WCAG 2.5.8's 24x24
   minimum with room. The previous system's default computed to 22px high and
   shipped under the minimum for months. */
export type ButtonVariant = "primary" | "outline" | "quiet" | "danger";

export const Button = React.forwardRef<
  HTMLButtonElement,
  WithLayout<"button", { variant?: ButtonVariant; size?: ControlSize }>
>(function Button(
  { variant = "outline", size = "2", type = "button", className, style, ...others },
  ref
) {
  const [layout, rest] = splitLayoutProps(others as Record<string, unknown>);
  return (
    <button
      ref={ref}
      // Explicitly typed, because an untyped <button> inside a <form> is a
      // submit button, and this product is mostly forms. Every accidental
      // submit-on-click bug starts here.
      type={type}
      className={cx("i-btn", `i-btn-${variant}`, `i-btn-${size}`, className)}
      style={layoutStyle(layout, style)}
      {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
    />
  );
});
Button.displayName = "Button";

/** A link that looks like a button. Separate component, because a navigation
 *  that renders as a <button> is a real accessibility defect — it loses
 *  middle-click, open-in-new-tab, and the screen reader's "link" role. */
export const ButtonLink = React.forwardRef<
  HTMLAnchorElement,
  WithLayout<"a", { variant?: ButtonVariant; size?: ControlSize; href: string }>
>(function ButtonLink({ variant = "outline", size = "2", className, style, ...others }, ref) {
  // Same fix as Badge above: without splitLayoutProps a layout prop leaked
  // onto the DOM as an invalid attribute instead of becoming a style.
  const [layout, rest] = splitLayoutProps(others as Record<string, unknown>);
  return (
    <a
      ref={ref}
      className={cx("i-btn", `i-btn-${variant}`, `i-btn-${size}`, className)}
      style={layoutStyle(layout, style)}
      {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
    />
  );
});
ButtonLink.displayName = "ButtonLink";

/* ── FIELD ────────────────────────────────────────────────────────────────
   Input, textarea and select share one skin so a form never looks assembled
   from two families. */
export const Input = React.forwardRef<
  HTMLInputElement,
  { size?: ControlSize; className?: string } & Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "size"
  >
>(function Input({ size = "2", className, ...rest }, ref) {
  return <input ref={ref} className={cx("i-field", `i-field-${size}`, className)} {...rest} />;
});
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  { className?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cx("i-field", className)} {...rest} />;
});
Textarea.displayName = "Textarea";

/**
 * The native `<select>`, styled.
 *
 * Deliberately not a custom listbox. Native gives correct keyboard and
 * screen-reader semantics for free, and on a phone it opens the OS picker —
 * which is the better interaction for a pilot filling a form one-handed on a
 * ramp, not a compromise. The cost is that the option list cannot be styled;
 * that is a price worth paying and is recorded here so it is not "fixed"
 * later by someone who reads it as an oversight.
 */
export const Select = React.forwardRef<
  HTMLSelectElement,
  { size?: ControlSize; className?: string } & Omit<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    "size"
  >
>(function Select({ size = "2", className, ...rest }, ref) {
  return <select ref={ref} className={cx("i-field", `i-field-${size}`, className)} {...rest} />;
});
Select.displayName = "Select";

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  { className?: string } & React.InputHTMLAttributes<HTMLInputElement>
>(function Checkbox({ className, ...rest }, ref) {
  return <input ref={ref} type="checkbox" className={cx("i-check", className)} {...rest} />;
});
Checkbox.displayName = "Checkbox";

/** Label / hint / error, so a field's supporting text is consistent. */
export function Label({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label className="i-label" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="i-hint">{children}</p>;
}

/**
 * A field-level error. `role="alert"` is not decoration: this product's
 * house rule is that every mutation ends in a visible success or a specific
 * visible error, and an error a screen reader never announces is not visible.
 */
export function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p className="i-error" role="alert">
      {children}
    </p>
  );
}

/* ── BADGE ────────────────────────────────────────────────────────────────
   Status. Outline, never a filled pill: a table where every row carries a
   solid coloured pill is a table you read the pills of instead of the data. */
export const Badge = React.forwardRef<
  HTMLSpanElement,
  WithLayout<"span", { tone?: Tone }>
>(function Badge({ tone = "default", className, style, children, ...others }, ref) {
  // Without splitLayoutProps, a layout prop like `ml="1"` fell into `rest`
  // and was spread straight onto the DOM as an invalid `ml` attribute
  // (React warning) with no margin applied — Button and Note already ran
  // every prop through this split; Badge was the one surface primitive
  // that did not.
  const [layout, rest] = splitLayoutProps(others as Record<string, unknown>);
  return (
    <span
      ref={ref}
      className={cx("i-badge", `i-badge-${tone}`, className)}
      style={layoutStyle(layout, style)}
      {...rest}
    >
      {children}
    </span>
  );
});
Badge.displayName = "Badge";

/* ── NOTE ─────────────────────────────────────────────────────────────────
   The callout. A left rule carries the tone rather than a full tinted block,
   so a screen with three notes is still readable.

   A `warn` note is given role="alert" automatically. That is the house rule
   again — an error the pilot cannot hear is not surfaced — and doing it here
   means ~24 call sites cannot each forget it. */
export const Note = React.forwardRef<
  HTMLDivElement,
  WithLayout<"div", { tone?: Tone }>
>(function Note({ tone = "default", className, children, style, ...others }, ref) {
  const [layout, rest] = splitLayoutProps(others as Record<string, unknown>);
  return (
    <div
      ref={ref}
      role={tone === "warn" ? "alert" : undefined}
      className={cx("i-note", `i-note-${tone}`, className)}
      style={layoutStyle(layout, style as React.CSSProperties)}
      {...rest}
    >
      <div>{children}</div>
    </div>
  );
});
Note.displayName = "Note";

/* ── TABLE ────────────────────────────────────────────────────────────────
   THE SCROLL CONTAINER IS PART OF THE COMPONENT.

   docs/RESPONSIVE-CONTRACT.md rule 1 is that the page never scrolls sideways
   — wide content scrolls inside its own frame. Making that a property of the
   table rather than something ~40 call sites each wrap by hand is the only
   version of that rule that survives contact with a deadline. */
export const Table = {
  Root: React.forwardRef<
    HTMLTableElement,
    React.ComponentPropsWithoutRef<"table">
  >(function TableRoot({ className, children, ...rest }, ref) {
    return (
      <div className="i-table-scroll">
        <table ref={ref} className={cx("i-table", className)} {...rest}>
          {children}
        </table>
      </div>
    );
  }),
  Header: "thead" as const,
  Body: "tbody" as const,
  Foot: "tfoot" as const,
  Row: React.forwardRef<
    HTMLTableRowElement,
    React.ComponentPropsWithoutRef<"tr"> & { selected?: boolean }
  >(function TableRow({ selected, ...rest }, ref) {
    return (
      <tr
        ref={ref}
        data-selected={selected ? "true" : undefined}
        {...(rest as React.HTMLAttributes<HTMLTableRowElement>)}
      />
    );
  }),
  /** A column head. Always a <th scope="col"> — that is what makes the
   *  column announce itself when a screen reader reaches a cell. */
  ColumnHead: React.forwardRef<
    HTMLTableCellElement,
    React.ComponentPropsWithoutRef<"th"> & { numeric?: boolean }
  >(function ColumnHead({ numeric, className, ...rest }, ref) {
    return (
      <th
        ref={ref}
        scope="col"
        className={cx(numeric && "i-num", className)}
        {...(rest as React.ThHTMLAttributes<HTMLTableCellElement>)}
      />
    );
  }),
  Cell: React.forwardRef<
    HTMLTableCellElement,
    React.ComponentPropsWithoutRef<"td"> & { numeric?: boolean; wrap?: boolean }
  >(function TableCell({ numeric, wrap, className, ...rest }, ref) {
    return (
      <td
        ref={ref}
        className={cx(numeric && "i-num", wrap && "i-cell-wrap", className)}
        {...(rest as React.TdHTMLAttributes<HTMLTableCellElement>)}
      />
    );
  }),
};

/* ── SEPARATOR / SPINNER ─────────────────────────────────────────────── */
export function Separator({
  vertical,
  className,
}: {
  vertical?: boolean;
  className?: string;
}) {
  return (
    <hr
      className={cx("i-sep", vertical ? "i-sep-v" : "i-sep-h", className)}
      aria-orientation={vertical ? "vertical" : "horizontal"}
    />
  );
}

const SPINNER_PX: Record<ControlSize, string> = { "1": "12px", "2": "16px", "3": "24px" };

export function Spinner({ size = "2", label = "Loading" }: { size?: ControlSize; label?: string }) {
  return (
    <span
      className="i-spinner"
      role="status"
      aria-label={label}
      style={{ width: SPINNER_PX[size], height: SPINNER_PX[size] }}
    />
  );
}
