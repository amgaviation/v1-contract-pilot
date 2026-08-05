import ForgotPasswordForm from "./forgot-password-form";

export const metadata = { title: "Reset your password" };

/**
 * Deliberately reachable while signed in. A pilot who is signed in on one
 * device but locked out on another still needs this, and bouncing an
 * authenticated session away from it would be a dead end rather than a
 * protection — there is nothing here to protect.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string }>;
}) {
  const { expired } = await searchParams;
  return <ForgotPasswordForm expired={expired === "1"} />;
}
