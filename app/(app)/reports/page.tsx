import NextLink from "next/link";
import { LCard } from "@/components/ledger";
import { LPageShell } from "@/components/ledger/page-shell";
import { requireAccount } from "@/lib/supabase/account";

export const metadata = { title: "Reports" };

type ReportLink = { href: string; title: string; description: string };

const GROUPS: { label: string; reports: ReportLink[] }[] = [
  {
    label: "Tax",
    reports: [
      {
        href: "/reports/year-end",
        title: "Year-end report",
        description: "Income, deductions, and 1099 reconciliation for a full tax year.",
      },
      {
        href: "/reports/quarterly",
        title: "Quarterly estimated tax",
        description:
          "Cash-basis profit for each IRS estimated-tax period, with a set-aside planner.",
      },
      {
        href: "/reports/sales-tax",
        title: "Sales tax",
        description:
          "Tax charged on your invoices and collected in a period, for whoever prepares your filings.",
      },
    ],
  },
  {
    label: "Money",
    reports: [
      {
        href: "/reports/profit-loss",
        title: "Profit & loss",
        description:
          "Income and expenses by year, quarter, or month, compared against the prior period.",
      },
      {
        href: "/reports/trip-pl",
        title: "Trip profitability",
        description:
          "What each trip and each client billed, what it cost you, and the margin per day. Invoiced, not collected.",
      },
      {
        href: "/reports/balance-sheet",
        title: "Balance sheet",
        description:
          "What you own and owe as of a date: cash, receivables, tax collected, and owner equity, from your ledger.",
      },
      {
        href: "/reports/cash-flow",
        title: "Cash flow",
        description:
          "Where cash actually came from and went in a period, derived from your ledger's Cash & bank account.",
      },
    ],
  },
  {
    label: "Flying",
    reports: [
      {
        href: "/reports/flight-time",
        title: "Flight time",
        description:
          "Cross-operator flight-time totals in 14 CFR 135.267's windows: the picture no single operator can see.",
      },
      // Sits beside Flight time as the second logbook-derived report. The
      // two answer different questions from the same record: that one
      // totals a regulation's windows for an operator about to assign a
      // trip, this one fills in the form an underwriter or a chief pilot
      // hands over before any of that.
      {
        href: "/reports/pilot-history",
        title: "Pilot history",
        description:
          "Total time, PIC and SIC, time by type and by airframe, and the dates on your paperwork: what an insurance or operator history form asks for, ready to download.",
      },
    ],
  },
];

// An index of the product's reports. Previously this redirected straight
// to /reports/year-end, the only report that existed; now that
// /reports/quarterly exists too, /reports has to actually list both
// rather than pick one for the pilot.
export default async function ReportsIndexPage() {
  await requireAccount("/reports");

  return (
    <LPageShell title="Reports">
      {/* Three groups, same label idiom as overview/page.tsx's KPI rows
          (a small caption-weight label over a <section aria-label>): nine
          identical cards in one column read as a wall rather than a menu,
          and a pilot reaching for "what do I owe this quarter" had to read
          past a balance sheet to find it. */}
      <div className="flex flex-col gap-5">
        {GROUPS.map((group) => (
          <section key={group.label} aria-label={group.label} className="flex flex-col gap-3">
            <p className="text-caption font-semibold text-ink-3">{group.label}</p>
            {group.reports.map((report) => (
              <LCard key={report.href}>
                <h2 className="mb-1 text-h3 font-semibold">
                  <NextLink href={report.href} className="text-accent hover:underline">
                    {report.title}
                  </NextLink>
                </h2>
                <p className="text-body-s text-ink-2">{report.description}</p>
              </LCard>
            ))}
          </section>
        ))}
      </div>
    </LPageShell>
  );
}
