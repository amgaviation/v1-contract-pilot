"use client";

import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

import MDBox from "@/components/mdpro/MDBox";
import MDTypography from "@/components/mdpro/MDTypography";
import MDButton from "@/components/mdpro/MDButton";
import MDBadge from "@/components/mdpro/MDBadge";

import DashboardLayout from "@/components/mdpro/examples/LayoutContainers/DashboardLayout";
import DashboardNavbar from "@/components/mdpro/examples/Navbars/DashboardNavbar";
import Footer from "@/components/mdpro/examples/Footer";
import ComplexStatisticsCard from "@/components/mdpro/examples/Cards/StatisticsCards/ComplexStatisticsCard";

import { BRAND } from "@/lib/brand";
import {
  KPIS,
  CURRENCY_ROWS,
  CURRENCY_DISCLAIMER,
  READY_TO_INVOICE,
  NEEDS_ATTENTION,
} from "@/lib/mock-data";

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Icon + color variant per KPI, keyed by lib/mock-data KPI id, following
 * the kit's analytics-dashboard rhythm (dark / info / success / primary).
 * Icon names are Material Icons font ligatures.
 */
type KpiCardStyle = {
  color: "dark" | "info" | "success" | "primary";
  icon: string;
};
const KPI_CARD_STYLE: Record<string, KpiCardStyle> = {
  unbilled: { color: "dark", icon: "flight_takeoff" },
  awaiting: { color: "info", icon: "receipt_long" },
  paid: { color: "success", icon: "payments" },
  deductible: { color: "primary", icon: "savings" },
};
const KPI_CARD_FALLBACK: KpiCardStyle = { color: "info", icon: "insights" };

/** Status → MDBadge color (variant="gradient"). */
const STATUS_BADGE_COLOR: Record<string, string> = {
  ok: "success",
  warn: "warning",
  bad: "error",
  neutral: "secondary",
};

/**
 * Visually-hidden-but-readable: the table <caption> stays in the
 * accessibility tree without occupying layout. Values are structural
 * (no visual tokens), so this lives outside the token layer legally.
 */
const visuallyHiddenSx = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: 0,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
} as const;

/**
 * Overview — the product's home screen, recomposed on the ported
 * Material Dashboard 3 PRO React system (lib/mdpro + components/mdpro),
 * mirroring the kit's analytics dashboard: DashboardLayout >
 * DashboardNavbar > stat-card row > content cards > Footer. Data is
 * still synthetic (lib/mock-data.ts) until Phase 3 wires real
 * pilot.trips / pilot.invoices / pilot.expenses queries through this
 * same layout.
 */
export default function OverviewPage() {
  const readyCount = READY_TO_INVOICE.length;
  const attentionCount = NEEDS_ATTENTION.length;
  const pastDueCount = NEEDS_ATTENTION.filter((item) =>
    item.label.toLowerCase().includes("past due")
  ).length;

  return (
    <DashboardLayout>
      <DashboardNavbar />
      <MDBox py={3}>
        {/* Page title block — data-driven subtitle preserved from the
            previous Overview implementation. */}
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
              Overview
            </MDTypography>
            <MDTypography variant="button" color="text" fontWeight="regular">
              {pluralize(readyCount, "trip")} flown and logged but not yet
              invoiced.{" "}
              {pastDueCount > 0
                ? `${pluralize(pastDueCount, "invoice")} past due.`
                : "No invoices past due."}
            </MDTypography>
          </MDBox>
          <MDBox display="flex" gap={1.5}>
            <MDButton variant="outlined" color="info">
              Log a trip
            </MDButton>
            <MDButton variant="gradient" color="info">
              Create invoice
            </MDButton>
          </MDBox>
        </MDBox>

        {/* Row 1 — KPI statistics cards. */}
        <Grid container spacing={3}>
          {KPIS.map((kpi) => {
            const style = KPI_CARD_STYLE[kpi.id] ?? KPI_CARD_FALLBACK;
            return (
              <Grid item xs={12} sm={6} lg={3} key={kpi.id}>
                <MDBox mb={1.5}>
                  <ComplexStatisticsCard
                    color={style.color}
                    icon={style.icon}
                    title={kpi.label}
                    count={kpi.value}
                    percentage={{ color: "secondary", amount: "", label: kpi.sub }}
                  />
                </MDBox>
              </Grid>
            );
          })}
        </Grid>

        {/* Row 2 — currency & expirations. */}
        <MDBox mt={3}>
          <Card>
            <MDBox p={3} pb={0} lineHeight={1.25}>
              <MDTypography variant="h6">Currency &amp; expirations</MDTypography>
              <MDTypography variant="button" color="text" fontWeight="regular">
                From your logbook and document dates
              </MDTypography>
            </MDBox>
            <MDBox p={3} pt={1}>
              <TableContainer sx={{ boxShadow: "none" }}>
                <Table>
                  <MDBox component="caption" sx={visuallyHiddenSx}>
                    Currency and document expirations
                  </MDBox>
                  <TableHead sx={{ display: "table-header-group" }}>
                    <TableRow>
                      <TableCell>
                        <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                          Item
                        </MDTypography>
                      </TableCell>
                      <TableCell>
                        <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                          Detail
                        </MDTypography>
                      </TableCell>
                      <TableCell align="right">
                        <MDTypography variant="caption" fontWeight="bold" textTransform="uppercase">
                          Status
                        </MDTypography>
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {CURRENCY_ROWS.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell component="th" scope="row">
                          <MDTypography variant="button" fontWeight="medium">
                            {row.label}
                          </MDTypography>
                        </TableCell>
                        <TableCell>
                          <MDTypography variant="button" color="text" fontWeight="regular">
                            {row.detail}
                          </MDTypography>
                        </TableCell>
                        <TableCell align="right">
                          <MDBadge
                            variant="gradient"
                            color={STATUS_BADGE_COLOR[row.status] ?? "secondary"}
                            badgeContent={row.statusLabel}
                            size="sm"
                            container
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <MDBox mt={2}>
                {/* Counsel-reviewed copy — imported verbatim, never inlined. */}
                <MDTypography variant="caption" color="text">
                  {CURRENCY_DISCLAIMER}
                </MDTypography>
              </MDBox>
            </MDBox>
          </Card>
        </MDBox>

        {/* Row 3 — ready to invoice / needs attention. */}
        <MDBox mt={3}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Card sx={{ height: "100%" }}>
                <MDBox p={3} pb={0} lineHeight={1.25}>
                  <MDTypography variant="h6">Ready to invoice</MDTypography>
                  <MDTypography variant="button" color="text" fontWeight="regular">
                    {pluralize(readyCount, "trip")}
                  </MDTypography>
                </MDBox>
                <MDBox p={3} pt={2}>
                  {READY_TO_INVOICE.map((trip) => (
                    <MDBox
                      key={trip.id}
                      display="flex"
                      justifyContent="space-between"
                      alignItems="flex-start"
                      py={1.5}
                    >
                      <MDBox lineHeight={1.4}>
                        <MDTypography display="block" variant="button" fontWeight="medium">
                          {trip.client}
                        </MDTypography>
                        <MDTypography display="block" variant="caption" color="text">
                          {trip.route}
                        </MDTypography>
                        <MDTypography display="block" variant="caption" color="text">
                          {trip.detail}
                        </MDTypography>
                      </MDBox>
                      <MDTypography variant="button" fontWeight="bold">
                        {trip.amount}
                      </MDTypography>
                    </MDBox>
                  ))}
                  <MDBox mt={2}>
                    <MDButton variant="gradient" color="info">
                      Invoice {pluralize(readyCount, "trip")}
                    </MDButton>
                  </MDBox>
                </MDBox>
              </Card>
            </Grid>
            <Grid item xs={12} md={6}>
              <Card sx={{ height: "100%" }}>
                <MDBox p={3} pb={0} lineHeight={1.25}>
                  <MDTypography variant="h6">Needs attention</MDTypography>
                  <MDTypography variant="button" color="text" fontWeight="regular">
                    {pluralize(attentionCount, "item")}
                  </MDTypography>
                </MDBox>
                <MDBox p={3} pt={2}>
                  {NEEDS_ATTENTION.map((item) => (
                    <MDBox
                      key={item.id}
                      display="flex"
                      justifyContent="space-between"
                      alignItems="center"
                      py={1.5}
                    >
                      <MDBox lineHeight={1.4}>
                        <MDTypography display="block" variant="button" fontWeight="medium">
                          {item.label}
                        </MDTypography>
                        <MDTypography display="block" variant="caption" color="text">
                          {item.detail}
                        </MDTypography>
                      </MDBox>
                      <MDButton
                        variant="outlined"
                        color="info"
                        size="small"
                        aria-label={`${item.action} — ${item.label}`}
                      >
                        {item.action}
                      </MDButton>
                    </MDBox>
                  ))}
                </MDBox>
              </Card>
            </Grid>
          </Grid>
        </MDBox>
      </MDBox>
      {/* Footer displays BRAND.attribution only — no external links. */}
      <Footer company={{ name: BRAND.attribution }} links={[]} />
    </DashboardLayout>
  );
}
