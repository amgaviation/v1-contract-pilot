"use client";

import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import DashboardLayout from "@/components/mdpro/examples/LayoutContainers/DashboardLayout";
import DashboardNavbar from "@/components/mdpro/examples/Navbars/DashboardNavbar";

/**
 * Route-level error boundary. Without this, an unhandled throw in any
 * Server Component under this layout falls through to Next's default
 * error page — no brand, no nav, no recovery affordance. Next.js
 * requires error.tsx to be a Client Component. The root layout (and so
 * the AppShell provider, Sidenav and theme) stays mounted around this,
 * which is what lets the MD components render here.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <DashboardLayout>
      <DashboardNavbar />
      <MDBox
        py={6}
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="50vh"
      >
        <Card sx={{ maxWidth: "30rem", width: "100%" }}>
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
      </MDBox>
    </DashboardLayout>
  );
}
