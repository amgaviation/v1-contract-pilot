"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Button, Card, Flex, Grid, Select, Switch, Text, TextField } from "@radix-ui/themes";
import { centsToInput } from "@/lib/format";
import type { Database } from "@/lib/supabase/database.types";
import {
  updateDayType,
  setDayTypeArchived,
  deleteDayType,
  type DayTypeFormState,
} from "./day-types-actions";

type DayTypeRowValue = Database["pilot"]["Tables"]["day_types"]["Row"];

const initialState: DayTypeFormState = { error: null };

const LINE_TYPE_OPTIONS = [
  { value: "flight_day", label: "Flight day line" },
  { value: "travel_day", label: "Travel day line" },
  { value: "other", label: "Other line" },
] as const;

/**
 * One day type, editable in place. Save/rename/rate/bills-as/order share
 * a single form; archive and delete are separate immediate actions (not
 * form fields), each with its own pending state, so a slow archive click
 * can't be confused with a slow save.
 */
export default function DayTypeRow({
  dayType,
  canEdit,
}: {
  dayType: DayTypeRowValue;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateDayType, initialState);
  const [archiving, startArchive] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  // F7: the action returns `requiresConfirm` instead of saving when
  // billable/invoice_line_type changed and un-invoiced trips already use
  // this type. The hidden field below flips to "1" once that happens, so
  // the SAME form's next Save actually applies the change — no separate
  // dialog or extra client state needed, `state` already persists across
  // the two dispatches.
  const awaitingConfirm = Boolean(state.requiresConfirm);

  // React 19 resets an uncontrolled form on every action dispatch, error
  // path included — echo what was submitted so a rejected save doesn't
  // blank the rename the pilot just typed.
  const submitted = state.values;
  const initial = (key: string, stored: unknown, fallback = "") => {
    const echoed = submitted?.[key];
    if (echoed !== undefined) return echoed;
    return stored === null || stored === undefined ? fallback : String(stored);
  };
  const checked = (key: "billable" | "counts_for_per_diem", stored: boolean) => {
    const echoed = submitted?.[key];
    return echoed === undefined ? stored : echoed === "on";
  };

  const archived = Boolean(dayType.archived_at);

  // Radix's Select.Root always renders its posting <select> with
  // `defaultValue`, never `value` (@radix-ui/react-select's
  // SelectBubbleInput) — so it is uncontrolled from React's point of view
  // regardless of what Select.Root is given, and it's what the browser
  // actually posts as long as `name` stays on it. React 19's post-action
  // form.reset() restores it to its mount-time option even on a rejected
  // submit — silently changing a day type's invoice line type to whatever
  // it was when the row mounted. Fixed by dropping `name` and posting the
  // real value from a controlled hidden input instead.
  const [invoiceLineType, setInvoiceLineType] = useState(() =>
    initial("invoice_line_type", dayType.invoice_line_type)
  );
  useEffect(() => {
    if (submitted?.invoice_line_type !== undefined) {
      setInvoiceLineType(String(submitted.invoice_line_type));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted]);

  return (
    <Card>
      <form action={formAction}>
        <Flex direction="column" gap="3" p="1">
          <input type="hidden" name="id" value={dayType.id} />
          <input type="hidden" name="confirm_reprice" value={awaitingConfirm ? "1" : ""} />

          <Flex justify="between" align="center" wrap="wrap" gap="2">
            <Text size="1" color="gray" weight="bold" style={{ textTransform: "uppercase" }}>
              {dayType.is_builtin ? "Starting day type" : "Custom day type"}
            </Text>
            {archived ? (
              <Text size="1" color="gray">
                Archived — hidden from pickers, still used on past trips
              </Text>
            ) : null}
          </Flex>

          <Grid columns={{ initial: "2", md: "12" }} gap="3" align="start">
            <Flex direction="column" gap="1" style={{ gridColumn: "span 3" }}>
              <Text size="1" color="gray">
                Label
              </Text>
              <TextField.Root
                name="label"
                required
                disabled={!canEdit}
                defaultValue={initial("label", dayType.label)}
              />
            </Flex>
            <Flex direction="column" gap="1" style={{ gridColumn: "span 2" }} justify="center">
              <Text as="label" size="2" color="gray">
                <Flex gap="2" align="center" mt="4">
                  <Switch
                    name="billable"
                    value="on"
                    disabled={!canEdit}
                    defaultChecked={checked("billable", dayType.billable)}
                    aria-label="Billable"
                  />
                  Billable
                </Flex>
              </Text>
            </Flex>
            <Flex direction="column" gap="1" style={{ gridColumn: "span 3" }} justify="center">
              <Text as="label" size="2" color="gray">
                <Flex gap="2" align="center" mt="4">
                  <Switch
                    name="counts_for_per_diem"
                    value="on"
                    disabled={!canEdit}
                    defaultChecked={checked("counts_for_per_diem", dayType.counts_for_per_diem)}
                    aria-label="Counts for per diem"
                  />
                  Counts for per diem
                </Flex>
              </Text>
            </Flex>
            <Flex direction="column" gap="1" style={{ gridColumn: "span 2" }}>
              <Text size="1" color="gray">
                Default rate (USD)
              </Text>
              <TextField.Root
                name="default_rate"
                inputMode="decimal"
                disabled={!canEdit}
                defaultValue={initial("default_rate", centsToInput(dayType.default_rate_cents))}
              />
              <Text size="1" color="gray">
                Blank = no rate agreed
              </Text>
            </Flex>
            <Flex direction="column" gap="1" style={{ gridColumn: "span 2" }}>
              <Text size="1" color="gray">
                Order
              </Text>
              <TextField.Root
                type="number"
                name="sort_order"
                disabled={!canEdit}
                defaultValue={initial("sort_order", dayType.sort_order)}
              />
              <Text size="1" color="gray">
                Lower shows first
              </Text>
            </Flex>

            <Flex direction="column" gap="1" style={{ gridColumn: "span 5" }}>
              <Text as="label" size="1" color="gray" id={`bills-as-label-${dayType.id}`}>
                Bills as
              </Text>
              <Select.Root
                disabled={!canEdit}
                value={invoiceLineType}
                onValueChange={setInvoiceLineType}
              >
                <Select.Trigger aria-labelledby={`bills-as-label-${dayType.id}`} />
                <Select.Content>
                  {LINE_TYPE_OPTIONS.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <input type="hidden" name="invoice_line_type" value={invoiceLineType} />
            </Flex>
            <Flex direction="column" justify="center" style={{ gridColumn: "span 7" }}>
              <Text size="1" color="gray">
                The name is yours to change. Which invoice line it bills as is fixed, because the
                invoice&rsquo;s own billing rules depend on it.
              </Text>
            </Flex>
          </Grid>

          <div role="alert" aria-live="polite">
            {state.error ? (
              <Text size="1" color="red">
                {state.error}
              </Text>
            ) : awaitingConfirm ? (
              // F7: not saved yet — naming the consequence rather than
              // blocking it. Save again (the hidden confirm_reprice field is
              // now "1") to apply the change anyway.
              <Text size="1" color="amber">
                Changing Billable or Bills as will change how already-recorded days bill on{" "}
                {state.affectedTripCount}{" "}
                {state.affectedTripCount === 1 ? "trip that hasn't" : "trips that haven't"} been
                invoiced yet. Save again to apply it anyway.
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
          </div>

          {canEdit ? (
            <Flex gap="3" wrap="wrap">
              <Button type="submit" size="1" disabled={pending}>
                {pending ? "Saving…" : awaitingConfirm ? "Save anyway" : "Save"}
              </Button>
              <Button
                type="button"
                variant="outline"
                color={archived ? undefined : "amber"}
                size="1"
                disabled={archiving}
                onClick={() =>
                  startArchive(async () => {
                    setRowError(null);
                    const result = await setDayTypeArchived(dayType.id, !archived);
                    setRowError(result.error);
                  })
                }
              >
                {archiving ? "Working…" : archived ? "Restore" : "Archive"}
              </Button>
              {/* F1: never offer Delete on a built-in row — Archive/Restore
                  already do everything a pilot actually wants here, and
                  unlike delete it's reversible. The database rejects a
                  built-in delete outright (23514), but the control shouldn't
                  exist to invite trying. */}
              {dayType.is_builtin ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  color="red"
                  size="1"
                  disabled={deleting}
                  onClick={() =>
                    startDelete(async () => {
                      setRowError(null);
                      const result = await deleteDayType(dayType.id);
                      setRowError(result.error);
                    })
                  }
                >
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
              )}
            </Flex>
          ) : null}
        </Flex>
      </form>
    </Card>
  );
}
