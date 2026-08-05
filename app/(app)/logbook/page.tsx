import NextLink from "next/link";
import Card from "@mui/material/Card";
import Grid from "@mui/material/Grid";
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
import PageShell from "../page-shell";
import { logbookFrom, type LogbookEntryRow, type LogbookSource } from "./db";

export const metadata = { title: "Logbook" };

type Badge = { tone: string; label: string };

const SOURCE_FALLBACK: Badge = { tone: "secondary", label: "Manual" };
const SOURCE_BADGE: Record<LogbookSource, Badge> = {
  manual: SOURCE_FALLBACK,
  trip: { tone: "info", label: "From trip" },
  import: { tone: "dark", label: "Imported" },
  foreflight_sync: { tone: "dark", label: "ForeFlight sync" },
};

// logbookFrom() returns `any` (see its own comment), so nothing type-checks
// these numeric(4,1) columns before they reach here — if one ever arrives
// as a string, `+` concatenates instead of adding and `.toFixed` throws a
// 500. Number() coerces the same way trips/invoices/page.tsx already does
// for their own numerics, so a string doesn't silently become NaN-shaped
// arithmetic three renders downstream.

/** total_time is NOT NULL; every other time column can be null. */
function sum(entries: LogbookEntryRow[], pick: (e: LogbookEntryRow) => number | null): number {
  return entries.reduce((total, entry) => total + Number(pick(entry) ?? 0), 0);
}

function landings(entry: LogbookEntryRow): number {
  return (
    Number(entry.day_landings_full_stop) +
    Number(entry.day_landings_touch_go) +
    Number(entry.night_landings_full_stop) +
    Number(entry.night_landings_touch_go)
  );
}

// Supabase's Data API caps rows (commonly 1000) and TRUNCATES SILENTLY —
// an explicit .limit makes that boundary visible instead of invisible, and
// truncatedEntries below turns it into a caveat rather than a quietly
// wrong sum. The real fix is a server-side aggregate (an RPC or a view),
// deferred to a later pass.
const ENTRIES_LIMIT = 1000;

export default async function LogbookPage() {
  await requireAccount("/logbook");

  const supabase = await createClient();
  const { data, error } = await logbookFrom(supabase, "logbook_entries")
    .select("*")
    .order("entry_date", { ascending: false })
    .limit(ENTRIES_LIMIT);

  const entries = (data ?? []) as LogbookEntryRow[];
  const truncatedEntries = entries.length === ENTRIES_LIMIT;

  const totals = {
    total: sum(entries, (e) => e.total_time),
    pic: sum(entries, (e) => e.pic_time),
    night: sum(entries, (e) => e.night_time),
    instrument: sum(entries, (e) => (e.instrument_actual_time ?? 0) + (e.instrument_simulated_time ?? 0)),
    landings: entries.reduce((total, e) => total + landings(e), 0),
  };

  return (
    <PageShell
      title="Logbook"
      subtitle={
        error
          ? "Couldn't load your logbook."
          : `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`
      }
      action={
        <MDBox display="flex" gap={1.5}>
          <MDButton component={NextLink} href="/logbook/drafts" variant="outlined" color="info">
            Trip drafts
          </MDButton>
          <MDButton component={NextLink} href="/logbook/new" variant="gradient" color="info">
            Log an entry
          </MDButton>
        </MDBox>
      }
    >
      {error ? (
        <Card>
          <MDBox p={3}>
            <MDTypography variant="button" color="error">
              {friendlyDbError(error, "logbook_entries.select")}
            </MDTypography>
          </MDBox>
        </Card>
      ) : (
        <>
          {truncatedEntries ? (
            <MDBox mb={3}>
              <Card>
                <MDBox p={2}>
                  <MDTypography variant="button" color="warning">
                    {`Totals below may be partial — there are more than ${ENTRIES_LIMIT} entries and only the first ${ENTRIES_LIMIT} were totaled.`}
                  </MDTypography>
                </MDBox>
              </Card>
            </MDBox>
          ) : null}
          <MDBox mb={3}>
            <Grid container spacing={2}>
              {[
                { label: "Total time", value: totals.total, decimals: 1 },
                { label: "PIC", value: totals.pic, decimals: 1 },
                { label: "Night", value: totals.night, decimals: 1 },
                { label: "Instrument", value: totals.instrument, decimals: 1 },
                { label: "Landings", value: totals.landings, decimals: 0 },
              ].map((stat) => (
                <Grid item xs={6} md={2.4} key={stat.label}>
                  <Card>
                    <MDBox p={2.5} textAlign="center">
                      <MDTypography variant="caption" color="text" textTransform="uppercase" fontWeight="bold">
                        {stat.label}
                      </MDTypography>
                      <MDTypography variant="h4" fontWeight="bold">
                        {stat.decimals === 0 ? stat.value : stat.value.toFixed(1)}
                      </MDTypography>
                    </MDBox>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </MDBox>

          <Card>
            <MDBox p={3}>
              {entries.length === 0 ? (
                <MDBox py={4} textAlign="center">
                  <MDTypography variant="h6">No logbook entries yet</MDTypography>
                  <MDTypography variant="button" color="text" fontWeight="regular">
                    Log a flight by hand, or confirm the entries a completed trip proposes.
                  </MDTypography>
                  <MDBox mt={3} display="flex" gap={1.5} justifyContent="center">
                    <MDButton component={NextLink} href="/logbook/new" variant="gradient" color="info">
                      Log your first entry
                    </MDButton>
                    <MDButton component={NextLink} href="/logbook/drafts" variant="outlined" color="info">
                      Review trip drafts
                    </MDButton>
                  </MDBox>
                </MDBox>
              ) : (
                <TableContainer sx={{ boxShadow: "none" }}>
                  <Table>
                    <TableHead sx={{ display: "table-header-group" }}>
                      <TableRow>
                        {["Date", "Route", "Aircraft", "Role", "Total", "Night", "Instrument", "Landings", "Source"].map(
                          (heading, index) => (
                            <TableCell key={heading} align={index >= 4 ? "right" : "left"}>
                              <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                                {heading}
                              </MDTypography>
                            </TableCell>
                          )
                        )}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {entries.map((entry) => {
                        const source = SOURCE_BADGE[entry.source] ?? SOURCE_FALLBACK;
                        return (
                          <TableRow key={entry.id}>
                            <TableCell component="th" scope="row">
                              <MDTypography
                                component={NextLink}
                                href={`/logbook/${entry.id}`}
                                variant="button"
                                fontWeight="medium"
                              >
                                {formatDate(entry.entry_date)}
                              </MDTypography>
                            </TableCell>
                            <TableCell>
                              <MDTypography variant="button" color="text" fontWeight="regular">
                                {entry.from_icao ?? "—"} → {entry.to_icao ?? "—"}
                              </MDTypography>
                            </TableCell>
                            <TableCell>
                              <MDTypography variant="button" color="text" fontWeight="regular">
                                {entry.aircraft_ident ?? "—"}
                              </MDTypography>
                            </TableCell>
                            <TableCell>
                              <MDTypography variant="button" color="text" fontWeight="regular">
                                {entry.role}
                              </MDTypography>
                            </TableCell>
                            <TableCell align="right">
                              <MDTypography variant="button" fontWeight="medium">
                                {Number(entry.total_time).toFixed(1)}
                              </MDTypography>
                            </TableCell>
                            <TableCell align="right">
                              <MDTypography variant="button" color="text" fontWeight="regular">
                                {Number(entry.night_time ?? 0).toFixed(1)}
                              </MDTypography>
                            </TableCell>
                            <TableCell align="right">
                              <MDTypography variant="button" color="text" fontWeight="regular">
                                {(Number(entry.instrument_actual_time ?? 0) + Number(entry.instrument_simulated_time ?? 0)).toFixed(1)}
                              </MDTypography>
                            </TableCell>
                            <TableCell align="right">
                              <MDTypography variant="button" color="text" fontWeight="regular">
                                {landings(entry)}
                              </MDTypography>
                            </TableCell>
                            <TableCell align="right">
                              <MDBadge variant="gradient" color={source.tone} badgeContent={source.label} size="sm" container />
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
        </>
      )}
    </PageShell>
  );
}
