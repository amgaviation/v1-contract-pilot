import { LPill, LSeparator, LTable, LTd, LTh } from "@/components/ledger";
import { cn } from "@/lib/ledger/cn";
import { BRAND } from "@/lib/brand";
import { formatDate, formatDateRange } from "@/lib/format";
import { visibleNavSections } from "@/lib/nav";

/**
 * The mock's rail shows the FLAG-OFF nav — visibleNavSections(false), the
 * same helper the real rail renders from when the currency engine is
 * disabled. The public page must advertise exactly what a new signup's
 * deployment shows, and the counsel-gated section may appear on no public
 * surface until its gate clears (docs/PRICING.md §4) — so the marketing
 * mock is pinned to the flag-off view rather than the raw NAV_SECTIONS
 * list, which deliberately includes gated entries for robots.txt's sake.
 */
const MOCK_NAV_SECTIONS = visibleNavSections(false);

/**
 * A HAND-BUILT MOCK OF THE OVERVIEW DASHBOARD, for the marketing page only.
 *
 * The real screen is behind requireAccount() (app/(app)/layout.tsx), so it
 * cannot be screenshotted for a signed-out visitor and a screenshot would
 * go stale the first time the dashboard changed. This is the honest
 * alternative: Ledger's own primitives and tokens (components/ledger), so
 * it looks like the product because it is built out of the product's own
 * parts — same section names from lib/nav.ts, same panel structure the
 * real app/(app)/overview/page.tsx renders (KPI row, ready-to-invoice,
 * document expirations).
 *
 * EVERY FIGURE, NAME AND TAIL NUMBER BELOW IS INVENTED. There is no
 * customer here and nothing on this component may ever be presented as
 * one: the pilot, the three client names and the registrations are
 * synthetic, chosen to be plausible rather than real. Airports are real
 * ICAO identifiers because a made-up identifier would read as wrong to the
 * only audience this page has.
 *
 * It is deliberately static markup — no state, no props, no data, and its
 * two look-alike buttons are plain <span>s rather than real <button>s, so
 * they cannot enter the tab order and cannot be mistaken for a live
 * control. It can never drift into being mistaken for a real view of
 * anything.
 */

const KPIS = [
  { label: "Unbilled work", value: "$18,400.00", sub: "3 trips · oldest 11 days" },
  { label: "Awaiting payment", value: "$9,150.00", sub: "2 invoices" },
  { label: "Paid this year", value: "$146,900.00", sub: "24 payments" },
  { label: "Deductible expenses", value: "$12,865.40", sub: "38 receipts filed" },
];

// Dates below are ISO ("YYYY-MM-DD") and rendered through lib/format.ts's
// own formatDate/formatDateRange — the same functions the real screens
// call — so this mock's date STRINGS cannot drift from the product's
// ("Apr 30, 2026", not a hand-typed "30 Apr 2026") even though its data is
// invented. See the file header: EVERY figure below is still synthetic.
const READY_TO_INVOICE = [
  {
    client: "Northlight Air Partners",
    route: "KBED → KTEB → KBED",
    tailNumber: "N412SP",
    days: 3,
    startsOn: "2026-03-04",
    endsOn: "2026-03-06",
    amount: "$7,350.00",
  },
  {
    client: "Cardinal Ridge Aviation",
    route: "KHPN → KPBI",
    tailNumber: "N778QC",
    days: 2,
    startsOn: "2026-03-11",
    endsOn: "2026-03-12",
    amount: "$5,900.00",
  },
  {
    client: "Harbor Rock Holdings",
    route: "KTEB → KASE → KTEB",
    tailNumber: "N219DL",
    days: 2,
    startsOn: "2026-03-18",
    endsOn: "2026-03-19",
    amount: "$5,150.00",
  },
];

const EXPIRATIONS: { label: string; date: string; tone: "warn" | "neutral"; badge: string }[] = [
  // 61.23: medical validity always runs through the LAST DAY of a
  // calendar month, so a mid-month date here would read as wrong to the
  // only audience this page has — see the file header's own standard.
  { label: "First-class medical", date: "2026-04-30", tone: "warn", badge: "30 days" },
  { label: "Flight review", date: "2026-09-30", tone: "neutral", badge: "OK" },
  { label: "Passport", date: "2028-06-14", tone: "neutral", badge: "OK" },
];

export default function ProductMock() {
  return (
    <div
      // Marks this subtree as illustrative data rather than copy, so the
      // word-budget count docs/MARKETING.md §6 records can be taken
      // mechanically instead of tallied by hand. Nothing styles off it.
      data-mock="product"
      className="overflow-x-auto [overscroll-behavior-inline:contain] [-webkit-overflow-scrolling:touch]"
    >
      <div className="min-w-[42rem] max-w-full">
        <div className="overflow-hidden rounded-card border border-hair bg-card shadow-card">
          {/* Window chrome, so this reads as a screen rather than a card. */}
          <div className="flex items-center gap-2 border-b border-hair bg-sunk px-3 py-2">
            <span className="size-2 rounded-full bg-ink-3" />
            <span className="size-2 rounded-full bg-ink-3" />
            <span className="size-2 rounded-full bg-ink-3" />
            <span className="ml-2 text-caption text-ink-3">{BRAND.name}: Overview</span>
          </div>

          <div className="flex">
            {/* Nav rail, labelled from lib/nav.ts so it can never name a
                section the product does not have. */}
            <div className="hidden w-36 shrink-0 border-r border-hair p-3 sm:block">
              <div className="flex flex-col gap-2">
                {MOCK_NAV_SECTIONS.map((item, index) => (
                  <span
                    key={item.href}
                    className={cn(
                      "text-caption",
                      index === 0 ? "font-medium text-ink" : "font-light text-ink-3"
                    )}
                  >
                    {item.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex-1 p-4">
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-body font-medium text-ink">Overview</span>
                    <span className="text-caption text-ink-3">
                      3 trips flown and logged but not yet invoiced. No invoices
                      past due.
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <span className="rounded-control border border-hair-strong bg-card px-3 py-1 text-caption font-medium text-ink">
                      Log a trip
                    </span>
                    <span className="rounded-control bg-accent px-3 py-1 text-caption font-medium text-accent-ink">
                      Create invoice
                    </span>
                  </div>
                </div>

                {/* 2x2, never 4-across. The `md:grid-cols-4` this used to carry keyed
                    off the PAGE's viewport, not this mock's container, so on a wide
                    screen it put four cards inside the hero's 700px track and clipped
                    the figures ("$146,900.00" lost its last digit). Two-up is the
                    honest fit for the width this mock actually gets. */}
                <div className="grid grid-cols-2 gap-3">
                  {KPIS.map((kpi) => (
                    <div key={kpi.label} className="rounded-card border border-hair bg-card p-3">
                      <div className="flex flex-col gap-1">
                        <span className="text-caption text-ink-3">{kpi.label}</span>
                        <span className="tnum-l text-h3 font-bold tracking-tight text-ink">
                          {kpi.value}
                        </span>
                        <span className="text-caption text-ink-3">{kpi.sub}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-card border border-hair bg-card p-3">
                    <div className="mb-2 flex flex-col gap-1">
                      <span className="text-body-s font-medium text-ink">Ready to invoice</span>
                      <span className="text-caption text-ink-3">3 trips</span>
                    </div>
                    <div className="flex flex-col">
                      {READY_TO_INVOICE.map((trip, index) => (
                        <div key={trip.client}>
                          {index > 0 ? <LSeparator className="my-0" /> : null}
                          <div className="flex items-start justify-between gap-3 py-2">
                            <div className="flex flex-col">
                              <span className="text-caption font-medium text-ink">
                                {trip.client}
                              </span>
                              <span className="font-mono text-caption text-ink-3">{trip.route}</span>
                              <span className="text-caption text-ink-3">
                                <span className="font-mono">{trip.tailNumber}</span>{" "}
                                · {trip.days} days ·{" "}
                                {formatDateRange(trip.startsOn, trip.endsOn)}
                              </span>
                            </div>
                            <span className="font-mono tnum-l text-caption font-medium text-ink">
                              {trip.amount}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-card border border-hair bg-card p-3">
                    <div className="mb-2 flex flex-col gap-1">
                      <span className="text-body-s font-medium text-ink">
                        Document expirations
                      </span>
                      <span className="text-caption text-ink-3">
                        Medical, flight review, and passport dates from your
                        documents
                      </span>
                    </div>
                    <LTable>
                      <thead>
                        <tr>
                          <LTh>Document</LTh>
                          <LTh>Expires</LTh>
                          <LTh numeric>Status</LTh>
                        </tr>
                      </thead>
                      <tbody>
                        {EXPIRATIONS.map((row) => (
                          <tr key={row.label}>
                            <LTd>
                              <span className="font-medium text-ink">{row.label}</span>
                            </LTd>
                            <LTd>
                              <span className="text-ink-2">{formatDate(row.date)}</span>
                            </LTd>
                            <LTd numeric>
                              <LPill tone={row.tone}>{row.badge}</LPill>
                            </LTd>
                          </tr>
                        ))}
                      </tbody>
                    </LTable>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
