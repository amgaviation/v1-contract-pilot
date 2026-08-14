import { notFound } from "next/navigation";
import { Button, Callout, Card, Container, Flex, Heading, Text } from "@/components/ui";
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
      <Container size="2">
        <Flex direction="column" gap="4" py="6">
          <Heading size="6">Store</Heading>
          <Callout.Root color="amber">
            <Callout.Text>{configError}</Callout.Text>
          </Callout.Root>
        </Flex>
      </Container>
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
    <Container size="3">
      <Flex direction="column" gap="5" py="6">
        <Flex direction="column" gap="1">
          <Heading size="6">{status.displayName ?? "Store"}</Heading>
          <Text size="2" color="gray">
            Payments are processed by {status.displayName ?? "this merchant"} through Stripe.
          </Text>
        </Flex>

        {/* NEVER TAKE MONEY INTO AN ACCOUNT THAT CANNOT RECEIVE IT. Checkout
            would fail anyway, but failing at the Stripe redirect leaves a
            shopper staring at an error page with no idea what happened. */}
        {!status.readyToProcessPayments ? (
          <Callout.Root color="amber">
            <Callout.Text>
              This store isn&rsquo;t accepting payments yet.
            </Callout.Text>
          </Callout.Root>
        ) : null}

        {products.length === 0 ? (
          <Text size="2" color="gray">
            Nothing for sale here yet.
          </Text>
        ) : (
          <Flex direction="column" gap="3">
            {products.map((product) => (
              <Card key={product.id}>
                <Flex justify="between" align="center" gap="4" wrap="wrap" p="1">
                  <Flex direction="column" gap="1">
                    <Text size="3" weight="medium">
                      {product.name}
                    </Text>
                    {product.description ? (
                      <Text size="2" color="gray">
                        {product.description}
                      </Text>
                    ) : null}
                  </Flex>

                  <Flex align="center" gap="3">
                    <Text size="4" weight="bold" className="tnum">
                      {formatAmount(product.unitAmount, product.currency)}
                    </Text>

                    {/* A form, not a link: starting a checkout is a mutation,
                        and a GET that a prefetcher can fire would create
                        Stripe sessions nobody asked for. The action re-reads
                        the price server-side — the browser never supplies an
                        amount. */}
                    <form action={buyProductAction}>
                      <input type="hidden" name="accountId" value={accountId} />
                      <input type="hidden" name="productId" value={product.id} />
                      <Button
                        type="submit"
                        disabled={!status.readyToProcessPayments || !product.unitAmount}
                      >
                        Buy
                      </Button>
                    </form>
                  </Flex>
                </Flex>
              </Card>
            ))}
          </Flex>
        )}
      </Flex>
    </Container>
  );
}
