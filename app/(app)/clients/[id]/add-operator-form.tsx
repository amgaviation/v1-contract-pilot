"use client";

import { useActionState, useState } from "react";
import { LAlert, lButtonClass } from "@/components/ledger";
import { LInput, LSelect } from "@/components/ledger/forms";
import { COUNTERPARTY_COPY } from "@/lib/counterparty";
import {
  CLIENT_OPERATING_RULES,
  type ClientOperatingRule,
} from "@/lib/operating-rule";
import {
  createOperatorCounterparty,
  type OperatorFormState,
} from "./operator-qualifications-actions";

const initialState: OperatorFormState = { error: null };

/**
 * Two fields. The name because pilot.clients requires one, and the
 * operating rule because without it this form hands the pilot a dead end.
 *
 * THE OPERATING RULE IS NOT OPTIONAL HERE, AND THAT IS THE POINT. The
 * panel this form sits in decides whether to show the 135.293, 135.297
 * and 135.299 rows by asking includesPart135(), which reads 'unspecified'
 * as "not Part 135" on purpose (see the safe-default reasoning in
 * lib/operating-rule.ts). An operator created without the rule therefore
 * lands on a qualifications panel with the Part 135 checks hidden, which
 * is precisely what the pilot came here to record. They would have to
 * open the billing form, set the rule, save, and navigate back.
 *
 * Defaulted to Part 135 because this control lives inside the Part 135
 * qualifications panel, and it is a visible labelled field rather than a
 * silent assumption: a pilot flying Part 91 for this operator changes it
 * before submitting, or on the client form afterwards.
 */
export default function AddOperatorForm() {
  const [state, formAction, pending] = useActionState(
    createOperatorCounterparty,
    initialState
  );
  const [operatingRule, setOperatingRule] = useState<ClientOperatingRule>(
    state.operatingRule ?? "part_135"
  );

  return (
    <form action={formAction}>
      <div className="mb-1 text-body-s font-medium text-ink">
        {COUNTERPARTY_COPY.addOperatorHeading}
      </div>
      <div className="mb-2 text-caption text-ink-3">
        {COUNTERPARTY_COPY.addOperatorHelp}
      </div>
      {state.error ? (
        <LAlert tone="crit" className="mb-2">
          {state.error}
        </LAlert>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-caption text-ink-3" htmlFor="new-operator-name">
            Operator name
          </label>
          <LInput
            id="new-operator-name"
            name="name"
            required
            defaultValue={state.name ?? ""}
            placeholder="Sierra Air Charter"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-ink-3" id="new-operator-rule-label">
            Flown under
          </span>
          <LSelect
            aria-labelledby="new-operator-rule-label"
            value={operatingRule}
            onChange={(e) => setOperatingRule(e.target.value as ClientOperatingRule)}
          >
            {CLIENT_OPERATING_RULES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </LSelect>
          <input type="hidden" name="operating_rule" value={operatingRule} />
        </div>
        <button type="submit" disabled={pending} className={lButtonClass({ variant: "outline" })}>
          {pending ? "Adding..." : COUNTERPARTY_COPY.addOperatorSubmit}
        </button>
      </div>
    </form>
  );
}
