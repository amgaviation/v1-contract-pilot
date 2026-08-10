"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DASHBOARD_PATH } from "@/lib/nav";

export type ResetPasswordState = { error: string | null };

export async function setNewPassword(
  _prev: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // Same floor as signup/actions.ts — a reset must not be a way around it.
  if (password.length < 8) {
    return { error: "Use at least 8 characters for your password." };
  }
  if (password !== confirm) {
    return { error: "Those two passwords don't match." };
  }

  const supabase = await createClient();

  // updateUser acts on the session the recovery link established. Without
  // one there is nothing to update, and re-checking here rather than
  // trusting the page's own check keeps the action safe on its own — a
  // server action is a public endpoint, not a private helper of the page
  // that renders the form.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: "That reset link has expired. Request a new one to continue.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }

  redirect(DASHBOARD_PATH);
}
