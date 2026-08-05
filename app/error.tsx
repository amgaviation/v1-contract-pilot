"use client";

import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import AuthShell from "@/components/mdpro/AuthShell";

/**
 * Root error boundary. An unhandled throw anywhere below the root layout
 * lands here, replacing the group layouts (and their dashboard chrome),
 * so it brings its own theme-only shell (AuthShell) rather than
 * DashboardLayout/Sidenav, which need the dashboard controller that is no
 * longer mounted at this point. Next.js requires error.tsx to be a Client
 * Component.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AuthShell>
      <Card sx={{ width: "100%", maxWidth: "30rem" }}>
        <MDBox p={4} textAlign="center" lineHeight={1.4}>
          <MDTypography variant="h4">Something went wrong</MDTypography>
          <MDBox mt={1} mb={3}>
            <MDTypography variant="button" color="text" fontWeight="regular">
              That didn&rsquo;t load. Try again, or head back to the overview.
            </MDTypography>
          </MDBox>
          <MDButton variant="gradient" color="info" onClick={reset}>
            Try again
          </MDButton>
        </MDBox>
      </Card>
    </AuthShell>
  );
}
