import { AppShell } from "@/components/shell/app-shell";
import { Panel } from "@/components/ui/panel";
import { KpiTile } from "@/components/ui/kpi-tile";
import { StatusTag } from "@/components/ui/status-tag";
import { Button } from "@/components/ui/button";
import {
  DEMO_ACCOUNT,
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
 * Overview — the product's home screen. Built to the locked reference
 * design (docs/PLAN.md → Design system; artifact
 * https://claude.ai/code/artifact/85f5aefa-30e2-40da-852d-944b3d4d2976,
 * Direction One). Data below is synthetic (lib/mock-data.ts) until
 * Phase 3 wires real pilot.trips / pilot.invoices / pilot.expenses
 * queries through this same layout.
 */
export default function OverviewPage() {
  const readyCount = READY_TO_INVOICE.length;
  const attentionCount = NEEDS_ATTENTION.length;
  const pastDueCount = NEEDS_ATTENTION.filter((item) =>
    item.label.toLowerCase().includes("past due")
  ).length;

  return (
    <AppShell accountName={DEMO_ACCOUNT.name} userName={DEMO_ACCOUNT.user}>
      <div className="v1-page-top">
        <div>
          <h1 className="v1-page-title">Overview</h1>
          <p className="v1-page-subtitle">
            {pluralize(readyCount, "trip")} flown and logged but not yet
            invoiced. {pastDueCount > 0
              ? `${pluralize(pastDueCount, "invoice")} past due.`
              : "No invoices past due."}
          </p>
        </div>
        <div className="v1-actions">
          <Button>Log a trip</Button>
          <Button variant="primary">Create invoice</Button>
        </div>
      </div>

      <div className="v1-kpis">
        {KPIS.map((kpi) => (
          <KpiTile key={kpi.id} label={kpi.label} value={kpi.value} sub={kpi.sub} />
        ))}
      </div>

      <div className="v1-cols v1-cols--overview">
        <div>
          <Panel title="Currency & expirations" context="From your logbook and document dates">
            {/* .v1-table-scroll, not the panel body: a wide record scrolls
                sideways inside its panel rather than losing its last column.
                A tail number clipped at the edge is a defect. */}
            <div className="v1-table-scroll">
              <table className="v1-table">
                <caption className="v1-visually-hidden">
                  Currency and document expirations
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Detail</th>
                    <th scope="col" className="v1-r">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CURRENCY_ROWS.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">{row.label}</th>
                      <td className="v1-num">{row.detail}</td>
                      <td className="v1-r">
                        <StatusTag variant={row.status}>{row.statusLabel}</StatusTag>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="v1-disclaimer">{CURRENCY_DISCLAIMER}</div>
          </Panel>

          <Panel title="Ready to invoice" context={pluralize(readyCount, "trip")}>
            {READY_TO_INVOICE.map((trip) => (
              <div className="v1-row" key={trip.id}>
                <div>
                  <span className="v1-row-label">{trip.client}</span>
                  <span className="v1-row-detail v1-num">{trip.route}</span>
                  <span className="v1-row-detail v1-num">{trip.detail}</span>
                </div>
                <span className="v1-num v1-row-amount">{trip.amount}</span>
              </div>
            ))}
            <div className="v1-row">
              <Button variant="primary">Invoice {pluralize(readyCount, "trip")}</Button>
            </div>
          </Panel>
        </div>

        <Panel title="Needs attention" context={pluralize(attentionCount, "item")}>
          {NEEDS_ATTENTION.map((item) => (
            <div className="v1-row" key={item.id}>
              <div>
                <span className="v1-row-label">{item.label}</span>
                <span className="v1-row-detail v1-num">{item.detail}</span>
              </div>
              <Button aria-label={`${item.action} — ${item.label}`}>{item.action}</Button>
            </div>
          ))}
        </Panel>
      </div>
    </AppShell>
  );
}
