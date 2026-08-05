import NextLink from "next/link";
import Card from "@mui/material/Card";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import MDBadge from "@/components/mdpro/MDBadge";

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
        <MDButton
          component={NextLink}
          href="/documents/new"
          variant="gradient"
          color="info"
        >
          Add document
        </MDButton>
      }
    >
      {anyError ? (
        <Card>
          <MDBox p={3}>
            <MDTypography variant="button" color="error">
              {friendlyDbError(error ?? expirationError, "documents.select")}
            </MDTypography>
          </MDBox>
        </Card>
      ) : (
        <Card>
          <MDBox p={3}>
            {sorted.length === 0 ? (
              <MDBox py={4} textAlign="center">
                <MDTypography variant="h6">No documents yet</MDTypography>
                <MDTypography variant="button" color="text" fontWeight="regular">
                  Medicals, flight reviews, passports, certificates,
                  insurance and W-9s — anything with a date that matters.
                </MDTypography>
                <MDBox mt={3}>
                  <MDButton
                    component={NextLink}
                    href="/documents/new"
                    variant="gradient"
                    color="info"
                  >
                    Add your first document
                  </MDButton>
                </MDBox>
              </MDBox>
            ) : (
              <TableContainer sx={{ boxShadow: "none" }}>
                <Table>
                  <TableHead sx={{ display: "table-header-group" }}>
                    <TableRow>
                      {["Document", "Kind", "Expires", "Status", "File"].map(
                        (heading) => (
                          <TableCell key={heading}>
                            <MDTypography
                              variant="caption"
                              fontWeight="bold"
                              textTransform="uppercase"
                            >
                              {heading}
                            </MDTypography>
                          </TableCell>
                        )
                      )}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sorted.map((doc) => {
                      const expiration = expirationByDocId.get(doc.id);
                      const badge = expiration
                        ? EXPIRY_LADDER_BADGE[expiration.ladder_stage] ?? EXPIRY_NO_DATE_BADGE
                        : EXPIRY_NO_DATE_BADGE;
                      return (
                        <TableRow key={doc.id}>
                          <TableCell component="th" scope="row">
                            <MDTypography
                              component={NextLink}
                              href={`/documents/${doc.id}`}
                              variant="button"
                              fontWeight="medium"
                            >
                              {doc.label}
                            </MDTypography>
                          </TableCell>
                          <TableCell>
                            <MDTypography
                              variant="button"
                              color="text"
                              fontWeight="regular"
                            >
                              {DOCUMENT_KIND_LABEL[doc.kind] ?? "Other"}
                            </MDTypography>
                          </TableCell>
                          <TableCell>
                            <MDTypography
                              display="block"
                              variant="button"
                              color="text"
                              fontWeight="regular"
                            >
                              {formatDate(doc.expires_on)}
                            </MDTypography>
                            {expiration ? (
                              <MDTypography
                                display="block"
                                variant="caption"
                                color="text"
                              >
                                {daysRemainingLabel(expiration.days_remaining)}
                              </MDTypography>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <MDBadge
                              variant="gradient"
                              color={badge.tone}
                              badgeContent={badge.label}
                              size="sm"
                              container
                            />
                          </TableCell>
                          <TableCell>
                            <MDTypography
                              variant="caption"
                              color={doc.file_path ? "text" : "secondary"}
                            >
                              {doc.file_path ? "Attached" : "None"}
                            </MDTypography>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </MDBox>
        </Card>
      )}
    </PageShell>
  );
}
