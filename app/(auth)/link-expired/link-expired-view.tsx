"use client";

import { useActionState, useState } from "react";
import NextLink from "next/link";
import {LAlert, lButtonClass} from "@/components/ledger";
import { LInput } from "@/components/ledger/forms";
import { RESEND_SENT_MESSAGE } from "@/lib/auth/confirmation";
import { AuthCard, AuthFooter, Field, FormError, SubmitButton } from "../auth-parts";
import { resendConfirmation, type ResendState } from "../resend-actions";

const initialState: ResendState = { error: null, sent: false };

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="28"
      height="28"
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

export default function LinkExpiredView({
  flow,
  knownEmail,
}: {
  flow: "signup" | "email-change";
  knownEmail: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    resendConfirmation,
    initialState
  );

  // React 19 resets an uncontrolled form on every action dispatch, the
  // rejected ones included, so a refused resend would otherwise blank the
  // address the pilot just typed.
  const [email, setEmail] = useState("");

  /**
   * AN EMAIL CHANGE CANNOT BE RESENT FROM A SIGNED-OUT SCREEN.
   * `resend({ type: "email_change" })` acts on the signed-in user's pending
   * address, and re-authentication is what authorises the change in the
   * first place (settings/profile-actions.ts). So this half sends them back
   * to the screen that can do it properly rather than offering a control
   * that would fail.
   */
  if (flow === "email-change") {
    return (
      <AuthCard>
        <div className="flex flex-col items-start gap-3">
          <WarningIcon className="text-warn" />
          <h1 className="text-h1 font-bold text-ink">That link has expired</h1>
          <p className="text-body-s text-ink-2">
            Your sign-in address has not changed. Sign in with the address you
            used before and start the change again from Settings.
          </p>
        </div>

        <NextLink href="/settings?tab=profile" className={lButtonClass({ size: "lg", className: "w-full" })}>
          Go to Profile &amp; security
        </NextLink>

        <AuthFooter>
          <NextLink href="/login" className="text-body-s font-medium text-accent hover:underline">
            Back to sign in
          </NextLink>
        </AuthFooter>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <div className="flex flex-col items-start gap-3">
        <WarningIcon className="text-warn" />
        <h1 className="text-h1 font-bold text-ink">That link has expired</h1>
        <p className="text-body-s text-ink-2">
          Confirmation links are single-use and expire. Send yourself a fresh
          one, then open the newest email.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        {/* No field when the pending-signup cookie already names the
            address: the action reads it from there, and a field would be
            an address the caller chooses. */}
        {knownEmail ? (
          <p className="text-body-s text-ink-2">
            Sending to <span className="font-medium text-ink">{knownEmail}</span>.
          </p>
        ) : (
          <Field id="email" label="Email">
            <LInput
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              autoFocus
              required
              disabled={pending}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        )}

        {state.sent ? <LAlert tone="good">{RESEND_SENT_MESSAGE}</LAlert> : null}

        <FormError message={state.error} />

        <SubmitButton pending={pending} idle="Send a new link" busy="Sending…" />
      </form>

      <AuthFooter>
        <p className="text-body-s text-ink-2">
          No account yet?{" "}
          <NextLink href="/signup" className="font-medium text-accent hover:underline">
            Create one
          </NextLink>
        </p>
        <NextLink href="/login" className="text-body-s font-medium text-accent hover:underline">
          Back to sign in
        </NextLink>
      </AuthFooter>
    </AuthCard>
  );
}
