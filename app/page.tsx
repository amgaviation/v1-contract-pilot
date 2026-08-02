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

/**
 * Overview — the product's home screen. Built to the locked reference
 * design (docs/PLAN.md → Design system; artifact
 * https://claude.ai/code/artifact/85f5aefa-30e2-40da-852d-944b3d4d2976,
 * Direction One). Data below is synthetic (lib/mock-data.ts) until
 * Phase 3 wires real pilot.trips / pilot.invoices / pilot.expenses
 * queries through this same layout.
 */
export default function OverviewPage() {
  return (
    <AppShell accountName={DEMO_ACCOUNT.name} userName={DEMO_ACCOUNT.user}>
      <div className="v1-page-top">
        <div>
          <h1 className="v1-page-title">Overview</h1>
          <p className="v1-page-subtitle">
            Two trips are flown and logged but not yet invoiced. One invoice is past due.
          </p>
        </div>
        <div className="flex gap-2">
          <Button>Log a trip</Button>
          <Button variant="primary">Create invoice</Button>
        </div>
      </div>

      <div className="v1-kpis">
        {KPIS.map((kpi) => (
          <KpiTile key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.32fr_1fr] gap-4">
        <div>
          <Panel title="Currency & expirations" context="From your logbook and document dates">
            <table className="v1-table">
              <tbody>
                {CURRENCY_ROWS.map((row) => (
                  <tr key={row.label}>
                    <td style={{ width: "38%" }}>{row.label}</td>
                    <td className="v1-num">{row.detail}</td>
                    <td className="v1-r">
                      <StatusTag variant={row.status}>{row.statusLabel}</StatusTag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="v1-disclaimer">{CURRENCY_DISCLAIMER}</div>
          </Panel>

          <Panel title="Ready to invoice" context={`${READY_TO_INVOICE.length} trips`}>
            {READY_TO_INVOICE.map((trip) => (
              <div className="v1-row" key={trip.client}>
                <div>
                  <span className="v1-row-label">{trip.client}</span>
                  <span className="v1-row-detail v1-num">{trip.route}</span>
                </div>
                <span className="v1-num" style={{ fontWeight: 700, fontSize: 14 }}>
                  {trip.amount}
                </span>
              </div>
            ))}
            <div className="v1-row">
              <Button variant="primary">Invoice both</Button>
            </div>
          </Panel>
        </div>

        <Panel title="Needs attention" context={`${NEEDS_ATTENTION.length} items`}>
          {NEEDS_ATTENTION.map((item) => (
            <div className="v1-row" key={item.label}>
              <div>
                <span className="v1-row-label">{item.label}</span>
                <span className="v1-row-detail v1-num">{item.detail}</span>
              </div>
              <Button>{item.action}</Button>
            </div>
          ))}
        </Panel>
      </div>
    </AppShell>
  );
}
