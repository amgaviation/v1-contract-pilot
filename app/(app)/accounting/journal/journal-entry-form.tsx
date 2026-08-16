"use client";

import { useActionState, useState } from "react";
import { LButton, LCard } from "@/components/ledger";
import { LField, LInput, LSelect } from "@/components/ledger/forms";
import { formatCents } from "@/lib/format";
import { parsePositiveDollarsToCents } from "../ledger-lib";
import { createJournalEntry, type JournalFormState } from "./actions";

export type AccountOption = {
  id: string;
  name: string;
  kindLabel: string;
  /** accounts_chart.system_key — null for a pilot-added account. Presets
   *  below match on this, never on the (renamable) name. */
  systemKey: string | null;
};

/**
 * Guided presets for the three manual entries a solo pilot actually types
 * by hand — everything else (invoices, payments, expenses, mileage) posts
 * itself. Each preset names its two legs by SYSTEM KEY, the seeded chart's
 * stable posting identity (20260812100000_accounting_ledger.sql) rather
 * than by account name, so a renamed "Cash & bank" account still matches.
 * All three system-key accounts exist for every tenant and can never be
 * archived (accounts_chart_protect forbids archiving a system row), so a
 * preset can always find both legs.
 *
 * Presets pre-select the two accounts and suggest a memo — nothing else.
 * The date, the amount(s), and the memo text all stay the pilot's own:
 * this is a shortcut for the two lines that are always the same two
 * accounts, not a canned transaction the pilot can't see or edit.
 */
type Preset = {
  key: string;
  label: string;
  memo: string;
  debitSystemKey: string;
  creditSystemKey: string;
};

const PRESETS: Preset[] = [
  {
    key: "owner_draw",
    label: "Owner draw",
    memo: "Owner draw",
    debitSystemKey: "owner_draws",
    creditSystemKey: "bank",
  },
  {
    key: "owner_contribution",
    label: "Owner contribution",
    memo: "Owner contribution",
    debitSystemKey: "bank",
    creditSystemKey: "owner_contributions",
  },
  {
    key: "sales_tax_remittance",
    label: "Sales tax remittance",
    memo: "Sales tax remittance",
    debitSystemKey: "sales_tax_payable",
    creditSystemKey: "bank",
  },
];

const initialState: JournalFormState = { error: null };

type LineDraft = {
  key: number;
  account: string;
  side: "debit" | "credit";
  amount: string;
};

const NO_ACCOUNT = "";

function draftsFromEcho(values: NonNullable<JournalFormState["values"]>): LineDraft[] {
  const count = Math.max(values.accounts.length, 2);
  const drafts: LineDraft[] = [];
  for (let i = 0; i < count; i++) {
    drafts.push({
      key: i,
      account: values.accounts[i] ?? "",
      side: values.sides[i] === "credit" ? "credit" : "debit",
      amount: values.amounts[i] ?? "",
    });
  }
  return drafts;
}

function emptyDrafts(): LineDraft[] {
  return [
    { key: 0, account: "", side: "debit", amount: "" },
    { key: 1, account: "", side: "credit", amount: "" },
  ];
}

/**
 * The manual journal entry form: date, memo, and at least two lines of
 * account / debit-or-credit / amount, with a live running total so the
 * pilot can see the imbalance BEFORE submitting. Lines are controlled
 * state (adding/removing rows), so on a rejected submit the echoed values
 * re-seed the state via the `key` remount — the React 19 reset-on-dispatch
 * pattern every form in this product uses (see mileage-form.tsx).
 */
export default function JournalEntryForm({ accounts }: { accounts: AccountOption[] }) {
  const [state, formAction, pending] = useActionState(createJournalEntry, initialState);
  const values = state.values;

  return (
    <LCard>
      <FormBody
        key={values ? JSON.stringify(values) : "fresh"}
        accounts={accounts}
        formAction={formAction}
        pending={pending}
        error={state.error}
        echoed={values}
      />
    </LCard>
  );
}

function FormBody({
  accounts,
  formAction,
  pending,
  error,
  echoed,
}: {
  accounts: AccountOption[];
  formAction: (formData: FormData) => void;
  pending: boolean;
  error: string | null;
  echoed: JournalFormState["values"];
}) {
  const [lines, setLines] = useState<LineDraft[]>(
    echoed ? draftsFromEcho(echoed) : emptyDrafts()
  );
  const [nextKey, setNextKey] = useState(lines.length);
  // Controlled, not defaultValue, ONLY so a preset button can fill it —
  // same reason the account/side/amount fields above are controlled state
  // rather than plain form fields.
  const [memo, setMemo] = useState(echoed?.memo ?? "");

  const accountBySystemKey = new Map(
    accounts.filter((a) => a.systemKey !== null).map((a) => [a.systemKey as string, a])
  );

  function applyPreset(preset: Preset) {
    const debitAccount = accountBySystemKey.get(preset.debitSystemKey);
    const creditAccount = accountBySystemKey.get(preset.creditSystemKey);
    // Both legs are seeded, non-archivable system accounts (see the
    // Preset comment above) — this should always resolve. If an account
    // was somehow filtered out of `accounts` (e.g. archived, which can't
    // happen to a system row, but the type is still nullable-safe),
    // leave that line blank rather than guess: the pilot picks it.
    setLines([
      { key: 0, account: debitAccount?.id ?? "", side: "debit", amount: "" },
      { key: 1, account: creditAccount?.id ?? "", side: "credit", amount: "" },
    ]);
    setNextKey(2);
    setMemo(preset.memo);
  }

  const debitCents = lines
    .filter((l) => l.side === "debit")
    .reduce((s, l) => s + (parsePositiveDollarsToCents(l.amount) ?? 0), 0);
  const creditCents = lines
    .filter((l) => l.side === "credit")
    .reduce((s, l) => s + (parsePositiveDollarsToCents(l.amount) ?? 0), 0);
  const balanced = debitCents === creditCents && debitCents > 0;

  function update(key: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  return (
    <form action={formAction}>
      <div className="mb-3 text-h3 font-semibold">Record a journal entry</div>
      <div className="mb-3 flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <LField label="Date" htmlFor="je-date">
            <LInput
              id="je-date"
              type="date"
              name="entry_date"
              required
              defaultValue={echoed?.entry_date ?? ""}
            />
          </LField>
        </div>
        <div className="min-w-56 flex-1">
          <LField label="Memo" htmlFor="je-memo">
            <LInput
              id="je-memo"
              name="memo"
              required
              placeholder="e.g. Owner draw, August"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </LField>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-caption text-ink-3">Common entries:</span>
        {PRESETS.map((preset) => (
          <LButton
            key={preset.key}
            type="button"
            size="sm"
            variant="outline"
            onClick={() => applyPreset(preset)}
          >
            {preset.label}
          </LButton>
        ))}
        <span className="text-caption text-ink-3">
          Fills in the two accounts and a memo. You still set the date and
          amount.
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {lines.map((line, i) => (
          <div key={line.key} className="flex flex-wrap items-center gap-2">
            <div className="w-56">
              <LSelect
                aria-label={`Line ${i + 1} account`}
                value={line.account === "" ? NO_ACCOUNT : line.account}
                onChange={(e) => update(line.key, { account: e.target.value })}
              >
                <option value={NO_ACCOUNT}>Pick an account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.kindLabel})
                  </option>
                ))}
              </LSelect>
              <input type="hidden" name="line_account" value={line.account} />
            </div>
            <div className="w-32">
              <LSelect
                aria-label={`Line ${i + 1} direction`}
                value={line.side}
                onChange={(e) => update(line.key, { side: e.target.value === "credit" ? "credit" : "debit" })}
              >
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </LSelect>
              <input type="hidden" name="line_side" value={line.side} />
            </div>
            <div className="w-32">
              <LInput
                name="line_amount"
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Line ${i + 1} amount`}
                value={line.amount}
                onChange={(e) => update(line.key, { amount: e.target.value })}
                className="tnum-l"
              />
            </div>
            {lines.length > 2 ? (
              <LButton
                type="button"
                size="sm"
                variant="quiet"
                className="text-crit hover:text-crit"
                onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
              >
                Remove
              </LButton>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <LButton
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setLines((prev) => [
              ...prev,
              { key: nextKey, account: "", side: "debit", amount: "" },
            ]);
            setNextKey((k) => k + 1);
          }}
        >
          Add line
        </LButton>
        <span className="tnum-l text-caption text-ink-3">
          Debits {formatCents(debitCents)} · Credits {formatCents(creditCents)}
        </span>
        {!balanced && (debitCents > 0 || creditCents > 0) ? (
          <span className="tnum-l text-caption font-medium text-warn">
            Out of balance by {formatCents(Math.abs(debitCents - creditCents))}
          </span>
        ) : null}
      </div>

      <div role="alert" aria-live="polite">
        {error ? <p className="mt-2 text-caption font-medium text-crit">{error}</p> : null}
      </div>
      <div className="mt-3">
        <LButton type="submit" disabled={pending}>
          {pending ? "Recording…" : "Record entry"}
        </LButton>
      </div>
    </form>
  );
}
