"use client";

import * as React from "react";
import { cx } from "@/lib/ds/props";
import { Button, type ButtonVariant } from "./surface";

/**
 * INSTRUMENT — Dialog, on the native `<dialog>` element.
 *
 * WHY NATIVE, AND WHY THAT IS THE MORE FROM-SCRATCH ANSWER.
 *
 * A modal has to do four things correctly, and each one is a well-known
 * source of accessibility bugs when hand-rolled:
 *
 *   focus trapping        Tab must not escape to the page behind
 *   inert background      the page behind must not be reachable or read out
 *   the top layer         it must paint above every stacking context, with
 *                         no z-index arms race
 *   Escape to close       and returning focus to whatever opened it
 *
 * `showModal()` does all four, in the browser, correctly, with no JavaScript
 * of ours and no dependency. A div-with-a-backdrop reimplements them and
 * typically gets two right. So this is not "we skipped building a dialog" —
 * it is the platform primitive doing the part that is genuinely hard, with
 * this file supplying the design system's skin and API on top.
 *
 * The one thing native does NOT give us is a click-outside-to-close, because
 * `::backdrop` is not an element you can put a handler on. It is implemented
 * below by comparing the click's coordinates against the dialog's own box —
 * see the comment on onClick, which explains why the obvious
 * `e.target === dialog` check is wrong.
 */

/**
 * The bare modal shell: the native element, the design system's skin, and the
 * open/close plumbing — with no opinion about what goes inside.
 *
 * Exported because components/ui's compatibility layer composes its own header
 * and footer out of the old API's Title/Description/Cancel parts, and wrapping
 * `Dialog` (which insists on a title prop) would have meant inventing one.
 */
export function DialogShell({
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
      className={cx("i-dialog", className)}
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

export function Dialog({
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
  // A fixed "i-dialog-title" id meant every Dialog on a page shared one id
  // — a list of N rows each rendering its own confirm dialog put N copies
  // of id="i-dialog-title" in the DOM, and aria-labelledby resolves to the
  // FIRST match in the document regardless of which dialog is open, so a
  // screen reader could announce row 1's title while row 5's dialog was
  // the one actually showing. useId() gives every instance its own.
  const titleId = React.useId();
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      className={className}
      labelledBy={titleId}
    >
      <div className="i-dialog-head">
        <h2 className="i-heading i-t4" id={titleId}>
          {title}
        </h2>
      </div>
      {description !== undefined || children !== undefined ? (
        <div className="i-dialog-body">
          {description}
          {children}
        </div>
      ) : null}
      {footer ? <div className="i-dialog-foot">{footer}</div> : null}
    </DialogShell>
  );
}

/**
 * The confirm-before-destroying pattern, which is the only way this product
 * uses a dialog today (deleting a trip, voiding an invoice).
 *
 * It is a component rather than a documented composition because the details
 * that make a destructive confirmation safe are easy to get subtly wrong and
 * should not be re-decided per call site: the cancel action is the one that
 * gets initial focus, the confirming button is `danger` rather than
 * `primary`, and the confirm label states the ACTION ("Delete trip") instead
 * of "OK" — so a pilot reading only the button still knows what is about to
 * happen.
 */
export function ConfirmDialog({
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
  confirmVariant?: ButtonVariant;
  onConfirm: () => void;
  pending?: boolean;
}) {
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  // Focus the SAFE action when the dialog opens. Native <dialog> autofocuses
  // the first focusable descendant, which here would be the destructive
  // button — so an Enter keypress already in flight when the dialog appears
  // would confirm the deletion. Moving focus to Cancel makes the accidental
  // keypress a no-op.
  React.useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button ref={cancelRef} variant="quiet" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} onClick={onConfirm} disabled={pending}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    />
  );
}
