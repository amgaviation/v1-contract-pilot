"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SignInState = { error: string | null };

/**
 * Only ever redirect to an app-internal path. A `next` value that isn't a
 * single-leading-slash path (protocol-relative `//evil.com`, an absolute
 * URL, anything else) is discarded in favour of the app root — otherwise
 * the post-login redirect is an open-redirect primitive.
 */
function safeNext(next: string): string {
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

export async function signIn(
  _prev: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? "/"));

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately generic: never disclose whether the email exists.
    return { error: "Those credentials didn't match. Check them and try again." };
  }

  redirect(next);
}
