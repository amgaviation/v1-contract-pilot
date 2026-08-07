import NextLink from "next/link";
import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Link as RadixLink,
  Table,
  Text,
} from "@/components/ui";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { formatDate } from "@/lib/format";
import { friendlyDbError } from "@/lib/db-errors";
import type { Database } from "@/lib/supabase/database.types";
import PageShell from "../page-shell";
import { DOCUMENT_KIND_LABEL } from "./kinds";
import { EXPIRY_LADDER_BADGE, EXPIRY_NO_DATE_BADGE } from "./expiry-badge";

export const metadata = { title: "Documents" };

type DocumentRow = Database["pilot"]["Tables"]["documents"]["Row"];
type ExpirationRow = Database["pilot"]["Views"]["expirations"]["Row"];

function daysRemainingLabel(days: number): string {
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "Expires today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

// D3: 61.23 medical duration and 61.56's 24-calendar-month flight review
// both run through the LAST DAY OF THE EXPIRING MONTH, not the exam-date
// anniversary — but pilot.documents stores whatever date the pilot typed
// (kinds.ts is deliberate about that; no duration is computed here). A
// day-precision "Expired 3 days ago" / "Expires today" on THESE two kinds
// tells a pilot who entered the anniversary date, not the month end, that
// they're expired up to ~30 days before they actually are. Rather than
// inventing a month-end derivation the schema doesn't support, this just
// says plainly what the countdown is actually measuring for these kinds.
const MONTH_SEMANTICS_KINDS = new Set(["medical", "flight_review"]);

export default async function DocumentsPage() {
  const { account } = await requireAccount("/documents");

  const supabase = await createClient();
  // pilot.expirations is read for its ladder math (days_remaining,
  // ladder_stage) — the point of this screen is to never recompute that
  // in TypeScript, per the migration's "one definition of due soon" rule.
  // .eq("account_id", ...) here is defence in depth, not the boundary —
  // RLS (security_invoker on the view, scoped by the underlying table's
  // policies) is what actually restricts the rows.
  const [{ data: documentData, error }, { data: expirationData, error: expirationError }] =
    await Promise.all([
      supabase.from("documents").select("*"),
      supabase
        .from("expirations")
        .select("*")
        .eq("account_id", account.id)
        .eq("source_table", "document"),
    ]);

  const documents = (documentData ?? []) as DocumentRow[];
  const expirationByDocId = new Map(
    ((expirationData ?? []) as ExpirationRow[]).map((row) => [row.source_id, row])
  );

  // Soonest-expiring first; a document with no expiry sorts LAST, not
  // first — an undated record isn't more urgent than one that's overdue.
  const sorted = [...documents].sort((a, b) => {
    const ea = expirationByDocId.get(a.id);
    const eb = expirationByDocId.get(b.id);
    if (ea && eb) return ea.days_remaining - eb.days_remaining;
    if (ea && !eb) return -1;
    if (!ea && eb) return 1;
    return a.label.localeCompare(b.label);
  });

  const overdueCount = [...expirationByDocId.values()].filter(
    (e) => e.ladder_stage === "overdue"
  ).length;
  const dueSoonCount = [...expirationByDocId.values()].filter((e) =>
    ["t_minus_1", "t_minus_7", "t_minus_14", "t_minus_30"].includes(e.ladder_stage)
  ).length;

  const anyError = error || expirationError;

  return (
    <PageShell
      title="Documents"
      subtitle={
        anyError
          ? "Couldn't load your documents."
          : overdueCount
            ? `${overdueCount} expired · ${dueSoonCount} due soon`
            : dueSoonCount
              ? `${dueSoonCount} due soon`
              : `${documents.length} document${documents.length === 1 ? "" : "s"} on file`
      }
      action={
        <Button asChild>
          <NextLink href="/documents/new">Add document</NextLink>
        </Button>
      }
    >
      {anyError ? (
        <Callout.Root color="red">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{friendlyDbError(error ?? expirationError, "documents.select")}</Callout.Text>
        </Callout.Root>
      ) : (
        <Card>
          {sorted.length === 0 ? (
            <Flex direction="column" align="center" gap="3" py="6">
              <Heading as="h3" size="4">No documents yet</Heading>
              <Text size="2" color="gray" align="center">
                Medicals, flight reviews, passports, certificates, insurance and W-9s — anything
                with a date that matters.
              </Text>
              <Button asChild mt="2">
                <NextLink href="/documents/new">Add your first document</NextLink>
              </Button>
            </Flex>
          ) : (
            <Table.Root variant="ghost">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Document</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Kind</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Expires</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell>File</Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {sorted.map((doc) => {
                  const expiration = expirationByDocId.get(doc.id);
                  const badge = expiration
                    ? EXPIRY_LADDER_BADGE[expiration.ladder_stage] ?? EXPIRY_NO_DATE_BADGE
                    : EXPIRY_NO_DATE_BADGE;
                  return (
                    <Table.Row key={doc.id}>
                      <Table.RowHeaderCell>
                        <RadixLink asChild weight="medium">
                          <NextLink href={`/documents/${doc.id}`}>{doc.label}</NextLink>
                        </RadixLink>
                      </Table.RowHeaderCell>
                      <Table.Cell>
                        <Text size="2" color="gray">
                          {DOCUMENT_KIND_LABEL[doc.kind] ?? "Other"}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <Flex direction="column">
                          <Text size="2" color="gray">
                            {formatDate(doc.expires_on)}
                          </Text>
                          {expiration ? (
                            <Text size="1" color="gray">
                              {daysRemainingLabel(expiration.days_remaining)}
                            </Text>
                          ) : null}
                          {expiration && MONTH_SEMANTICS_KINDS.has(doc.kind) ? (
                            <Text size="1" color="gray">
                              Counted against the date you entered — 61.23/61.56
                              actually run through the end of that month.
                            </Text>
                          ) : null}
                        </Flex>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge color={badge.tone}>{badge.label}</Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <Text size="1" color={doc.file_path ? "gray" : "red"}>
                          {doc.file_path ? "Attached" : "None"}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Root>
          )}
        </Card>
      )}
    </PageShell>
  );
}
