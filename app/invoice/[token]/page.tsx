import { notFound } from "next/navigation";
import { Badge, Box, Button, Callout, Card, Container, Flex, Separator, Table, Text } from "@/components/ui";
import { Logo } from "@/components/ui/logo";
import { createClient } from "@/lib/supabase/server";
import { isLiveMode } from "@/lib/stripe/server";
import { formatCents, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The CLIENT-FACING invoice — this product's first unauthenticated route
 * that exposes tenant data. Read supabase/migrations/20260809060000_
 * invoice_public_share.sql in full before touching this file; that
 * migration's `pilot.invoice_public` function is the entire access
 * boundary, and this page is a thin renderer of exactly what it returns.
 *
 * NO SESSION ASSUMED ANYWHERE IN THIS FILE: no `requireAccount`, no
 * `lib/supabase/account.ts` import, no read of `auth.getUser()`. The
 * Supabase client below is created the same way the authenticated screens
 * create theirs (`lib/supabase/server.ts`'s `createClient()` — it merely
 * binds to whatever cookies exist, session or none), but the ONLY call
 * made through it is `rpc("invoice_public", ...)`, which runs as `anon`
 * for a visitor with no session (the ordinary case here) and as
 * `authenticated` for a signed-in pilot previewing their own link — both
 * paths go through the identical SECURITY DEFINER function, so a pilot
 * previewing sees byte-for-byte what their client will.
 *
 * NO loading.tsx IN THIS DIRECTORY, DELIBERATELY (there used to be one).
 * A loading.tsx wraps a route's async Server Component in an automatic
 * Suspense boundary, which makes Next start STREAMING the response: the
 * shell flushes with an HTTP 200 before this function has run far enough
 * to reach either notFound() call below. Once that 200 is on the wire it
 * cannot become the 404 an invalid token deserves — the not-found copy
 * still streams in and renders correctly (Suspense delivers the
 * replacement content the moment it resolves, exactly as designed), only
 * the STATUS CODE is stuck at 200 for the rest of that response, which is
 * what a link-checker, monitoring probe, or crawler sees regardless of
 * what the rendered page says. Removing loading.tsx makes the whole
 * render synchronous — nothing reaches the client until this function
 * returns — so notFound() below can still set the real status. The cost
 * is that a client with a slow connection sees nothing at all, rather
 * than a spinner, while pilot.invoice_public resolves; accepted on
 * purpose, because this page is opened once from an emailed link and a
 * correct HTTP status matters more here than perceived latency on an RPC
 * that is ordinarily fast. app/packet/[token]/page.tsx makes the same
 * trade for the same reason and never had a loading.tsx to remove.
 *
 * FIELD-BY-FIELD JUSTIFICATION for every field `pilot.invoice_public`
 * returns and this page renders — the promised companion to that
 * migration's own header comment:
 *
 *   invoice.invoice_number  The document's own identifier. Already on
 *                           every PDF this pilot has ever sent.
 *   invoice.status          So a paid/partially-paid invoice says so
 *                           instead of asking to be paid again — the
 *                           "degrade honestly" requirement.
 *   invoice.issued_on/due_on  Ordinary invoice header facts.
 *   invoice.notes            Pilot-authored, ALREADY client-facing —
 *                           lib/invoice-pdf.tsx renders this exact field
 *                           in the PDF this pilot already sends by hand;
 *                           this is not a new disclosure, only a second
 *                           surface for one already-shared fact.
 *   account.legal_name/address*  The pilot's own business identity — the
 *                           client already knows who is billing them
 *                           (it's who they hired). NOT included: any
 *                           other `pilot.accounts` column — no plan,
 *                           status, seat_count, connect_account_id,
 *                           stripe_customer_id, trial_ends_at, or logo
 *                           (the PDF route's logo fetch needs a private-
 *                           bucket download this function deliberately
 *                           does not attempt — see that route's own
 *                           comment on why a logo failure must not break
 *                           rendering; the public page ships text-only
 *                           rather than add a second signed-URL surface
 *                           for this first version).
 *   client.name/contact_name/address*  The BILLED client's OWN name and
 *                           address — this is the invoice's "Bill To"
 *                           block, the client's own data being shown back
 *                           to them, the same fields (and ONLY these
 *                           fields — no contact_email/contact_phone, which
 *                           the PDF route doesn't select either) the PDF
 *                           already puts in their hands. NOT included:
 *                           anything that would let this client discover
 *                           this pilot's OTHER clients — there is no way
 *                           to reach any client row but this invoice's own
 *                           billed client, ever, from this function.
 *   lines[].description/quantity/unit_amount_cents/amount_cents  What was
 *                           billed, at the granularity the client already
 *                           agreed to pay. NOT included: line_type,
 *                           trip_id, expense_id, expense_treatment,
 *                           sort_order, id, created_at — none of that is
 *                           meaningful to the person paying the bill, and
 *                           expense_id/trip_id are internal foreign keys
 *                           into tables (pilot.expenses, pilot.trips) this
 *                           client must never be able to correlate against.
 *   totals.*                subtotal/tax/total/amount_paid/balance_due/
 *                           last_paid_on — pilot.invoice_totals is this
 *                           schema's single source for these figures (see
 *                           that view's own comment); reading it here
 *                           rather than re-deriving keeps the client-
 *                           facing total byte-for-byte identical to what
 *                           the pilot sees on their own screen.
 *   payment.url/livemode/amount_cents  The Stripe Payment Link, if one
 *                           exists — the whole point of this feature (see
 *                           PLAN.md decision #8). `url` is not a secret: it
 *                           is the exact string Stripe already hands
 *                           anyone who has it. `livemode` is compared
 *                           against isLiveMode() below, mirroring
 *                           PaymentPanel's own test/live guard, so a
 *                           test-mode link is never rendered as payable to
 *                           a real client. `amount_cents` (20260811010000)
 *                           is the balance the link was SNAPSHOTTED for at
 *                           generation time — a Payment Link prices off a
 *                           Stripe Price made once, at creation, and never
 *                           re-priced afterwards, so a link generated
 *                           against an earlier balance keeps charging that
 *                           earlier figure even after the balance changes
 *                           (a correction, a partial payment). Without this
 *                           field the page could only label the button
 *                           with balance_due_cents while the link itself
 *                           charged something else — one number shown, a
 *                           different one charged. `payable` below requires
 *                           amount_cents to equal the live balance, and the
 *                           button is labelled with amount_cents, never
 *                           balance_due_cents, so it can never state a
 *                           figure Stripe will not actually charge.
 *                           stripe_payment_link_id is deliberately NOT
 *                           returned — the client never needs Stripe's
 *                           internal object id, only the URL.
 *
 * Nothing about the ACCOUNT beyond what's on this one document, nothing
 * about any OTHER invoice, nothing about any OTHER client, no cost/margin
 * data (expenses.amount_cents as the PILOT paid it never appears here —
 * only the rebilled invoice_lines.amount_cents the CLIENT owes), no
 * expenses.treatment, no internal notes table, no logbook, no expirations.
 */

type PublicInvoice = {
  invoice: {
    invoice_number: string | null;
    status: "sent" | "partial" | "paid";
    issued_on: string | null;
    due_on: string | null;
    notes: string | null;
  };
  account: {
    legal_name: string;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  };
  client: {
    name: string;
    contact_name: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  };
  lines: {
    description: string;
    quantity: number;
    unit_amount_cents: number;
    amount_cents: number;
  }[];
  totals: {
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    amount_paid_cents: number;
    balance_due_cents: number;
    last_paid_on: string | null;
  };
  payment: {
    url: string | null;
    livemode: boolean | null;
    amount_cents: number | null;
  };
};

function addressLines(entity: {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
}): string[] {
  const lines: string[] = [];
  if (entity.address_line1) lines.push(entity.address_line1);
  if (entity.address_line2) lines.push(entity.address_line2);
  const cityLine = [entity.city, entity.state, entity.postal_code].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (entity.country) lines.push(entity.country);
  return lines;
}

const STATUS_LABEL: Record<string, { color: "blue" | "amber" | "green"; label: string }> = {
  sent: { color: "blue", label: "Awaiting payment" },
  partial: { color: "amber", label: "Partially paid" },
  paid: { color: "green", label: "Paid" },
};

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();

  // A malformed/miscopied URL segment (wrong length, wrong charset) is
  // rejected here before ever reaching the database — cheap, and it means
  // the RPC only ever sees something shaped like a real token. This is
  // NOT the security boundary (pilot.invoice_public's own token match is),
  // only an early exit for the overwhelmingly common "link got truncated
  // in an email client" case.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    notFound();
  }

  const { data, error } = await supabase.rpc("invoice_public", { p_token: token } as never);

  // A genuine query failure (network, database down) is a real error, not
  // a verdict on the token — rendered as a normal 500 by Next's error
  // boundary, distinct from the notFound() branch below, and the token
  // itself never appears in what gets thrown or logged.
  if (error) {
    throw new Error("Couldn't load this invoice right now.");
  }

  // null covers an unknown token, a revoked one, and an invoice that
  // reverted out of a shareable status — all three, identically, by
  // design (see the migration's own comment on pilot.invoice_public).
  if (!data) {
    notFound();
  }

  const invoice = data as unknown as PublicInvoice;
  const status = STATUS_LABEL[invoice.invoice.status] ?? STATUS_LABEL.sent!;

  // A stored Payment Link is priced once, at generation time, and never
  // re-priced — see this page's own header comment on payment.amount_cents.
  // "Live" here only means "exists and matches this deployment's Stripe
  // mode"; it says nothing about whether the price it charges still matches
  // what's owed, which is the separate check below.
  const linkLooksLive =
    invoice.payment.url !== null && invoice.payment.livemode === isLiveMode();
  // amount_cents === null covers a link generated before this column
  // existed (20260810010000) and never regenerated since — there is no way
  // to know what it charges without a Stripe round trip this page
  // deliberately doesn't make (see this file's own "no second signed-URL
  // surface" reasoning for the logo, above at lines 49-55; the same
  // tradeoff applies here), so an unknown snapshot is treated exactly like
  // a stale one: not payable. app/(app)/invoices/[id]/payment-panel.tsx's
  // PayOnlinePanel treats the same null the same way, so this page and the
  // pilot's own screen never disagree about whether a link is trustworthy.
  const linkCurrent =
    linkLooksLive &&
    invoice.payment.amount_cents !== null &&
    invoice.payment.amount_cents === invoice.totals.balance_due_cents;
  // The button must never state a figure Stripe will not actually charge —
  // gating on the snapshot matching the LIVE balance, not merely on a link
  // existing, is what closes that gap.
  const payable = invoice.totals.balance_due_cents > 0 && linkCurrent;
  // A link that exists and looks live but is priced for a different
  // balance than what's actually owed — a client paid $600 less than they
  // thought, or a pilot corrected a payment, without anyone regenerating
  // the link. The balance is still real and still owed; the client just
  // cannot be handed a button that would charge the wrong amount for it.
  const linkStale =
    invoice.totals.balance_due_cents > 0 && linkLooksLive && !linkCurrent;

  return (
    <Box style={{ minHeight: "100vh", background: "var(--gray-2)" }}>
      <Container size="3" p={{ initial: "4", sm: "6" }}>
        <Flex align="center" justify="between" mb="5">
          <Logo />
          <Badge color={status.color} size="2">
            {status.label}
          </Badge>
        </Flex>

        <Card size="4">
          <Flex justify="between" wrap="wrap" gap="4" mb="4">
            <Box>
              <Text as="div" size="5" weight="bold">
                {invoice.account.legal_name}
              </Text>
              {addressLines(invoice.account).map((line, i) => (
                <Text as="div" key={i} color="gray" size="2">
                  {line}
                </Text>
              ))}
            </Box>
            <Box>
              <Text as="div" size="2" color="gray">
                Invoice
              </Text>
              <Text as="div" size="5" weight="bold">
                {invoice.invoice.invoice_number ?? "—"}
              </Text>
              <Text as="div" size="2" color="gray">
                {invoice.invoice.issued_on ? `Issued ${formatDate(invoice.invoice.issued_on)}` : null}
              </Text>
              <Text as="div" size="2" color="gray">
                {invoice.invoice.due_on ? `Due ${formatDate(invoice.invoice.due_on)}` : null}
              </Text>
            </Box>
          </Flex>

          <Separator size="4" mb="4" />

          <Box mb="4">
            <Text as="div" size="1" color="gray" mb="1">
              Bill to
            </Text>
            <Text as="div" weight="medium">
              {invoice.client.name}
            </Text>
            {invoice.client.contact_name ? (
              <Text as="div" color="gray" size="2">
                Attn: {invoice.client.contact_name}
              </Text>
            ) : null}
            {addressLines(invoice.client).map((line, i) => (
              <Text as="div" key={i} color="gray" size="2">
                {line}
              </Text>
            ))}
          </Box>

          <Table.Root variant="surface" mb="4">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Description</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell align="right">Qty</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell align="right">Rate</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell align="right">Amount</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {invoice.lines.map((line, i) => (
                <Table.Row key={i}>
                  <Table.Cell>{line.description}</Table.Cell>
                  <Table.Cell align="right" className="tnum">
                    {line.quantity}
                  </Table.Cell>
                  <Table.Cell align="right" className="tnum">
                    {formatCents(line.unit_amount_cents)}
                  </Table.Cell>
                  <Table.Cell align="right" className="tnum">
                    {formatCents(line.amount_cents)}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>

          <Flex direction="column" gap="1" align="end" mb="4">
            <TotalsLine label="Subtotal" value={invoice.totals.subtotal_cents} />
            <TotalsLine label="Tax" value={invoice.totals.tax_cents} />
            <TotalsLine label="Total" value={invoice.totals.total_cents} emphasize />
            <TotalsLine label="Paid" value={invoice.totals.amount_paid_cents} />
            <TotalsLine label="Balance due" value={invoice.totals.balance_due_cents} emphasize />
          </Flex>

          {invoice.invoice.notes ? (
            <>
              <Separator size="4" mb="3" />
              <Text as="div" size="2" color="gray">
                {invoice.invoice.notes}
              </Text>
            </>
          ) : null}

          {payable ? (
            // Labelled with the LINK's own snapshotted amount, never
            // balance_due_cents — `payable` already proved the two are
            // equal, but the button states what Stripe will actually
            // charge, not what this page separately computed.
            <>
              <Separator size="4" my="4" />
              <Button asChild size="3" style={{ width: "100%" }}>
                <a href={invoice.payment.url!} target="_blank" rel="noopener noreferrer">
                  Pay {formatCents(invoice.payment.amount_cents!)} online
                </a>
              </Button>
            </>
          ) : linkStale ? (
            <>
              <Separator size="4" my="4" />
              <Callout.Root color="amber" size="2">
                <Callout.Text>
                  Balance due: {formatCents(invoice.totals.balance_due_cents)}. The
                  online payment link for this invoice is out of date — contact
                  your pilot for an updated one rather than using it.
                </Callout.Text>
              </Callout.Root>
            </>
          ) : null}
        </Card>
      </Container>
    </Box>
  );
}

function TotalsLine({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: number;
  emphasize?: boolean;
}) {
  return (
    <Flex gap="4" minWidth="220px" justify="between">
      <Text color="gray" weight={emphasize ? "bold" : "regular"}>
        {label}
      </Text>
      <Text weight={emphasize ? "bold" : "regular"} className="tnum">
        {formatCents(value)}
      </Text>
    </Flex>
  );
}
