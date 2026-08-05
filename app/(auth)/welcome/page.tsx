import { redirect } from "next/navigation";
import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { getSessionContext } from "@/lib/supabase/account";
import { signOut } from "./actions";
import { StartTrialButton } from "./welcome-actions";

export const metadata = { title: "Welcome" };

// Presentational only — the authoritative amount is the Stripe Price
// (STRIPE_PRICE_SOLO), which is what actually gets charged. Kept in sync
// by hand; the price object is the source of truth, not this string.
const PRICE_LABEL = "$29/month";

/**
 * The resting state for a signed-in user with no tenant. Per docs/PLAN.md
 * decisions #6/#7 the Stripe checkout webhook is the ONLY thing that
 * creates a tenant, so this page starts that checkout rather than
 * provisioning anything itself.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.account) redirect("/");

  const { checkout } = await searchParams;

  // Returning from a completed checkout, but the account isn't visible
  // yet: the webhook is racing this browser redirect and usually wins by
  // a second or two. Say what's happening instead of showing the trial
  // pitch again to someone who just paid, which would read as a failure.
  if (checkout === "complete") {
    return (
      <Card sx={{ width: "100%", maxWidth: "28rem" }}>
        <MDBox p={4} textAlign="center" lineHeight={1.5}>
          <MDTypography variant="h4" fontWeight="bold" mb={1}>
            Setting up your workspace
          </MDTypography>
          <MDTypography variant="body2" color="text">
            Payment confirmed. We&rsquo;re provisioning your account now —
            this usually takes a few seconds.
          </MDTypography>
          <MDBox mt={3}>
            {/* A plain link, not a client poller: one deliberate refresh is
                honest about the state and avoids a spinner that could hide
                a genuine webhook failure forever. */}
            <MDButton href="/welcome" variant="gradient" color="info">
              Refresh
            </MDButton>
          </MDBox>
        </MDBox>
      </Card>
    );
  }

  return (
    <Card sx={{ width: "100%", maxWidth: "28rem" }}>
      <MDBox p={4} textAlign="center" lineHeight={1.5}>
        <MDTypography variant="h4" fontWeight="bold" mb={1}>
          You&rsquo;re signed in
        </MDTypography>
        <MDTypography variant="body2" color="text">
          Log the trip once — your logbook entry, invoice, and expenses all
          post from it. Start your trial to set up your workspace.
        </MDTypography>

        {checkout === "cancelled" ? (
          <MDBox mt={2}>
            <MDTypography variant="caption" color="text">
              Checkout cancelled — nothing was charged.
            </MDTypography>
          </MDBox>
        ) : null}

        <MDBox mt={3}>
          <StartTrialButton priceLabel={PRICE_LABEL} />
        </MDBox>

        <MDBox mt={3}>
          <form action={signOut}>
            <MDButton type="submit" variant="text" color="dark" size="small">
              Sign out
            </MDButton>
          </form>
        </MDBox>
      </MDBox>
    </Card>
  );
}
