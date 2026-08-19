import { notFound } from "next/navigation";
import { LButton, LCard, LPill, LStat, LTable, LTd, LTh } from "@/components/ledger";
import { LField, LInput } from "@/components/ledger/forms";
import { NAV_SECTIONS } from "@/lib/nav";
import { themeForSlots, DEFAULT_THEME_SLOTS } from "@/lib/theme-slots";
import { AppShell } from "../../(app)/app-shell";

/**
 * THE LAYOUT HARNESS — development only, 404 everywhere else.
 *
 * It renders the real <AppShell> (the same component app/(app)/layout.tsx
 * renders) around content chosen to be the WORST CASE the product
 * actually contains, so scripts/layout-verify.mjs can measure the shell
 * across a viewport matrix without a session, a tenant, or a row of live
 * data. Nothing here reads the database; every string is a fixture.
 *
 * Why a harness at all: the shell is behind requireAccount(), so until
 * this existed the responsive behaviour of every page in the product was
 * the only part of it with no automated check. It got eyeballed at
 * whatever width the last person had their window, and it drifted — a
 * fixed rail crushing the canvas between 768 and 1023px, a header whose
 * Sign out button a long email address pushed off the right edge, and a
 * 1136px cap that wasted half a large monitor, all shipped.
 *
 * The content below is deliberately hostile, and each piece is here
 * because it is a real shape from a real screen, ported to Ledger's own
 * primitives (components/ledger) rather than the retired components/ui
 * seam:
 *
 *   - a 12-column table            the year-end packet and trip P&L
 *   - a 4-up KPI grid              Overview's money row
 *   - an unbroken 46-char token    a Stripe payment-intent id, rendered
 *                                  on the invoice payment panel
 *   - a 44-char email              the header's unbounded user string
 *   - a long unbroken account name a tenant-supplied value in the rail
 *   - a form row of inputs         every settings panel
 *
 * If you add a shape to the product that the shell has to survive, add it
 * here too — the verify script is only as good as what it is pointed at.
 */

const FIXTURE_EMAIL = "operations.department@meridian-air-charter.com";
const FIXTURE_ACCOUNT = "Meridian Air Charter Holdings LLC";
const FIXTURE_INTENT = "pi_3PxQ7bK2eZvKYlo2C9tRfWq8_secret_aB9";

const COLUMNS = [
  "Date",
  "Trip",
  "Client",
  "Tail",
  "Route",
  "Days",
  "Day rate",
  "Travel",
  "Per diem",
  "Expenses",
  "Invoiced",
  "Margin",
];

const ROW = [
  "2026-08-14",
  "TRP-1042",
  "Meridian Air Charter",
  "N512QS",
  "KTEB–KASE–KTEB",
  "3",
  "$1,350.00",
  "$675.00",
  "$225.00",
  "$1,184.20",
  "$4,634.20",
  "$3,450.00",
];

export default async function LayoutHarnessPage() {
  // Belt and braces. The route group is not excluded from the production
  // build, so the guard — not the absence of a link to it — is what keeps
  // this off the live site.
  if (process.env.NODE_ENV !== "development") notFound();

  const theme = themeForSlots(DEFAULT_THEME_SLOTS);

  return (
    <AppShell
      userEmail={FIXTURE_EMAIL}
      accountName={FIXTURE_ACCOUNT}
      sections={NAV_SECTIONS}
      theme={theme}
      readOnlyNotice={null}
      // The real shell takes a server action here. The harness never
      // submits it; it exists so the button renders at its true size.
      signOutAction={async () => {
        "use server";
      }}
    >
      <div className="flex flex-col gap-4 font-ledger text-body text-ink">
        <h1 className="text-h1 font-bold tracking-tight">Layout harness</h1>

        {/* Overview's money row (reports/cash-flow's own KPI-grid idiom:
            LCard > LStat, grid-cols-1 up to grid-cols-4). grid-cols-1 stays
            the default: four KPI cards side by side at 320px is four
            illegible slivers. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Unbilled work", "$18,420.00"],
            ["Awaiting payment", "$32,905.50"],
            ["Paid this year", "$214,338.75"],
            ["Deductible expenses", "$9,881.40"],
          ].map(([label, figure]) => (
            <LCard key={label}>
              <LStat label={label} figure={figure} />
            </LCard>
          ))}
        </div>

        {/* The unbounded-token case. A payment-intent id has no spaces to
            break at, so without an overflow-wrap escape it is a single
            wide word that sets its container's min-content width and
            pushes the page sideways at every viewport narrower than it. */}
        <LCard>
          <div className="text-caption font-semibold text-ink-3">
            Payment reference
          </div>
          <div
            className="tnum-l text-body-s text-ink"
            style={{ overflowWrap: "anywhere" }}
          >
            {FIXTURE_INTENT}
          </div>
        </LCard>

        {/* A settings form row. */}
        <LCard>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <LField label="Default day rate" htmlFor="lh-day-rate">
                <LInput id="lh-day-rate" placeholder="1350.00" />
              </LField>
            </div>
            <div className="min-w-0 flex-1">
              <LField label="Payment terms" htmlFor="lh-terms">
                <LInput id="lh-terms" placeholder="Net 30" />
              </LField>
            </div>
            <LButton type="button">Save</LButton>
          </div>
        </LCard>

        {/* The 12-column table. LTable owns its own overflow-x-auto
            wrapper, so the correct behaviour is for THIS to scroll inside
            its own frame while the page does not move — which is exactly
            what the verify script asserts. Date carries the row-header
            idiom (a real, unique identifier for the row), matching the
            invoices/trips list pattern. */}
        <LCard>
          <LTable>
            <caption>
              <span className="sr-only">Layout harness sample trips</span>
            </caption>
            <thead>
              <tr>
                {COLUMNS.map((c, i) => (
                  <LTh key={c} numeric={i >= 5}>
                    {c}
                  </LTh>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map((i) => (
                <tr key={i}>
                  <th
                    scope="row"
                    className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                  >
                    {ROW[0]}
                  </th>
                  {ROW.slice(1).map((cell, j) => {
                    const columnIndex = j + 1;
                    return (
                      <LTd key={columnIndex} numeric={columnIndex >= 5}>
                        {columnIndex === 1 ? (
                          <LPill tone="good">{cell}</LPill>
                        ) : (
                          cell
                        )}
                      </LTd>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </LTable>
        </LCard>
      </div>
    </AppShell>
  );
}
