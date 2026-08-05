"use client";

import NextLink from "next/link";
import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import AuthShell from "@/components/mdpro/AuthShell";

/**
 * Root 404 — reached for any unmatched path, signed in or out. It renders
 * OUTSIDE the (app) dashboard chrome, so it brings its own theme-only
 * shell (AuthShell) rather than DashboardLayout/Sidenav, which need the
 * dashboard controller this page doesn't sit inside. MDButton with
 * component={NextLink} renders a real <a> styled as a button.
 */
export default function NotFound() {
  return (
    <AuthShell>
      <Card sx={{ width: "100%", maxWidth: "30rem" }}>
        <MDBox p={4} textAlign="center" lineHeight={1.4}>
          <MDTypography variant="h4">Not found</MDTypography>
          <MDBox mt={1} mb={3}>
            <MDTypography variant="button" color="text" fontWeight="regular">
              There&rsquo;s nothing at this address.
            </MDTypography>
          </MDBox>
          <MDButton
            component={NextLink}
            href="/"
            variant="gradient"
            color="info"
          >
            Back to overview
          </MDButton>
        </MDBox>
      </Card>
    </AuthShell>
  );
}
