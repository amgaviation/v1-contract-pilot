import NextLink from "next/link";
import { LCard, LPill, LStat, LTable, LTd, LTh, lButtonClass } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";
import { formatCents, formatDate, formatDateRange } from "@/lib/format";
import {
  EXPIRY_LADDER_BADGE,
  type ExpiryBadge,
  type ExpiryTone,
} from "../../(app)/documents/expiry-badge";
import {
  clientLabel,
  daysSince,
  draftAction,
  draftHref,
  formatDays,
  pluralizeDays,
  sortClientRows,
  unbilledLede,
} from "../../(app)/overview/unbilled-lib";
import {
  FIXTURE_NOW,
  OVERVIEW_AWAITING_CENTS,
  OVERVIEW_AWAITING_INVOICES,
  OVERVIEW_CLIENT_ROWS,
  OVERVIEW_DEDUCTIBLE_CENTS,
  OVERVIEW_DEDUCTIBLE_COUNT,
  OVERVIEW_EXPIRATIONS,
  OVERVIEW_PAID_CENTS,
  OVERVIEW_PAID_COUNT,
  OVERVIEW_SUMMARY,
  OVERVIEW_TRIPS,
} from "./fixtures";

/**
 * OVERVIEW, RE-COMPOSED FROM THE PRODUCT'S OWN PRIMITIVES — and SAYING SO.
 *
 * This is the second of the two options ../README-less harness header
 * describes, and it is the honest label for what this file is: it is NOT
 * app/(app)/overview/page.tsx rendered with fixtures. That screen is a
 * ~1,960-line server component whose presentation is welded to twenty-odd
 * Supabase reads, their error gates and their truncation checks; pulling
 * the markup out of it would be a large, risky refactor of the busiest
 * file in the product, for a picture.
 *
 * So this file composes the SAME Ledger primitives (LPageShell, LCard,
 * LStat, LTable, LPill, lButtonClass) into the SAME panel structure the
 * real screen renders — the grouped money row, the unbilled-by-client
 * table with its reconciliation <tfoot>, "Ready to invoice", and document
 * expirations — and it borrows every piece of shared LOGIC the real screen
 * uses rather than re-typing its output:
 *
 *   lib/format.ts            formatCents / formatDate / formatDateRange
 *   overview/unbilled-lib.ts formatDays, pluralizeDays, daysSince,
 *                            clientLabel, sortClientRows, unbilledLede,
 *                            draftHref, draftAction — and its row TYPES,
 *                            so a column that changes shape fails the
 *                            typecheck here too
 *   documents/expiry-badge   the one ladder→badge map, so a status pill
 *                            here can only ever say what the product says
 *
 * WHAT THAT DOES AND DOES NOT BUY. It cannot drift in its wording,
 * formatting or vocabulary. It CAN drift in layout if someone rearranges
 * the real screen's panels and does not rearrange this one. If Overview's
 * panels are ever extracted the way logbook/panels.tsx and
 * invoices/[id]/totals.tsx were, delete this composition and render those
 * instead.
 *
 * The phone layout is deliberately not reproduced: the real screen renders
 * a stacked list below `md` and this table from `md` up, and every capture
 * is taken at desktop width, so only the table is here.
 */
function ladderToPillTone(tone: ExpiryTone): "crit" | "warn" | "good" | "neutral" {
  switch (tone) {
    case "red":
      return "crit";
    case "amber":
      return "warn";
    case "green":
      return "good";
    default:
      return "neutral";
  }
}

const LADDER_FALLBACK: ExpiryBadge = { tone: "gray", label: "—" };

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export default function OverviewScreen() {
  const summary = OVERVIEW_SUMMARY;
  const clientRows = sortClientRows(OVERVIEW_CLIENT_ROWS);
  const readyCount = Number(summary.trip_count);
  const unbilledCents = Number(summary.total_cents);
  const oldestDays = daysSince(summary.oldest_ends_on, FIXTURE_NOW) ?? 0;

  const kpiGroups = [
    {
      id: "owed",
      label: "Owed to you",
      kpis: [
        {
          id: "unbilled",
          label: "Unbilled work",
          value: formatCents(unbilledCents),
          sub: `${pluralize(readyCount, "trip")} · oldest ${pluralize(oldestDays, "day")}`,
          hint: "Completed trips, priced from their day grids and rebillable receipts",
          href: "/trips",
        },
        {
          id: "awaiting",
          label: "Awaiting payment",
          value: formatCents(OVERVIEW_AWAITING_CENTS),
          sub: pluralize(OVERVIEW_AWAITING_INVOICES, "invoice"),
          hint: "Balance still due on invoices you've issued",
          href: "/invoices?show=outstanding",
        },
      ],
    },
    {
      id: "year",
      label: "This calendar year",
      kpis: [
        {
          id: "paid",
          label: "Paid this year",
          value: formatCents(OVERVIEW_PAID_CENTS),
          sub: pluralize(OVERVIEW_PAID_COUNT, "payment"),
          hint: "Cash actually received, by the date it arrived",
          href: "/reports/profit-loss",
        },
        {
          id: "deductible",
          label: "Deductible expenses",
          value: formatCents(OVERVIEW_DEDUCTIBLE_CENTS),
          sub: `${pluralize(OVERVIEW_DEDUCTIBLE_COUNT, "receipt")} filed this year`,
          hint: "Receipts you tagged deduct, not rebill, dated this year",
          href: "/expenses",
        },
      ],
    },
  ];

  const displayRows = clientRows.map((row) => ({
    key: row.client_id ?? "no-client",
    clientId: row.client_id,
    label: clientLabel(row),
    waiting: daysSince(row.oldest_ends_on, FIXTURE_NOW),
    trips: Number(row.trip_count),
    days: formatDays(Number(row.billable_days)),
    dayMoney: formatCents(Number(row.day_value_cents)),
    reimbursables: formatCents(Number(row.rebill_expense_cents)),
    total: formatCents(Number(row.total_cents)),
  }));

  const lede = unbilledLede(summary, clientRows.length, false, formatCents);

  const readyTrips = OVERVIEW_TRIPS.map((trip) => {
    const rateCents = Number(trip.day_value_cents);
    const expenseCents = Number(trip.rebill_expense_cents);
    return {
      id: trip.trip_id,
      client: clientLabel(trip),
      route: trip.route,
      tail: trip.aircraft_ident,
      dates: formatDateRange(trip.starts_on, trip.ends_on),
      days: Number(trip.billable_days),
      amountCents: rateCents + expenseCents,
      detail: expenseCents
        ? `${formatCents(rateCents)} rate + ${formatCents(expenseCents)} exp`
        : `${formatCents(rateCents)} rate`,
    };
  });

  return (
    <LPageShell
      title="Overview"
      subtitle={`${pluralize(
        readyCount,
        "trip"
      )} flown and logged but not yet invoiced. No invoices past due.`}
      action={
        <>
          <NextLink href="/trips/new" className={lButtonClass({ variant: "outline" })}>
            Log a trip
          </NextLink>
          <NextLink href="/invoices/new" className={lButtonClass({ variant: "primary" })}>
            Create invoice
          </NextLink>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {kpiGroups.map((group) => (
          <section key={group.id} aria-label={group.label}>
            <LCard className="flex h-full flex-col gap-4">
              <p className="text-caption font-semibold text-ink-3">{group.label}</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {group.kpis.map((kpi) => (
                  <NextLink
                    key={kpi.id}
                    href={kpi.href}
                    className="-m-2 flex flex-col gap-1 rounded-control p-2 transition-colors hover:bg-sunk"
                  >
                    <LStat label={kpi.label} figure={kpi.value} sub={kpi.sub} />
                    <p className="text-caption text-ink-3">{kpi.hint}</p>
                  </NextLink>
                ))}
              </div>
            </LCard>
          </section>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[3fr_2fr]">
        <LCard>
          <div className="mb-3 flex flex-col gap-1">
            <h2 className="text-h3 font-semibold">Unbilled money, by client</h2>
            <p className="tnum-l text-body-s text-ink-3">
              {lede ??
                "Every completed trip you haven’t invoiced yet, grouped by who you’d bill it to."}
            </p>
          </div>

          <LTable>
            <caption>
              <span className="sr-only">Unbilled money by client</span>
            </caption>
            <thead>
              <tr>
                <LTh>Client</LTh>
                <LTh numeric>Trips</LTh>
                <LTh numeric>Days</LTh>
                <LTh numeric>Day money</LTh>
                <LTh numeric>Reimbursables</LTh>
                <LTh numeric>Unbilled</LTh>
                <LTh>
                  <span className="sr-only">Action</span>
                </LTh>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.key}>
                  <LTd>
                    <div className="flex flex-col">
                      <span className="font-medium">{row.label}</span>
                      {row.waiting === null ? null : (
                        <span className="tnum-l text-caption text-ink-3">
                          {`Oldest ${pluralize(row.waiting, "day")} ago`}
                        </span>
                      )}
                    </div>
                  </LTd>
                  <LTd numeric>{row.trips}</LTd>
                  <LTd numeric>{row.days}</LTd>
                  <LTd numeric>{row.dayMoney}</LTd>
                  <LTd numeric>{row.reimbursables}</LTd>
                  <LTd numeric>
                    <span className="font-bold">{row.total}</span>
                  </LTd>
                  <LTd>
                    <NextLink
                      href={draftHref(row.clientId)}
                      aria-label={`${draftAction(row.clientId)}, ${row.label}`}
                      className={lButtonClass({ variant: "outline", size: "sm" })}
                    >
                      {draftAction(row.clientId)}
                    </NextLink>
                  </LTd>
                </tr>
              ))}
            </tbody>
            {/* The reconciliation row: the same figure as the "Unbilled
                work" card above, printed where a reader can add the column
                up and check it. */}
            <tfoot>
              <tr>
                <LTd>
                  <span className="font-bold">Total unbilled</span>
                </LTd>
                <LTd numeric>
                  <span className="font-bold">{readyCount}</span>
                </LTd>
                <LTd numeric>
                  <span className="font-bold">{formatDays(Number(summary.billable_days))}</span>
                </LTd>
                <LTd numeric>
                  <span className="font-bold">
                    {formatCents(Number(summary.day_value_cents))}
                  </span>
                </LTd>
                <LTd numeric>
                  <span className="font-bold">
                    {formatCents(Number(summary.rebill_expense_cents))}
                  </span>
                </LTd>
                <LTd numeric>
                  <span className="font-bold">{formatCents(unbilledCents)}</span>
                </LTd>
                <LTd />
              </tr>
            </tfoot>
          </LTable>

          <div className="mt-3">
            <p className="text-caption text-ink-3">
              Billable day money plus rebillable receipts for completed trips
              not yet invoiced: the same figure as &ldquo;Unbilled work&rdquo;
              above. Per diem and contract minimums are added at drafting, so a
              draft can come out higher.
            </p>
          </div>
        </LCard>

        <LCard>
          <div className="mb-3 flex flex-col gap-1">
            <h2 className="text-h3 font-semibold">Ready to invoice</h2>
            <p className="text-body-s text-ink-3">{pluralize(readyCount, "trip")}</p>
          </div>
          <div className="flex flex-col divide-y divide-hair">
            {readyTrips.map((trip) => (
              <NextLink
                key={trip.id}
                href={`/trips/${trip.id}`}
                className="flex items-start justify-between gap-3 py-2.5"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{trip.client}</span>
                  <span className="text-caption text-ink-3">
                    {[trip.route, trip.tail, pluralizeDays(trip.days), trip.dates]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="text-caption text-ink-3">{trip.detail}</span>
                </div>
                <span className="tnum-l font-bold">{formatCents(trip.amountCents)}</span>
              </NextLink>
            ))}
          </div>
          <div className="mt-3">
            <NextLink href="/invoices/new" className={lButtonClass({ variant: "outline" })}>
              Start an invoice
            </NextLink>
          </div>
        </LCard>
      </div>

      <LCard>
        <div className="mb-3 flex flex-col gap-1">
          <h2 className="text-h3 font-semibold">Document expirations</h2>
          <p className="text-body-s text-ink-3">
            Medical, flight review, passport, insurance and PIC proficiency
            check (61.58) dates from your documents
          </p>
        </div>
        <LTable>
          <caption>
            <span className="sr-only">Document expirations</span>
          </caption>
          <thead>
            <tr>
              <LTh>Document</LTh>
              <LTh>Expires</LTh>
              <LTh numeric>Status</LTh>
            </tr>
          </thead>
          <tbody>
            {OVERVIEW_EXPIRATIONS.map((row) => {
              const badge = EXPIRY_LADDER_BADGE[row.ladder_stage] ?? LADDER_FALLBACK;
              return (
                <tr key={row.id}>
                  <LTd>
                    <span className="font-medium">{row.label}</span>
                  </LTd>
                  <LTd>
                    <span className="text-ink-3">{formatDate(row.expires_on)}</span>
                  </LTd>
                  <LTd numeric>
                    <LPill tone={ladderToPillTone(badge.tone)}>{badge.label}</LPill>
                  </LTd>
                </tr>
              );
            })}
          </tbody>
        </LTable>
        <div className="mt-3">
          {/* NOT the currency disclaimer, and deliberately not a currency
              claim of any kind — this panel claims only what it is: dates
              the pilot typed off their own documents. */}
          <p className="text-caption text-ink-3">
            These are the expiry dates you recorded on your own documents.
            Keeping them current is your responsibility.
          </p>
        </div>
      </LCard>
    </LPageShell>
  );
}
