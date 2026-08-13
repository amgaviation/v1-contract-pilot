"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Card, Flex, Text, TextField } from "@/components/ui";
import type { CustomOptionRow } from "@/lib/custom-options";
import {
  moveCustomOption,
  renameCustomOption,
  setCustomOptionArchived,
  type CustomizationFormState,
} from "./customization-actions";

const initialState: CustomizationFormState = { error: null };

/**
 * One option in one picker: rename it, move it, retire it.
 *
 * The three are separate operations with separate pending states, the
 * same split day-type-row.tsx uses — a slow archive click must not look
 * like a slow save.
 *
 * WHAT IS NOT HERE, and why: no key field (the key is what every past
 * expense, trip and document is filed under, and both the UPDATE grant
 * and pilot.custom_options_protect refuse to move it), no delete (there
 * is no DELETE policy on the table at all — archiving is the removal
 * story, because history must keep rendering), and no Retire button on a
 * built-in. That last one is the same reasoning day-type-row.tsx applies
 * to Delete: the database refuses it, so the control should not exist to
 * invite trying. The action refuses it too, with the sentence the trigger
 * would have raised, for the case where someone posts it anyway.
 *
 * THE REORDER BUTTONS ARE NEVER `disabled`, and that is a keyboard fix
 * rather than a preference. `disabled={moving || isFirst}` set the
 * attribute on the very button the pilot had just activated, in the same
 * render batch as the click — and a focused element that becomes disabled
 * is blurred to <body> per the HTML spec. Reordering fifteen categories
 * by keyboard therefore meant tabbing back down the settings page once
 * per press. So both buttons stay focusable, carry `aria-disabled` for
 * the semantics, and no-op in the handler at the ends of the list. The
 * move is also ANNOUNCED (the polite live region below): a reorder that
 * says nothing on success is invisible to a screen reader, since the
 * only feedback the action returns is an error.
 */
export default function CategoryRow({
  option,
  canEdit,
  isFirst,
  isLast,
  position,
  total,
}: {
  option: CustomOptionRow;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** 1-based place in the domain's list, for the move announcement. */
  position: number;
  total: number;
}) {
  const [state, formAction, pending] = useActionState(renameCustomOption, initialState);
  const [moving, startMove] = useTransition();
  const [archiving, startArchive] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);
  const [moveNotice, setMoveNotice] = useState<string | null>(null);

  // React 19 resets an uncontrolled form on every dispatch, error path
  // included — echo what was submitted so a rejected rename doesn't blank
  // what the pilot just typed.
  const label = state.values?.label ?? option.label;
  const archived = option.archived_at !== null;

  function runMove(direction: "up" | "down") {
    // The no-op at the ends, which is what lets the button stay enabled
    // and keep focus. A second press at position 1 does nothing rather
    // than sending a request the server would refuse anyway.
    if (moving) return;
    if (direction === "up" && isFirst) return;
    if (direction === "down" && isLast) return;

    startMove(async () => {
      setRowError(null);
      setMoveNotice(null);
      const result = await moveCustomOption(option.id, option.domain, direction);
      setRowError(result.error);
      if (!result.error) {
        const next = direction === "up" ? position - 1 : position + 1;
        setMoveNotice(`${option.label} moved to position ${next} of ${total}.`);
      }
    });
  }

  return (
    <Card>
      <form action={formAction}>
        <Flex direction="column" gap="2" p="1">
          <input type="hidden" name="id" value={option.id} />
          <input type="hidden" name="domain" value={option.domain} />

          <Flex align="end" gap="3" wrap="wrap">
            <Flex direction="column" gap="1" flexGrow="1" minWidth="180px">
              <Text size="1" color="gray">
                {option.is_builtin ? "Built in" : "Yours"}
                {archived ? " · retired" : ""}
              </Text>
              <TextField.Root
                name="label"
                required
                disabled={!canEdit}
                defaultValue={label}
                // The HUMAN label, never option.key. There is no visible
                // <label> on this field, so this string is the entire
                // accessible name — and announcing "Name for
                // pic_proficiency_check" reads out the machine handle this
                // whole screen exists to hide, while also breaking voice
                // control, which matches on visible text.
                aria-label={`Name for ${option.label}`}
              />
            </Flex>

            {/* size="2", not size="1". Radix's size-1 button is
                --space-5 tall, and the root Theme pins scaling="90%", so
                it renders 21.6px — under the WCAG 2.2 AA 24×24 target
                minimum, for a pair of opposite-direction controls sitting
                a few px apart on a screen this product expects to be used
                on a phone on a ramp. size="2" clears the floor. */}
            {canEdit ? (
              <Flex gap="2" wrap="wrap">
                <Button type="submit" size="2" disabled={pending}>
                  {pending ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  size="2"
                  variant="soft"
                  color="gray"
                  // aria-disabled, not disabled — see this file's header:
                  // disabling the pressed button blurs it to <body>.
                  aria-disabled={moving || isFirst}
                  onClick={() => runMove("up")}
                  aria-label={`Move ${option.label} up`}
                >
                  Up
                </Button>
                <Button
                  type="button"
                  size="2"
                  variant="soft"
                  color="gray"
                  aria-disabled={moving || isLast}
                  onClick={() => runMove("down")}
                  aria-label={`Move ${option.label} down`}
                >
                  Down
                </Button>
                {/* No Retire on a built-in — see this file's header. */}
                {option.is_builtin ? null : (
                  <Button
                    type="button"
                    size="2"
                    variant="outline"
                    color={archived ? undefined : "amber"}
                    disabled={archiving}
                    onClick={() =>
                      startArchive(async () => {
                        setRowError(null);
                        const result = await setCustomOptionArchived(
                          option.id,
                          option.domain,
                          !archived
                        );
                        setRowError(result.error);
                      })
                    }
                  >
                    {archiving ? "Working…" : archived ? "Bring back" : "Retire"}
                  </Button>
                )}
              </Flex>
            ) : null}
          </Flex>

          <div role="alert" aria-live="polite">
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
            {archived ? (
              <Text as="div" size="1" color="gray">
                Retired — not offered on new records, still shown on the ones already
                filed under it.
              </Text>
            ) : null}
          </div>

          {/* The successful-move announcement, in its own polite region.
              Separate from the role="alert" block above because a
              reorder is not an alert, and because that block is keyed to
              the rename action's state — a move that succeeded would
              otherwise say nothing at all to a screen reader, the row
              having simply changed place in the DOM. */}
          <div aria-live="polite" role="status">
            {moveNotice ? (
              <Text as="div" size="1" color="gray">
                {moveNotice}
              </Text>
            ) : null}
          </div>
        </Flex>
      </form>
    </Card>
  );
}
