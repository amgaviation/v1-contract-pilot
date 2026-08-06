import { notFound } from "next/navigation";
import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";

import { createClient } from "@/lib/supabase/server";
import { requireAccount } from "@/lib/supabase/account";
import type { Database } from "@/lib/supabase/database.types";
import PageShell from "../../page-shell";
import ClientForm from "../client-form";
import { updateClientRecord } from "../actions";
import ArchiveButton from "./archive-button";
import RateOverridesPanel from "./rate-overrides-panel";

type ClientRow = Database["pilot"]["Tables"]["clients"]["Row"];
type DayTypeRow = Database["pilot"]["Tables"]["day_types"]["Row"];
type ClientRateRow = Database["pilot"]["Tables"]["client_rates"]["Row"];

export const metadata = { title: "Edit client" };

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireAccount(`/clients/${id}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  // A failed query is not a missing client — see the note in
  // trips/[id]/page.tsx.
  if (error) {
    throw new Error(`Couldn't load client ${id}: ${error.message}`);
  }

  const client = data as ClientRow | null;
  // Another tenant's id and a nonexistent id are indistinguishable here,
  // and that is the point: RLS returns no row either way, so a probe
  // can't tell "not yours" from "not real".
  if (!client) notFound();

  // F10: fetches EVERY day type, not just active ones. An archived type
  // is dropped from every picker (it's already removed from new trips'
  // day grids), but an override on one doesn't stop existing — filtering
  // the query itself made that override invisible while it still applied
  // to any not-yet-invoiced day already captured under the old type.
  // RateOverridesPanel is what decides active-vs-archived-with-override.
  const [dayTypesResult, ratesResult] = await Promise.all([
    supabase
      .from("day_types")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("key", { ascending: true }),
    supabase.from("client_rates").select("*").eq("client_id", id),
  ]);

  const dayTypes = (dayTypesResult.data ?? []) as DayTypeRow[];
  const rateOverrides = (ratesResult.data ?? []) as ClientRateRow[];
  const ratesLoadError = dayTypesResult.error ?? ratesResult.error;

  return (
    <PageShell
      title={client.name}
      subtitle={client.archived_at ? "Archived" : "Client"}
      action={<ArchiveButton id={client.id} archived={Boolean(client.archived_at)} />}
    >
      {client.archived_at ? (
        <MDBox mb={3}>
          <Card>
            <MDBox p={3}>
              <MDTypography variant="button" color="text" fontWeight="regular">
                This client is archived. Their trips and invoices are
                untouched — they just won&rsquo;t appear when you pick a client
                for new work.
              </MDTypography>
            </MDBox>
          </Card>
        </MDBox>
      ) : null}

      <ClientForm
        action={updateClientRecord}
        values={client}
        submitLabel="Save changes"
      />

      {/* F5: cancellation_policy_note had nowhere it would ever actually
          be seen — the invoice draft only surfaces it when a CANCELED
          trip is selected, and the trip picker only offers COMPLETED
          trips, so the note was write-only. Placed next to the rate
          overrides, the other per-client terms the product records but
          doesn't act on by itself, and labeled the same way. */}
      {client.cancellation_policy_note ? (
        <MDBox mt={3}>
          <Card>
            <MDBox p={3}>
              <MDTypography variant="button" color="text" fontWeight="regular">
                <MDTypography component="span" variant="button" fontWeight="bold">
                  Cancellation terms on file:
                </MDTypography>{" "}
                {client.cancellation_policy_note}
              </MDTypography>
              <MDBox mt={0.5}>
                <MDTypography variant="caption" color="text">
                  Recorded for reference only — never applied automatically.
                  Add a cancellation fee line on the invoice yourself if this
                  client owes one.
                </MDTypography>
              </MDBox>
            </MDBox>
          </Card>
        </MDBox>
      ) : null}

      <MDBox mt={3}>
        {ratesLoadError ? (
          <Card>
            <MDBox p={3}>
              <MDTypography variant="button" color="error">
                Couldn&rsquo;t load rate overrides. Try reloading the page.
              </MDTypography>
            </MDBox>
          </Card>
        ) : (
          <RateOverridesPanel
            clientId={client.id}
            dayTypes={dayTypes}
            overrides={rateOverrides}
          />
        )}
      </MDBox>
    </PageShell>
  );
}
