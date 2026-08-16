"use client";

import * as React from "react";
import { cn } from "@/lib/ledger/cn";

/**
 * LEDGER — Dialog shell, on the native `<dialog>` element.
 *
 * A LEDGER PORT, NOT A REDESIGN. components/ds/dialog.tsx's header comment
 * lays out why `showModal()` is the right primitive: it gives focus
 * trapping, an inert background, top-layer stacking and Escape-to-close
 * correctly, for free, with no dependency of ours — a hand-rolled
 * div-with-a-backdrop reimplements those four things and typically gets two
 * of them wrong. docs/design/LEDGER.md's Architecture section keeps that
 * decision explicitly for the whole migration ("the native-element
 * decisions INSTRUMENT proved out — dialog via `<dialog>`/showModal, native
 * selects, roving-tabindex tabs — are kept and reskinned when each is first
 * needed by a migrated screen"). So everything below the JSX return is the
 * SAME mechanics as DialogShell — the open/onOpenChange effect that drives
 * showModal()/close(), onClose forwarding to onOpenChange(false), the
 * click-outside geometry check, labelledBy — ported rather than
 * reinterpreted. Only the class list changes.
 *
 * THE CLICK-OUTSIDE CHECK IS COORDINATES, NOT `e.target`, AND HERE IS WHY:
 * `<dialog>` gives no element to attach a handler to for its own
 * `::backdrop` — a click that lands there bubbles with `e.target` set to
 * the dialog itself, which is exactly what `e.target` also is for a click
 * that lands on the dialog's own padding (padding isn't a child element
 * either). `e.target === dialog` alone cannot tell those two clicks apart,
 * so the only way to know whether a click was truly outside the dialog's
 * box is to compare its viewport coordinates against that box directly,
 * via `getBoundingClientRect()`.
 *
 * THIS FILE EXISTS SEPARATELY FROM components/ds/dialog.tsx, RATHER THAN A
 * SHARED IMPORT, because that file is styled with `i-*` classes from a
 * stylesheet Ledger screens never load — the two class combiners (`cx` for
 * INSTRUMENT, `cn` for Ledger) are kept from crossing on purpose (LEDGER.md,
 * Architecture / Guardrails), and a shared component would have had to
 * reach into one system's classes from the other's file.
 *
 * UA DEFAULTS ARE STILL LIVE HERE — READ THIS BEFORE ADDING A UTILITY.
 * ledger.css imports Tailwind's `theme` and `utilities` layers only, never
 * `preflight` (see that file's own header), so the browser's default
 * `<dialog>` stylesheet — a border, ~1em of padding, `margin: auto`
 * centering — is exactly as present on this element as it would be with no
 * class at all. Nothing below is decorative restatement of what the
 * browser already does for free:
 *   - `border border-hair` REPLACES the UA border rather than layering on
 *     top of it. (Author-origin styles always beat user-agent-origin
 *     styles for a normal, non-`!important` declaration regardless of
 *     selector specificity, so this wins even though `dialog:modal`'s own
 *     UA rule is otherwise no less specific.)
 *   - `p-0` removes the UA's ~1em padding — the content this shell wraps
 *     supplies its own (command-palette.tsx's input row and list each
 *     carry their own padding, the same split components/ds/dialog.tsx's
 *     i-dialog-head/-body/-foot made).
 *   - `m-auto` restates the UA's own centering explicitly, so this shell's
 *     centering is a decision recorded here rather than a browser default
 *     this file happens not to disturb.
 *   - `overflow-hidden` clips content to the rounded corners `rounded-card`
 *     draws — with `p-0` handing padding to the content, a full-bleed child
 *     (command-palette.tsx's input row has a bottom hairline that runs
 *     edge-to-edge) would otherwise square off the shell's own corners.
 *   - `font-ledger text-body text-ink` are asserted here rather than
 *     assumed from an ancestor: a `<dialog>` still inherits down the DOM
 *     tree it was authored in (the top layer changes paint order, not the
 *     inheritance chain), but this shell has no guarantee its caller sits
 *     inside a `font-ledger` subtree the way overview/page.tsx's root div
 *     is — command-palette.tsx's own DialogShell usage today is mounted
 *     directly in CommandPaletteProvider, outside any such wrapper.
 */
export function LDialogShell({
  open,
  onOpenChange,
  children,
  className,
  labelledBy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: React.ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cn(
        "m-auto w-full max-w-[480px] overflow-hidden rounded-card border border-hair " +
          "bg-card p-0 font-ledger text-body text-ink shadow-raised " +
          // `ink` is theme-aware (see ledger.css: dark ink is a light
          // tone), so one low-opacity fill reads as a dim scrim in day and
          // a dim scrim in night alike — no separate night value needed.
          "backdrop:bg-ink/20",
        className
      )}
      onClose={() => onOpenChange(false)}
      onClick={(e) => {
        const el = ref.current;
        if (!el || e.target !== el) return;
        const r = el.getBoundingClientRect();
        const inside =
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom;
        if (!inside) onOpenChange(false);
      }}
      aria-labelledby={labelledBy}
    >
      {children}
    </dialog>
  );
}

/* ── Titled dialog and the destructive confirm ─────────────────────── */

/**
 * LDialog and LConfirmDialog port components/ds/dialog.tsx's Dialog and
 * ConfirmDialog onto LDialogShell, keeping the two decisions that file
 * documents at length: a per-instance useId for aria-labelledby (a fixed
 * title id across N row-dialogs made screen readers announce the wrong
 * row's title), and initial focus on the CANCEL button in the confirm
 * (native <dialog> autofocuses the first focusable — the destructive
 * button — so an Enter already in flight would confirm the deletion).
 */
import { LButton, type LButtonProps } from "./index";

export function LDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const titleId = React.useId();
  return (
    <LDialogShell open={open} onOpenChange={onOpenChange} className={className} labelledBy={titleId}>
      <div className="border-b border-hair px-5 py-4">
        <h2 id={titleId} className="text-h3 font-semibold">
          {title}
        </h2>
      </div>
      {description !== undefined || children !== undefined ? (
        <div className="flex flex-col gap-3 px-5 py-4 text-body-s text-ink-2">
          {description}
          {children}
        </div>
      ) : null}
      {footer ? (
        <div className="flex justify-end gap-2 border-t border-hair px-5 py-3">
          {footer}
        </div>
      ) : null}
    </LDialogShell>
  );
}

export function LConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  confirmVariant?: LButtonProps["variant"];
  onConfirm: () => void;
  pending?: boolean;
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  return (
    <LDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          {/* type="button" is load-bearing, not defensive style: a native
              button with no type defaults to type="submit", and a caller
              is free to render this dialog as a sibling of its own <form>
              rather than nested inside it (LDialogShell's <dialog> isn't a
              portal the way Radix's AlertDialog was, so nothing here
              removes it from that form's DOM subtree automatically).
              Without this, Cancel or Confirm would silently submit
              whatever form happens to be nearby. */}
          <LButton
            ref={cancelRef}
            type="button"
            variant="quiet"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </LButton>
          <LButton type="button" variant={confirmVariant} onClick={onConfirm} disabled={pending}>
            {pending ? "Working…" : confirmLabel}
          </LButton>
        </>
      }
    />
  );
}
