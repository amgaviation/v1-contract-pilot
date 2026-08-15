"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  defaultFilter,
} from "cmdk";
import { DialogShell } from "@/components/ds/dialog";
import { Box, Button, Flex, Text } from "@/components/ui";
import { NAV_HELP, NAV_SETTINGS, type NavItem } from "@/lib/nav";
import type {
  CommandSearchResponse,
  CommandSearchResult,
} from "@/app/api/command-search/route";

/**
 * THE ⌘K COMMAND PALETTE — the product's first search of any kind.
 * Everything else in the app (clients/invoices/trips/expenses) is a
 * browse-only list capped at 1000 rows; this is the one place a pilot can
 * type a client name, an invoice number, or an ICAO pair and land on the
 * record directly instead of paging a list to find it.
 *
 * HOSTED IN THE REPO'S OWN DIALOG, NOT cmdk's. cmdk ships a `Command.Dialog`
 * built on Radix's dialog primitive, but this product has exactly one
 * overlay mechanism — DialogShell (components/ds/dialog.tsx), native
 * `<dialog>` + showModal() — and every accessibility property a second
 * dialog implementation would have to re-earn (focus trap, inert
 * background, top layer, Escape-to-close) that one already has. So this
 * renders the PLAIN `Command` primitives inside DialogShell instead:
 * cmdk supplies listbox semantics and keyboard nav, DialogShell supplies
 * the modal itself.
 *
 * TWO RESULT LAYERS, deliberately filtered two different ways:
 *
 *   NAVIGATION  sections + Settings + Help. Static, always available, and
 *               filtered by cmdk's OWN fuzzy matcher (the `filter` prop's
 *               fallback to `defaultFilter` below) — there is nothing to
 *               fetch, so there is nothing to debounce.
 *   RECORDS     clients/invoices/trips from /api/command-search, fetched
 *               as the pilot types. These arrive ALREADY filtered by the
 *               server (an ilike against real columns, not a client-side
 *               fuzzy score), so cmdk's own matcher would be redundant at
 *               best and could hide a real match at worst — a record
 *               whose label doesn't happen to contain the literal query
 *               text as a fuzzy-scorable substring (e.g. an invoice found
 *               via its CLIENT's name, not its own number) would be
 *               re-filtered out by a matcher scoring the label alone. The
 *               `filter` function below exempts them by a `record::`
 *               value prefix, so a record that survived the server's
 *               query is never hidden a second time on the client.
 *
 * `sections` arrives as a PROP, not an import of lib/nav's own list — see
 * nav-rail.tsx's header comment: the rail's section list is filtered by
 * the server-only currency flag before it ever reaches a client
 * component, and this palette must show the SAME filtered list the rail
 * does, not a second, unfiltered one that could offer a pilot a section
 * their tenant does not have.
 *
 * THE TRIGGER BUTTON LIVES HERE TOO, not in app-shell.tsx. app-shell.tsx
 * is a presentational server component (its own header comment: "measured
 * by scripts/layout-verify.mjs... keep the shell a presentational
 * component"), and opening the palette needs a click handler, which only
 * a client component can own. Rendering the button as part of THIS
 * component — a fragment of [trigger, dialog] sharing one `open` state —
 * means app-shell.tsx's only edit is mounting `<CommandPalette
 * sections={sections} />` where the button should appear, rather than
 * lifting `open` state up into the shell and threading a setter back
 * down, which would be the same feature spread across two files for no
 * benefit.
 */

/** Below this the query is too short to be worth a round trip — mirrors
 *  the same floor app/api/command-search/route.ts enforces server-side,
 *  so the palette never fires (and then discards) a request the API
 *  would have answered empty anyway. */
const MIN_QUERY_LENGTH = 2;
/** Keystrokes coalesce into one request this long after the pilot pauses
 *  — short enough that search still feels immediate, long enough that a
 *  five-letter word is one request, not five. */
const DEBOUNCE_MS = 200;

type RecordsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      clients: CommandSearchResult[];
      invoices: CommandSearchResult[];
      trips: CommandSearchResult[];
    };

/** Every navigation `CommandItem`'s `value` doubles as the text cmdk's
 *  fuzzy matcher scores against, so it is the item's LABEL, not its href —
 *  scoring "/estimates" against a pilot's typed "estim" would work by
 *  accident today and stop working the day a route gets renamed. Record
 *  items instead carry a `record::` prefix, which the `filter` function
 *  below reads as "already filtered server-side, always show." */
function isRecordValue(value: string): boolean {
  return value.startsWith("record::");
}

export function CommandPalette({ sections }: { sections: readonly NavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeValue, setActiveValue] = React.useState("");
  const [records, setRecords] = React.useState<RecordsState>({ status: "idle" });
  const inputRef = React.useRef<HTMLInputElement>(null);
  const titleId = React.useId();

  // ⌘K on macOS, Ctrl+K everywhere else. Toggles rather than only opens —
  // a pilot mid-keystroke who fires the shortcut again expects it to get
  // out of their way, the same as every other command palette. Cleaned up
  // on unmount, which in practice means "when the authenticated shell
  // itself unmounts" (this component lives at that level, mounted once).
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((wasOpen) => !wasOpen);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // FOCUS THE INPUT ON EVERY OPEN, not just the first. DialogShell keeps
  // this component's children mounted for the dialog's whole lifetime and
  // only toggles native open/closed state, so React's own `autoFocus`
  // prop — which fires once, on mount — would focus the input the first
  // time and silently do nothing on every reopen after. Same reasoning
  // components/ds/dialog.tsx's ConfirmDialog already documents for its
  // own Cancel-button focus.
  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // RESET ON CLOSE, so reopening never shows the last search's query,
  // highlighted row, or stale/errored results for a beat before the
  // pilot's next keystroke replaces them.
  React.useEffect(() => {
    if (open) return;
    setQuery("");
    setActiveValue("");
    setRecords({ status: "idle" });
  }, [open]);

  // THE DEBOUNCED, STALE-RESPONSE-SAFE RECORD FETCH.
  //
  // AbortController does the actual cancellation (a superseded request's
  // response body is never even parsed); the `signal.aborted` check inside
  // the catch block is what stops that cancellation from being reported
  // to the pilot as a search FAILURE — an aborted fetch throws too, and
  // without the check every keystroke would flash "Search couldn't run"
  // for the request its own next keystroke just cancelled.
  React.useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setRecords({ status: "idle" });
      return;
    }

    setRecords({ status: "loading" });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/command-search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            setRecords({ status: "error" });
            return;
          }
          const data = (await res.json()) as CommandSearchResponse;
          if (data.error) {
            setRecords({ status: "error" });
            return;
          }
          setRecords({
            status: "ready",
            clients: data.clients,
            invoices: data.invoices,
            trips: data.trips,
          });
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setRecords({ status: "error" });
          void err;
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const navItems: NavItem[] = [...sections, NAV_SETTINGS, NAV_HELP];
  const showRecords = query.trim().length >= MIN_QUERY_LENGTH;
  const recordCount =
    records.status === "ready"
      ? records.clients.length + records.invoices.length + records.trips.length
      : 0;

  return (
    <>
      {/* THE DISCOVERABILITY AFFORDANCE. Without this, ⌘K is a feature
          only a pilot who already knew to try it would ever find — every
          other control in the product is a visible button, and a
          keyboard-only entry point to the product's one search surface
          would fail that same bar for anyone who doesn't already use
          command palettes elsewhere. The "⌘K" hint hides below `sm`: a
          touch device has no ⌘/Ctrl key for the hint to describe, so
          showing it there would document a shortcut that does not exist
          on the hardware reading it. */}
      <Button type="button" variant="soft" color="gray" size="2" onClick={() => setOpen(true)}>
        <Flex align="center" gap="2">
          <Text size="2">Search</Text>
          <Box
            display={{ initial: "none", sm: "inline-block" }}
            style={{
              border: "var(--hairline) solid var(--edge)",
              borderRadius: "var(--radius)",
              padding: "0 var(--space-1)",
            }}
          >
            <Text size="1" color="gray">
              ⌘K
            </Text>
          </Box>
        </Flex>
      </Button>

      <DialogShell open={open} onOpenChange={setOpen} labelledBy={titleId}>
        {/* Screen-reader-only accessible name for the dialog itself — a
            command palette has no visible heading (the input's own
            placeholder carries that job for sighted pilots), but the
            dialog still needs a name announced on open. */}
        <span className="i-vh" id={titleId}>
          Command palette
        </span>
        <Command
          value={activeValue}
          onValueChange={setActiveValue}
          loop
          label="Search clients, invoices, trips, or jump to a section"
          filter={(value, search, keywords) =>
            isRecordValue(value) ? 1 : defaultFilter(value, search, keywords)
          }
        >
          <Box p="3" style={{ borderBottom: "var(--hairline) solid var(--hair)" }}>
            <CommandInput
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder="Search clients, invoices, trips, or jump to a section…"
              className="i-field i-field-3"
            />
          </Box>

          <CommandList
            style={{
              maxHeight: "calc(100dvh - var(--space-8) - var(--space-8))",
              overflowY: "auto",
              padding: "var(--space-2) 0",
            }}
          >
            <CommandEmpty>
              <Box px="4" py="4">
                <Text size="2" color="gray">
                  No matches.
                </Text>
              </Box>
            </CommandEmpty>

            <CommandGroup heading={<GroupHeading>Sections</GroupHeading>}>
              {navItems.map((item) => (
                <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                  <PaletteRow label={item.label} selected={activeValue === item.label} />
                </CommandItem>
              ))}
            </CommandGroup>

            {/* Records only render once there is something to show for
                them — below MIN_QUERY_LENGTH the group is omitted outright
                rather than shown empty, so a pilot who has typed one
                character sees the sections list alone, not a "Records"
                header over nothing. */}
            {showRecords ? (
              <CommandGroup heading={<GroupHeading>Records</GroupHeading>}>
                {records.status === "loading" ? (
                  <StatusRow value="record::loading">Searching…</StatusRow>
                ) : records.status === "error" ? (
                  <StatusRow value="record::error">
                    Search couldn&rsquo;t run. Try again in a moment.
                  </StatusRow>
                ) : records.status === "ready" && recordCount === 0 ? (
                  <StatusRow value="record::empty">No matching records.</StatusRow>
                ) : records.status === "ready" ? (
                  <>
                    {records.clients.map((result) => (
                      <RecordItem
                        key={result.href}
                        result={result}
                        activeValue={activeValue}
                        onGo={go}
                      />
                    ))}
                    {records.invoices.map((result) => (
                      <RecordItem
                        key={result.href}
                        result={result}
                        activeValue={activeValue}
                        onGo={go}
                      />
                    ))}
                    {records.trips.map((result) => (
                      <RecordItem
                        key={result.href}
                        result={result}
                        activeValue={activeValue}
                        onGo={go}
                      />
                    ))}
                  </>
                ) : null}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogShell>
    </>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <Box px="3" pt="3" pb="1">
      <Text size="1" color="gray" weight="medium">
        {children}
      </Text>
    </Box>
  );
}

/** A non-interactive row inside the Records group — "Searching…", "Search
 *  couldn't run", "No matching records". Given a `record::` value so the
 *  palette's `filter` function keeps it visible (see the header comment),
 *  and `disabled` so cmdk excludes it from arrow-key navigation and click
 *  selection — it is a status line, not a choice. */
function StatusRow({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <CommandItem value={value} disabled>
      <Box px="3" py="2">
        <Text size="2" color="gray">
          {children}
        </Text>
      </Box>
    </CommandItem>
  );
}

function RecordItem({
  result,
  activeValue,
  onGo,
}: {
  result: CommandSearchResult;
  activeValue: string;
  onGo: (href: string) => void;
}) {
  const value = `record::${result.href}`;
  return (
    <CommandItem value={value} onSelect={() => onGo(result.href)}>
      <PaletteRow label={result.label} sublabel={result.sublabel} selected={activeValue === value} />
    </CommandItem>
  );
}

/** The one row shape both layers render — a label, an optional sublabel,
 *  and the keyboard/pointer "current selection" highlight cmdk tracks via
 *  the Command's controlled `value`. Background rather than a border, same
 *  reasoning as the nav rail's own current-section fill: a course-bar
 *  highlight that does not shift layout when it appears. */
function PaletteRow({
  label,
  sublabel,
  selected,
}: {
  label: string;
  sublabel?: string;
  selected: boolean;
}) {
  return (
    <Flex
      align="center"
      justify="between"
      gap="3"
      px="3"
      py="2"
      style={{
        borderRadius: "var(--radius)",
        background: selected ? "var(--selected)" : undefined,
        cursor: "pointer",
      }}
    >
      <Box minWidth="0" style={{ overflow: "hidden" }}>
        <Text size="2" truncate as="div">
          {label}
        </Text>
      </Box>
      {sublabel ? (
        <Text size="1" color="gray" truncate as="div" style={{ flexShrink: 0, maxWidth: "50%" }}>
          {sublabel}
        </Text>
      ) : null}
    </Flex>
  );
}
