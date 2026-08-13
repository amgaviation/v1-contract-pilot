"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import NextLink from "next/link";
import {
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Grid,
  Select,
  Separator,
  Text,
  TextField,
} from "@/components/ui";
import { Cross2Icon, ExclamationTriangleIcon } from "@radix-ui/react-icons";

import {
  LOGBOOK_VIEW_ROLES,
  LOGBOOK_VIEW_ROLE_LABEL,
  logbookFilterHref,
  logbookFilterIsEmpty,
  logbookFiltersEqual,
  type LogbookFilter,
  type LogbookView,
} from "@/lib/logbook-views";
import type { LogbookViewFormState } from "./views-actions";

/**
 * The saved-view picker and the filter that feeds it.
 *
 * THE FILTER LIVES IN THE URL, not in this component's state, and that is
 * the load-bearing decision here. A filtered logbook is something a pilot
 * bookmarks, sends to themselves, and comes back to after a browser
 * restart; it is also what the browser's back button has to be able to
 * undo. Holding it in React state would break all three and would make a
 * saved view a different kind of thing from a link, when they are exactly
 * the same thing with a name attached. So this component's own state is
 * only the DRAFT — what the pilot has picked but not yet applied — and
 * applying navigates.
 *
 * Radix's Select posts through a bubble <select> rendered with
 * `defaultValue`, which React 19's post-action form.reset() would restore
 * to its mount-time option; the same reason aircraft-form.tsx keeps `name`
 * off its Select and posts from a controlled input. Here the draft is
 * pushed through the router instead of submitted, so the picker values
 * never ride a form at all.
 */

// Radix Select.Item forbids an empty-string value, and "any" is a real
// choice rather than an absence.
const ANY = "__any__";

const initialState: LogbookViewFormState = { error: null };

export type TailOption = { tailKey: string; tailNumber: string; archived: boolean };

export default function SavedViews({
  views,
  activeFilter,
  tails,
  typeLabels,
  saveAction,
  deleteAction,
}: {
  views: LogbookView[];
  activeFilter: LogbookFilter;
  tails: TailOption[];
  typeLabels: string[];
  saveAction: (
    state: LogbookViewFormState,
    formData: FormData
  ) => Promise<LogbookViewFormState>;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();

  const [tail, setTail] = useState(activeFilter.tailKey ?? ANY);
  const [type, setType] = useState(activeFilter.typeLabel ?? ANY);
  const [role, setRole] = useState<string>(activeFilter.role ?? ANY);
  const [from, setFrom] = useState(activeFilter.dateFrom ?? "");
  const [to, setTo] = useState(activeFilter.dateTo ?? "");
  /** Set by apply() when the two dates cannot both be true. Cleared by the
   *  next apply and by any change to either date. */
  const [rangeError, setRangeError] = useState<string | null>(null);

  // The URL is the source of truth: when a saved view is clicked, or the
  // back button is pressed, the applied filter changes underneath this
  // component and the draft has to follow it. Without this the pickers
  // would keep showing whatever was last typed while the table below
  // showed something else.
  useEffect(() => {
    setTail(activeFilter.tailKey ?? ANY);
    setType(activeFilter.typeLabel ?? ANY);
    setRole(activeFilter.role ?? ANY);
    setFrom(activeFilter.dateFrom ?? "");
    setTo(activeFilter.dateTo ?? "");
    setRangeError(null);
  }, [activeFilter]);

  const [state, formAction, pending] = useActionState(saveAction, initialState);
  const submitted = state.values;
  const [name, setName] = useState("");
  useEffect(() => {
    if (state.saved) setName("");
    else if (submitted?.name !== undefined) setName(submitted.name);
  }, [state, submitted]);

  const activeIsEmpty = logbookFilterIsEmpty(activeFilter);
  const alreadySaved = views.some((view) =>
    logbookFiltersEqual(view.filter, activeFilter)
  );

  function apply(event: React.FormEvent) {
    event.preventDefault();
    const fromValue = from.trim();
    const toValue = to.trim();
    // AN IMPOSSIBLE RANGE IS REFUSED HERE, IN WORDS. resolveLogbookFilter
    // drops both ends of a reversed range, which is the right behaviour for
    // a hand-edited URL — it fails wide, toward showing more of the record.
    // As the ONLY guard it meant a pilot who mistyped a year watched their
    // whole logbook come back under career totals, both date fields blank
    // themselves, and nothing say why. The resolver is still the last line;
    // this is the sentence it always claimed the form said.
    if (fromValue !== "" && toValue !== "" && fromValue > toValue) {
      setRangeError(
        "That range runs backwards — the From date is after the To date. Swap them and try again."
      );
      return;
    }
    setRangeError(null);
    // Assembled through the same pure helper the saved views and the server
    // both use, so a link built here and a link stored in a view cannot be
    // shaped differently. Blank/any facets are omitted rather than written
    // as empty parameters.
    router.push(
      logbookFilterHref({
        tailKey: tail === ANY ? null : tail,
        typeLabel: type === ANY ? null : type,
        role:
          role === ANY
            ? null
            : (LOGBOOK_VIEW_ROLES.find((value) => value === role) ?? null),
        dateFrom: fromValue === "" ? null : fromValue,
        dateTo: toValue === "" ? null : toValue,
      })
    );
  }

  return (
    <Card>
      <Flex direction="column" gap="3" p="1">
        {views.length > 0 ? (
          <>
            <Flex align="center" gap="2" wrap="wrap">
              <Text size="1" color="gray" weight="bold" style={{ textTransform: "uppercase" }}>
                Saved views
              </Text>
              {views.map((view) => {
                const isActive = logbookFiltersEqual(view.filter, activeFilter);
                return (
                  <Flex key={view.name} align="center" gap="1">
                    <Button
                      asChild
                      size="1"
                      variant={isActive ? "solid" : "soft"}
                    >
                      <NextLink href={logbookFilterHref(view.filter)}>
                        {view.name}
                      </NextLink>
                    </Button>
                    {/* Its own tiny form rather than a button inside the
                        filter form: nesting forms is invalid HTML and the
                        delete must not carry the filter's fields. */}
                    <form action={deleteAction}>
                      <input type="hidden" name="name" value={view.name} />
                      <Button
                        type="submit"
                        size="1"
                        variant="ghost"
                        color="gray"
                        aria-label={`Delete the saved view ${view.name}`}
                      >
                        <Cross2Icon />
                      </Button>
                    </form>
                  </Flex>
                );
              })}
            </Flex>
            <Separator size="4" />
          </>
        ) : null}

        <form onSubmit={apply}>
          <Grid columns={{ initial: "1", sm: "2", lg: "5" }} gap="3" align="end">
            <Flex direction="column" gap="1">
              <Text as="label" size="1" color="gray" id="filter-tail-label">
                Aircraft
              </Text>
              <Select.Root value={tail} onValueChange={setTail}>
                <Select.Trigger aria-labelledby="filter-tail-label" />
                <Select.Content>
                  <Select.Item value={ANY}>Any aircraft</Select.Item>
                  {tails.map((option) => (
                    <Select.Item key={option.tailKey} value={option.tailKey}>
                      {/* A retired airframe still filters — archiving takes
                          it out of the pickers for NEW work, and its hours
                          are still the pilot's history. Marked rather than
                          hidden. */}
                      {option.archived
                        ? `${option.tailNumber} (retired)`
                        : option.tailNumber}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>

            <Flex direction="column" gap="1">
              <Text as="label" size="1" color="gray" id="filter-type-label">
                Type
              </Text>
              <Select.Root value={type} onValueChange={setType}>
                <Select.Trigger aria-labelledby="filter-type-label" />
                <Select.Content>
                  <Select.Item value={ANY}>Any type</Select.Item>
                  {typeLabels.map((label) => (
                    <Select.Item key={label} value={label}>
                      {label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>

            <Flex direction="column" gap="1">
              <Text as="label" size="1" color="gray" id="filter-role-label">
                Role
              </Text>
              <Select.Root value={role} onValueChange={setRole}>
                <Select.Trigger aria-labelledby="filter-role-label" />
                <Select.Content>
                  <Select.Item value={ANY}>Any role</Select.Item>
                  {LOGBOOK_VIEW_ROLES.map((value) => (
                    <Select.Item key={value} value={value}>
                      {LOGBOOK_VIEW_ROLE_LABEL[value]}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>

            <Flex direction="column" gap="1">
              <Text as="label" size="1" color="gray" htmlFor="filter-from">
                From
              </Text>
              <TextField.Root
                id="filter-from"
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setRangeError(null);
                }}
              />
            </Flex>

            <Flex direction="column" gap="1">
              <Text as="label" size="1" color="gray" htmlFor="filter-to">
                To
              </Text>
              <TextField.Root
                id="filter-to"
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setRangeError(null);
                }}
              />
            </Flex>
          </Grid>

          <Flex gap="2" mt="3" wrap="wrap" align="center">
            <Button type="submit" variant="soft">
              Show these entries
            </Button>
            {activeIsEmpty ? null : (
              <Button asChild variant="ghost" color="gray">
                <NextLink href="/logbook">Clear</NextLink>
              </Button>
            )}
          </Flex>

          {rangeError ? (
            <Callout.Root color="amber" size="1" mt="3">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>{rangeError}</Callout.Text>
            </Callout.Root>
          ) : null}
        </form>

        {activeIsEmpty ? null : (
          <>
            <Separator size="4" />
            {alreadySaved ? (
              <Flex align="center" gap="2">
                <Badge color="gray" variant="outline">
                  Saved
                </Badge>
                <Text size="1" color="gray">
                  You already have a saved view for exactly this filter.
                </Text>
              </Flex>
            ) : (
              <form action={formAction}>
                {/* THE APPLIED FILTER, not the draft above: what gets saved
                    is what the pilot is looking at. Re-validated server-side
                    — these are as untrusted as a hand-edited URL. */}
                <input type="hidden" name="tail" value={activeFilter.tailKey ?? ""} />
                <input type="hidden" name="type" value={activeFilter.typeLabel ?? ""} />
                <input type="hidden" name="role" value={activeFilter.role ?? ""} />
                <input type="hidden" name="from" value={activeFilter.dateFrom ?? ""} />
                <input type="hidden" name="to" value={activeFilter.dateTo ?? ""} />
                <Flex gap="2" align="end" wrap="wrap">
                  <Flex direction="column" gap="1">
                    <Text as="label" size="1" color="gray" htmlFor="view-name">
                      Save this view as
                    </Text>
                    <TextField.Root
                      id="view-name"
                      name="name"
                      placeholder="Citation V, as PIC"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </Flex>
                  <Button type="submit" disabled={pending}>
                    {pending ? "Saving…" : "Save view"}
                  </Button>
                </Flex>
              </form>
            )}
            {state.error ? (
              <Callout.Root color="red" size="1">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>{state.error}</Callout.Text>
              </Callout.Root>
            ) : null}
          </>
        )}
      </Flex>
    </Card>
  );
}
