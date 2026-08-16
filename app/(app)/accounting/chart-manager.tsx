"use client";

import { useActionState, useState, useTransition } from "react";
import { LButton, LCard, LPill, LTable, LTd, LTh } from "@/components/ledger";
import { LField, LInput, LSelect } from "@/components/ledger/forms";
import { formatCents } from "@/lib/format";
import {
  KIND_LABEL,
  KIND_ORDER,
  type ChartKind,
  type LedgerBalanceRow,
  presentedBalanceCents,
} from "./ledger-lib";
import {
  createChartAccount,
  renameChartAccount,
  setChartAccountArchived,
  type ChartFormState,
} from "./actions";

const initialState: ChartFormState = { error: null };

function AddAccountForm() {
  const [state, formAction, pending] = useActionState(createChartAccount, initialState);
  const values = state.values ?? { name: "", kind: "expense" };

  return (
    <LCard>
      <form action={formAction} key={JSON.stringify(values)}>
        <div className="mb-2 text-h3 font-semibold">Add an account</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <LField label="Name" htmlFor="chart-add-name">
              <LInput
                id="chart-add-name"
                name="name"
                required
                placeholder="e.g. Simulator rental income"
                defaultValue={values.name}
              />
            </LField>
          </div>
          <div className="w-48">
            <LField label="Type" htmlFor="chart-add-kind">
              <LSelect id="chart-add-kind" name="kind" defaultValue={values.kind || "expense"}>
                {KIND_ORDER.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABEL[kind]}
                  </option>
                ))}
              </LSelect>
            </LField>
          </div>
          <LButton type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add account"}
          </LButton>
        </div>
        <div role="alert" aria-live="polite">
          {state.error ? (
            <p className="mt-2 text-caption font-medium text-crit">{state.error}</p>
          ) : null}
        </div>
        <p className="mt-2 text-caption text-ink-3">
          The type can&rsquo;t change later. Archive and re-add the account
          if it was wrong. Built-in accounts can be renamed but not
          archived: they&rsquo;re where your invoices, payments, expenses,
          and mileage post automatically.
        </p>
      </form>
    </LCard>
  );
}

function AccountRow({ row }: { row: LedgerBalanceRow }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(renameChartAccount, initialState);
  const [archiving, startArchive] = useTransition();
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const balance = presentedBalanceCents(row.kind, row.balance_cents);

  function toggleArchive() {
    startArchive(async () => {
      setArchiveError(null);
      const result = await setChartAccountArchived(row.chart_account_id, !row.archived);
      if (result.error) setArchiveError(result.error);
    });
  }

  return (
    <tr>
      <th
        scope="row"
        className="border-b border-hair px-3 py-2.5 text-left align-baseline font-medium text-ink first:pl-0 last:pr-0"
      >
        {editing ? (
          <form
            action={(formData) => {
              formData.set("id", row.chart_account_id);
              return formAction(formData);
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <LInput
                name="name"
                required
                defaultValue={state.values?.name ?? row.name}
                aria-label={`Rename ${row.name}`}
              />
              <LButton type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </LButton>
              <LButton type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </LButton>
            </div>
            {state.error ? (
              <p className="mt-1 text-caption font-medium text-crit" role="alert">
                {state.error}
              </p>
            ) : null}
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span>{row.name}</span>
            {row.system_key ? <LPill tone="neutral">built-in</LPill> : null}
            {row.archived ? <LPill tone="neutral">archived</LPill> : null}
          </div>
        )}
      </th>
      <LTd numeric>
        <span className={balance < 0 ? "font-medium text-crit" : "font-medium"}>
          {formatCents(balance)}
        </span>
      </LTd>
      <LTd>
        <div className="flex justify-end gap-2">
          {!editing ? (
            <LButton type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              Rename
            </LButton>
          ) : null}
          {!row.system_key ? (
            <LButton
              type="button"
              size="sm"
              variant="quiet"
              className={row.archived ? undefined : "text-crit hover:text-crit"}
              disabled={archiving}
              onClick={toggleArchive}
            >
              {archiving ? "…" : row.archived ? "Unarchive" : "Archive"}
            </LButton>
          ) : null}
        </div>
        {archiveError ? (
          <p className="mt-1 text-caption font-medium text-crit" role="alert">
            {archiveError}
          </p>
        ) : null}
      </LTd>
    </tr>
  );
}

export default function ChartManager({ rows }: { rows: LedgerBalanceRow[] }) {
  const byKind = new Map<ChartKind, LedgerBalanceRow[]>();
  for (const kind of KIND_ORDER) byKind.set(kind, []);
  for (const row of rows) byKind.get(row.kind)?.push(row);

  return (
    <div className="flex flex-col gap-4">
      <AddAccountForm />
      {KIND_ORDER.map((kind) => {
        const kindRows = (byKind.get(kind) ?? []).sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        if (kindRows.length === 0) return null;
        return (
          <LCard key={kind}>
            <div className="mb-2 text-h3 font-semibold">{KIND_LABEL[kind]}</div>
            <LTable>
              <caption>
                <span className="sr-only">{KIND_LABEL[kind]} accounts</span>
              </caption>
              <thead>
                <tr>
                  <LTh>Account</LTh>
                  <LTh numeric>Balance</LTh>
                  <LTh>
                    <span className="sr-only">Actions</span>
                  </LTh>
                </tr>
              </thead>
              <tbody>
                {kindRows.map((row) => (
                  <AccountRow key={row.chart_account_id} row={row} />
                ))}
              </tbody>
            </LTable>
          </LCard>
        );
      })}
    </div>
  );
}
