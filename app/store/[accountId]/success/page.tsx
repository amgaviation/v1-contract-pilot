import Link from "next/link";
import { Button, Callout, Card, Container, Flex, Heading, Text } from "@/components/ui";
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
    <Container size="2">
      <Flex direction="column" gap="4" py="6">
        <Heading size="6">Thank you</Heading>

        {!session ? (
          <Callout.Root color="amber">
            <Callout.Text>
              We couldn&rsquo;t find that checkout session. If you were charged, your
              receipt from Stripe is the record — nothing here changes it.
            </Callout.Text>
          </Callout.Root>
        ) : (
          <Card>
            <Flex direction="column" gap="2" p="1">
              <Text size="2" color="gray">
                {paid
                  ? "Payment received."
                  : pending
                    ? "Payment started. Some methods take a few business days to settle — you'll get a receipt from Stripe when it does."
                    : `Payment status: ${session.payment_status}`}
              </Text>
              {session.amount_total !== null ? (
                <Text size="5" weight="bold" className="tnum">
                  {formatAmount(session.amount_total, session.currency ?? "usd")}
                </Text>
              ) : null}
            </Flex>
          </Card>
        )}

        <Link href={`/store/${accountId}`}>
          <Button variant="outline">Back to the store</Button>
        </Link>
      </Flex>
    </Container>
  );
}
