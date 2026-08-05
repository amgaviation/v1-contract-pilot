import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ResetPasswordForm from "./reset-password-form";

export const metadata = { title: "Choose a new password" };

/**
 * Only reachable with a session — normally the one /auth/confirm just
 * minted from the emailed recovery token. Someone who navigates here
 * cold gets sent to request a link rather than shown a form that could
 * only fail on submit.
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/forgot-password");

  return <ResetPasswordForm />;
}
