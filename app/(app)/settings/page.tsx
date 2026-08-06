import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";

import { requireAccount } from "@/lib/supabase/account";
import PageShell from "../page-shell";
import SettingsForm, { type SettingsValues } from "./settings-form";
import LogoPanel from "./logo-panel";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  // requireAccount already returns the full account row, so there is no
  // second query to make here — and no query error to mishandle.
  const { account, role, user } = await requireAccount("/settings");
  const canEdit = role === "owner";

  return (
    <PageShell
      title="Settings"
      subtitle={`Signed in as ${user.email ?? "your account"}`}
    >
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
    </PageShell>
  );
}
