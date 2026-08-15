import { cookies } from "next/headers";
import { PENDING_SIGNUP_COOKIE } from "@/lib/auth/confirmation";
import LinkExpiredView from "./link-expired-view";

export const metadata = { title: "That link has expired" };

/**
 * WHERE A DEAD CONFIRMATION LINK LANDS. app/auth/confirm/route.ts sends a
 * failed signup or email-change verification here; a failed RECOVERY still
 * goes to /forgot-password?expired=1, which is the screen that can actually
 * issue a new one.
 *
 * `flow` is read from the query string and is not trusted for anything: it
 * only picks which of two sentences and which control to render, and the
 * resend action does its own checks regardless of what this page showed. An
 * unrecognised value falls back to the signup wording, which is the flow
 * that has a way forward from here.
 *
 * KNOWING THE ADDRESS IS OPTIONAL BY DESIGN. An emailed link is often
 * opened on a phone while the signup happened on a laptop, so the
 * pending-signup cookie may not exist in this browser at all. When it does,
 * the resend needs no typing and cannot be pointed anywhere else; when it
 * does not, the form asks for the address and the action answers every
 * outcome identically (see ../resend-actions.ts).
 */
export default async function LinkExpiredPage({
  searchParams,
}: {
  searchParams: Promise<{ flow?: string }>;
}) {
  const { flow } = await searchParams;
  const cookieStore = await cookies();
  const knownEmail = cookieStore.get(PENDING_SIGNUP_COOKIE)?.value?.trim() ?? null;

  return (
    <LinkExpiredView
      flow={flow === "email-change" ? "email-change" : "signup"}
      knownEmail={knownEmail}
    />
  );
}
