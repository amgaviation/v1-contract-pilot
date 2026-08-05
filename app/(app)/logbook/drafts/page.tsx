import Card from "@mui/material/Card";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import { friendlyDbError } from "@/lib/db-errors";
import { formatDate, formatDateRange } from "@/lib/format";
import PageShell from "../../page-shell";
import { logbookFrom, draftPayloadForLeg, type DraftLegRow, type DraftTripRow } from "../db";
import { ConfirmLegButton, ConfirmTripButton } from "./confirm-draft-button";

export const metadata = { title: "Trip drafts" };

/**
 * Completing a trip PROPOSES logbook entries from its legs; nothing lands
 * in logbook_entries until the pilot confirms here (docs/PLAN.md "Trip →
 * logbook is a confirmed draft"). There is no stored draft/proposal row —
 * this page computes "unconfirmed" at read time as "a completed trip's
 * leg that no logbook_entries row yet references via trip_leg_id", and
 * app/(app)/logbook/actions.ts's confirmLegDraft/confirmTripDrafts are the
 * only code paths that ever turn one into a real row. See the Phase 6
 * migration's file header for the full reasoning, including why this is a
 * deliberate departure from the house "derived state is a trigger" rule.
 */
export default async function LogbookDraftsPage() {
  const { account } = await requireAccount("/logbook/drafts");

  const supabase = await createClient();
  const { data: tripData, error: tripError } = await supabase
    .from("trips")
    .select("id, starts_on, ends_on, aircraft_ident, aircraft_type, status")
    .eq("status", "completed")
    .order("starts_on", { ascending: false });

  // friendlyDbError throughout this file — see confirmedError below; a raw
  // error.message carries internal schema (table/constraint names) that
  // isn't useful to a pilot, so it never belongs on screen.
  if (tripError) {
    return (
      <PageShell title="Trip drafts" subtitle="Legs from completed trips, waiting on your review.">
        <Card>
          <MDBox p={3}>
            <MDTypography variant="button" color="error">
              {friendlyDbError(tripError, "trips.select")}
            </MDTypography>
          </MDBox>
        </Card>
      </PageShell>
    );
  }

  const trips = (tripData ?? []) as DraftTripRow[];
  const tripIds = trips.map((trip) => trip.id);

  const [{ data: legData, error: legsError }, { data: confirmedData, error: confirmedError }] =
    tripIds.length === 0
      ? [{ data: [], error: null }, { data: [], error: null }]
      : await Promise.all([
          supabase
            .from("trip_legs")
            .select(
              "id, trip_id, leg_date, from_icao, to_icao, block_hours, night_hours, instrument_hours, day_landings, night_takeoffs, night_landings_full_stop, night_landings_touch_go, approaches, holds"
            )
            .in("trip_id", tripIds)
            .order("leg_date", { ascending: true }),
          logbookFrom(supabase, "logbook_entries")
            .select("trip_leg_id")
            .eq("account_id", account.id)
            .in("trip_id", tripIds)
            .not("trip_leg_id", "is", null),
        ]);

  if (legsError) {
    return (
      <PageShell title="Trip drafts" subtitle="Legs from completed trips, waiting on your review.">
        <Card>
          <MDBox p={3}>
            <MDTypography variant="button" color="error">
              {friendlyDbError(legsError, "trip_legs.select")}
            </MDTypography>
          </MDBox>
        </Card>
      </PageShell>
    );
  }
  if (confirmedError) {
    return (
      <PageShell title="Trip drafts" subtitle="Legs from completed trips, waiting on your review.">
        <Card>
          <MDBox p={3}>
            <MDTypography variant="button" color="error">
              {friendlyDbError(confirmedError, "logbook_entries.select")}
            </MDTypography>
          </MDBox>
        </Card>
      </PageShell>
    );
  }

  const legs = (legData ?? []) as DraftLegRow[];
  const confirmedLegIds = new Set(
    ((confirmedData ?? []) as { trip_leg_id: string }[]).map((row) => row.trip_leg_id)
  );

  const legsByTrip = new Map<string, DraftLegRow[]>();
  for (const leg of legs) {
    if (confirmedLegIds.has(leg.id)) continue;
    const bucket = legsByTrip.get(leg.trip_id) ?? [];
    bucket.push(leg);
    legsByTrip.set(leg.trip_id, bucket);
  }

  const pendingTrips = trips
    .map((trip) => ({ trip, legs: legsByTrip.get(trip.id) ?? [] }))
    .filter((entry) => entry.legs.length > 0);

  return (
    <PageShell
      title="Trip drafts"
      subtitle={
        pendingTrips.length === 0
          ? "Nothing waiting — every completed trip's legs are already in your logbook."
          : `${pendingTrips.length} completed trip${pendingTrips.length === 1 ? "" : "s"} with unconfirmed legs`
      }
    >
      {pendingTrips.length === 0 ? (
        <Card>
          <MDBox p={4} textAlign="center">
            <MDTypography variant="h6">Nothing to review</MDTypography>
            <MDTypography variant="button" color="text" fontWeight="regular">
              Complete a trip with legs and its proposed entries will show up here for you to
              confirm — nothing reaches your logbook automatically.
            </MDTypography>
          </MDBox>
        </Card>
      ) : (
        pendingTrips.map(({ trip, legs: tripLegs }) => (
          <MDBox key={trip.id} mb={3}>
            <Card>
              <MDBox p={3} pb={2} display="flex" justifyContent="space-between" alignItems="flex-start" gap={2}>
                <MDBox lineHeight={1.3}>
                  <MDTypography variant="h6">{formatDateRange(trip.starts_on, trip.ends_on)}</MDTypography>
                  <MDTypography variant="caption" color="text">
                    {trip.aircraft_ident ?? "No tail number"}
                    {trip.aircraft_type ? ` · ${trip.aircraft_type}` : ""}
                  </MDTypography>
                </MDBox>
                <ConfirmTripButton tripId={trip.id} legCount={tripLegs.length} />
              </MDBox>
              <MDBox px={3} pb={3}>
                <TableContainer sx={{ boxShadow: "none" }}>
                  <Table>
                    <TableHead sx={{ display: "table-header-group" }}>
                      <TableRow>
                        {["Date", "Route", "Total", "Night", "Instrument", "Landings", ""].map(
                          (heading, index) => (
                            <TableCell key={heading || index} align={index >= 2 && index <= 5 ? "right" : "left"}>
                              <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                                {heading}
                              </MDTypography>
                            </TableCell>
                          )
                        )}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {tripLegs.map((leg) => {
                        const proposal = draftPayloadForLeg(trip, leg);
                        // logbookFrom()/draftPayloadForLeg return `any`, so
                        // nothing type-checks these numeric(4,1) columns —
                        // Number() coerces the same way trips/invoices
                        // already do for their own numerics, so a value
                        // that ever arrives as a string doesn't silently
                        // concatenate instead of sum.
                        const landings =
                          Number(proposal.day_landings_full_stop) +
                          Number(proposal.day_landings_touch_go) +
                          Number(proposal.night_landings_full_stop) +
                          Number(proposal.night_landings_touch_go);
                        return (
                          <TableRow key={leg.id}>
                            <TableCell>
                              <MDTypography variant="button" fontWeight="medium">
                                {formatDate(proposal.entry_date)}
                              </MDTypography>
                            </TableCell>
                            <TableCell>
                              <MDTypography variant="button" color="text" fontWeight="regular">
                                {proposal.from_icao ?? "—"} → {proposal.to_icao ?? "—"}
                              </MDTypography>
                            </TableCell>
                            <TableCell align="right">
                              <MDTypography variant="button" fontWeight="regular">
                                {Number(proposal.total_time).toFixed(1)}
                              </MDTypography>
                            </TableCell>
                            <TableCell align="right">
                              <MDTypography variant="button" color="text" fontWeight="regular">
                                {Number(proposal.night_time ?? 0).toFixed(1)}
                              </MDTypography>
                            </TableCell>
                            <TableCell align="right">
                              <MDTypography variant="button" color="text" fontWeight="regular">
                                {Number(proposal.instrument_actual_time ?? 0).toFixed(1)}
                              </MDTypography>
                            </TableCell>
                            <TableCell align="right">
                              <MDTypography variant="button" color="text" fontWeight="regular">
                                {landings}
                              </MDTypography>
                            </TableCell>
                            <TableCell align="right">
                              <ConfirmLegButton
                                tripLegId={leg.id}
                                label={`${proposal.from_icao ?? "?"} to ${proposal.to_icao ?? "?"} on ${formatDate(proposal.entry_date)}`}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
                <MDBox mt={2}>
                  <MDTypography variant="caption" color="text" fontWeight="regular">
                    These numbers come straight from the trip's legs. Edit them on the trip
                    first if anything's wrong — you can also fix any individual field on the
                    logbook entry after confirming.
                  </MDTypography>
                </MDBox>
              </MDBox>
            </Card>
          </MDBox>
        ))
      )}
    </PageShell>
  );
}
