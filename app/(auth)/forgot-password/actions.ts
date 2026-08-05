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

  const origin = (await headers()).get("origin");
  if (!origin) {
    return {
      error: "Couldn't determine this app's address. Try again.",
      sent: false,
    };
  }

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
