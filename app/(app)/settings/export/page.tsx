import NextLink from "next/link";
import { Button, Card, Flex, Heading, Link as RadixLink, Text } from "@/components/ui";
import { requireEntitlement } from "@/lib/supabase/entitlements";
import PageShell from "../../page-shell";

export const metadata = { title: "Export your data" };

/**
 * The account-wide export: one CSV download per record type, each
 * labelled with what it contains. Per-entity files rather than one
 * combined archive — no zip dependency exists in this product, and a
 * folder of flat CSVs is the shape a spreadsheet, an accountant, or a
 * competitor's importer can actually use.
 *
 * The downloads are plain <a href download> links to the streaming
 * routes at /settings/export/<entity> (same pattern as the logbook's
 * download button) — those routes page past the Data API's silent
 * 1000-row cap and fail loudly rather than ever producing a truncated
 * file that looks complete.
 */

type ExportCard = {
  href: string;
  title: string;
  description: string;
};

const EXPORTS: ExportCard[] = [
  {
    href: "/settings/export/clients",
    title: "Clients",
    description:
      "Every client with contact details, address, operating rule, default rates, payment terms, and W-9 status with its requested/received dates.",
  },
  {
    href: "/settings/export/trips",
    title: "Trips",
    description:
      "One row per trip: dates, status, kind, client, tail number, aircraft type, operating rule, day and travel-day rates and counts, and billing state.",
  },
  {
    href: "/settings/export/trip-days",
    title: "Trip days",
    description:
      "The day records under each trip: date, day type, the rate snapshotted when the day was captured, quantity and rate fractions, and away-from-base.",
  },
  {
    href: "/settings/export/trip-legs",
    title: "Trip legs",
    description:
      "One row per leg: date, departure and destination, out/in times (UTC), block, night, instrument and cross-country hours, takeoffs, landings, approaches and holds.",
  },
  {
    href: "/settings/export/invoices",
    title: "Invoices",
    description:
      "One row per invoice: number, client, status, issued and due dates, and the computed subtotal, tax, total, amount paid and balance due.",
  },
  {
    href: "/settings/export/invoice-lines",
    title: "Invoice lines",
    description:
      "Every line on every invoice: line type, description, quantity, unit amount and amount, with the invoice number and IDs linking back to trips and expenses.",
  },
  {
    href: "/settings/export/invoice-payments",
    title: "Invoice payments",
    description:
      "The full payment ledger: date paid, client, invoice, method and amount, including corrections (negative rows naming the payment they cancel, with the reason) and payments on invoices that were later voided, flagged by the status column.",
  },
  {
    href: "/settings/export/estimates",
    title: "Estimates",
    description:
      "Every estimate: number, client, status, issued and valid-until dates, terms, and the computed subtotal, tax and total. Where a quote became an invoice, this also shows which invoice and when.",
  },
  {
    href: "/settings/export/estimate-lines",
    title: "Estimate lines",
    description:
      "Every line on every estimate: line type, description, quantity, unit amount and amount, with the estimate number and ID linking each line to its quote.",
  },
  {
    href: "/settings/export/expenses",
    title: "Expenses",
    description:
      "Every expense with category, vendor, amount, and its treatment (rebill to client, deductible, or unassigned), linked to its trip where one is set.",
  },
  {
    href: "/settings/export/mileage",
    title: "Mileage",
    description:
      "Every drive: date, miles, route, purpose, client, and the cents-per-mile rate snapshotted when it was recorded, with that drive's amount.",
  },
  {
    href: "/settings/export/documents",
    title: "Documents (details only)",
    description:
      "What's on file and when it expires: kind, label, issued and expiry dates, and filename. The uploaded files themselves are not in this CSV; download each one from its page in Documents.",
  },
  {
    href: "/settings/export/operator-qualifications",
    title: "Operator qualifications",
    description:
      "Your per-operator training and check records: requirement, status, completed and expiry dates, and type designator. This is the 135.293/.297/.299 compliance history an operator or an insurer may ask to see.",
  },
  {
    href: "/settings/export/aircraft",
    title: "Aircraft",
    description:
      "Your own fleet register: tail number, type designator, type rating, make/model, category/class and gear.",
  },
  {
    href: "/settings/export/client-rates",
    title: "Client rates",
    description:
      "Per-client day-type rate overrides: which day type, at what rate, for which client.",
  },
  {
    href: "/settings/export/client-tax-forms",
    title: "Client 1099s",
    description:
      "The 1099 each client reported for each tax year, as they reported it. Use it to reconcile against your own payment ledger.",
  },
  {
    href: "/settings/export/guarantee-periods",
    title: "Guarantee periods",
    description:
      "Monthly minimum-day guarantees by client: guaranteed days, and the invoice that settled a shortfall if one was billed.",
  },
  {
    href: "/settings/export/bank-accounts",
    title: "Bank accounts",
    description: "The accounts you've connected for statement import: label, last 4 digits, and kind.",
  },
  {
    href: "/settings/export/bank-transactions",
    title: "Bank transactions",
    description:
      "Every imported statement line: date, description, amount, review state, category and treatment, with the business/personal triage you made.",
  },
  {
    href: "/settings/export/accounts-chart",
    title: "Chart of accounts",
    description: "The accounting ledger's account list: name and kind (asset, liability, equity, income, expense).",
  },
  {
    href: "/settings/export/journal-entries",
    title: "Journal entries",
    description:
      "The accounting ledger's entries: date, memo, and what generated each one (an invoice, a payment, an expense…).",
  },
  {
    href: "/settings/export/journal-lines",
    title: "Journal lines",
    description: "Every debit and credit line under every journal entry, with the account it posted to.",
  },
  {
    href: "/settings/export/invoice-late-fees",
    title: "Late fees",
    description:
      "Late fees charged on overdue invoices: the invoice that was late, the fee invoice raised for it, and how it was calculated.",
  },
  {
    href: "/settings/export/recurring-invoice-schedules",
    title: "Recurring invoice schedules",
    description: "Standing recurring-invoice setups: client, cadence, amount, and whether each is still active.",
  },
  {
    href: "/settings/export/day-types",
    title: "Day types",
    description:
      "Your day-type configuration: label, billable and per-diem flags, default rate, and the invoice line type it generates.",
  },
  {
    href: "/settings/export/mileage-rates",
    title: "Mileage rates",
    description: "The standard mileage rate you set for each tax year, in cents per mile.",
  },
];

export default async function ExportPage() {
  await requireEntitlement("account_export", "/settings/export");

  return (
    <PageShell
      title="Export your data"
      subtitle="One CSV per record type: every business, compliance and accounting record this product holds for you, in files a spreadsheet can open."
    >
      <Flex direction="column" gap="3">
        <Text size="2" color="gray">
          Each download is complete: exports are read straight from your live
          records with no row limit, and a failed read produces a failed
          download rather than a file with rows quietly missing. Amounts are in
          US dollars, dates are YYYY-MM-DD.
        </Text>

        {EXPORTS.map((item) => (
          <Card size="3" key={item.href}>
            <Flex
              direction={{ initial: "column", sm: "row" }}
              justify="between"
              align={{ initial: "start", sm: "center" }}
              gap="3"
            >
              <Flex direction="column" gap="1">
                <Heading as="h2" size="4">
                  {item.title}
                </Heading>
                <Text as="div" size="2" color="gray">
                  {item.description}
                </Text>
              </Flex>
              <Flex flexShrink="0">
                {/* Plain <a>, not a client-side link: it's a file download —
                    same pattern as the logbook's download button. */}
                <Button asChild variant="outline">
                  <a href={item.href} download>
                    Download CSV
                  </a>
                </Button>
              </Flex>
            </Flex>
          </Card>
        ))}

        <Card size="3">
          <Flex
            direction={{ initial: "column", sm: "row" }}
            justify="between"
            align={{ initial: "start", sm: "center" }}
            gap="3"
          >
            <Flex direction="column" gap="1">
              <Heading as="h2" size="4">
                Logbook
              </Heading>
              <Text as="div" size="2" color="gray">
                Your flight time already has its own full CSV export, the same
                download as the button on the{" "}
                <RadixLink asChild>
                  <NextLink href="/logbook">Logbook</NextLink>
                </RadixLink>{" "}
                page.
              </Text>
            </Flex>
            <Flex flexShrink="0">
              <Button asChild variant="outline">
                <a href="/logbook/export" download>
                  Download CSV
                </a>
              </Button>
            </Flex>
          </Flex>
        </Card>

        <Text size="1" color="gray">
          Not included as files: receipt images and document scans. The
          expenses and documents CSVs say whether a file is on record; the
          files themselves stay downloadable one at a time from their own
          pages. Also not included: internal bookkeeping trails with no
          data of your own in them, such as bank-import batch/source-file records
          and payment-reminder send logs.
        </Text>
      </Flex>
    </PageShell>
  );
}
