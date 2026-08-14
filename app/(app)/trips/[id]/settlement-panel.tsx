import { Badge, Callout, Card, Flex, Grid, Heading, Text } from "@/components/ui";
import { formatCents } from "@/lib/format";
import type { TripSettlement } from "@/lib/trip-settlement";

/**
 * Expected vs invoiced vs paid, for THIS trip's flight and travel days —
 * roadmap #5's remainder. Server component: everything here is a read
 * already assembled by lib/trip-settlement.ts, so there is nothing for a
 * client bundle to do.
 *
 * SCOPE, STATED ON SCREEN, NOT JUST IN A CODE COMMENT: this panel prices
 * day money only (flight_day + travel_day) — the same money
 * lib/trip-value.ts's tripValueCents prices for every other screen. Per
 * diem, a cancellation fee, and rebilled receipts can also ride on this
 * trip's invoice, and are deliberately left out of these three figures so
 * "unbilled remainder" keeps meaning one thing: day money not yet on an
 * invoice. Saying nothing about that scope would let a pilot read
 * "Invoiced $0" as "this trip billed nothing" when it may have billed a
 * cancellation fee and nothing else.
 */
export default function SettlementPanel({
  settlement,
  loadError,
}: {
  settlement: TripSettlement | null;
  /** A failed read of this trip's invoice lines, invoices, or payments —
   *  never rendered as a healthy $0.00, matching the moneyError pattern on
   *  the invoice detail screen. */
  loadError: string | null;
}) {
  return (
    <Card size="3">
      <Heading as="h2" size="4">Settlement</Heading>
      <Text as="p" size="2" color="gray" mb="3">
        What this trip&rsquo;s flight and travel days are worth, what has
        been invoiced for them, and what has been paid. Per diem,
        cancellation fees, and rebilled expenses bill separately and
        aren&rsquo;t counted here.
      </Text>

      {loadError ? (
        <Callout.Root color="red">
          <Callout.Text>{loadError}</Callout.Text>
        </Callout.Root>
      ) : settlement ? (
        <>
          <Grid columns={{ initial: "1", sm: "3" }} gap="4">
            <Figure label="Expected" cents={settlement.expectedCents} />
            <Figure
              label="Invoiced"
              cents={settlement.invoicedCents}
              note={
                settlement.hasDraftMoney
                  ? `${formatCents(settlement.draftInvoicedCents)} of that sits on a draft, not yet sent`
                  : null
              }
            />
            <Figure
              label="Paid"
              cents={settlement.paidCents}
              note={
                settlement.invoiceHasOtherCharges
                  ? "the invoice this pays also carries other charges"
                  : null
              }
            />
          </Grid>

          <Flex direction="column" gap="2" mt="4">
            <DeltaRow
              label="Unbilled remainder"
              cents={settlement.unbilledRemainderCents}
              zeroTone="green"
              zeroWord="fully invoiced"
            />
            <DeltaRow
              label="Unpaid balance"
              cents={settlement.unpaidBalanceCents}
              zeroTone="green"
              zeroWord={settlement.invoicedCents > 0 ? "fully paid" : "nothing invoiced yet"}
            />
          </Flex>

          <Text as="p" size="1" color="gray" mt="3">
            {settlement.invoiceLabel
              ? `Billed on ${settlement.invoiceLabel}.`
              : "Not yet on an invoice."}
          </Text>
        </>
      ) : null}
    </Card>
  );
}

function Figure({
  label,
  cents,
  note,
}: {
  label: string;
  cents: number;
  note?: string | null;
}) {
  return (
    <Flex direction="column" gap="1">
      <Text size="1" color="gray">{label}</Text>
      <Text size="6" weight="bold" className="tnum">{formatCents(cents)}</Text>
      {note ? (
        <Text size="1" color="gray">{note}</Text>
      ) : null}
    </Flex>
  );
}

function DeltaRow({
  label,
  cents,
  zeroTone,
  zeroWord,
}: {
  label: string;
  cents: number;
  zeroTone: "green";
  zeroWord: string;
}) {
  const isZero = cents === 0;
  return (
    <Flex justify="between" align="center" gap="3">
      <Text size="2" color="gray">{label}</Text>
      {isZero ? (
        <Badge color={zeroTone}>{zeroWord}</Badge>
      ) : (
        <Text size="3" weight="bold" className="tnum">{formatCents(cents)}</Text>
      )}
    </Flex>
  );
}
