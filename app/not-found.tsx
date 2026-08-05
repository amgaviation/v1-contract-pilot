"use client";

import NextLink from "next/link";
import Card from "@mui/material/Card";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import DashboardLayout from "@/components/mdpro/examples/LayoutContainers/DashboardLayout";
import DashboardNavbar from "@/components/mdpro/examples/Navbars/DashboardNavbar";

/**
 * Without this file, an unmatched route falls through to Next's stock
 * 404 — no nav, no brand, no way back except the browser Back button.
 * The root layout (AppShell provider + Sidenav + theme) still wraps
 * this, so the MD components work here. MDButton with component={NextLink}
 * renders a real <a> styled as a button — no button-inside-anchor
 * nesting.
 */
export default function NotFound() {
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
            <MDTypography variant="h4">Not found</MDTypography>
            <MDBox mt={1} mb={3}>
              <MDTypography variant="button" color="text" fontWeight="regular">
                There&rsquo;s nothing at this address. Pick a section from the
                left.
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
      </MDBox>
    </DashboardLayout>
  );
}
