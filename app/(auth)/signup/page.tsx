import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/supabase/account";
import { DASHBOARD_PATH } from "@/lib/nav";
import { INTRO_FIRST_MONTH_LABEL } from "@/lib/stripe/server";
import SignUpForm from "./signup-form";

export const metadata = { title: "Create your account" };

export default async function SignUpPage() {
  const ctx = await getSessionContext();
  if (ctx?.account) redirect(DASHBOARD_PATH);
  if (ctx) redirect("/welcome");

  // INTRO_FIRST_MONTH_LABEL is read HERE and passed down: lib/stripe/server.ts
  // is `server-only` and the form is a client component. It is the same
  // constant the checkout's coupon is minted from, so the price this screen
  // states is the price the code charges — same arrangement as the picker.
  return <SignUpForm introLabel={INTRO_FIRST_MONTH_LABEL} />;
}
