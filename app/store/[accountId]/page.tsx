import { notFound } from "next/navigation";
import { LAlert, LButton, LCard } from "@/components/ledger";
import { Logo } from "@/components/logo";
import { sampleConnectConfigError } from "@/lib/sample-connect/client";
import { getSampleAccountStatus } from "@/lib/sample-connect/accounts";
import { listSampleProducts, formatAmount } from "@/lib/sample-connect/products";
import { buyProductAction } from "./actions";

/**
 * ===========================================================================
 * SAMPLE CONNECT — the public storefront
 * ===========================================================================
 *
 * One page per merchant, showing their products and letting anyone buy one.
 * No login: these are the merchant's customers, not the platform's users.
 *
 * Ledger's softer marketing variant, same posture as app/vendor/[token]/
 * page.tsx and app/packet/[token]/page.tsx (both unauthenticated, no
 * app-shell chrome) — this page mirrors their root and card structure.
 *
 * ── THE ACCOUNT ID IN THE URL ─────────────────────────────────────────────
 * This route keys off the Stripe account id (`/store/acct_123`) because it
 * makes the sample's data flow obvious at a glance.
 *
 * DO NOT DO THIS IN PRODUCTION. Use your own identifier — a slug the merchant
 * chooses (`/store/blue-ridge-aviation`), or an opaque id you issue — and look
 * the Stripe account up from it server-side. Two reasons:
 *
 *   1. It leaks your Stripe topology. Anyone can enumerate or record which
 *      accounts exist on your platform.
 *   2. It welds a URL your merchants will share and print to an id you do not
 *      control. If an account is ever recreated, every link dies.
 *
 * The lookup would go exactly where `accountId` is read below — everything
 * downstream already takes it as a parameter.
 */

export const dynamic = "force-dynamic";

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;

  // Cheap shape check before spending a Stripe round trip on an obviously
  // wrong id — and it keeps arbitrary strings out of the API call.
  if (!accountId.startsWith("acct_")) notFound();

  const configError = sampleConnectConfigError();
  if (configError) {
    return (
      <div className="min-h-dvh bg-canvas font-ledger text-body text-ink">
        <div className="mx-auto max-w-xl px-4 py-8 sm:px-8 sm:py-12">
          <div className="mb-8">
            <Logo />
          </div>
          <LCard className="p-6 sm:p-8">
            <h1 className="mb-4 text-h3 font-bold text-ink">Store</h1>
            <LAlert tone="warn">{configError}</LAlert>
          </LCard>
        </div>
      </div>
    );
  }

  // Status and products in parallel. Status is read so the page can refuse to
  // take money into an account that cannot settle it — see below.
  const [status, products] = await Promise.all([
    getSampleAccountStatus(accountId).catch(() => null),
    listSampleProducts(accountId).catch(() => []),
  ]);

  // An unknown account id and a Stripe outage look the same from here; both
  // are a 404 for a shopper, which is the honest answer either way.
  if (!status) notFound();

  return (
    <div className="min-h-dvh bg-canvas font-ledger text-body text-ink">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-12">
        <div className="mb-8">
          <Logo />
        </div>

        <div className="mb-6 flex flex-col gap-1">
          <h1 className="text-h1 font-bold tracking-tight text-ink">
            {status.displayName ?? "Store"}
          </h1>
          <p className="text-body-s text-ink-2">
            Payments are processed by {status.displayName ?? "this merchant"} through Stripe.
          </p>
        </div>

        {/* NEVER TAKE MONEY INTO AN ACCOUNT THAT CANNOT RECEIVE IT. Checkout
            would fail anyway, but failing at the Stripe redirect leaves a
            shopper staring at an error page with no idea what happened. */}
        {!status.readyToProcessPayments ? (
          <LAlert tone="warn" className="mb-6">
            This store isn&rsquo;t accepting payments yet.
          </LAlert>
        ) : null}

        {products.length === 0 ? (
          <LCard className="p-6">
            <p className="text-body-s text-ink-2">Nothing for sale here yet.</p>
          </LCard>
        ) : (
          <div className="flex flex-col gap-3">
            {products.map((product) => (
              <LCard key={product.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="text-body font-medium text-ink">{product.name}</span>
                    {product.description ? (
                      <span className="text-body-s text-ink-2">{product.description}</span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="tnum-l text-lead font-bold tracking-tight text-ink">
                      {formatAmount(product.unitAmount, product.currency)}
                    </span>

                    {/* A form, not a link: starting a checkout is a mutation,
                        and a GET that a prefetcher can fire would create
                        Stripe sessions nobody asked for. The action re-reads
                        the price server-side — the browser never supplies an
                        amount. */}
                    <form action={buyProductAction}>
                      <input type="hidden" name="accountId" value={accountId} />
                      <input type="hidden" name="productId" value={product.id} />
                      <LButton
                        type="submit"
                        disabled={!status.readyToProcessPayments || !product.unitAmount}
                      >
                        Buy
                      </LButton>
                    </form>
                  </div>
                </div>
              </LCard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
