import type { ReactNode } from "react";
import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import DashboardLayout from "@/components/mdpro/examples/LayoutContainers/DashboardLayout";
import DashboardNavbar from "@/components/mdpro/examples/Navbars/DashboardNavbar";
import Footer from "@/components/mdpro/examples/Footer";
import { BRAND } from "@/lib/brand";

/**
 * The standard chrome for a feature page: navbar, a title block with an
 * optional action slot, and the footer carrying BRAND.attribution — the
 * only place AMG is named (decision #18).
 *
 * A server component composing client ones, so pages built on it can stay
 * server components and query Supabase directly.
 */
export default function PageShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DashboardLayout>
      <DashboardNavbar />
      <MDBox py={3}>
        <MDBox
          mb={3}
          display="flex"
          flexDirection={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
          gap={2}
        >
          <MDBox lineHeight={1.25}>
            <MDTypography variant="h4" fontWeight="bold">
              {title}
            </MDTypography>
            {subtitle ? (
              <MDTypography variant="button" color="text" fontWeight="regular">
                {subtitle}
              </MDTypography>
            ) : null}
          </MDBox>
          {action ? (
            <MDBox display="flex" gap={1.5}>
              {action}
            </MDBox>
          ) : null}
        </MDBox>
        {children}
      </MDBox>
      <Footer company={{ name: BRAND.attribution }} links={[]} />
    </DashboardLayout>
  );
}
