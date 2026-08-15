"use client";

import { useState, useTransition } from "react";
import NextLink from "next/link";
import { LButton, LCard, LPill, LSeparator } from "@/components/ledger";
import { LConfirmDialog } from "@/components/ledger/dialog";
import { cn } from "@/lib/ledger/cn";
import { setInvoiceRemindersSuppressed, createLateFeeInvoice } from "../reminder-actions";
import {
  NO_CLIENT_LATE_FEE_NOTICE,
  NO_CLIENT_REMINDER_NOTICE,
} from "@/lib/invoice-bill-to";

/**
 * WHAT THE SCHEDULER IS GOING TO DO, ON THE SCREEN, BEFORE IT DOES IT.
 *
 * This panel exists because a job that emails somebody else's client on a
 * pilot's behalf is only acceptable if the pilot can see exactly what it will
 * send and when, and stop it in one press. Everything here is derived at
 * render time from the same pure functions the run itself uses
 * (lib/reminders/policy.ts) — there is no second implementation of "what is
 * due" that could drift from the one that sends.
 *
 * It renders for issued, unpaid invoices only; the invoice screen decides
 * that, matching the statuses the run itself will act on.
 */

export type ReminderRungView = {
  key: string;
  /** "7 days past due" */
  label: string;
  /** The calendar day it comes due, already formatted. */
  when: string;
  /**
   * FIVE STATES, AND THE THREE UNHAPPY ONES SAY DIFFERENT THINGS.
   *
   *   'retrying': it definitely did not send, and it is coming back on the
   *     next run. Nothing reached the client.
   *   'failed': it definitely did not send and the attempts are used up.
   *     Nothing reached the client and nothing more will be tried for this
   *     step.
   *   'unknown': the mail service stopped answering part way through, so this
   *     may or may not be in the client's inbox. It is never tried again,
   *     because a second copy of one chase is worse than a missed one.
   */
  state: "sent" | "failed" | "retrying" | "unknown" | "skipped" | "upcoming";
  /** The mail service's words on a failure, or why it was skipped. */
  detail: string | null;
  /** When the row was written, already formatted. */
  at: string | null;
  /** How many times sending this one has been attempted and refused. */
  attempts: number | null;
};

export type LateFeeView = {
  /** The pilot's own agreed terms, in a sentence. Null when none agreed. */
  policy: string | null;
  /** What it comes to today, if anything is chargeable. */
  quote: string | null;
  /** Fee invoices already raised against this one. */
  raised: { id: string; number: string | null; amount: string; when: string }[];
};

/**
 * A LEDGER-SKINNED TOGGLE, LOCAL TO THIS FILE. There is no LSwitch in
 * components/ledger yet — the primitive layer's own header says
 * interactive controls are added "when a migrated screen first needs one"
 * rather than spun up speculatively, and this is the first Ledger screen
 * that needs one. Built on a plain `<button role="switch">` rather than a
 * checkbox: it is a single on/off action fired immediately (via
 * setInvoiceRemindersSuppressed below), not a value collected into a form
 * submission, which is exactly the semantic native ARIA switches exist
 * for. cn() only, no i- classes, no var(), no arbitrary-px utilities — the
 * same constraints as every other migrated file.
 */
function LSwitch({
  checked,
  onCheckedChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        checked ? "bg-accent" : "border border-hair-strong bg-sunk"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-4 rounded-full bg-card shadow-card transition-transform",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
}

export default function ReminderPanel({
  invoiceId,
  clientName,
  clientId,
  noClient,
  suppressed: initialSuppressed,
  scheduleIsEmpty,
  rungs,
  nextUp,
  hold,
  canEmail,
  clientHasEmail,
  lateFee,
  manualSends,
}: {
  invoiceId: string;
  clientName: string;
  /** Null when this invoice bills typed details rather than a saved client. */
  clientId: string | null;
  /**
   * This invoice has no client, so the scheduled run never reaches it: it
   * filters clientless invoices out explicitly (lib/reminders/run.ts). The
   * panel says that outright instead of rendering a ladder that would never
   * advance and a "Set a schedule" link that leads nowhere.
   */
  noClient: boolean;
  suppressed: boolean;
  /** This client has no reminder schedule at all — the default state. */
  scheduleIsEmpty: boolean;
  rungs: ReminderRungView[];
  /** "The next reminder goes out on Oct 4." — null when nothing is pending. */
  nextUp: string | null;
  /** Why nothing is going out right now, when something otherwise would. */
  hold: string | null;
  canEmail: boolean;
  clientHasEmail: boolean;
  lateFee: LateFeeView;
  /** Reminders the pilot sent by hand, newest first, already formatted. */
  manualSends: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [suppressed, setSuppressed] = useState(initialSuppressed);
  const [error, setError] = useState<string | null>(null);
  const [lateFeeOpen, setLateFeeOpen] = useState(false);

  return (
    <LCard>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-h3 font-semibold">Reminders</div>
        {suppressed ? <LPill tone="neutral">Off for this invoice</LPill> : null}
      </div>

      {noClient ? (
        <p className="text-body-s text-ink-3">{NO_CLIENT_REMINDER_NOTICE}</p>
      ) : scheduleIsEmpty ? (
        <p className="text-body-s text-ink-3">
          Nothing goes out automatically for {clientName}.{" "}
          <NextLink href={`/clients/${clientId}`} className="text-accent underline">
            Set a schedule
          </NextLink>{" "}
          if you want reminders sent for them, or send one now from the panel
          above.
        </p>
      ) : (
        <>
          {/* THE SWITCH FIRST, because "stop chasing this one" is the reason a
              pilot opens this panel in a hurry. */}
          <div className="mb-3 flex items-center gap-2">
            <LSwitch
              checked={!suppressed}
              disabled={pending}
              ariaLabel={`Automatic reminders for this invoice, ${suppressed ? "off" : "on"}`}
              onCheckedChange={(value) => {
                const next = value !== true;
                setSuppressed(next);
                startTransition(async () => {
                  setError(null);
                  const result = await setInvoiceRemindersSuppressed(invoiceId, next);
                  if (result.error) {
                    // Put it back: the screen must not show a state the
                    // database refused.
                    setSuppressed(!next);
                    setError(result.error);
                  }
                });
              }}
            />
            <span className="text-body-s">
              {suppressed
                ? "Paused. No scheduled reminder will go out for this invoice."
                : `Follow ${clientName}'s schedule for this invoice.`}
            </span>
          </div>

          {!canEmail ? (
            <p className="mb-2 text-caption text-warn">
              Emailing isn&rsquo;t set up on this account yet, so scheduled
              reminders can&rsquo;t be sent. Nothing is marked as sent, and
              anything due will go out once it is.
            </p>
          ) : !clientHasEmail ? (
            <p className="mb-2 text-caption text-warn">
              {clientName} has no email address on file, so nothing can be sent.
              Add one on their page.
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            {rungs.map((rung) => (
              <div key={rung.key} className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-body-s">{rung.label}</span>
                  <span className="text-caption text-ink-3">
                    {rung.when}
                    {rung.at ? ` · ${rung.at}` : ""}
                  </span>
                  {rung.detail ? (
                    <span
                      className={cn(
                        "text-caption",
                        rung.state === "failed"
                          ? "text-crit"
                          : rung.state === "retrying" || rung.state === "unknown"
                            ? "text-warn"
                            : "text-ink-3"
                      )}
                    >
                      {rung.detail}
                    </span>
                  ) : null}
                  {/* WHAT HAPPENS NEXT, in the pilot's own terms. The line
                      above is the mail service's words about the last
                      attempt; this one says what this product is going to do
                      about them, which is the part they can act on. */}
                  {rung.state === "retrying" ? (
                    <span className="text-caption text-ink-3">
                      Nothing reached {clientName}. This one is tried again on
                      the next run.
                    </span>
                  ) : rung.state === "failed" ? (
                    <span className="text-caption text-ink-3">
                      Nothing reached {clientName} after{" "}
                      {rung.attempts ?? 0} attempt
                      {(rung.attempts ?? 0) === 1 ? "" : "s"}, so this step is
                      being left alone. Later reminders in the schedule still
                      go out.
                    </span>
                  ) : rung.state === "unknown" ? (
                    <span className="text-caption text-ink-3">
                      We can&rsquo;t tell whether this one reached{" "}
                      {clientName}. Check with them before sending it again,
                      and mark the invoice by hand if it did arrive. It
                      won&rsquo;t be tried again on its own.
                    </span>
                  ) : null}
                </div>
                <LPill tone={STATE_TONE[rung.state]}>{STATE_LABEL[rung.state]}</LPill>
              </div>
            ))}
          </div>

          {hold ? (
            <p className="mt-3 text-caption text-ink-3">{hold}</p>
          ) : nextUp ? (
            <p className="mt-3 text-caption text-ink-3">{nextUp}</p>
          ) : null}
        </>
      )}

      {manualSends.length > 0 ? (
        <div className="mt-3">
          <p className="text-caption text-ink-3">Sent by hand: {manualSends.join(", ")}</p>
        </div>
      ) : null}

      {/* ------------------------------------------------------------------
          THE LATE FEE. Shown only when the pilot has agreed one with this
          client — there is no "set up a late fee" prompt here, deliberately.
          A product that suggests charging somebody's client extra is making a
          commercial decision it has no standing to make.
          ------------------------------------------------------------------ */}
      {noClient ? (
        <>
          <LSeparator className="my-4" />
          <p className="mb-1 text-body-s font-medium">Late fee</p>
          <p className="text-caption text-ink-3">{NO_CLIENT_LATE_FEE_NOTICE}</p>
        </>
      ) : null}

      {!noClient && lateFee.policy ? (
        <>
          <LSeparator className="my-4" />
          <p className="mb-1 text-body-s font-medium">Late fee</p>
          <p className="text-caption text-ink-3">{lateFee.policy}</p>

          {lateFee.raised.length > 0 ? (
            <div className="mt-2">
              {lateFee.raised.map((fee) => (
                <p className="text-caption text-ink-3" key={fee.id}>
                  {fee.amount} raised {fee.when}:{" "}
                  <NextLink href={`/invoices/${fee.id}`} className="text-accent underline">
                    {fee.number ?? "draft invoice"}
                  </NextLink>
                </p>
              ))}
            </div>
          ) : null}

          {lateFee.quote ? (
            <div className="mt-3">
              <p className="mb-2 text-body-s">{lateFee.quote}</p>
              <LButton
                type="button"
                variant="outline"
                disabled={pending}
                className="w-full"
                onClick={() => setLateFeeOpen(true)}
              >
                Draft a late fee invoice
              </LButton>
              <LConfirmDialog
                open={lateFeeOpen}
                onOpenChange={setLateFeeOpen}
                title={`Draft a late fee invoice for ${clientName}?`}
                // SPELLS OUT EVERY CONSEQUENCE, because this is the one
                // action in the feature that creates a billable document.
                // It says what it makes (a draft), what it does not touch
                // (this invoice), and who sends it (them).
                description={
                  <>
                    This creates a SEPARATE draft invoice for {lateFee.quote}. It
                    does not change this invoice, which stays exactly as your
                    client received it. Nothing is sent: you review the draft and
                    send it yourself, like any other invoice. Only do this if the
                    fee is in what you agreed with them.
                  </>
                }
                confirmLabel="Create the draft"
                confirmVariant="primary"
                pending={pending}
                onConfirm={() => {
                  // Closes the instant it's pressed, exactly as Radix's
                  // AlertDialog.Action always did — not gated on the async
                  // result. On success createLateFeeInvoice redirects to
                  // the new draft and never returns a value, so this
                  // component is gone before it matters anyway.
                  setLateFeeOpen(false);
                  startTransition(async () => {
                    setError(null);
                    const result = await createLateFeeInvoice(invoiceId);
                    setError(result?.error ?? null);
                  });
                }}
              />
            </div>
          ) : (
            <p className="mt-2 text-caption text-ink-3">Nothing to charge yet.</p>
          )}
        </>
      ) : null}

      {error ? (
        <div className="mt-3" role="alert">
          <p className="text-caption font-medium text-crit">{error}</p>
        </div>
      ) : null}
    </LCard>
  );
}

const STATE_LABEL: Record<ReminderRungView["state"], string> = {
  sent: "Sent",
  failed: "Didn't send",
  retrying: "Trying again",
  unknown: "Not confirmed",
  skipped: "Skipped",
  upcoming: "Scheduled",
};

const STATE_TONE: Record<
  ReminderRungView["state"],
  "good" | "crit" | "neutral" | "accent" | "warn"
> = {
  sent: "good",
  // Crit is for the one that is over: nothing reached the client and nothing
  // more will. A retry is warn because it is still in progress, and an
  // unconfirmed send is warn because it is a question rather than a fault.
  failed: "crit",
  retrying: "warn",
  unknown: "warn",
  skipped: "neutral",
  upcoming: "accent",
};
