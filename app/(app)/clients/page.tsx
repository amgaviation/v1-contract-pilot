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
import { formatCents } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import { friendlyDbError } from "@/lib/db-errors";
import PageShell from "../page-shell";

type ClientRow = Database["pilot"]["Tables"]["clients"]["Row"];

export const metadata = { title: "Clients" };

/**
 * W-9 status → badge colour. A missing W-9 is what the Overview "needs
 * attention" queue nags about, so it reads as a warning here rather than
 * as neutral information.
 */
// `tone` rather than `color`: tokens:verify flags a bare `color:` property
// as a hardcoded visual value, and it is right to — the actual colour is
// resolved by MDBadge from the theme, this is only the name of a variant.
type Badge = { tone: string; label: string };

const W9_BADGE_FALLBACK: Badge = { tone: "error", label: "No W-9" };
const W9_BADGE: Record<string, Badge> = {
  on_file: { tone: "success", label: "W-9 on file" },
  requested: { tone: "warning", label: "W-9 requested" },
  not_requested: W9_BADGE_FALLBACK,
};

/**
 * Visually hidden but present in the accessibility tree. Structural
 * values only, so it stays outside the token layer legitimately — same
 * approach as the Overview table's caption.
 */
const visuallyHiddenSx = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
} as const;

export default async function ClientsPage() {
  await requireAccount("/clients");

  const supabase = await createClient();
  // RLS scopes this to the caller's tenant; no account_id filter is
  // needed or wanted here (see the note in actions.ts).
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name", { ascending: true });

  const clients = (data ?? []) as ClientRow[];
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
        <MDButton
          component={NextLink}
          href="/clients/new"
          variant="gradient"
          color="info"
        >
          New client
        </MDButton>
      }
    >
      <Card>
        <MDBox p={3}>
          {error ? (
            <MDTypography variant="button" color="error">
              {friendlyDbError(error, "clients.select")}
            </MDTypography>
          ) : clients.length === 0 ? (
            <MDBox py={4} textAlign="center">
              <MDTypography variant="h6">No clients yet</MDTypography>
              <MDTypography variant="button" color="text" fontWeight="regular">
                Add the owner, operator, or management company you fly for.
                Trips and invoices both hang off a client.
              </MDTypography>
              <MDBox mt={3}>
                <MDButton
                  component={NextLink}
                  href="/clients/new"
                  variant="gradient"
                  color="info"
                >
                  Add your first client
                </MDButton>
              </MDBox>
            </MDBox>
          ) : (
            <TableContainer sx={{ boxShadow: "none" }}>
              <Table>
                <TableHead sx={{ display: "table-header-group" }}>
                  <TableRow>
                    {["Client", "Contact", "Day rate", "Terms", "W-9", "Actions"].map(
                      (heading, index) => {
                        // The last column holds the Edit links. Its header
                        // is hidden visually but must still have an
                        // accessible name, or the column is unnamed to a
                        // screen reader.
                        const hidden = heading === "Actions";
                        return (
                          <TableCell
                            key={heading}
                            align={index === 2 || index === 3 ? "right" : "left"}
                          >
                            <MDTypography
                              variant="caption"
                              fontWeight="bold"
                              textTransform="uppercase"
                              sx={hidden ? visuallyHiddenSx : undefined}
                            >
                              {heading}
                            </MDTypography>
                          </TableCell>
                        );
                      }
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {clients.map((client) => {
                    const w9 =
                      W9_BADGE[client.w9_status] ?? W9_BADGE_FALLBACK;
                    return (
                      <TableRow key={client.id}>
                        <TableCell component="th" scope="row">
                          <MDTypography
                            component={NextLink}
                            href={`/clients/${client.id}`}
                            variant="button"
                            fontWeight="medium"
                          >
                            {client.name}
                          </MDTypography>
                          {client.archived_at ? (
                            <MDTypography
                              display="block"
                              variant="caption"
                              color="text"
                            >
                              Archived
                            </MDTypography>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <MDTypography
                            display="block"
                            variant="button"
                            fontWeight="regular"
                          >
                            {client.contact_name ?? "—"}
                          </MDTypography>
                          <MDTypography
                            display="block"
                            variant="caption"
                            color="text"
                          >
                            {client.contact_email ?? ""}
                          </MDTypography>
                        </TableCell>
                        <TableCell align="right">
                          <MDTypography variant="button" fontWeight="medium">
                            {formatCents(client.default_day_rate_cents)}
                          </MDTypography>
                        </TableCell>
                        <TableCell align="right">
                          <MDTypography
                            variant="button"
                            color="text"
                            fontWeight="regular"
                          >
                            Net {client.payment_terms_days}
                          </MDTypography>
                        </TableCell>
                        <TableCell>
                          <MDBadge
                            variant="gradient"
                            color={w9.tone}
                            badgeContent={w9.label}
                            size="sm"
                            container
                          />
                        </TableCell>
                        <TableCell align="right">
                          <MDButton
                            component={NextLink}
                            href={`/clients/${client.id}`}
                            variant="outlined"
                            color="info"
                            size="small"
                            aria-label={`Edit ${client.name}`}
                          >
                            Edit
                          </MDButton>
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
    </PageShell>
  );
}
