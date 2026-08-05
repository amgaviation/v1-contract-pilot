"use client";

/**
 * Placeholder screen for sections that are scoped in docs/PLAN.md but not
 * built yet. Same props contract as the retired
 * components/shell/phase-placeholder.tsx (title, phase), recomposed on the
 * ported Material Dashboard system: DashboardLayout > DashboardNavbar >
 * centered Card > Footer. Without a page at each Sidenav route, clicking
 * one would hit Next's default 404 (no nav, no way back) — this keeps the
 * nav honest until real content lands.
 */

// prop-types is a library for typechecking of props
import PropTypes from "prop-types";

// @mui material components
import Card from "@mui/material/Card";

// Material Dashboard 3 PRO React components
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";

// Material Dashboard 3 PRO React examples
import DashboardLayout from "@/components/mdpro/examples/LayoutContainers/DashboardLayout";
import DashboardNavbar from "@/components/mdpro/examples/Navbars/DashboardNavbar";
import Footer from "@/components/mdpro/examples/Footer";

// Brand strings — the single permitted source (lib/brand.ts)
import { BRAND } from "@/lib/brand";

export function PhasePlaceholder({ title, phase }) {
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
            <MDTypography variant="h4">{title}</MDTypography>
            <MDBox mt={1}>
              <MDTypography variant="button" color="text" fontWeight="regular">
                Not built yet &mdash; see docs/PLAN.md, {phase}.
              </MDTypography>
            </MDBox>
          </MDBox>
        </Card>
      </MDBox>
      <Footer company={{ name: BRAND.attribution }} links={[]} />
    </DashboardLayout>
  );
}

PhasePlaceholder.propTypes = {
  title: PropTypes.string.isRequired,
  phase: PropTypes.string.isRequired,
};

export default PhasePlaceholder;
