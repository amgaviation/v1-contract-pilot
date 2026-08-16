import NextLink from "next/link";
import { notFound } from "next/navigation";
import {
  LAlert,
  LButton,
  LCard,
  LEmpty,
  LPill,
  LRow,
  LRows,
  LSeparator,
  LSkeleton,
  LStat,
  LSwitch,
  LTable,
  LTd,
  LTh,
  lButtonClass,
} from "@/components/ledger";
import {
  LCheckbox,
  LField,
  LInput,
  LSelect,
  LTextarea,
} from "@/components/ledger/forms";
import { DialogSpecimen, TabsSpecimen } from "./specimens-client";

/**
 * THE LEDGER SPECIMEN SHEET — development only, 404s elsewhere.
 *
 * components/ui (the INSTRUMENT compatibility seam this page used to
 * exercise) is gone. What replaced it is components/ledger, and every
 * migrated authenticated screen composes its markup from that one small
 * set of primitives — LButton, LCard, LPill, LStat, LAlert, LEmpty,
 * LSkeleton, LRows/LRow, LTable, the form primitives, LDialog and
 * LTabsRoot. This page renders all of them together, in the PROP SHAPES
 * the real screens actually use — pulled by reading invoices/page.tsx,
 * trips/[id]/delete-trip-button.tsx, reports/cash-flow/page.tsx,
 * settings/settings-tabs.tsx and their siblings, not imagined — so
 * scripts/layout-verify.mjs keeps a real, standalone surface to measure
 * Ledger's own components against across the viewport matrix, the same
 * way it always measured the old seam.
 *
 * The authenticated screens themselves still can't be rendered here: they
 * are behind requireAccount() and query Supabase, which needs a seeded
 * tenant. This page needs none of that — every value below is a fixture.
 *
 * If you add a primitive to components/ledger, or a screen bends an
 * existing one into a new shape, add that shape here too. A specimen sheet
 * is only as useful as what it actually renders.
 */

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 2 14.25 13H1.75Z" />
      <path d="M8 6.25v3" />
      <circle cx="8" cy="11.25" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

const COLUMNS = ["Number", "Client", "Due", "Status", "Total", "Balance due"];
const ROWS = [
  {
    number: "INV-2044",
    client: "Meridian Air Charter",
    due: "2026-09-10",
    status: "good" as const,
    label: "Paid",
    total: "6,134.20",
    balance: "0.00",
  },
  {
    number: "INV-2043",
    client: "Cardinal Aviation LLC",
    due: "2026-09-03",
    status: "accent" as const,
    label: "Sent",
    total: "3,262.65",
    balance: "3,262.65",
  },
  {
    number: "INV-2041",
    client: "Sterling Jet Partners",
    due: "2026-08-27",
    status: "crit" as const,
    label: "Overdue",
    total: "9,088.90",
    balance: "9,088.90",
  },
];

export default async function SeamHarnessPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <div className="flex flex-col gap-5 p-3 font-ledger text-body text-ink sm:p-4 lg:p-5">
      <div>
        <h1 className="text-h1 font-bold tracking-tight">Ledger specimen sheet</h1>
        <p className="text-body-s text-ink-3">
          Every Ledger primitive, called with the prop shapes the migrated
          authenticated screens actually use.
        </p>
      </div>

      {/* Buttons: primary/outline/quiet/danger, three sizes, disabled — the
          lButtonClass() shape (invoices/page.tsx's Log/Create actions on a
          NextLink) alongside the LButton element itself (trips/[id]/
          delete-trip-button.tsx). */}
      <LCard>
        <h2 className="mb-3 text-h3 font-semibold">Buttons</h2>
        <div className="flex flex-wrap items-center gap-2">
          <NextLink href="/seam-harness" className={lButtonClass({ variant: "primary" })}>
            primary (link)
          </NextLink>
          <LButton type="button" variant="outline">
            outline
          </LButton>
          <LButton type="button" variant="quiet">
            quiet
          </LButton>
          <LButton type="button" variant="danger">
            danger
          </LButton>
          <LButton type="button" size="sm">
            size sm
          </LButton>
          <LButton type="button" size="lg">
            size lg
          </LButton>
          <LButton type="button" disabled>
            disabled
          </LButton>
        </div>
      </LCard>

      {/* Pills: all five tones, plus the tnum-l shape a pill wraps around a
          figure (invoices/recurring/page.tsx's due-count badge). */}
      <LCard>
        <h2 className="mb-3 text-h3 font-semibold">Pills</h2>
        <div className="flex flex-wrap items-center gap-2">
          <LPill tone="neutral">Draft</LPill>
          <LPill tone="accent">Current</LPill>
          <LPill tone="good">Paid</LPill>
          <LPill tone="warn">Check payment</LPill>
          <LPill tone="crit">Overdue</LPill>
          <LPill tone="warn" className="tnum-l">
            3 due
          </LPill>
        </div>
      </LCard>

      {/* Stats: the KPI-grid idiom (reports/cash-flow/page.tsx, Overview's
          money row) — LCard > LStat, tabular figures, tone reserved for
          money states. */}
      <LCard>
        <h2 className="mb-3 text-h3 font-semibold">Stats</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <LCard>
            <LStat label="Unbilled work" figure="$18,420.00" sub="6 trips · oldest 14 days" />
          </LCard>
          <LCard>
            <LStat label="Paid this year" figure="$214,338.75" tone="good" sub="41 payments" />
          </LCard>
          <LCard>
            <LStat label="Awaiting payment" figure="$32,905.50" tone="warn" sub="5 invoices" />
          </LCard>
          <LCard>
            <LStat label="Overdue" figure="$9,088.90" tone="crit" sub="1 invoice, 4 days" />
          </LCard>
        </div>
      </LCard>

      {/* Alerts: all five tones. crit/warn pair the WarningIcon shape
          Overview's own error and truncation banners use; crit alone
          carries role="alert" — a live error, per LAlert's own header on
          when that role is the caller's to add. */}
      <LCard>
        <h2 className="mb-3 text-h3 font-semibold">Alerts</h2>
        <div className="flex flex-col gap-2">
          <LAlert tone="neutral">Neutral — informational, no state implied.</LAlert>
          <LAlert tone="accent">Accent — a nudge, not a warning.</LAlert>
          <LAlert tone="good">Good — the reconciliation ties.</LAlert>
          <LAlert tone="warn" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-warn" />
            <span>
              Figures using clients, expenses may be partial: there are more
              rows than were totaled.
            </span>
          </LAlert>
          <LAlert tone="crit" role="alert" className="flex items-start gap-2">
            <WarningIcon className="mt-0.5 shrink-0 text-crit" />
            <span>Couldn&rsquo;t load: unbilled trips. Reload the page.</span>
          </LAlert>
        </div>
      </LCard>

      {/* Empty state: title + body + action + secondaryAction
          (invoices/recurring/schedule-form.tsx's "add a client first"
          shape) — the fullest call this component supports. */}
      <LCard>
        <h2 className="mb-3 text-h3 font-semibold">Empty state</h2>
        <LEmpty
          title="No clients yet"
          action={
            <NextLink href="/seam-harness" className={lButtonClass({ variant: "primary" })}>
              Add a client
            </NextLink>
          }
          secondaryAction={
            <NextLink href="/seam-harness" className={lButtonClass({ variant: "outline" })}>
              Raise a one-off invoice
            </NextLink>
          }
        >
          Add the owner, operator, or management company you fly for. Trips
          and invoices both hang off a client.
        </LEmpty>
      </LCard>

      {/* Fields: LField wrapping LInput/LTextarea/LSelect/LCheckbox/
          LSwitch, plus the hint and error states every money form uses
          (invoices/new/draft-form.tsx's tax-rate field, trips/trip-form.tsx's
          selects, settings/add-day-type-form.tsx's switches). */}
      <LCard>
        <h2 className="mb-3 text-h3 font-semibold">Fields</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LField label="Day rate (USD)" htmlFor="seam-rate" hint="Applied to every flight day">
            <LInput
              id="seam-rate"
              name="rate"
              inputMode="decimal"
              className="tnum-l"
              defaultValue="1350.00"
            />
          </LField>
          <LField
            label="Tax rate (%)"
            htmlFor="seam-tax"
            error="Enter a number between 0 and 100"
            errorId="seam-tax-error"
          >
            <LInput
              id="seam-tax"
              name="tax_rate_percent"
              inputMode="decimal"
              className="tnum-l"
              defaultValue="—"
              aria-invalid
              aria-describedby="seam-tax-error"
            />
          </LField>
          <LField label="Payment terms" htmlFor="seam-terms">
            <LSelect id="seam-terms" name="terms" defaultValue="30">
              <option value="0">Due on receipt</option>
              <option value="15">Net 15</option>
              <option value="30">Net 30</option>
            </LSelect>
          </LField>
          <LField label="Notes" htmlFor="seam-notes">
            <LTextarea id="seam-notes" name="notes" rows={3} defaultValue="Repositioned empty." />
          </LField>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <LCheckbox id="seam-rebill" defaultChecked />
              <label htmlFor="seam-rebill" className="text-body-s text-ink">
                Rebill this expense
              </label>
            </div>
            <div className="flex items-center gap-2">
              <LSwitch name="billable" value="on" defaultChecked aria-label="Billable" />
              <span className="text-body-s text-ink-2">Billable</span>
            </div>
          </div>
        </div>
      </LCard>

      {/* Table: numeric columns, LPill status cells, and the row-header
          idiom (invoices/page.tsx: a plain <th scope="row"> since LTd has
          no row-header variant) — the highest-traffic component shape in
          the product. */}
      <LCard>
        <h2 className="mb-3 text-h3 font-semibold">Table</h2>
        <LTable>
          <caption>
            <span className="sr-only">Sample invoices</span>
          </caption>
          <thead>
            <tr>
              {COLUMNS.map((c, i) => (
                <LTh key={c} numeric={i >= 4}>
                  {c}
                </LTh>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.number}>
                <th
                  scope="row"
                  className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                >
                  <NextLink href="/seam-harness" className="text-accent hover:underline">
                    {row.number}
                  </NextLink>
                </th>
                <LTd>
                  <span className="text-ink-2">{row.client}</span>
                </LTd>
                <LTd>
                  <span className="text-ink-2">{row.due}</span>
                </LTd>
                <LTd>
                  <LPill tone={row.status}>{row.label}</LPill>
                </LTd>
                <LTd numeric>
                  <span className="font-medium">{row.total}</span>
                </LTd>
                <LTd numeric>
                  <span
                    className={
                      row.balance === "0.00" ? "text-ink-2" : "font-medium text-warn"
                    }
                  >
                    {row.balance}
                  </span>
                </LTd>
              </tr>
            ))}
          </tbody>
        </LTable>
      </LCard>

      {/* Rows: the divide-y label/figure list (reports/cash-flow/page.tsx's
          FlowTable, settings/profile-panel.tsx's identity block), paired
          with LSeparator. */}
      <LCard>
        <h2 className="mb-3 text-h3 font-semibold">Rows</h2>
        <LRows>
          <LRow>
            <span className="text-ink-2">Charter revenue</span>
            <span className="tnum-l text-ink">$212,040.00</span>
          </LRow>
          <LRow>
            <span className="text-ink-2">Reimbursed expenses</span>
            <span className="tnum-l text-ink">$2,298.75</span>
          </LRow>
          <LRow>
            <span className="font-semibold text-ink">Total</span>
            <span className="tnum-l font-semibold text-ink">$214,338.75</span>
          </LRow>
        </LRows>
        <LSeparator />
        <p className="text-caption text-ink-3">
          LSeparator sits between an LRows block and whatever follows it.
        </p>
      </LCard>

      {/* Skeleton: the loading-placeholder shapes (invoices/recurring/
          loading.tsx) — a header stand-in and a divided row list. */}
      <LCard>
        <h2 className="mb-3 text-h3 font-semibold">Skeleton</h2>
        <div className="flex flex-col gap-2">
          <LSkeleton className="h-8 w-56 max-w-full" />
          <LSkeleton className="h-4 w-32" />
        </div>
        <div className="mt-3 flex flex-col divide-y divide-hair">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center justify-between gap-3 py-2.5">
              <LSkeleton className="h-4 w-28 flex-1" />
              <LSkeleton className="h-4 w-24 shrink-0" />
              <LSkeleton className="h-8 w-16 shrink-0 rounded-control" />
            </div>
          ))}
        </div>
      </LCard>

      {/* Tabs: the controlled LTabsRoot shape (settings/settings-tabs.tsx),
          three triggers, roving tabindex. Client-only — see
          specimens-client.tsx's header for why. */}
      <LCard>
        <h2 className="mb-3 text-h3 font-semibold">Tabs</h2>
        <TabsSpecimen />
      </LCard>

      {/* Dialogs: LDialog with a footer of two buttons
          (invoices/[id]/share-panel.tsx's rotate-link shape) and
          LConfirmDialog (trips/[id]/delete-trip-button.tsx). Client-only —
          both are controlled (open/onOpenChange), same reason as Tabs. */}
      <LCard>
        <h2 className="mb-3 text-h3 font-semibold">Dialogs</h2>
        <DialogSpecimen />
      </LCard>
    </div>
  );
}
