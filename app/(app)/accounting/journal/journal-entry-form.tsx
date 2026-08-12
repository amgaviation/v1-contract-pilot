"use client";

import { useActionState, useState } from "react";
import {
  Button,
  Card,
  Flex,
  Select,
  Text,
  TextField,
} from "@/components/ui";
import { formatCents } from "@/lib/format";
import { parsePositiveDollarsToCents } from "../ledger-lib";
import { createJournalEntry, type JournalFormState } from "./actions";

export type AccountOption = {
  id: string;
  name: string;
  kindLabel: string;
};

const initialState: JournalFormState = { error: null };

type LineDraft = {
  key: number;
  account: string;
  side: "debit" | "credit";
  amount: string;
};

const NO_ACCOUNT = "none";

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
    <Card size="3">
      <FormBody
        key={values ? JSON.stringify(values) : "fresh"}
        accounts={accounts}
        formAction={formAction}
        pending={pending}
        error={state.error}
        echoed={values}
      />
    </Card>
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
      <Text as="div" size="4" weight="bold" mb="3">
        Record a journal entry
      </Text>
      <Flex gap="3" wrap="wrap" mb="3">
        <Flex direction="column" gap="1">
          <Text as="label" size="2" weight="medium" htmlFor="je-date">
            Date
          </Text>
          <TextField.Root
            id="je-date"
            type="date"
            name="entry_date"
            required
            defaultValue={echoed?.entry_date ?? ""}
          />
        </Flex>
        <Flex direction="column" gap="1" flexGrow="1">
          <Text as="label" size="2" weight="medium" htmlFor="je-memo">
            Memo
          </Text>
          <TextField.Root
            id="je-memo"
            name="memo"
            required
            placeholder="e.g. Owner draw — August"
            defaultValue={echoed?.memo ?? ""}
          />
        </Flex>
      </Flex>

      <Flex direction="column" gap="2">
        {lines.map((line, i) => (
          <Flex key={line.key} gap="2" align="center" wrap="wrap">
            <input type="hidden" name="line_account" value={line.account} />
            <Select.Root
              value={line.account === "" ? NO_ACCOUNT : line.account}
              onValueChange={(v) => update(line.key, { account: v === NO_ACCOUNT ? "" : v })}
            >
              <Select.Trigger
                aria-label={`Line ${i + 1} account`}
                placeholder="Account"
              />
              <Select.Content>
                <Select.Item value={NO_ACCOUNT}>Pick an account…</Select.Item>
                {accounts.map((a) => (
                  <Select.Item key={a.id} value={a.id}>
                    {a.name} ({a.kindLabel})
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <input type="hidden" name="line_side" value={line.side} />
            <Select.Root
              value={line.side}
              onValueChange={(v) => update(line.key, { side: v === "credit" ? "credit" : "debit" })}
            >
              <Select.Trigger aria-label={`Line ${i + 1} direction`} />
              <Select.Content>
                <Select.Item value="debit">Debit</Select.Item>
                <Select.Item value="credit">Credit</Select.Item>
              </Select.Content>
            </Select.Root>
            <TextField.Root
              name="line_amount"
              inputMode="decimal"
              placeholder="0.00"
              aria-label={`Line ${i + 1} amount`}
              value={line.amount}
              onChange={(e) => update(line.key, { amount: e.target.value })}
              className="tnum"
            />
            {lines.length > 2 ? (
              <Button
                type="button"
                size="1"
                variant="ghost"
                color="red"
                onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
              >
                Remove
              </Button>
            ) : null}
          </Flex>
        ))}
      </Flex>

      <Flex mt="2" gap="3" align="center" wrap="wrap">
        <Button
          type="button"
          size="1"
          variant="soft"
          onClick={() => {
            setLines((prev) => [
              ...prev,
              { key: nextKey, account: "", side: "debit", amount: "" },
            ]);
            setNextKey((k) => k + 1);
          }}
        >
          Add line
        </Button>
        <Text size="1" color="gray" className="tnum">
          Debits {formatCents(debitCents)} · Credits {formatCents(creditCents)}
        </Text>
        {!balanced && (debitCents > 0 || creditCents > 0) ? (
          <Text size="1" color="amber">
            Out of balance by {formatCents(Math.abs(debitCents - creditCents))}
          </Text>
        ) : null}
      </Flex>

      <Flex mt="2" role="alert" aria-live="polite">
        {error ? (
          <Text size="1" color="red">
            {error}
          </Text>
        ) : null}
      </Flex>
      <Flex mt="3">
        <Button type="submit" disabled={pending}>
          {pending ? "Recording…" : "Record entry"}
        </Button>
      </Flex>
    </form>
  );
}
