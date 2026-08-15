import NextLink from "next/link";
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Link as RadixLink,
  Table,
  Text,
  VisuallyHidden,
} from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatCents } from "@/lib/format";
import { COUNTERPARTY_COPY, isInvoicedCounterparty } from "@/lib/counterparty";
import type { Database } from "@/lib/supabase/database.types";
import { friendlyDbError } from "@/lib/db-errors";
import EmptyState from "@/components/ui/empty-state";
import PageShell from "../page-shell";

type ClientRow = Database["pilot"]["Tables"]["clients"]["Row"];

export const metadata = { title: "Clients" };

// Supabase's Data API caps rows (commonly 1000) and TRUNCATES SILENTLY on
// a plain select — no error, just a shorter array. An explicit .limit
// makes that boundary visible instead of invisible. Same pattern as
// logbook/page.tsx's ENTRIES_LIMIT and page.tsx's AGGREGATE_LIMIT —
// copied, not reinvented.
const CLIENTS_LIMIT = 1000;

/**
 * W-9 status → badge colour. A missing W-9 is what the Overview "needs
 * attention" queue nags about, so it reads as a warning here rather than
 * as neutral information.
 */
type BadgeInfo = { color: "gray" | "green" | "amber" | "red"; label: string };

const W9_BADGE_FALLBACK: BadgeInfo = { color: "red", label: "No W-9" };
const W9_BADGE: Record<string, BadgeInfo> = {
  on_file: { color: "green", label: "W-9 on file" },
  requested: { color: "amber", label: "W-9 requested" },
  not_requested: W9_BADGE_FALLBACK,
};

export default async function ClientsPage() {
  await requireAccount("/clients");

  const supabase = await createClient();
  // RLS scopes this to the caller's tenant; no account_id filter is
  // needed or wanted here (see the note in actions.ts).
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name", { ascending: true })
    .limit(CLIENTS_LIMIT);

  const clients = (data ?? []) as ClientRow[];
  const truncatedClients = clients.length === CLIENTS_LIMIT;
  const active = clients.filter((c) => !c.archived_at);
  const archived = clients.filter((c) => c.archived_at);

  return (
    <PageShell
      title="Clients"
      subtitle={
        error
          ? "Couldn't load your clients."
          : `${active.length} active${archived.length ? `, ${archived.length} archived` : ""}`
      }
      action={
        <Button asChild>
          <NextLink href="/clients/new">New client</NextLink>
        </Button>
      }
    >
      {truncatedClients ? (
        <Box mb="4">
          <Callout.Root color="amber">
            <Callout.Icon>
              <ExclamationTriangleIcon />
            </Callout.Icon>
            <Callout.Text>
              {`This list may be partial. There are more than ${CLIENTS_LIMIT} clients and only the first ${CLIENTS_LIMIT} are shown.`}
            </Callout.Text>
          </Callout.Root>
        </Box>
      ) : null}

      <Card>
        {error ? (
          <Callout.Root color="red" m="3">
            <Callout.Text>{friendlyDbError(error, "clients.select")}</Callout.Text>
          </Callout.Root>
        ) : clients.length === 0 ? (
          <EmptyState
            title="No clients yet"
            action={
              <Button asChild>
                <NextLink href="/clients/new">Add your first client</NextLink>
              </Button>
            }
          >
            Add the owner, operator, or management company you fly for. Trips
            and invoices both hang off a client.
          </EmptyState>
        ) : (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Client</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Contact</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Day rate</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell justify="end">Terms</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>W-9</Table.ColumnHeaderCell>
                {/* Hidden visually but must still have an accessible name,
                    or the Edit-link column is unnamed to a screen reader. */}
                <Table.ColumnHeaderCell>
                  <VisuallyHidden>Actions</VisuallyHidden>
                </Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {clients.map((client) => {
                const w9 = W9_BADGE[client.w9_status] ?? W9_BADGE_FALLBACK;
                return (
                  <Table.Row key={client.id}>
                    <Table.RowHeaderCell>
                      <RadixLink asChild weight="medium">
                        <NextLink href={`/clients/${client.id}`}>{client.name}</NextLink>
                      </RadixLink>
                      {client.archived_at ? (
                        <Text as="div" size="1" color="gray">
                          Archived
                        </Text>
                      ) : null}
                    </Table.RowHeaderCell>
                    <Table.Cell>
                      <Text as="div" size="2">
                        {client.contact_name ?? "—"}
                      </Text>
                      <Text as="div" size="1" color="gray">
                        {client.contact_email ?? ""}
                      </Text>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text size="2" weight="medium" className="tnum">
                        {formatCents(client.default_day_rate_cents)}
                      </Text>
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Text size="2" color="gray" className="tnum">
                        {client.payment_terms_days === null
                          ? "—"
                          : `Net ${client.payment_terms_days}`}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      {/* A W-9 is what a client needs from the pilot in
                          order to 1099 them for money paid. A client you
                          do not invoice is never paying you, so "No W-9"
                          in red is not a thing to chase, it is noise on
                          the queue that exists to make real ones visible.
                          The billing relationship is the fact worth
                          stating in this column instead. */}
                      {isInvoicedCounterparty(client) ? (
                        <Badge color={w9.color}>{w9.label}</Badge>
                      ) : (
                        <Badge color="gray">{COUNTERPARTY_COPY.badge}</Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell justify="end">
                      <Button asChild variant="outline" size="1">
                        <NextLink href={`/clients/${client.id}`} aria-label={`Edit ${client.name}`}>
                          Edit
                        </NextLink>
                      </Button>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        )}
      </Card>
    </PageShell>
  );
}
