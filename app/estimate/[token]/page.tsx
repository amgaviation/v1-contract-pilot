import { notFound } from "next/navigation";
import { Badge, Box, Card, Container, Flex, Separator, Table, Text } from "@/components/ui";
import { Logo } from "@/components/ui/logo";
import { createClient } from "@/lib/supabase/server";
import { formatCents, formatDate } from "@/lib/format";
import RespondPanel from "./respond-panel";

export const dynamic = "force-dynamic";

/**
 * The CLIENT-FACING estimate — this product's second unauthenticated route
 * that exposes tenant data. Read
 * supabase/migrations/20260814111000_estimate_share.sql in full before
 * touching this file; pilot.estimate_public is the entire access boundary,
 * and this page is a thin renderer of exactly what it returns, mirroring
 * app/invoice/[token]/page.tsx's own structure and its own reasoning for
 * every choice below (repeated only where an estimate differs):
 *
 * NO SESSION ASSUMED, NO loading.tsx IN THIS DIRECTORY — same two reasons
 * as the invoice page: a loading.tsx would stream a 200 before either
 * notFound() below can run, permanently costing an invalid token its 404.
 *
 * FIELD-BY-FIELD: see pilot.estimate_public's own comment in the migration
 * for exactly which columns this function returns and why each one is
 * safe to show this specific client (their own name/address being read
 * back to them, this pilot's own business identity, and nothing about any
 * other estimate, invoice, or client).
 *
 * ACCEPT/DECLINE, THE ONE THING THIS PAGE CAN DO THAT app/invoice/[token]
 * CANNOT: pilot.estimates already has a client-answerable lifecycle (sent
 * -> accepted|declined, pilot.estimates_protect, 20260810060000) and today
 * the only way that answer reaches this schema is the pilot re-typing it.
 * RespondPanel below is rendered ONLY while status is 'sent' — matching
 * pilot.estimate_public_accept/_decline's own gate exactly, so the buttons
 * are never shown where the RPC would silently do nothing.
 */

type PublicEstimate = {
  estimate: {
    estimate_number: string | null;
    status: "sent" | "accepted" | "declined";
    issued_on: string | null;
    valid_until: string | null;
    terms: string | null;
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

const STATUS_LABEL: Record<string, { color: "blue" | "green" | "red"; label: string }> = {
  sent: { color: "blue", label: "Awaiting your answer" },
  accepted: { color: "green", label: "Accepted" },
  declined: { color: "red", label: "Declined" },
};

export default async function PublicEstimatePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();

  // Cheap early exit for a truncated/miscopied URL segment — NOT the
  // security boundary (pilot.estimate_public's own token match is).
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    notFound();
  }

  const { data, error } = await supabase.rpc("estimate_public", { p_token: token } as never);

  if (error) {
    throw new Error("Couldn't load this estimate right now.");
  }

  // null covers an unknown token, a revoked one, and a draft estimate —
  // all three, identically, by design (see the migration's own comment).
  if (!data) {
    notFound();
  }

  // VIEWED STAMP — best-effort, same reasoning as the invoice page: a
  // failed stamp must never cost the client their document.
  const { error: viewedError } = await supabase.rpc("estimate_share_mark_viewed", {
    p_token: token,
  } as never);
  if (viewedError) {
    console.error(
      "[estimate-public] view stamp failed",
      viewedError.code ?? viewedError.message
    );
  }

  const estimate = data as unknown as PublicEstimate;
  const status = STATUS_LABEL[estimate.estimate.status] ?? STATUS_LABEL.sent!;

  return (
    <Box style={{ minHeight: "100vh", background: "var(--canvas)" }}>
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
                {estimate.account.legal_name}
              </Text>
              {addressLines(estimate.account).map((line, i) => (
                <Text as="div" key={i} color="gray" size="2">
                  {line}
                </Text>
              ))}
            </Box>
            <Box>
              <Text as="div" size="2" color="gray">
                Estimate
              </Text>
              <Text as="div" size="5" weight="bold">
                {estimate.estimate.estimate_number ?? "N/A"}
              </Text>
              <Text as="div" size="2" color="gray">
                {estimate.estimate.issued_on ? `Sent ${formatDate(estimate.estimate.issued_on)}` : null}
              </Text>
              <Text as="div" size="2" color="gray">
                {estimate.estimate.valid_until
                  ? `Valid until ${formatDate(estimate.estimate.valid_until)}`
                  : null}
              </Text>
            </Box>
          </Flex>

          <Box mb="4" style={{ background: "var(--sunk)", borderRadius: "var(--radius)", padding: "8px 12px" }}>
            <Text as="div" size="2" color="gray">
              This is a price quote, not an invoice. No payment is due.
            </Text>
          </Box>

          <Separator size="4" mb="4" />

          <Box mb="4">
            <Text as="div" size="1" color="gray" mb="1">
              Quote for
            </Text>
            <Text as="div" weight="medium">
              {estimate.client.name}
            </Text>
            {estimate.client.contact_name ? (
              <Text as="div" color="gray" size="2">
                Attn: {estimate.client.contact_name}
              </Text>
            ) : null}
            {addressLines(estimate.client).map((line, i) => (
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
              {estimate.lines.map((line, i) => (
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
            <TotalsLine label="Subtotal" value={estimate.totals.subtotal_cents} />
            <TotalsLine label="Tax" value={estimate.totals.tax_cents} />
            <TotalsLine label="Total" value={estimate.totals.total_cents} emphasize />
          </Flex>

          {estimate.estimate.terms ? (
            <>
              <Separator size="4" mb="3" />
              <Text as="div" size="1" color="gray" mb="1">
                Terms
              </Text>
              <Text as="div" size="2" color="gray">
                {estimate.estimate.terms}
              </Text>
            </>
          ) : null}

          {estimate.estimate.notes ? (
            <>
              <Separator size="4" my="3" />
              <Text as="div" size="2" color="gray">
                {estimate.estimate.notes}
              </Text>
            </>
          ) : null}

          {estimate.estimate.status === "sent" ? (
            <>
              <Separator size="4" my="4" />
              <RespondPanel token={token} />
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
