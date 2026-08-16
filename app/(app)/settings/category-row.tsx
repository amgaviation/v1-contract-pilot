"use client";

import { useActionState, useState, useTransition } from "react";
import { LButton, LCard } from "@/components/ledger";
import { LInput } from "@/components/ledger/forms";
import { cn } from "@/lib/ledger/cn";
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
    <LCard>
      <form action={formAction}>
        <div className="flex flex-col gap-2">
          <input type="hidden" name="id" value={option.id} />
          <input type="hidden" name="domain" value={option.domain} />

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-[180px] flex-1 flex-col gap-1">
              <p className="text-caption text-ink-3">
                {option.is_builtin ? "Built in" : "Yours"}
                {archived ? " · retired" : ""}
              </p>
              <LInput
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
            </div>

            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <LButton type="submit" size="sm" disabled={pending}>
                  {pending ? "Saving…" : "Save"}
                </LButton>
                <LButton
                  type="button"
                  size="sm"
                  variant="outline"
                  // aria-disabled, not disabled — see this file's header:
                  // disabling the pressed button blurs it to <body>.
                  aria-disabled={moving || isFirst}
                  onClick={() => runMove("up")}
                  aria-label={`Move ${option.label} up`}
                >
                  Up
                </LButton>
                <LButton
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-disabled={moving || isLast}
                  onClick={() => runMove("down")}
                  aria-label={`Move ${option.label} down`}
                >
                  Down
                </LButton>
                {/* No Retire on a built-in — see this file's header. */}
                {option.is_builtin ? null : (
                  <LButton
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={archiving}
                    className={cn(!archived && "border-warn text-warn hover:bg-warn-soft")}
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
                  </LButton>
                )}
              </div>
            ) : null}
          </div>

          <div role="alert" aria-live="polite">
            {state.error ? (
              <p className="text-caption font-medium text-crit">{state.error}</p>
            ) : state.saved ? (
              <p className="text-caption font-medium text-good">Saved.</p>
            ) : null}
            {rowError ? <p className="text-caption font-medium text-crit">{rowError}</p> : null}
            {archived ? (
              <p className="text-caption text-ink-3">
                Retired. Not offered on new records, but still shown on the ones
                already filed under it.
              </p>
            ) : null}
          </div>

          {/* The successful-move announcement, in its own polite region.
              Separate from the role="alert" block above because a
              reorder is not an alert, and because that block is keyed to
              the rename action's state — a move that succeeded would
              otherwise say nothing at all to a screen reader, the row
              having simply changed place in the DOM. */}
          <div aria-live="polite" role="status">
            {moveNotice ? <p className="text-caption text-ink-3">{moveNotice}</p> : null}
          </div>
        </div>
      </form>
    </LCard>
  );
}
