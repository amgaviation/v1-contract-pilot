import { notFound } from "next/navigation";
import { Badge, Box, Card, Container, Flex, Heading, Link as RadixLink, Separator, Table, Text } from "@/components/ui";
import { Logo } from "@/components/ui/logo";
import { createClient } from "@/lib/supabase/server";
import { formatCents, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * The CLIENT-FACING vendor page — the per-client rollup a 135 operator's AP
 * desk wants instead of re-asking a pilot for the same information every
 * few weeks (research roadmap item #12). Read
 * supabase/migrations/20260814112000_client_vendor_page.sql IN FULL before
 * touching this file; pilot.client_vendor_page_public is the entire access
 * boundary and this page is a thin renderer of exactly what it returns —
 * same division of labor as app/invoice/[token]/page.tsx and
 * app/packet/[token]/page.tsx, which this file's structure mirrors
 * throughout.
 *
 * NO SESSION ASSUMED ANYWHERE HERE: no requireAccount, no account.ts
 * import, no auth.getUser(). The Supabase client binds to whatever cookies
 * exist; the only calls made through it are the two RPCs below, which run
 * as anon for a visitor and as authenticated for a pilot previewing their
 * own link — the identical SECURITY DEFINER functions either way, so a
 * preview shows exactly what the client will see.
 *
 * WHAT IS DELIBERATELY NOT HERE: invoice line items (that detail lives on
 * each invoice's own share link, not folded into a rollup), any other
 * client's data, draft/void invoices, and the packet's own document rows —
 * this page LINKS to /packet/[token] when one is live for this same client
 * rather than inlining its contents, so a change to what the packet exposes
 * never has to be mirrored here. It also never MINTS a packet link; if
 * packet_token comes back null, the honest answer is "ask your pilot," not
 * a button that would create one on this page's behalf.
 */

type VendorPage = {
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
  };
  open_invoices: {
    invoice_number: string | null;
    due_on: string | null;
    status: "sent" | "partial";
    balance_due_cents: number;
  }[];
  open_invoices_truncated: boolean;
  total_outstanding_cents: number;
  paid_invoices: {
    invoice_number: string | null;
    paid_on: string | null;
    total_cents: number;
  }[];
  paid_invoices_truncated: boolean;
  packet_token: string | null;
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

const OPEN_STATUS_LABEL: Record<string, { color: "blue" | "amber"; label: string }> = {
  sent: { color: "blue", label: "Awaiting payment" },
  partial: { color: "amber", label: "Partially paid" },
};

export default async function VendorPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();

  // Same early-exit shape as app/invoice/[token]/page.tsx: not the
  // security boundary (pilot.client_vendor_page_public's own token match
  // is), only a cheap rejection of a truncated/miscopied URL segment
  // before it ever reaches the database.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    notFound();
  }

  const { data, error } = await supabase.rpc("client_vendor_page_public", {
    p_token: token,
  } as never);

  // A genuine query failure is a real error, not a verdict on the token —
  // rendered as a normal 500, distinct from the notFound() branch below,
  // and the token itself never appears in what gets thrown or logged.
  // Matches app/invoice/[token]/page.tsx and app/packet/[token]/page.tsx's
  // documented position on the same trade.
  if (error) {
    throw new Error("Couldn't load this vendor page right now.");
  }

  // null covers an unknown token, a revoked one, and an expired one — all
  // three, identically, by design (see the migration's own comment on
  // pilot.client_vendor_page_public).
  if (!data) {
    notFound();
  }

  // VIEWED STAMP — only after the read above proved the token live, same
  // ordering and same best-effort reasoning as
  // app/invoice/[token]/page.tsx's own stamp: a failed stamp is bookkeeping
  // lost, never a reason to withhold the page from the client who is
  // waiting on it.
  const { error: viewedError } = await supabase.rpc("client_vendor_link_mark_viewed", {
    p_token: token,
  } as never);
  if (viewedError) {
    console.error(
      "[vendor-page] view stamp failed",
      viewedError.code ?? viewedError.message
    );
  }

  const page = data as unknown as VendorPage;

  return (
    <Box style={{ minHeight: "100vh", background: "var(--canvas)" }}>
      <Container size="3" p={{ initial: "4", sm: "6" }}>
        <Flex align="center" justify="between" mb="5">
          <Logo />
        </Flex>

        <Card size="4" mb="4">
          <Flex justify="between" wrap="wrap" gap="4" mb="4">
            <Box>
              <Text as="div" size="5" weight="bold">
                {page.account.legal_name}
              </Text>
              {addressLines(page.account).map((line, i) => (
                <Text as="div" key={i} color="gray" size="2">
                  {line}
                </Text>
              ))}
            </Box>
            <Box>
              <Text as="div" size="2" color="gray">
                Vendor page for
              </Text>
              <Text as="div" size="5" weight="bold">
                {page.client.name}
              </Text>
            </Box>
          </Flex>

          <Separator size="4" mb="4" />

          <Flex justify="between" align="center" wrap="wrap" gap="3">
            <Text size="3" weight="medium">
              Total outstanding
            </Text>
            <Text size="6" weight="bold" className="tnum">
              {formatCents(page.total_outstanding_cents)}
            </Text>
          </Flex>
        </Card>

        <Card size="4" mb="4">
          <Heading as="h2" size="4" mb="1">
            Open invoices
          </Heading>
          <Text as="p" size="2" color="gray" mb="4">
            Sent, awaiting payment.
          </Text>

          {page.open_invoices.length === 0 ? (
            <Text size="2" color="gray">
              Nothing outstanding right now.
            </Text>
          ) : (
            <Table.Root variant="surface">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Invoice</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Due</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell align="right">Balance due</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {page.open_invoices.map((invoice, i) => {
                  const status = OPEN_STATUS_LABEL[invoice.status] ?? OPEN_STATUS_LABEL.sent!;
                  return (
                    <Table.Row key={`${invoice.invoice_number}-${i}`}>
                      <Table.RowHeaderCell>{invoice.invoice_number ?? "N/A"}</Table.RowHeaderCell>
                      <Table.Cell>
                        <Text color="gray">
                          {invoice.due_on ? formatDate(invoice.due_on) : "N/A"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge color={status.color}>{status.label}</Badge>
                      </Table.Cell>
                      <Table.Cell align="right" className="tnum">
                        {formatCents(invoice.balance_due_cents)}
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          )}
          {page.open_invoices_truncated ? (
            <Text as="p" size="1" color="gray" mt="3">
              Showing the 200 soonest due. More are outstanding, and the total
              above includes all of them.
            </Text>
          ) : null}
        </Card>

        <Card size="4" mb="4">
          <Heading as="h2" size="4" mb="1">
            Payment history
          </Heading>
          <Text as="p" size="2" color="gray" mb="4">
            Recently paid.
          </Text>

          {page.paid_invoices.length === 0 ? (
            <Text size="2" color="gray">
              No payments on file yet.
            </Text>
          ) : (
            <Table.Root variant="ghost">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Invoice</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Paid</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell align="right">Amount</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {page.paid_invoices.map((invoice, i) => (
                  <Table.Row key={`${invoice.invoice_number}-${i}`}>
                    <Table.RowHeaderCell>{invoice.invoice_number ?? "N/A"}</Table.RowHeaderCell>
                    <Table.Cell>
                      <Text color="gray">
                        {invoice.paid_on ? formatDate(invoice.paid_on) : "N/A"}
                      </Text>
                    </Table.Cell>
                    <Table.Cell align="right" className="tnum">
                      {formatCents(invoice.total_cents)}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
          {page.paid_invoices_truncated ? (
            <Text as="p" size="1" color="gray" mt="3">
              Showing the 50 most recently paid.
            </Text>
          ) : null}
        </Card>

        {page.packet_token ? (
          <Card size="4" mb="4">
            <Heading as="h2" size="4" mb="1">
              Paperwork on file
            </Heading>
            <Text as="p" size="2" color="gray" mb="3">
              W-9, certificate of insurance, and other documents shared with you.
            </Text>
            <RadixLink asChild weight="medium">
              <a href={`/packet/${page.packet_token}`}>View the current paperwork</a>
            </RadixLink>
          </Card>
        ) : null}

        <Text size="1" color="gray">
          This link was shared by {page.account.legal_name} and stops working
          on its own. If you need it again, ask them for a new one.
        </Text>
      </Container>
    </Box>
  );
}
