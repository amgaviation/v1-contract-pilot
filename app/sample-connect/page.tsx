import Link from "next/link";
import {
  LAlert,
  LButton,
  LCard,
  LPill,
  LSeparator,
  LTable,
  LTd,
  LTh,
  lButtonClass,
} from "@/components/ledger";
import { Logo } from "@/components/logo";
import { requireAccount } from "@/lib/supabase/account";
import { sampleConnectConfigError, APPLICATION_FEE_BASIS_POINTS } from "@/lib/sample-connect/client";
import { getSampleAccountId } from "@/lib/sample-connect/store";
import { getSampleAccountStatus } from "@/lib/sample-connect/accounts";
import { listSampleProducts, formatAmount } from "@/lib/sample-connect/products";
import { getPlatformSubscriptionStatus } from "@/lib/sample-connect/checkout";
import {
  startSampleOnboarding,
  subscribeToPlatformAction,
  openBillingPortalAction,
} from "./actions";
import ProductForm from "./product-form";

/**
 * ===========================================================================
 * SAMPLE CONNECT — the merchant dashboard
 * ===========================================================================
 *
 * One page showing the whole merchant lifecycle:
 *
 *   1. Onboard        create a V2 account + hosted onboarding
 *   2. Status         read live from Stripe, never from our database
 *   3. Products       create them on the connected account
 *   4. Storefront     the public link customers buy from
 *   5. Subscription   the merchant paying the platform, + billing portal
 *
 * Server component: every Stripe read happens here, so no key and no account
 * id logic ever reaches the browser.
 *
 * NOT INSIDE THE AUTHENTICATED SHELL. This route lives outside the (app)
 * route group, so it never renders inside app/(app)/app-shell.tsx — same as
 * app/(onboarding)/onboarding/page.tsx, which is the other authenticated,
 * shell-less Ledger screen in the product. This file follows that layout's
 * shape: its own slim header bar carrying the mark, then Ledger's paper
 * canvas underneath, rather than the softer marketing variant the
 * unauthenticated storefront pages (app/store/[accountId]) use — the
 * "denser app-register" reading fits a dashboard with five independent
 * lifecycle stages better than a portal's single-column card stack.
 *
 * NOTE ON THE DESIGN: this uses the host application's own Ledger primitives
 * (components/ledger) so the sample looks like the rest of the product
 * rather than like a bolt-on. Swap them for plain HTML if you are lifting
 * this into a different codebase — nothing here depends on them.
 */

// Always dynamic: the whole point is live status. A cached render would show
// a merchant "onboarding complete" from someone else's request.
export const dynamic = "force-dynamic";

export default async function SampleConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ subscribed?: string; accountId?: string }>;
}) {
  const params = await searchParams;
  const { user } = await requireAccount("/sample-connect");

  // ── Configuration gate ──────────────────────────────────────────────────
  // Render the reason rather than throwing, so an unconfigured deployment
  // explains itself instead of showing a 500.
  const configError = sampleConnectConfigError();
  if (configError) {
    return (
      <div className="min-h-dvh bg-canvas font-ledger text-body text-ink">
        <div className="mx-auto max-w-xl px-4 py-8 sm:px-8 sm:py-12">
          <div className="mb-8">
            <Logo />
          </div>
          <LCard className="p-6 sm:p-8">
            <h1 className="mb-4 text-h3 font-bold text-ink">Sample Connect integration</h1>
            <LAlert tone="warn">{configError}</LAlert>
          </LCard>
        </div>
      </div>
    );
  }

  const accountId = await getSampleAccountId(user.id);

  // Live reads, in parallel. All three are Stripe round trips and none
  // depends on the others.
  const [status, products, subscription] = accountId
    ? await Promise.all([
        getSampleAccountStatus(accountId).catch(() => null),
        listSampleProducts(accountId).catch(() => []),
        getPlatformSubscriptionStatus(accountId).catch(() => ({
          status: null,
          currentPeriodEnd: null,
        })),
      ])
    : [null, [], { status: null as string | null, currentPeriodEnd: null as number | null }];

  const subscribed = subscription.status === "active" || subscription.status === "trialing";

  return (
    <div className="v1-nozoom-fields min-h-dvh bg-canvas font-ledger text-body text-ink">
      <div className="border-b border-hair bg-card">
        <div className="mx-auto w-full max-w-3xl px-4">
          <div className="flex items-center gap-3 py-3">
            <Logo />
            <span className="text-caption text-ink-3">Sample Connect integration</span>
          </div>
        </div>
      </div>

      <div className="px-4 pb-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 py-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-h1 font-bold tracking-tight text-ink">
              Sample Connect integration
            </h1>
            <p className="text-body-s text-ink-2">
              A working demonstration of Stripe Connect with V2 accounts: onboarding,
              products, a public storefront, and a platform subscription. Separate from
              this product&rsquo;s real Connect integration in Settings — see{" "}
              <code className="text-body-s text-ink-2">docs/SAMPLE-CONNECT.md</code>.
            </p>
          </div>

          {params.subscribed === "1" ? (
            <LAlert tone="good">
              Subscription started. It can take a moment to appear below while Stripe
              finishes processing.
            </LAlert>
          ) : null}

          {/* ── 1 + 2. ONBOARDING AND LIVE STATUS ───────────────────────── */}
          <LCard className="p-5 sm:p-6">
            <h2 className="mb-3 text-h3 font-semibold text-ink">1. Onboarding</h2>

            {!accountId ? (
              <div className="flex flex-col gap-3">
                <p className="text-body-s text-ink-2">
                  You don&rsquo;t have a connected account yet. Creating one takes you
                  straight to Stripe&rsquo;s hosted onboarding.
                </p>
                <form action={startSampleOnboarding}>
                  <LButton type="submit">Onboard to collect payments</LButton>
                </form>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-body-s text-ink-2">Account</span>
                  <code className="text-body-s text-ink">{accountId}</code>
                </div>

                {status ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <LPill tone={status.readyToProcessPayments ? "good" : "warn"}>
                        {status.readyToProcessPayments
                          ? "Ready to take payments"
                          : "Cannot take payments yet"}
                      </LPill>
                      <LPill tone={status.onboardingComplete ? "good" : "warn"}>
                        {status.onboardingComplete
                          ? "Nothing outstanding"
                          : `Requirements ${status.requirementsStatus ?? "due"}`}
                      </LPill>
                    </div>

                    {/* What Stripe still wants, named. "Something is missing"
                        with no list is the least useful onboarding UI there
                        is. */}
                    {status.outstandingRequirements.length ? (
                      <LAlert tone="warn">
                        Stripe still needs: {status.outstandingRequirements.join("; ")}
                      </LAlert>
                    ) : null}

                    {/* The button stays available after onboarding: a merchant
                        whose requirements change later needs to go back in,
                        and each click mints a fresh single-use link. */}
                    <form action={startSampleOnboarding}>
                      <LButton
                        type="submit"
                        variant={status.onboardingComplete ? "outline" : "primary"}
                      >
                        {status.onboardingComplete
                          ? "Review details on Stripe"
                          : "Continue onboarding"}
                      </LButton>
                    </form>
                  </>
                ) : (
                  <LAlert tone="crit">
                    Couldn&rsquo;t read this account&rsquo;s status from Stripe. If the key
                    you are using is in a different mode from the one that created the
                    account, that is the usual cause.
                  </LAlert>
                )}
              </div>
            )}
          </LCard>

          {/* ── 3. PRODUCTS ─────────────────────────────────────────────── */}
          <LCard className="p-5 sm:p-6">
            <h2 className="mb-1 text-h3 font-semibold text-ink">2. Products</h2>
            <p className="mb-4 text-body-s text-ink-2">
              Created on your connected account with the{" "}
              <code className="text-body-s text-ink-2">Stripe-Account</code> header, so
              they belong to you and not to the platform.
            </p>

            <ProductForm disabled={!accountId} />

            <LSeparator />

            {products.length ? (
              <LTable>
                <thead>
                  <tr>
                    <LTh>Product</LTh>
                    <LTh numeric>Price</LTh>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      {/* scope="row": the row-header semantics the old
                          Table.RowHeaderCell carried, per the invoices list
                          idiom. */}
                      <th
                        scope="row"
                        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span>{product.name}</span>
                          {product.description ? (
                            <span className="text-caption font-normal text-ink-3">
                              {product.description}
                            </span>
                          ) : null}
                        </div>
                      </th>
                      <LTd numeric>{formatAmount(product.unitAmount, product.currency)}</LTd>
                    </tr>
                  ))}
                </tbody>
              </LTable>
            ) : (
              <p className="text-body-s text-ink-2">
                {accountId
                  ? "No products yet. Create one above and it appears on your storefront."
                  : "Connect an account first. Products live on the connected account."}
              </p>
            )}
          </LCard>

          {/* ── 4. STOREFRONT ───────────────────────────────────────────── */}
          {accountId ? (
            <LCard className="p-5 sm:p-6">
              <h2 className="mb-1 text-h3 font-semibold text-ink">3. Your storefront</h2>
              <p className="mb-3 text-body-s text-ink-2">
                The public page your customers buy from. No login required. The platform
                takes {(APPLICATION_FEE_BASIS_POINTS / 100).toFixed(2)}% of each sale as
                an application fee; the rest settles into your Stripe balance.
              </p>
              <Link href={`/store/${accountId}`} className={lButtonClass({ variant: "outline" })}>
                Open storefront
              </Link>
              {!status?.readyToProcessPayments ? (
                <LAlert tone="warn" className="mt-3">
                  Finish onboarding before sharing this. Until card payments are
                  active, checkout will fail for your customers.
                </LAlert>
              ) : null}
            </LCard>
          ) : null}

          {/* ── 5. PLATFORM SUBSCRIPTION ────────────────────────────────── */}
          {accountId ? (
            <LCard className="p-5 sm:p-6">
              <h2 className="mb-1 text-h3 font-semibold text-ink">
                4. Your subscription to the platform
              </h2>
              <p className="mb-3 text-body-s text-ink-2">
                Separate money from the storefront above: this is you paying the
                platform. Billed to your connected account directly. With V2 accounts
                one id is both the account and the customer.
              </p>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <LPill tone={subscribed ? "good" : "neutral"}>
                  {subscription.status ? `Subscription ${subscription.status}` : "Not subscribed"}
                </LPill>
                {subscription.currentPeriodEnd ? (
                  <span className="text-caption text-ink-3">
                    Renews {new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString()}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-3">
                {!subscribed ? (
                  <form action={subscribeToPlatformAction}>
                    <LButton type="submit">Subscribe</LButton>
                  </form>
                ) : null}
                <form action={openBillingPortalAction}>
                  <LButton type="submit" variant="outline">
                    Manage billing
                  </LButton>
                </form>
              </div>
            </LCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
