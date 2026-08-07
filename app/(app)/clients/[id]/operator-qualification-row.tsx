"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Badge, Box, Button, Flex, Select, Text, TextField } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import {
  STATUS_OPTIONS,
  DERIVED_EXPIRY_REQUIREMENTS,
  OPERATOR_QUALIFICATION_REG_CITE,
} from "./operator-qualification-kinds";
import {
  saveOperatorQualification,
  deleteOperatorQualification,
  type QualificationFormState,
} from "./operator-qualifications-actions";

type QualificationRow = Database["pilot"]["Tables"]["operator_qualifications"]["Row"];

const initialState: QualificationFormState = { error: null };

/**
 * One requirement row, either the fixed kind (one per client — line 0 of
 * OPERATOR_QUALIFICATION_REQUIREMENTS minus the line check) or one
 * instance of a type-specific line check. `existing` is null for a
 * requirement the pilot hasn't recorded anything against yet — the same
 * insert-or-update branch RateOverrideRow uses for a never-set override.
 */
export default function OperatorQualificationRow({
  clientId,
  requirement,
  label,
  typeDesignator = "",
  existing,
  allowDelete = false,
  allowTypeEdit = false,
}: {
  clientId: string;
  requirement: string;
  label: string;
  /** Fixed '' for every requirement except line_check_135_299 instances. */
  typeDesignator?: string;
  existing: QualificationRow | null;
  /** Only line-check rows offer delete — see the action's own comment. */
  allowDelete?: boolean;
  /** True only for the "add another type" blank row, where type_designator
   * is a live text field rather than a fixed hidden value. */
  allowTypeEdit?: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveOperatorQualification, initialState);
  const [deleting, startDelete] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);
  const [typeInput, setTypeInput] = useState(typeDesignator);
  const [statusValue, setStatusValue] = useState<string>(existing?.status ?? "not_started");

  const derived = DERIVED_EXPIRY_REQUIREMENTS.has(requirement);
  const regCite = OPERATOR_QUALIFICATION_REG_CITE[requirement];

  const completedValue =
    state.values?.completed_on !== undefined
      ? state.values.completed_on
      : existing?.completed_on ?? "";

  // expires_on is only ever hand-entered for the non-derived kinds (H4) —
  // for the three trigger-derived checks the database always overwrites
  // it, so there is deliberately no input for those; see DERIVED_EXPIRY_
  // REQUIREMENTS and the trigger's own comment.
  const expiresValue =
    state.values?.expires_on !== undefined
      ? state.values.expires_on
      : existing?.expires_on ?? "";

  // The "add another type" blank row (allowTypeEdit) keeps a stable key in
  // the parent list across the revalidatePath refresh that follows a
  // successful save, so its local state would otherwise survive that
  // refresh instead of clearing — the one case where React 19's
  // per-dispatch form reset doesn't reach these fields because they're
  // controlled, not uncontrolled. Clear them explicitly once a save on
  // this specific row succeeds.
  useEffect(() => {
    if (allowTypeEdit && state.saved) {
      setTypeInput("");
      setStatusValue("not_started");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.saved]);

  return (
    <Flex asChild direction="column" gap="2" py="3">
      <form action={formAction}>
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="requirement" value={requirement} />
        <input
          type="hidden"
          name="type_designator"
          value={allowTypeEdit ? typeInput : typeDesignator}
        />
        <input type="hidden" name="status" value={statusValue} />

        <Flex justify="between" align="start" wrap="wrap" gap="3">
          <Box style={{ flex: "1 1 220px" }}>
            <Text as="div" size="2" weight="medium">
              {label}
              {typeDesignator ? ` — ${typeDesignator}` : null}
            </Text>
            {regCite ? (
              <Text as="div" size="1" color="gray">
                {regCite}
              </Text>
            ) : null}
          </Box>

          {allowTypeEdit ? (
            <Flex direction="column" gap="1" style={{ flex: "1 1 140px" }}>
              <Text size="1" color="gray">
                Aircraft type
              </Text>
              <TextField.Root
                placeholder="CE-560XL"
                value={typeInput}
                onChange={(e) => setTypeInput(e.target.value)}
              />
            </Flex>
          ) : null}

          <Flex direction="column" gap="1" style={{ flex: "1 1 160px" }}>
            <Text size="1" color="gray">
              Completed on
            </Text>
            <TextField.Root type="date" name="completed_on" defaultValue={completedValue} />
          </Flex>

          <Flex direction="column" gap="1" style={{ flex: "1 1 170px" }}>
            <Text size="1" color="gray">
              Status
            </Text>
            <Select.Root value={statusValue} onValueChange={setStatusValue}>
              <Select.Trigger />
              <Select.Content>
                {STATUS_OPTIONS.map((opt) => (
                  <Select.Item key={opt.value} value={opt.value}>
                    {opt.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>

          <Flex direction="column" gap="1" style={{ flex: "1 1 170px" }}>
            <Text size="1" color="gray">
              {derived ? "Valid through (computed)" : "Valid through"}
            </Text>
            {derived ? (
              existing?.expires_on ? (
                <Badge color={existing.expires_on < new Date().toISOString().slice(0, 10) ? "red" : "gray"}>
                  {formatDate(existing.expires_on)}
                </Badge>
              ) : (
                <Text size="2" color="gray">
                  Set once completed
                </Text>
              )
            ) : (
              <TextField.Root type="date" name="expires_on" defaultValue={expiresValue} />
            )}
          </Flex>

          <Flex direction="column" gap="1" pt="4">
            <Button type="submit" variant="outline" size="1" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </Flex>
        </Flex>

        <Flex direction="column" gap="1" style={{ maxWidth: "480px" }}>
          <Text size="1" color="gray">
            Notes
          </Text>
          <TextField.Root
            name="notes"
            placeholder="Optional"
            defaultValue={state.values?.notes ?? existing?.notes ?? ""}
          />
        </Flex>

        <Box role="alert" aria-live="polite">
          {state.error ? (
            <Text size="1" color="red">
              {state.error}
            </Text>
          ) : state.saved ? (
            <Text size="1" color="green">
              Saved.
            </Text>
          ) : null}
          {rowError ? (
            <Text as="div" size="1" color="red">
              {rowError}
            </Text>
          ) : null}
        </Box>

        {allowDelete && existing ? (
          <Flex>
            <Button
              type="button"
              variant="ghost"
              color="red"
              size="1"
              disabled={deleting}
              onClick={() =>
                startDelete(async () => {
                  setRowError(null);
                  const result = await deleteOperatorQualification(existing.id, clientId);
                  if (result.error) setRowError(result.error);
                })
              }
            >
              {deleting ? "Removing…" : "Remove"}
            </Button>
          </Flex>
        ) : null}
      </form>
    </Flex>
  );
}
