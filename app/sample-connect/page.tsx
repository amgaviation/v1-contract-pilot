import Link from "next/link";
import {
  Badge,
  Button,
  Callout,
  Card,
  Container,
  Flex,
  Heading,
  Separator,
  Table,
  Text,
} from "@/components/ui";
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
 * NOTE ON THE DESIGN: this uses the host application's own UI primitives
 * (components/ui) so the sample looks like the rest of the product rather
 * than like a bolt-on. Swap them for plain HTML if you are lifting this into
 * a different codebase — nothing here depends on them.
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
      <Container size="2">
        <Flex direction="column" gap="4" py="6">
          <Heading size="6">Sample Connect integration</Heading>
          <Callout.Root color="amber">
            <Callout.Text>{configError}</Callout.Text>
          </Callout.Root>
        </Flex>
      </Container>
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
    <Container size="3">
      <Flex direction="column" gap="5" py="6">
        <Flex direction="column" gap="1">
          <Heading size="6">Sample Connect integration</Heading>
          <Text size="2" color="gray">
            A working demonstration of Stripe Connect with V2 accounts: onboarding,
            products, a public storefront, and a platform subscription. Separate from
            this product&rsquo;s real Connect integration in Settings — see{" "}
            <code>docs/SAMPLE-CONNECT.md</code>.
          </Text>
        </Flex>

        {params.subscribed === "1" ? (
          <Callout.Root color="green" size="1">
            <Callout.Text>
              Subscription started. It can take a moment to appear below while Stripe
              finishes processing.
            </Callout.Text>
          </Callout.Root>
        ) : null}

        {/* ── 1 + 2. ONBOARDING AND LIVE STATUS ───────────────────────── */}
        <Card>
          <Flex direction="column" gap="3" p="1">
            <Heading size="4">1. Onboarding</Heading>

            {!accountId ? (
              <>
                <Text size="2" color="gray">
                  You don&rsquo;t have a connected account yet. Creating one takes you
                  straight to Stripe&rsquo;s hosted onboarding.
                </Text>
                <form action={startSampleOnboarding}>
                  <Button type="submit">Onboard to collect payments</Button>
                </form>
              </>
            ) : (
              <Flex direction="column" gap="3">
                <Flex gap="2" align="center" wrap="wrap">
                  <Text size="2" color="gray">
                    Account
                  </Text>
                  <code>{accountId}</code>
                </Flex>

                {status ? (
                  <>
                    <Flex gap="2" align="center" wrap="wrap">
                      <Badge color={status.readyToProcessPayments ? "green" : "amber"}>
                        {status.readyToProcessPayments
                          ? "Ready to take payments"
                          : "Cannot take payments yet"}
                      </Badge>
                      <Badge color={status.onboardingComplete ? "green" : "amber"}>
                        {status.onboardingComplete
                          ? "Nothing outstanding"
                          : `Requirements ${status.requirementsStatus ?? "due"}`}
                      </Badge>
                    </Flex>

                    {/* What Stripe still wants, named. "Something is missing"
                        with no list is the least useful onboarding UI there
                        is. */}
                    {status.outstandingRequirements.length ? (
                      <Callout.Root color="amber" size="1">
                        <Callout.Text>
                          Stripe still needs: {status.outstandingRequirements.join("; ")}
                        </Callout.Text>
                      </Callout.Root>
                    ) : null}

                    {/* The button stays available after onboarding: a merchant
                        whose requirements change later needs to go back in,
                        and each click mints a fresh single-use link. */}
                    <form action={startSampleOnboarding}>
                      <Button type="submit" variant={status.onboardingComplete ? "outline" : "solid"}>
                        {status.onboardingComplete
                          ? "Review details on Stripe"
                          : "Continue onboarding"}
                      </Button>
                    </form>
                  </>
                ) : (
                  <Callout.Root color="red" size="1">
                    <Callout.Text>
                      Couldn&rsquo;t read this account&rsquo;s status from Stripe. If the key
                      you are using is in a different mode from the one that created the
                      account, that is the usual cause.
                    </Callout.Text>
                  </Callout.Root>
                )}
              </Flex>
            )}
          </Flex>
        </Card>

        {/* ── 3. PRODUCTS ─────────────────────────────────────────────── */}
        <Card>
          <Flex direction="column" gap="3" p="1">
            <Heading size="4">2. Products</Heading>
            <Text size="2" color="gray">
              Created on your connected account with the <code>Stripe-Account</code>{" "}
              header, so they belong to you and not to the platform.
            </Text>

            <ProductForm disabled={!accountId} />

            <Separator size="4" />

            {products.length ? (
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>Product</Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell justify="end">Price</Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {products.map((product) => (
                    <Table.Row key={product.id}>
                      <Table.Cell>
                        <Flex direction="column">
                          <Text size="2">{product.name}</Text>
                          {product.description ? (
                            <Text size="1" color="gray">
                              {product.description}
                            </Text>
                          ) : null}
                        </Flex>
                      </Table.Cell>
                      <Table.Cell justify="end" className="tnum">
                        {formatAmount(product.unitAmount, product.currency)}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            ) : (
              <Text size="2" color="gray">
                {accountId
                  ? "No products yet. Create one above and it appears on your storefront."
                  : "Connect an account first. Products live on the connected account."}
              </Text>
            )}
          </Flex>
        </Card>

        {/* ── 4. STOREFRONT ───────────────────────────────────────────── */}
        {accountId ? (
          <Card>
            <Flex direction="column" gap="3" p="1">
              <Heading size="4">3. Your storefront</Heading>
              <Text size="2" color="gray">
                The public page your customers buy from. No login required. The platform
                takes {(APPLICATION_FEE_BASIS_POINTS / 100).toFixed(2)}% of each sale as
                an application fee; the rest settles into your Stripe balance.
              </Text>
              <Link href={`/store/${accountId}`}>
                <Button variant="outline">Open storefront</Button>
              </Link>
              {!status?.readyToProcessPayments ? (
                <Callout.Root color="amber" size="1">
                  <Callout.Text>
                    Finish onboarding before sharing this. Until card payments are
                    active, checkout will fail for your customers.
                  </Callout.Text>
                </Callout.Root>
              ) : null}
            </Flex>
          </Card>
        ) : null}

        {/* ── 5. PLATFORM SUBSCRIPTION ────────────────────────────────── */}
        {accountId ? (
          <Card>
            <Flex direction="column" gap="3" p="1">
              <Heading size="4">4. Your subscription to the platform</Heading>
              <Text size="2" color="gray">
                Separate money from the storefront above: this is you paying the
                platform. Billed to your connected account directly. With V2 accounts
                one id is both the account and the customer.
              </Text>

              <Flex gap="2" align="center" wrap="wrap">
                <Badge color={subscribed ? "green" : "gray"}>
                  {subscription.status ? `Subscription ${subscription.status}` : "Not subscribed"}
                </Badge>
                {subscription.currentPeriodEnd ? (
                  <Text size="1" color="gray">
                    Renews {new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString()}
                  </Text>
                ) : null}
              </Flex>

              <Flex gap="2" wrap="wrap">
                {!subscribed ? (
                  <form action={subscribeToPlatformAction}>
                    <Button type="submit">Subscribe</Button>
                  </form>
                ) : null}
                <form action={openBillingPortalAction}>
                  <Button type="submit" variant="outline">
                    Manage billing
                  </Button>
                </form>
              </Flex>
            </Flex>
          </Card>
        ) : null}
      </Flex>
    </Container>
  );
}
