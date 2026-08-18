"use client";

import { useActionState } from "react";
import NextLink from "next/link";
import { LAlert, LCard } from "@/components/ledger";
import { RESEND_SENT_MESSAGE } from "@/lib/auth/confirmation";
import { AuthFooter, FormError, SubmitButton } from "../auth-parts";
import { resendConfirmation, type ResendState } from "../resend-actions";

const initialState: ResendState = { error: null, sent: false };

function MailIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
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
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

/**
 * The resend form carries NO email field: the action reads the address from
 * the httpOnly pending-signup cookie that got the pilot to this screen. A
 * field here would be an address the caller chooses, which is the account
 * enumeration shape resend-actions.ts's header rules out.
 */
export default function CheckEmailView({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(
    resendConfirmation,
    initialState
  );

  return (
    <LCard className="flex flex-col gap-6 p-6 sm:p-8">
      <div className="flex flex-col items-start gap-3">
        <MailIcon className="text-accent" />
        <h1 className="text-h1 font-bold text-ink">Check your email</h1>
        <p className="text-body-s text-ink-2">
          Open the link we sent to{" "} <span className="font-medium text-ink">{email}</span>, then pick your plan. It works once and expires.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        {state.sent ? <LAlert tone="good">{RESEND_SENT_MESSAGE}</LAlert> : null}

        <FormError message={state.error} />

        <SubmitButton pending={pending} idle="Send it again" busy="Sending…" variant="outline" />
      </form>

      <AuthFooter>
        <p className="text-body-s text-ink-2">
          Wrong address?{" "}
          <NextLink href="/signup" className="font-medium text-accent hover:underline">
            Sign up again
          </NextLink>
        </p>
        <NextLink href="/login" className="text-body-s font-medium text-accent hover:underline">
          Back to sign in
        </NextLink>
      </AuthFooter>
    </LCard>
  );
}
