"use client";

import { useActionState, useState } from "react";
import {
  Button,
  Card,
  Flex,
  Heading,
  Switch,
  Text,
} from "@/components/ui";
import { NAV_SETTINGS, type NavItem, type NavLayout } from "@/lib/nav";
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
 * The reorder controls are size="2", not size="1": the root Theme pins
 * scaling="90%", which renders a size-1 button 21.6px tall — under the
 * WCAG 2.2 AA 24×24 target minimum, and this file's own argument for
 * buttons over drag is that they need no pointer precision.
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
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="1">
        <Heading as="h3" size="4">
          Navigation
        </Heading>
        <Text size="2" color="gray">
          The order of the sections in the rail, and which of them it shows. Hiding a
          section only takes it out of the rail — the screen still works, its links
          from other screens still open it, and a bookmark still gets you there. Your
          records are untouched either way. {NAV_SETTINGS.label} always stays visible,
          so you can always get back here.
        </Text>
        {/* Said here rather than discovered in the rail. The group
            headings only survive while each group is still one unbroken
            run — see navGroupsAreContiguous in lib/nav.ts and the rail's
            own note. */}
        <Text size="1" color="gray">
          The rail groups these under headings ({[
            ...new Set(
              sections
                .map((item) => item.group)
                .filter((group) => group !== undefined)
            ),
          ].join(", ")}). Move a section past one from another group and the headings
          stop matching the order, so the rail drops them and shows one plain list —
          your order, exactly as you set it.
        </Text>
      </Flex>

      <Card>
        <form action={formAction}>
          <Flex direction="column" gap="3" p="1">
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
                <Flex
                  key={href}
                  align="center"
                  justify="between"
                  gap="3"
                  wrap="wrap"
                  py="1"
                  style={{ borderBottom: "1px solid var(--gray-a3)" }}
                >
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="medium">
                      {item.label}
                    </Text>
                    <Text size="1" color="gray">
                      {item.group ?? "—"} · {item.href}
                    </Text>
                  </Flex>

                  <Flex align="center" gap="3">
                    <Text as="label" size="1" color="gray">
                      <Flex align="center" gap="2">
                        <Switch
                          checked={visible}
                          disabled={!canEdit}
                          onCheckedChange={(checked) => toggle(href, checked === true)}
                          aria-label={`Show ${item.label} in the rail`}
                        />
                        Show
                      </Flex>
                    </Text>
                    {/* aria-disabled at the ends, `disabled` only for a
                        non-owner: see this file's header. A pilot who may
                        not edit at all never had focus to lose. */}
                    <Button
                      type="button"
                      size="2"
                      variant="soft"
                      color="gray"
                      disabled={!canEdit}
                      aria-disabled={index === 0}
                      onClick={() => move(index, -1)}
                      aria-label={`Move ${item.label} up`}
                    >
                      Up
                    </Button>
                    <Button
                      type="button"
                      size="2"
                      variant="soft"
                      color="gray"
                      disabled={!canEdit}
                      aria-disabled={index === order.length - 1}
                      onClick={() => move(index, 1)}
                      aria-label={`Move ${item.label} down`}
                    >
                      Down
                    </Button>
                  </Flex>
                </Flex>
              );
            })}

            {/* The move announcement, separate from the save alert: a
                reorder here is local state and produces no server
                response at all, so without this a screen-reader user
                gets no confirmation that anything happened. */}
            <div aria-live="polite" role="status">
              {moveNotice ? (
                <Text size="1" color="gray">
                  {moveNotice}
                </Text>
              ) : null}
            </div>

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
            </div>

            {canEdit ? (
              <Flex>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save navigation"}
                </Button>
              </Flex>
            ) : (
              <Text size="1" color="gray">
                Only the account owner can change the navigation.
              </Text>
            )}
          </Flex>
        </form>
      </Card>
    </Flex>
  );
}
