"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type SignUpState = { error: string | null; needsConfirmation?: boolean };

export async function signUp(
  _prev: SignUpState,
  formData: FormData
): Promise<SignUpState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  // Constrain the account-type toggle to the two known values rather than
  // trusting the posted string: it seeds accounts.kind at provisioning, so
  // an unexpected value would violate that column's CHECK. Anything that
  // isn't "business" falls back to "solo" — the floor, same rule the
  // webhook uses.
  const accountKind =
    String(formData.get("account_kind") ?? "") === "business"
      ? "business"
      : "solo";
  const homeBase = String(formData.get("home_base") ?? "").trim().toUpperCase();

  if (!email || !password) {
    return { error: "Enter your email and a password." };
  }
  if (!fullName) {
    return { error: "Enter your name so we can set up your account." };
  }
  if (password.length < 8) {
    return { error: "Use at least 8 characters for your password." };
  }

  const supabase = await createClient();
  // The identity fields ride in user_metadata (Supabase's raw_user_meta_data).
  // This is PREFILL for provisioning, never an authorization input — the
  // webhook reads it once to name the account and seed kind/home_base, and
  // nothing in an RLS policy or entitlement check ever consults it. (The
  // account's real kind lives in pilot.accounts, service_role-written; see
  // lib/stripe/provisioning.ts.)
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        account_kind: accountKind,
        home_base: homeBase || null,
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  // When email confirmation is enabled on the Supabase project, signUp
  // returns a user with no session — the pilot must click the link before
  // they can do anything. Say so plainly instead of redirecting into a
  // gate that would just bounce them back to /login.
  if (!data.session) {
    return { error: null, needsConfirmation: true };
  }

  // Session established: they're authenticated but have no tenant yet, so
  // /welcome (which offers the trial checkout) is the right landing spot.
  redirect("/welcome");
}
