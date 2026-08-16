"use client";

import { useActionState, useState } from "react";
import { LButton, LCard, LSwitch } from "@/components/ledger";
import { type NavItem, type NavLayout } from "@/lib/nav";
import {
  saveNavArrangement,
  type CustomizationFormState,
} from "./customization-actions";

const initialState: CustomizationFormState = { error: null };

/**
 * LAYOUT — the order of the section rail, and which sections it shows.
 *
 * MOVE UP / MOVE DOWN, NOT DRAG. A drag-and-drop list is a mouse
 * interaction with a keyboard story bolted on afterwards, and this is a
 * settings screen a pilot might be using on a phone on a ramp. Two
 * buttons per row are operable by keyboard, by screen reader, and by a
 * thumb, need no pointer-precision, and are trivially announced. Each
 * carries an explicit aria-label naming the section, because "Move up" on
 * its own is meaningless in a list of eleven.
 *
 * Rows are keyed by href, so reordering MOVES the existing DOM nodes
 * rather than rebuilding them — which is what keeps focus on the button
 * the pilot just pressed as the row travels up the list. The buttons
 * therefore must not DISABLE themselves at the ends either: a focused
 * element that becomes disabled is blurred to <body> per the HTML spec,
 * so moving a section to the top or the bottom threw focus away on the
 * last press and contradicted the sentence above. They stay focusable,
 * carry `aria-disabled`, and `move()` no-ops past the ends. The new
 * position is announced in a polite region, because a purely visual
 * reorder tells a screen-reader user nothing — and this list's changes
 * are local state, so there is not even an error to hear.
 *
 * SETTINGS IS NOT IN THIS LIST. It is where a pilot comes to undo this
 * setting, so it is neither offered nor hideable — normalizeNavLayout
 * drops it from `hidden` even if a stored blob names it, so this is a
 * rule rather than a convention of the screen.
 */
export default function LayoutPanel({
  sections,
  layout,
  canEdit,
}: {
  /**
   * Every section available to this account, in the tenant's current
   * order — hidden ones INCLUDED. They must render here (with their
   * Show switch off) or a pilot who hid one could never bring it back.
   * See settings/page.tsx, which applies the order half of the layout
   * and deliberately not the hidden half.
   */
  sections: readonly NavItem[];
  layout: NavLayout;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveNavArrangement, initialState);

  const [order, setOrder] = useState<string[]>(() => sections.map((item) => item.href));
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(layout.hidden));
  const [moveNotice, setMoveNotice] = useState<string | null>(null);

  const byHref = new Map(sections.map((item) => [item.href, item]));

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    setOrder((current) => {
      const moved = current[index];
      const displaced = current[target];
      if (moved === undefined || displaced === undefined) return current;
      const next = current.slice();
      next[index] = displaced;
      next[target] = moved;
      return next;
    });
    const label = byHref.get(order[index] ?? "")?.label ?? "Section";
    setMoveNotice(`${label} moved to position ${target + 1} of ${order.length}.`);
  }

  function toggle(href: string, visible: boolean) {
    setHidden((current) => {
      const next = new Set(current);
      if (visible) next.delete(href);
      else next.add(href);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-h3 font-semibold">Navigation</h3>
        {/* Said here rather than discovered in the rail. The group
            headings only survive while each group is still one unbroken
            run — see navGroupsAreContiguous in lib/nav.ts and the rail's
            own note. */}
        <p className="text-caption text-ink-3">
          The rail groups these under headings ({[
            ...new Set(
              sections
                .map((item) => item.group)
                .filter((group) => group !== undefined)
            ),
          ].join(", ")}). Move a section past one from another group and the headings
          stop matching the order, so the rail drops them and shows one plain list —
          your order, exactly as you set it.
        </p>
      </div>

      <LCard>
        <form action={formAction}>
          <div className="flex flex-col gap-3">
            {/* The whole arrangement posts as one field plus one checkbox
                per hidden section. Newline-separated rather than JSON: the
                server puts it through normalizeNavLayout anyway, which
                drops anything that is not a real section href, so there is
                no shape here worth parsing strictly. */}
            <input type="hidden" name="order" value={order.join("\n")} />
            {[...hidden].map((href) => (
              <input key={href} type="hidden" name="hidden" value={href} />
            ))}

            {order.map((href, index) => {
              const item = byHref.get(href);
              if (!item) return null;
              const visible = !hidden.has(href);
              return (
                <div
                  key={href}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-hair py-1 last:border-b-0"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-body-s font-medium">{item.label}</span>
                    <span className="text-caption text-ink-3">
                      {item.group ?? "—"} · {item.href}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-caption text-ink-3">
                      <LSwitch
                        checked={visible}
                        disabled={!canEdit}
                        onCheckedChange={(checked) => toggle(href, checked === true)}
                        aria-label={`Show ${item.label} in the rail`}
                      />
                      Show
                    </label>
                    {/* aria-disabled at the ends, `disabled` only for a
                        non-owner: see this file's header. A pilot who may
                        not edit at all never had focus to lose. */}
                    <LButton
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canEdit}
                      aria-disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Move ${item.label} up`}
                    >
                      Up
                    </LButton>
                    <LButton
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canEdit}
                      aria-disabled={index === order.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Move ${item.label} down`}
                    >
                      Down
                    </LButton>
                  </div>
                </div>
              );
            })}

            {/* The move announcement, separate from the save alert: a
                reorder here is local state and produces no server
                response at all, so without this a screen-reader user
                gets no confirmation that anything happened. */}
            <div aria-live="polite" role="status">
              {moveNotice ? (
                <p className="text-caption text-ink-3">{moveNotice}</p>
              ) : null}
            </div>

            <div role="alert" aria-live="polite">
              {state.error ? (
                <p className="text-caption font-medium text-crit">{state.error}</p>
              ) : state.saved ? (
                <p className="text-caption font-medium text-good">Saved.</p>
              ) : null}
            </div>

            {canEdit ? (
              <div>
                <LButton type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save navigation"}
                </LButton>
              </div>
            ) : (
              <p className="text-caption text-ink-3">
                Only the account owner can change the navigation.
              </p>
            )}
          </div>
        </form>
      </LCard>
    </div>
  );
}
