"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import NextLink from "next/link";
import { LAlert, LButton, LCard, LTable, LTd, LTh } from "@/components/ledger";
import { LDialog } from "@/components/ledger/dialog";
import { formatCents, formatDate } from "@/lib/format";
import { generateRecurringInvoice, generateAllDueRecurringInvoices, type DuePeriod } from "./actions";

export type DueRow = DuePeriod & { client_name: string; description: string };

function CreateOneButton({ row, onDone }: { row: DueRow; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCreate() {
    startTransition(async () => {
      setError(null);
      const result = await generateRecurringInvoice(row.schedule_id, row.period_start);
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <LButton type="button" variant="outline" size="sm" onClick={handleCreate} disabled={pending}>
        {pending ? "Creating…" : "Create"}
      </LButton>
      {error ? (
        <p className="text-caption text-crit" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default function DueQueue({
  rows,
  hasActiveSchedules,
}: {
  rows: DueRow[];
  // "Every active schedule's periods are already created" is only true
  // when there IS an active schedule. With none, this queue is empty for
  // a completely different reason and that sentence is simply wrong.
  hasActiveSchedules: boolean;
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [pendingAll, startAll] = useTransition();
  const [allError, setAllError] = useState<string | null>(null);
  const [allSummary, setAllSummary] = useState<string | null>(null);
  // Set only when generateAllDueRecurringInvoices reports the due count is
  // past CREATE_ALL_CONFIRM_THRESHOLD — see that action's own comment
  // (defect 7). Nothing has been created yet at this point.
  const [confirmInfo, setConfirmInfo] = useState<{ count: number; amountCents: number } | null>(null);
  // Same reasoning LConfirmDialog's own header documents for a destructive
  // confirm: a native <dialog> autofocuses the first focusable control,
  // which here is "Create N invoices" — so an Enter already in flight when
  // this opens would confirm a many-invoice creation the pilot hasn't
  // actually looked at yet. Focused on Cancel instead, same as every other
  // confirm dialog in this product.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirmInfo) cancelRef.current?.focus();
  }, [confirmInfo]);

  const key = (r: DuePeriod) => `${r.schedule_id}:${r.period_start}`;
  const visible = rows.filter((r) => !dismissed.has(key(r)));

  function runGenerateAll(confirmed: boolean) {
    startAll(async () => {
      setAllError(null);
      setAllSummary(null);
      const result = await generateAllDueRecurringInvoices(confirmed);
      if (result.error) {
        setAllError(result.error);
        return;
      }
      if (result.needsConfirmation) {
        setConfirmInfo({ count: result.dueCount ?? 0, amountCents: result.dueAmountCents ?? 0 });
        return;
      }
      setConfirmInfo(null);
      setDismissed(new Set(rows.map(key)));
      setAllSummary(
        result.failed.length === 0
          ? `Created ${result.created} invoice${result.created === 1 ? "" : "s"}.`
          : `Created ${result.created} invoice${result.created === 1 ? "" : "s"}; ${result.failed.length} couldn't be created (${result.failed.join("; ")}).`
      );
    });
  }

  function handleCreateAll() {
    runGenerateAll(false);
  }

  function handleConfirmCreateAll() {
    runGenerateAll(true);
  }

  if (rows.length === 0) {
    return (
      <LCard>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <h2 className="text-h3 font-semibold">
            {hasActiveSchedules ? "Nothing due right now" : "No schedules to fall due"}
          </h2>
          <p className="max-w-md text-body-s text-ink-2">
            {hasActiveSchedules
              ? "Every active schedule’s periods up to today have already been created."
              : "This queue lists the periods an active recurring schedule owes you an invoice for. Set one up below and its first period shows up here."}
          </p>
        </div>
      </LCard>
    );
  }

  return (
    <LCard>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClockIcon className="text-ink-3" />
          <p className="font-semibold">{visible.length} due to create</p>
        </div>
        <LButton
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCreateAll}
          disabled={pendingAll || visible.length === 0}
        >
          {pendingAll ? "Creating…" : "Create all due"}
        </LButton>
      </div>

      <LDialog
        open={confirmInfo !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmInfo(null);
        }}
        title={`Create ${confirmInfo?.count ?? 0} invoices?`}
        description={
          <>
            {`This creates ${confirmInfo?.count ?? 0} draft invoices totaling `}
            <span className="tnum-l font-medium text-ink">
              {formatCents(confirmInfo?.amountCents ?? 0)}
            </span>
            {
              ". That's more than usual for one click. Double-check a schedule's first-bill date isn't further in the past than intended before continuing. Every invoice is still a draft you review before sending."
            }
          </>
        }
        footer={
          <>
            <LButton
              ref={cancelRef}
              type="button"
              variant="quiet"
              disabled={pendingAll}
              onClick={() => setConfirmInfo(null)}
            >
              Cancel
            </LButton>
            <LButton type="button" variant="primary" disabled={pendingAll} onClick={handleConfirmCreateAll}>
              {pendingAll ? "Creating…" : `Create ${confirmInfo?.count ?? 0} invoices`}
            </LButton>
          </>
        }
      />

      {allError ? (
        <LAlert tone="crit" className="mb-3">
          {allError}
        </LAlert>
      ) : null}
      {allSummary ? (
        <LAlert tone="good" className="mb-3">
          {allSummary}{" "}
          <NextLink href="/invoices" className="font-medium text-accent underline-offset-2 hover:underline">
            View invoices
          </NextLink>
        </LAlert>
      ) : null}

      {visible.length === 0 ? null : (
        <LTable>
          <caption>
            <span className="sr-only">Recurring invoices due</span>
          </caption>
          <thead>
            <tr>
              <LTh>Client</LTh>
              <LTh>Description</LTh>
              <LTh>Period</LTh>
              <LTh>Due</LTh>
              <LTh>
                <span className="sr-only">Action</span>
              </LTh>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={key(row)}>
                {/* scope="row": the accessible-name row header Radix's
                    Table.RowHeaderCell gave this cell. */}
                <th
                  scope="row"
                  className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
                >
                  {row.client_name}
                </th>
                <LTd>
                  <span className="text-ink-2">{row.description}</span>
                </LTd>
                <LTd>
                  <span className="text-ink-2">
                    {new Date(`${row.period_start}T00:00:00Z`).toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </span>
                </LTd>
                <LTd>
                  <span className="text-ink-2">{formatDate(row.due_on)}</span>
                </LTd>
                <LTd>
                  <CreateOneButton row={row} onDone={() => setDismissed((d) => new Set(d).add(key(row)))} />
                </LTd>
              </tr>
            ))}
          </tbody>
        </LTable>
      )}
    </LCard>
  );
}

/* ── Inline icon ───────────────────────────────────────────────────────
 * Ledger screens carry no icon dependency — see components/ledger's own
 * header rule. */
function ClockIcon({ className }: { className?: string }) {
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
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5v3.75l2.5 1.5" />
    </svg>
  );
}
