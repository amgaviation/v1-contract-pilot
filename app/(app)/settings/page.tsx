import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";

import { requireAccount } from "@/lib/supabase/account";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import PageShell from "../page-shell";
import SettingsForm, { type SettingsValues } from "./settings-form";
import LogoPanel from "./logo-panel";
import SettingsTabs from "./settings-tabs";
import DayTypesPanel from "./day-types-panel";

type DayTypeRow = Database["pilot"]["Tables"]["day_types"]["Row"];

export const metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  // F10: makes the day-types tab deep-linkable (/settings?tab=day-types)
  // — read server-side and handed to the client tab switch as its initial
  // state, rather than making the client fetch it itself.
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;

  // requireAccount already returns the full account row, so there is no
  // second query to make here — and no query error to mishandle.
  const { account, role, user } = await requireAccount("/settings");
  const canEdit = role === "owner";

  const supabase = await createClient();
  // RLS scopes this to the caller's tenant; no account_id filter is
  // needed or wanted on a plain listing select (see the note in
  // clients/page.tsx). Ordered the same way the trip day grid orders its
  // picker, so the two stay visually in step.
  const { data: dayTypesData, error: dayTypesError } = await supabase
    .from("day_types")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("key", { ascending: true });

  const dayTypes = (dayTypesData ?? []) as DayTypeRow[];

  return (
    <PageShell
      title="Settings"
      subtitle={`Signed in as ${user.email ?? "your account"}`}
    >
      <SettingsTabs
        initialTab={tab}
        business={
          <Grid container spacing={3}>
            <Grid item xs={12} lg={8}>
              <SettingsForm values={account as SettingsValues} canEdit={canEdit} />
            </Grid>
            <Grid item xs={12} lg={4}>
              <MDBox mb={3}>
                <LogoPanel hasLogo={Boolean(account.logo_url)} canEdit={canEdit} />
              </MDBox>
              <Card>
                <MDBox p={3} lineHeight={1.4}>
                  <MDTypography variant="h6">Plan</MDTypography>
                  <MDTypography display="block" variant="button" color="text" fontWeight="regular">
                    {account.plan ?? "—"} · {account.status}
                  </MDTypography>
                  {/* Read-only on purpose. Plan, seat count and every Stripe
                      column are withheld from the tenant UPDATE grant AND
                      blocked by the accounts_protect_billing_columns trigger,
                      so billing state changes only ever arrive through the
                      Stripe webhook. Showing an editable control here would
                      promise something the database refuses. */}
                  <MDBox mt={1}>
                    <MDTypography variant="caption" color="text">
                      Billing is managed through Stripe. Changes to your plan
                      arrive here automatically.
                    </MDTypography>
                  </MDBox>
                </MDBox>
              </Card>
            </Grid>
          </Grid>
        }
        dayTypes={
          dayTypesError ? (
            <Card>
              <MDBox p={3}>
                <MDTypography variant="button" color="error">
                  Couldn&rsquo;t load your day types. Try reloading the page.
                </MDTypography>
              </MDBox>
            </Card>
          ) : (
            <DayTypesPanel dayTypes={dayTypes} canEdit={canEdit} />
          )
        }
      />
    </PageShell>
  );
}
