import { LAlert, LButton, LSeparator, LSpinner, type LButtonProps } from "@/components/ledger";
import { cn } from "@/lib/ledger/cn";

/**
 * The pieces every auth screen is built from, so the five of them read as
 * one product rather than five forms that happen to share a stylesheet.
 *
 * LEDGER PASS: this file used to compose Radix (components/ui); it is now
 * plain elements styled with Ledger's Tailwind utilities and `cn()`-free
 * (nothing here needs conditional classes). No hooks and no event handlers
 * — presentation only, which is why the file still carries no "use client"
 * directive: it compiles into whichever graph imports it (the form
 * components are client, the welcome page is server) instead of forcing a
 * boundary on either.
 *
 * The layout (../layout.tsx) supplies the canvas and the measure. These
 * supply the hierarchy inside it: one heading, one supporting line, fields
 * grouped with real space between them, one strong primary action, and
 * secondary links pushed below a rule where they cannot compete with it.
 */

/** The heading block. One h1 per screen, one supporting line, no more. */
export function AuthHeading({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-h1 font-bold text-ink">{title}</h1>
      {children ? <p className="text-body-s text-ink-2">{children}</p> : null}
    </div>
  );
}

/**
 * A labelled field. The hint carries its own id (`${id}-hint`) so the
 * caller can wire it to the control with aria-describedby exactly as every
 * call site already does — the label/hint/control spacing is set once here
 * so no screen drifts into its own rhythm. Not LField (components/ledger/
 * forms.tsx): that primitive has no id on its hint line, and this wiring is
 * load-bearing accessibility behavior this migration must not drop.
 */
export function Field({
  id,
  label,
  hint,
  optional = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-s font-medium text-ink">
        {label}
        {optional ? <span className="font-normal text-ink-3"> (optional)</span> : null}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="text-caption text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * THE ERROR STATE, and it is always rendered — an empty live region that
 * already exists announces its first message; one that appears at the same
 * moment often does not. So the region is permanent and only its contents
 * change, and a failed submit never shifts the form under the cursor by
 * more than the callout itself.
 */
export function FormError({ message }: { message: string | null }) {
  return (
    <div role="alert" aria-live="polite">
      {message ? (
        <LAlert tone="crit" className="flex items-start gap-2">
          <AlertTriangleIcon className="mt-0.5 shrink-0 text-crit" />
          <span>{message}</span>
        </LAlert>
      ) : null}
    </div>
  );
}

/**
 * The one primary action per screen. `pending` swaps the label for a
 * spinner+busy-label pair rather than merely disabling the button, so a
 * submit cannot be double-fired and the wait is visible rather than
 * inferred. `size="lg"` is Ledger's 44px control — the touch-target floor
 * the old size="3" style prop used to state by hand.
 */
export function SubmitButton({
  pending,
  idle,
  busy,
  variant = "primary",
  className,
  ...rest
}: {
  pending: boolean;
  idle: string;
  busy: string;
} & Omit<LButtonProps, "type" | "children">) {
  return (
    <LButton
      type="submit"
      size="lg"
      variant={variant}
      disabled={pending}
      className={cn("w-full rounded-full", className)}
      {...rest}
    >
      {pending ? (
        <>
          <LSpinner
            className={
              variant === "primary"
                ? "border-accent-ink/40 border-t-accent-ink"
                : undefined
            }
            label={busy}
          />
          {busy}
        </>
      ) : (
        idle
      )}
    </LButton>
  );
}

/**
 * THE FORM'S SEAT — the marketing surface's double-bezel tray
 * (app/design/marketing.css: a machined outer rim, a white inner core
 * with a concentric radius), replacing the bare LCard every screen used
 * to render. Same treatment the product screenshots get on the landing
 * page, which is the point: the form a pilot fills in looks like the
 * hardware the site has been showing them. Presentation only, no hooks —
 * compiles into server and client graphs alike, same as everything else
 * in this file.
 */
export function AuthCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mkt-tray">
      <div className={cn("mkt-tray-core flex flex-col gap-6 p-6 sm:p-8", className)}>
        {children}
      </div>
    </div>
  );
}

/** Secondary links, below a rule and deliberately quiet. */
export function AuthFooter({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <LSeparator className="mb-4" />
      <div className="flex flex-col items-center gap-2 text-center">{children}</div>
    </div>
  );
}
