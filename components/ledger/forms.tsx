import * as React from "react";
import { cn } from "@/lib/ledger/cn";

/**
 * LEDGER form primitives — built once, ahead of Phase 3, because every
 * money screen needs them and four parallel migrations would otherwise
 * each invent their own.
 *
 * Same shape rules as index.tsx (read its header), plus the form-specific
 * ones:
 *
 *   - PLAIN ELEMENTS, no state. Every screen in this app posts through
 *     server actions with useActionState at the call site; these
 *     primitives are the skin on native controls, so they compose into
 *     client forms without being client components themselves.
 *   - NATIVE CONTROLS SURVIVE. <select> stays a real select (the ds/
 *     system proved why); appearance-none + an inline chevron restores
 *     the Ledger look without touching behavior. No preflight means UA
 *     defaults are live — every neutralization is explicit here.
 *   - 15px control text (text-body): clears iOS Safari's 16px focus-zoom
 *     threshold via the shell's v1-nozoom-fields for the sizes below it,
 *     and is the Ledger scale's body size — the 90% INSTRUMENT hack has
 *     no equivalent here and must never grow one.
 *   - Error wiring is the CALLER's: pass aria-invalid / aria-describedby
 *     at the call site exactly as the INSTRUMENT screens already do —
 *     these primitives forward all props.
 */

const CONTROL =
  "w-full rounded-control border border-hair-strong bg-card px-3 text-body text-ink " +
  "placeholder:text-ink-3 " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent " +
  "disabled:opacity-50 disabled:pointer-events-none " +
  "aria-[invalid=true]:border-crit";

export const LInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function LInput({ className, ...props }, ref) {
  return <input ref={ref} className={cn(CONTROL, "h-9", className)} {...props} />;
});

export const LTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function LTextarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(CONTROL, "min-h-20 py-2 leading-normal", className)}
      {...props}
    />
  );
});

/**
 * Native select, Ledger skin. appearance-none removes the UA chrome; the
 * chevron is an inline SVG sibling (not a background-image URL, which
 * would be a value the token verifier can't read) positioned over the
 * control's right padding. The wrapper is inline-grid so the chevron
 * overlays without a positioned ancestor leaking out.
 */
export const LSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function LSelect({ className, children, ...props }, ref) {
  return (
    <span className={cn("relative inline-grid w-full", className)}>
      <select
        ref={ref}
        className={cn(CONTROL, "h-9 appearance-none pr-8")}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
});

export const LCheckbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(function LCheckbox({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "size-4 shrink-0 rounded-sm border border-hair-strong bg-card accent-accent " +
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent " +
          "disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});

/**
 * Label + control + hint/error column — the one field arrangement every
 * money form repeats. The label is a real <label>; pass htmlFor. Error
 * text renders in crit and the caller keeps owning aria-describedby
 * wiring on the control (see the file header).
 */
export function LField({
  label,
  htmlFor,
  hint,
  error,
  errorId,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** id for the error line, so the caller can aria-describedby it. */
  errorId?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-body-s font-medium text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-caption text-ink-3">{hint}</p> : null}
      {error ? (
        <p id={errorId} className="text-caption font-medium text-crit">
          {error}
        </p>
      ) : null}
    </div>
  );
}
