"use client";

import { useActionState, useState } from "react";
import { Button, Callout, Flex, Select, Text, TextField } from "@/components/ui";
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
      <Text as="div" size="2" weight="medium" mb="1">
        {COUNTERPARTY_COPY.addOperatorHeading}
      </Text>
      <Text as="div" size="1" color="gray" mb="2">
        {COUNTERPARTY_COPY.addOperatorHelp}
      </Text>
      {state.error ? (
        <Callout.Root color="red" size="1" mb="2">
          <Callout.Text>{state.error}</Callout.Text>
        </Callout.Root>
      ) : null}
      <Flex gap="2" align="end" wrap="wrap">
        <Flex direction="column" gap="1">
          <Text as="label" size="1" color="gray" htmlFor="new-operator-name">
            Operator name
          </Text>
          <TextField.Root
            id="new-operator-name"
            name="name"
            required
            defaultValue={state.name ?? ""}
            placeholder="Sierra Air Charter"
          />
        </Flex>
        <Flex direction="column" gap="1">
          <Text as="label" size="1" color="gray" id="new-operator-rule-label">
            Flown under
          </Text>
          <Select.Root
            value={operatingRule}
            onValueChange={(v) => setOperatingRule(v as ClientOperatingRule)}
          >
            <Select.Trigger aria-labelledby="new-operator-rule-label" />
            <Select.Content>
              {CLIENT_OPERATING_RULES.map((option) => (
                <Select.Item key={option.value} value={option.value}>
                  {option.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
          <input type="hidden" name="operating_rule" value={operatingRule} />
        </Flex>
        <Button type="submit" variant="soft" disabled={pending}>
          {pending ? "Adding..." : COUNTERPARTY_COPY.addOperatorSubmit}
        </Button>
      </Flex>
    </form>
  );
}
