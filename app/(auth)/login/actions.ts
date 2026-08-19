"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-next";

export type SignInState = { error: string | null };


export async function signIn(
  _prev: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? "/"));

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // The one specific case: a CORRECT password on an address that hasn't
    // confirmed yet. Supabase only returns email_not_confirmed when the
    // credentials matched, so the caller already owns the address and
    // "this address needs confirming" discloses nothing new to them —
    // while the generic sentence below would tell a pilot their correct
    // password was wrong, which compounds a broken-confirmation loop into
    // "the product lost my account". A wrong password on an unconfirmed
    // address still returns invalid_credentials and stays generic.
    if (error.code === "email_not_confirmed") {
      return {
        error:
          "That email address hasn't been confirmed yet. Open the link we emailed you — or sign up again with the same address and we'll offer to resend it.",
      };
    }
    // Deliberately generic: never disclose whether the email exists.
    return { error: "Those credentials didn't match. Check them and try again." };
  }

  redirect(next);
}
