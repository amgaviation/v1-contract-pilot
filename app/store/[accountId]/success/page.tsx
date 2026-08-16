import Link from "next/link";
import { LAlert, LCard, lButtonClass } from "@/components/ledger";
import { Logo } from "@/components/logo";
import { getStorefrontSession } from "@/lib/sample-connect/checkout";
import { formatAmount } from "@/lib/sample-connect/products";

/**
 * Post-checkout confirmation.
 *
 * ── DO NOT FULFIL ORDERS FROM THIS PAGE ───────────────────────────────────
 * Reaching this URL is not proof of payment. A shopper can bookmark it, share
 * it, or simply navigate here, and an asynchronous method (bank debits, some
 * wallets) can still fail days after the redirect. The page reads the session
 * back from Stripe and shows its ACTUAL `payment_status` rather than assuming.
 *
 * Real fulfilment belongs in a webhook — `checkout.session.completed` plus
 * `checkout.session.async_payment_succeeded` / `…_failed`, registered on the
 * CONNECTED ACCOUNTS scope, because these are direct charges on the
 * merchant's account. The production integration in this same codebase does
 * exactly that in app/api/stripe/connect-webhook/route.ts, and its header
 * explains the async-payment trap in detail.
 *
 * Ledger's softer marketing variant, same root as this route's own storefront
 * page and app/vendor/[token]/page.tsx / app/packet/[token]/page.tsx.
 */

export const dynamic = "force-dynamic";

export default async function StorefrontSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { accountId } = await params;
  const { session_id: sessionId } = await searchParams;

  // Scoped to the connected account: the session lives on THEIR account, so
  // a platform-scoped retrieve would 404.
  const session = sessionId ? await getStorefrontSession(accountId, sessionId) : null;

  const paid = session?.payment_status === "paid";
  const pending = session?.payment_status === "unpaid" && session?.status === "complete";

  return (
    <div className="min-h-dvh bg-canvas font-ledger text-body text-ink">
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-8">
          <Logo />
        </div>

        <h1 className="mb-6 text-h1 font-bold tracking-tight text-ink">Thank you</h1>

        {!session ? (
          <LAlert tone="warn" className="mb-6">
            We couldn&rsquo;t find that checkout session. If you were charged, your
            receipt from Stripe is the record. Nothing here changes it.
          </LAlert>
        ) : (
          <LCard className="mb-6 p-6 sm:p-8">
            <p className="mb-2 text-body-s text-ink-2">
              {paid
                ? "Payment received."
                : pending
                  ? "Payment started. Some methods take a few business days to settle. You'll get a receipt from Stripe when it does."
                  : `Payment status: ${session.payment_status}`}
            </p>
            {session.amount_total !== null ? (
              <p className="tnum-l text-figure font-bold tracking-tight text-ink">
                {formatAmount(session.amount_total, session.currency ?? "usd")}
              </p>
            ) : null}
          </LCard>
        )}

        <Link href={`/store/${accountId}`} className={lButtonClass({ variant: "outline" })}>
          Back to the store
        </Link>
      </div>
    </div>
  );
}
