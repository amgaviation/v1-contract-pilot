import { redirect } from "next/navigation";
import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import { getSessionContext } from "@/lib/supabase/account";
import { signOut } from "./actions";

export const metadata = { title: "Welcome" };

/**
 * The resting state for a signed-in user who has no tenant yet. Per
 * docs/PLAN.md decisions #6/#7 a tenant is created ONLY by the Stripe
 * checkout webhook (Phase 2, not built), so this is a real, expected
 * state — not an error — and there is deliberately no "create my account"
 * button here that would mint an unbilled tenant. When the billing flow
 * lands, its "start your trial" call to action replaces this copy.
 */
export default async function WelcomePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.account) redirect("/");

  return (
    <Card sx={{ width: "100%", maxWidth: "28rem" }}>
      <MDBox p={4} textAlign="center" lineHeight={1.5}>
        <MDTypography variant="h4" fontWeight="bold" mb={1}>
          You're signed in
        </MDTypography>
        <MDTypography variant="body2" color="text">
          This account isn't on an active plan yet. Subscribing sets up your
          workspace and unlocks your trips, invoices, and expenses — the
          billing flow that provisions it is coming next.
        </MDTypography>
        <MDBox mt={3} display="flex" justifyContent="center">
          <form action={signOut}>
            <MDButton type="submit" variant="outlined" color="dark" size="small">
              Sign out
            </MDButton>
          </form>
        </MDBox>
      </MDBox>
    </Card>
  );
}
