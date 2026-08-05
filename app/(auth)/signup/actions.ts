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

  if (!email || !password) {
    return { error: "Enter your email and a password." };
  }
  if (password.length < 8) {
    return { error: "Use at least 8 characters for your password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

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
