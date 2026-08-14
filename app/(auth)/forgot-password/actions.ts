"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export type ForgotPasswordState = { error: string | null; sent: boolean };

export async function requestPasswordReset(
  _prev: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { error: "Enter the email address on your account.", sent: false };
  }

  // NEXT_PUBLIC_APP_URL first, same as connect-actions.ts's
  // startConnectOnboarding: a reset link built from the request's Origin
  // header is the classic reset-poisoning shape (a forged Host/Origin pair
  // producing an attacker-hosted link that still looks like this site's own
  // email). Falling back to the Host header rather than Origin when the env
  // var is unset matches the one other place this codebase already builds
  // an absolute URL from the request — Vercel routes by Host, so a forged
  // pair never reaches the app in the first place.
  const requestHeaders = await headers();
  const origin =
    process.env.NEXT_PUBLIC_APP_URL ?? `https://${requestHeaders.get("host")}`;

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    // The emailed link lands on the verify handler, which turns the
    // one-time token into a session and only then forwards to the form
    // that sets the new password.
    redirectTo: `${origin}/auth/confirm?next=/reset-password`,
  });

  // Reported as sent no matter what came back. Distinguishing "we sent
  // it" from "no such account" would turn this form into an account
  // enumeration oracle, which matches the deliberately generic failure
  // in login/actions.ts. A genuine delivery failure is visible in the
  // Supabase auth logs, not here.
  return { error: null, sent: true };
}
