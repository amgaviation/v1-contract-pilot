import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PENDING_SIGNUP_COOKIE } from "@/lib/auth/confirmation";
import CheckEmailView from "./check-email-view";

export const metadata = { title: "Check your email" };

/**
 * WHERE SIGNUP ENDS when the project confirms email addresses. A real page
 * rather than a panel inside the signup form, because the form has nothing
 * left to do and this state has to survive the reload a pilot performs when
 * the mail is slow.
 *
 * THE ADDRESS COMES FROM AN httpOnly COOKIE, set by signup/actions.ts at
 * the moment it sent the mail, and never from the query string. A writable
 * ?email= would let a stranger produce a link to this product, on this
 * domain, that states in the product's own type that a confirmation was
 * sent to an address of their choosing. See lib/auth/confirmation.ts.
 *
 * No cookie means nobody just signed up in this browser, so there is
 * nothing truthful to say here and the pilot is sent back to the form.
 */
export default async function CheckEmailPage() {
  const cookieStore = await cookies();
  const email = cookieStore.get(PENDING_SIGNUP_COOKIE)?.value?.trim();

  if (!email) redirect("/signup");

  return <CheckEmailView email={email} />;
}
