"use client";

import NextLink from "next/link";
import { useActionState } from "react";
import { LAlert, LButton, LCard, LSeparator } from "@/components/ledger";
import { LField, LInput } from "@/components/ledger/forms";
import {
  deactivateAccount,
  deleteAccount,
  resetAccountData,
  type AccountActionState,
} from "./account-actions";

const initialState: AccountActionState = { error: null, notice: null };

/**
 * THE ACCOUNT TAB — the three ways out.
 *
 * ORDERED BY SEVERITY, LEAST FIRST, and that order is the main piece of
 * design here. A pilot who arrives wanting to "stop paying for this" meets
 * DEACTIVATE first, which is reversible and destroys nothing. They reach
 * DELETE only after passing the two milder answers to the same question.
 * The opposite order — the nuclear option at the top, where the eye lands —
 * converts "I need a break this quarter" into a destroyed account, and the
 * pilot who does that does not come back.
 *
 * THE EXPORT SITS ABOVE ALL THREE. It is the one thing on this tab that
 * cannot be done afterwards, so it is the first thing on it. Not a
 * footnote under the delete button, where it would be read by nobody who
 * still had the option of using it.
 *
 * The two that destroy records ask for the business name to be TYPED. The
 * one that does not destroy anything asks only for the password: making the
 * reversible action as ceremonious as the irreversible one teaches people
 * to type through ceremonies, which is exactly what you do not want them
 * practised at by the time they reach the last card.
 */
export default function AccountPanel({
  legalName,
  isOwner,
}: {
  legalName: string;
  isOwner: boolean;
}) {
  const [resetState, resetAction, resetPending] = useActionState(
    resetAccountData,
    initialState
  );
  const [deactivateState, deactivateAction, deactivatePending] = useActionState(
    deactivateAccount,
    initialState
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteAccount,
    initialState
  );

  // A member or bookkeeper sees why the controls are absent rather than a
  // blank tab — the same courtesy the rest of settings extends. The server
  // actions and the database both refuse them regardless.
  if (!isOwner) {
    return (
      <LCard className="flex flex-col gap-2">
        <h2 className="text-h3 font-semibold text-ink">Account</h2>
        <p className="text-body-s text-ink-2">
          Only the account owner can deactivate, reset or delete this account.
        </p>
      </LCard>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* THE WAY OUT THAT IS NOT DESTRUCTIVE AT ALL. */}
      <LCard className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 font-semibold text-ink">Take your records with you</h2>
          <p className="text-body-s text-ink-2">
            Everything below is permanent. The export writes one CSV per record
            type and works on every plan, whether or not you keep paying.
            Download it first.
          </p>
        </div>
        <div>
          <NextLink
            href="/settings/export"
            className="text-body-s font-medium text-accent hover:underline"
          >
            Export everything →
          </NextLink>
        </div>
      </LCard>

      {/* 1 — DEACTIVATE. Reversible. */}
      <LCard className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 font-semibold text-ink">Deactivate</h2>
          <p className="text-body-s text-ink-2">
            Ends your subscription now and puts the account in read-only. Every
            record is kept and stays exportable, and you can re-subscribe from
            Billing whenever you want it back. Nothing is deleted.
          </p>
          <p className="text-caption text-ink-3">
            The remainder of the period you have already paid for is not
            refunded.
          </p>
        </div>

        {deactivateState.error ? (
          <LAlert tone="crit">{deactivateState.error}</LAlert>
        ) : null}
        {deactivateState.notice ? (
          <LAlert tone="good">{deactivateState.notice}</LAlert>
        ) : null}

        <form action={deactivateAction} className="flex flex-col gap-3">
          <LField label="Your password" htmlFor="deactivate-password">
            <LInput
              id="deactivate-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </LField>
          <div>
            <LButton type="submit" disabled={deactivatePending}>
              {deactivatePending ? "Deactivating…" : "Deactivate account"}
            </LButton>
          </div>
        </form>
      </LCard>

      <LSeparator className="my-1" />

      {/* 2 — RESET. Destroys records, keeps the account. */}
      <LCard className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 font-semibold text-ink">Start over</h2>
          <p className="text-body-s text-ink-2">
            Deletes every record you have entered: clients, trips, invoices,
            estimates, expenses, and your logbook, aircraft and documents. Your
            account, your subscription, your settings and your invoice
            numbering stay exactly as they are.
          </p>
          <p className="text-caption text-ink-3">
            Your invoice numbering deliberately keeps counting, so a future
            invoice can never reuse a number a client has already been sent.
          </p>
        </div>

        <LAlert tone="warn">
          This deletes your logbook. It is the only thing in this product that
          does, and it cannot be undone. Export first.
        </LAlert>

        {resetState.error ? <LAlert tone="crit">{resetState.error}</LAlert> : null}
        {resetState.notice ? <LAlert tone="good">{resetState.notice}</LAlert> : null}

        <form action={resetAction} className="flex flex-col gap-3">
          <LField label="Your password" htmlFor="reset-password">
            <LInput
              id="reset-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </LField>
          <LField
            label={`Type "${legalName}" to confirm`}
            htmlFor="reset-confirm-name"
          >
            <LInput
              id="reset-confirm-name"
              name="confirm_name"
              autoComplete="off"
              placeholder={legalName}
              required
            />
          </LField>
          <div>
            <LButton type="submit" variant="danger" disabled={resetPending}>
              {resetPending ? "Clearing…" : "Clear all records"}
            </LButton>
          </div>
        </form>
      </LCard>

      {/* 3 — DELETE. The end. */}
      <LCard className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3 font-semibold text-ink">Delete this account</h2>
          <p className="text-body-s text-ink-2">
            Ends your subscription and removes the account and every record in
            it. You are signed out and there is nothing to sign back in to.
          </p>
        </div>

        <LAlert tone="crit">
          This cannot be undone and support cannot recover it. If you only want
          to stop paying, deactivate instead: it keeps everything.
        </LAlert>

        {deleteState.error ? <LAlert tone="crit">{deleteState.error}</LAlert> : null}

        <form action={deleteAction} className="flex flex-col gap-3">
          <LField label="Your password" htmlFor="delete-password">
            <LInput
              id="delete-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </LField>
          <LField
            label={`Type "${legalName}" to confirm`}
            htmlFor="delete-confirm-name"
          >
            <LInput
              id="delete-confirm-name"
              name="confirm_name"
              autoComplete="off"
              placeholder={legalName}
              required
            />
          </LField>
          <div>
            <LButton type="submit" variant="danger" disabled={deletePending}>
              {deletePending ? "Deleting…" : "Delete account permanently"}
            </LButton>
          </div>
        </form>
      </LCard>
    </div>
  );
}
