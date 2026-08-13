import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/supabase/account";
import { DASHBOARD_PATH } from "@/lib/nav";
import { TRIAL_PERIOD_DAYS } from "@/lib/stripe/server";
import SignUpForm from "./signup-form";

export const metadata = { title: "Create your account" };

export default async function SignUpPage() {
  const ctx = await getSessionContext();
  if (ctx?.account) redirect(DASHBOARD_PATH);
  if (ctx) redirect("/welcome");

  // TRIAL_PERIOD_DAYS is read HERE and passed down: lib/stripe/server.ts is
  // `server-only` and the form is a client component. It is the same
  // constant the checkout hands Stripe, so the trial this screen states is
  // the trial the code enforces — same arrangement as the welcome picker.
  return <SignUpForm trialDays={TRIAL_PERIOD_DAYS} />;
}
