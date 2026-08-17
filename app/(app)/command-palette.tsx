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
import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { LDialogShell } from "@/components/ledger/dialog";
import { LButton } from "@/components/ledger";
import { cn } from "@/lib/ledger/cn";
import { NAV_COMMANDS, NAV_HELP, NAV_SETTINGS, type NavItem } from "@/lib/nav";
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
 * HOSTED IN THE REPO'S LEDGER DIALOG SHELL, NOT cmdk's. cmdk ships a
 * `Command.Dialog` built on Radix's dialog primitive, but this product has
 * exactly one overlay mechanism per design system — `LDialogShell`
 * (components/ledger/dialog.tsx), native `<dialog>` + `showModal()`, itself
 * a direct port of components/ds/dialog.tsx's `DialogShell` (see that
 * file's own header for why native wins) — and every accessibility
 * property a second dialog implementation would have to re-earn (focus
 * trap, inert background, top layer, Escape-to-close) that one already
 * has. So this renders the PLAIN `Command` primitives inside
 * `LDialogShell` instead: cmdk supplies listbox semantics and keyboard
 * nav, `LDialogShell` supplies the modal itself. Styling throughout this
 * file is Ledger utilities against `cn()` (lib/ledger/cn) — no `i-*`
 * classes, no `var()`, no `@/components/ui` import — with the currently
 * highlighted row picked out by cmdk's own `data-selected` attribute via
 * Tailwind's `data-[selected=true]:` variant rather than a hand-computed
 * "is this the active one" comparison.
 *
 * TWO RESULT LAYERS, deliberately filtered two different ways, plus a
 * THIRD that isn't filtered by the query at all:
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
 *   RECENT      up to MAX_RECENTS records the pilot has actually opened
 *               from this palette before, read from local storage — see
 *               the recents helpers below. Useful exactly BELOW
 *               MIN_QUERY_LENGTH, where RECORDS has nothing to show yet
 *               and the nav list alone is what a pilot getting back to an
 *               invoice they had open five minutes ago has to scan
 *               instead. Rendered with the SAME RecordItem the live layer
 *               uses and the SAME `record::` value prefix: a recent is
 *               not text to fuzzy-match against a one-character query
 *               either, it is a short fixed list the pilot already chose
 *               once.
 *
 * `sections` arrives as a PROP, not an import of lib/nav's own list — see
 * nav-rail.tsx's header comment: the rail's section list is filtered by
 * the server-only currency flag before it ever reaches a client
 * component, and this palette must show the SAME filtered list the rail
 * does, not a second, unfiltered one that could offer a pilot a section
 * their tenant does not have.
 *
 * ONE DIALOG, TWO MOUNT POINTS. The desktop header used to be this
 * palette's only visible entry point, hidden below `md` (1024px) same as
 * the rail it sits beside — which left phones, the exact between-legs
 * capture moments app-shell.tsx's own comments build the rest of the
 * shell for, with no way to open search at all: no visible control below
 * `md`, and no physical ⌘/Ctrl key for the keyboard shortcut either. The
 * fix is not a second palette. This file used to be one component — a
 * fragment of [trigger, dialog] sharing one `open` state — and is now two:
 *
 *   CommandPaletteProvider   owns EVERYTHING: the open state, the ⌘K/
 *                            Ctrl-K listener, the query/records/recents
 *                            state, and the LDialogShell-hosted Command
 *                            tree itself. Mounted exactly once, wrapping
 *                            the shell's own content in app-shell.tsx.
 *   CommandPaletteTrigger    owns nothing — it reads `open` off context
 *                            and calls it. app-shell.tsx mounts this
 *                            twice now (the desktop header, unchanged in
 *                            appearance, and a new icon-only one in the
 *                            phone top bar), and both opens hit the SAME
 *                            dialog behind the SAME listener, because
 *                            neither mount point owns a dialog or a
 *                            listener of its own to duplicate.
 *
 * `open` state is still never lifted into app-shell.tsx — that was the
 * point of the original one-component shape, and splitting the trigger
 * out does not change it, it just gives app-shell.tsx a context consumer
 * to mount twice instead of one element to mount once. app-shell.tsx
 * wraps its own markup in `<CommandPaletteProvider>` rather than this
 * file wrapping app-shell.tsx's markup: a client component rendering
 * server-rendered content passed to it as `children` does not pull that
 * content across the server/client boundary — `children` arrives already
 * rendered, not as source for this file to compile — so app-shell.tsx
 * stays a server component with no "use client" of its own (its header
 * comment: "keep the shell a presentational component").
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

/** Local storage key for the palette's own most-recently-opened list.
 *  Versioned (".v1") so a future change to the stored shape ships as a
 *  new key rather than a runtime migration every past write has to keep
 *  satisfying — an empty "Recent" group the day after an upgrade costs a
 *  pilot nothing; code that has to keep reading a shape it no longer
 *  writes would. */
const RECENTS_STORAGE_KEY = "v1.palette.recents.v1";
/** A handful, not a second copy of the record list — "Recent" is useful
 *  precisely because it is short enough to scan without typing anything. */
const MAX_RECENTS = 8;

type RecordsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | ({ status: "ready" } & RecordGroups);

/** The six record arrays a ready search carries — the same shape the API
 *  returns (minus its `error` flag), so the fetch handler spreads the
 *  response straight in and the render walks this in one order. */
type RecordGroups = {
  clients: CommandSearchResult[];
  invoices: CommandSearchResult[];
  trips: CommandSearchResult[];
  estimates: CommandSearchResult[];
  expenses: CommandSearchResult[];
  documents: CommandSearchResult[];
};

/** Which record array a result came from — the live search response never
 *  needs this (the array it comes back in already says it), but a flat
 *  stored "Recent" list has no other way to carry it. */
type PaletteRecordKind =
  | "client"
  | "invoice"
  | "trip"
  | "estimate"
  | "expense"
  | "document";

/** The record groups in the order they render, each with its own heading.
 *  One source both the live "Records" layer and recordCount walk, so a new
 *  entity is added in exactly one place. */
const RECORD_GROUPS: { kind: PaletteRecordKind; heading: string; key: keyof RecordGroups }[] = [
  { kind: "client", heading: "Clients", key: "clients" },
  { kind: "invoice", heading: "Invoices", key: "invoices" },
  { kind: "trip", heading: "Trips", key: "trips" },
  { kind: "estimate", heading: "Estimates", key: "estimates" },
  { kind: "expense", heading: "Expenses", key: "expenses" },
  { kind: "document", heading: "Documents", key: "documents" },
];

/** The two feature-command groups, split once from lib/nav's flat list so
 *  the render below reads straight down. cmdk hides a group whose items all
 *  filter out, so both are rendered unconditionally once there is a query. */
const CREATE_COMMANDS = NAV_COMMANDS.filter((c) => c.group === "Create");
const GOTO_COMMANDS = NAV_COMMANDS.filter((c) => c.group === "Go to");

/** One entry in the local "Recent" list — a CommandSearchResult plus the
 *  kind it was found as. */
type PaletteRecent = {
  href: string;
  label: string;
  sublabel: string;
  kind: PaletteRecordKind;
};

/** Every navigation `CommandItem`'s `value` doubles as the text cmdk's
 *  fuzzy matcher scores against, so it is the item's LABEL, not its href —
 *  scoring "/estimates" against a pilot's typed "estim" would work by
 *  accident today and stop working the day a route gets renamed. Record
 *  items instead carry a `record::` prefix, which the `filter` function
 *  below reads as "already filtered server-side, always show." Recent
 *  items carry the same prefix for the same reason — see the header
 *  comment's RECENT paragraph. */
function isRecordValue(value: string): boolean {
  return value.startsWith("record::");
}

function isPaletteRecordKind(value: unknown): value is PaletteRecordKind {
  return RECORD_GROUPS.some((g) => g.kind === value);
}

/** Defensive parse of ONE stored entry. Every field is checked, not cast
 *  — the value on the other side of JSON.parse is untrusted: an older
 *  version of this feature, a browser extension, or a pilot's own manual
 *  edit could all have left something else at this key. An entry that
 *  fails any check here is dropped outright rather than rendered
 *  half-blank with an empty label or a href that goes nowhere. */
function isPaletteRecent(value: unknown): value is PaletteRecent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.href === "string" &&
    v.href.length > 0 &&
    typeof v.label === "string" &&
    v.label.length > 0 &&
    typeof v.sublabel === "string" &&
    isPaletteRecordKind(v.kind)
  );
}

/** Reads the stored list, or an empty one for anything short of a clean
 *  read — there is no state below "no recents" for this feature to fall
 *  back to, so every failure mode collapses to the same harmless result:
 *  no `window` (defensive; every real call site is already inside an
 *  effect or an event handler), private-mode Safari throwing on the read
 *  itself, a value that is not JSON, JSON that is not an array, or an
 *  array whose entries don't pass isPaletteRecent. Never thrown past this
 *  function. */
function readRecents(): PaletteRecent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPaletteRecent).slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/** Writes the list, or silently does not — private-mode Safari throws on
 *  every localStorage WRITE too (not only reads), and there is no error
 *  state in this UI a failed MRU write belongs in. A pilot in that mode
 *  loses nothing they had; "Recent" just never populates for them, the
 *  same as before this feature existed. */
function writeRecents(recents: PaletteRecent[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      RECENTS_STORAGE_KEY,
      JSON.stringify(recents.slice(0, MAX_RECENTS))
    );
  } catch {
    // Swallowed deliberately — see the function comment above.
  }
}

/** Moves `entry` to the front of the stored list, deduped by href and
 *  capped at MAX_RECENTS. Reads the CURRENT stored list rather than
 *  trusting whatever the caller's own React state last held, so a second
 *  tab is never silently clobbered by a stale copy — the cost is one
 *  extra localStorage read on a user-initiated selection, not a hot path.
 *  Called on every record selection, including re-selecting an existing
 *  Recent row, which is what bumps it back to the top instead of leaving
 *  the list stuck in first-visit order. */
function pushRecent(entry: PaletteRecent): PaletteRecent[] {
  const next = [entry, ...readRecents().filter((r) => r.href !== entry.href)].slice(
    0,
    MAX_RECENTS
  );
  writeRecents(next);
  return next;
}

type CommandPaletteContextValue = { open: () => void };

const CommandPaletteContext = React.createContext<CommandPaletteContextValue | null>(null);

/** Shared row styling for every selectable item in the list — nav
 *  sections, live records and recents alike — so the three render call
 *  sites below cannot drift into three slightly different hover/selected
 *  treatments. The selected look (`bg-accent-soft`, with the label text
 *  inheriting `text-accent`) is driven entirely by cmdk's own
 *  `data-selected="true"` attribute on this element, not by comparing the
 *  Command's controlled `value` against this row's own value in JS — cmdk
 *  already tracks which row is current; restating that comparison here
 *  would be a second, potentially-stale source of truth for the same
 *  fact. */
const ITEM_CLASS = cn(
  "mx-1 flex cursor-pointer items-center justify-between gap-3 rounded-control px-3 py-2 text-ink",
  "data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent"
);

export function CommandPaletteProvider({
  sections,
  children,
}: {
  sections: readonly NavItem[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeValue, setActiveValue] = React.useState("");
  const [records, setRecords] = React.useState<RecordsState>({ status: "idle" });
  const [recents, setRecents] = React.useState<PaletteRecent[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const titleId = React.useId();

  // HYDRATE RECENTS AFTER MOUNT, not from useState's own initializer.
  // This file is "use client", but Next still renders a client component
  // to HTML on the server for the first response, and to matching markup
  // on the browser's own first paint before hydration takes over — an
  // initializer reading localStorage would run in both places, and the
  // server has no localStorage at all. An effect runs only after that
  // first paint, on the client alone, so "Recent" always starts empty
  // (server markup and pre-hydration client markup match exactly) and is
  // seeded in a silent second pass — one no pilot can catch, since
  // nothing can open this dialog before this component has mounted.
  React.useEffect(() => {
    setRecents(readRecents());
  }, []);

  // ⌘K on macOS, Ctrl+K everywhere else. Toggles rather than only opens —
  // a pilot mid-keystroke who fires the shortcut again expects it to get
  // out of their way, the same as every other command palette. Cleaned up
  // on unmount, which in practice means "when the authenticated shell
  // itself unmounts" — CommandPaletteProvider is mounted directly around
  // the shell's own content in app-shell.tsx, at that level, exactly
  // once.
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

  // FOCUS THE INPUT ON EVERY OPEN, not just the first. LDialogShell keeps
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
  // pilot's next keystroke replaces them. `recents` deliberately does NOT
  // reset here — it is a standing MRU list, not search state, and must
  // survive the dialog closing (and the page reloading) exactly as
  // written.
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
            estimates: data.estimates,
            expenses: data.expenses,
            documents: data.documents,
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

  // Memoized so the context value's identity survives every keystroke in
  // `query` — without this, every render of this component (which is
  // every keystroke, since query lives here) would hand both trigger
  // mount points a new object and re-render them for no reason.
  const openPalette = React.useCallback(() => setOpen(true), []);
  const contextValue = React.useMemo<CommandPaletteContextValue>(
    () => ({ open: openPalette }),
    [openPalette]
  );

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  // THE ONE PATH EVERY RECORD SELECTION GOES THROUGH, live result or
  // Recent row alike — which is what makes "selectable exactly like live
  // results" literally true rather than a claim about two similar-looking
  // code paths. Persisting here, not at each call site, is also what
  // makes re-selecting a Recent row bump its recency: pushRecent re-adds
  // it at the front of the stored list instead of leaving it inert.
  function selectRecord(result: CommandSearchResult, kind: PaletteRecordKind) {
    setRecents(
      pushRecent({ href: result.href, label: result.label, sublabel: result.sublabel, kind })
    );
    go(result.href);
  }

  const navItems: NavItem[] = [...sections, NAV_SETTINGS, NAV_HELP];
  const showRecords = query.trim().length >= MIN_QUERY_LENGTH;
  const showRecent = !showRecords && recents.length > 0;
  // Feature commands (Create / Go to) surface as soon as the pilot types —
  // one character, not MIN_QUERY_LENGTH, since they are filtered client-side
  // with nothing to fetch. Below that the palette stays the quiet Recent +
  // Sections list it has always been, rather than unrolling two dozen deep
  // links the moment it opens.
  const showCommands = query.trim().length >= 1;
  const recordCount =
    records.status === "ready"
      ? RECORD_GROUPS.reduce((sum, g) => sum + records[g.key].length, 0)
      : 0;

  return (
    <CommandPaletteContext.Provider value={contextValue}>
      {children}

      <LDialogShell open={open} onOpenChange={setOpen} labelledBy={titleId}>
        {/* Screen-reader-only accessible name for the dialog itself — a
            command palette has no visible heading (the input's own
            placeholder carries that job for sighted pilots), but the
            dialog still needs a name announced on open. `sr-only` is
            Tailwind's own visually-hidden utility (part of the
            `utilities` layer ledger.css imports), not INSTRUMENT's
            `i-vh` — the two systems' stylesheets never share a class. */}
        <span className="sr-only" id={titleId}>
          Command palette
        </span>
        <Command
          value={activeValue}
          onValueChange={setActiveValue}
          loop
          label="Search your records, run an action, or jump to any screen"
          filter={(value, search, keywords) =>
            isRecordValue(value) ? 1 : defaultFilter(value, search, keywords)
          }
        >
          <div className="border-b border-hair p-3">
            <CommandInput
              ref={inputRef}
              value={query}
              onValueChange={setQuery}
              placeholder="Search records, actions, or a screen…"
              className="w-full bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
            />
          </div>

          <CommandList className="max-h-[calc(100dvh_-_8rem)] overflow-y-auto py-2">
            <CommandEmpty>
              <div className="px-4 py-4 text-caption text-ink-3">No matches.</div>
            </CommandEmpty>

            {/* RECENT sits ABOVE Sections — see the header comment's
                RECENT paragraph. Shown only below MIN_QUERY_LENGTH
                (mutually exclusive with Records, same threshold) and only
                when there is at least one entry, for the same reason
                Records is omitted outright rather than shown empty. */}
            {showRecent ? (
              <CommandGroup heading={<GroupHeading>Recent</GroupHeading>}>
                {recents.map((recent) => (
                  <RecordItem
                    key={recent.href}
                    result={recent}
                    kind={recent.kind}
                    onSelectRecord={selectRecord}
                  />
                ))}
              </CommandGroup>
            ) : null}

            <CommandGroup heading={<GroupHeading>Sections</GroupHeading>}>
              {navItems.map((item) => (
                <CommandItem
                  key={item.href}
                  value={item.label}
                  onSelect={() => go(item.href)}
                  className={ITEM_CLASS}
                >
                  <PaletteRow label={item.label} />
                </CommandItem>
              ))}
            </CommandGroup>

            {/* FEATURE COMMANDS — actions and sub-pages, the half of "search
                any feature" the rail never shows. Rendered only once the
                pilot types (see showCommands): cmdk fuzzy-matches each on its
                label AND its keywords, and hides a group whose every item
                filtered out, so an unmatched "Create" group simply doesn't
                appear. `go()` navigates without touching Recent — a command
                is a route, not a record. */}
            {showCommands ? (
              <>
                <CommandGroup heading={<GroupHeading>Create</GroupHeading>}>
                  {CREATE_COMMANDS.map((cmd) => (
                    <CommandItem
                      key={cmd.href}
                      value={cmd.label}
                      keywords={cmd.keywords ? [...cmd.keywords] : undefined}
                      onSelect={() => go(cmd.href)}
                      className={ITEM_CLASS}
                    >
                      <PaletteRow label={cmd.label} />
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandGroup heading={<GroupHeading>Go to</GroupHeading>}>
                  {GOTO_COMMANDS.map((cmd) => (
                    <CommandItem
                      key={cmd.href}
                      value={cmd.label}
                      keywords={cmd.keywords ? [...cmd.keywords] : undefined}
                      onSelect={() => go(cmd.href)}
                      className={ITEM_CLASS}
                    >
                      <PaletteRow label={cmd.label} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}

            {/* Records only render once there is something to show for
                them — below MIN_QUERY_LENGTH the group is omitted outright
                rather than shown empty, so a pilot who has typed one
                character sees the sections list alone, not a "Records"
                header over nothing. Each record TYPE that has results is its
                own titled group (Clients / Invoices / Trips / Estimates /
                Expenses / Documents), so a match reads as what it is at a
                glance rather than as an untyped row in one long list. The
                loading / error / empty states share a single "Records"
                header, since none of them belongs to a type. */}
            {showRecords ? (
              records.status === "loading" ? (
                <CommandGroup heading={<GroupHeading>Records</GroupHeading>}>
                  <StatusRow value="record::loading">Searching…</StatusRow>
                </CommandGroup>
              ) : records.status === "error" ? (
                <CommandGroup heading={<GroupHeading>Records</GroupHeading>}>
                  <StatusRow value="record::error">
                    Search couldn&rsquo;t run. Try again in a moment.
                  </StatusRow>
                </CommandGroup>
              ) : records.status === "ready" && recordCount === 0 ? (
                <CommandGroup heading={<GroupHeading>Records</GroupHeading>}>
                  <StatusRow value="record::empty">No matching records.</StatusRow>
                </CommandGroup>
              ) : records.status === "ready" ? (
                RECORD_GROUPS.map((groupDef) => {
                  const items = records[groupDef.key];
                  if (items.length === 0) return null;
                  return (
                    <CommandGroup
                      key={groupDef.kind}
                      heading={<GroupHeading>{groupDef.heading}</GroupHeading>}
                    >
                      {items.map((result) => (
                        <RecordItem
                          key={result.href}
                          result={result}
                          kind={groupDef.kind}
                          onSelectRecord={selectRecord}
                        />
                      ))}
                    </CommandGroup>
                  );
                })
              ) : null
            ) : null}
          </CommandList>
        </Command>
      </LDialogShell>
    </CommandPaletteContext.Provider>
  );
}

/**
 * The button either mount point renders. Reads `open` off context rather
 * than owning any state itself, so mounting this twice (app-shell.tsx's
 * desktop header and its phone top bar) never risks a second dialog or a
 * second ⌘K listener — there is exactly one of each, up in
 * CommandPaletteProvider, above wherever this is mounted.
 *
 * `variant="full"` (the default) is THE DISCOVERABILITY AFFORDANCE this
 * palette has always had: without a visible button, ⌘K is a feature only
 * a pilot who already knew to try it would ever find. The "⌘K" hint hides
 * below `sm`: a touch device has no ⌘/Ctrl key for the hint to describe,
 * so showing it there would document a shortcut that does not exist on
 * the hardware reading it. Styled `outline` (LButton) — a bordered,
 * card-background button, not the one filled-accent action LEDGER.md
 * reserves per view (see components/ledger/index.tsx's button variants).
 *
 * `variant="icon"` is the phone top bar's entry point, where there is no
 * room for a labelled button — icon-only with `aria-label="Search"`, the
 * same tradeoff every other icon-only control in the product makes (e.g.
 * logbook/saved-views.tsx's delete button): silent to a sighted pilot who
 * already recognizes the glyph, legible to a screen reader that cannot
 * see it. Styled `quiet` (text-only until hovered) since it sits in a
 * tighter top-bar strip than the desktop trigger; LButton's `sm` size is
 * 32px tall, clearing the ≥24px touch-target floor on its own.
 */
export function CommandPaletteTrigger({
  variant = "full",
}: {
  variant?: "full" | "icon";
}) {
  const ctx = React.useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error("CommandPaletteTrigger must be rendered inside a CommandPaletteProvider.");
  }
  const { open } = ctx;

  if (variant === "icon") {
    return (
      <LButton
        type="button"
        variant="quiet"
        size="sm"
        className="px-2"
        onClick={open}
        aria-label="Search"
      >
        <MagnifyingGlassIcon aria-hidden focusable={false} />
      </LButton>
    );
  }

  return (
    <LButton type="button" variant="outline" size="sm" onClick={open}>
      <span>Search</span>
      <span className="hidden rounded-control border border-hair-strong px-1 text-caption text-ink-3 sm:inline-block">
        ⌘K
      </span>
    </LButton>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-3 text-caption font-semibold text-ink-3">{children}</div>
  );
}

/** A non-interactive row inside the Records group — "Searching…", "Search
 *  couldn't run", "No matching records". Given a `record::` value so the
 *  palette's `filter` function keeps it visible (see the header comment),
 *  and `disabled` so cmdk excludes it from arrow-key navigation and click
 *  selection — it is a status line, not a choice. Caption-sized, ink-3 —
 *  a status line is the quietest text on the row, never competing with an
 *  actual match. */
function StatusRow({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <CommandItem value={value} disabled>
      <div className="px-3 py-2 text-caption text-ink-3">{children}</div>
    </CommandItem>
  );
}

/** One row in either the Records layer or the Recent layer — both are
 *  CommandSearchResult-shaped, and both go through the same `onSelectRecord`
 *  so a Recent row is genuinely selectable "exactly like" a live result
 *  rather than a lookalike with its own separate handler. */
function RecordItem({
  result,
  kind,
  onSelectRecord,
}: {
  result: CommandSearchResult;
  kind: PaletteRecordKind;
  onSelectRecord: (result: CommandSearchResult, kind: PaletteRecordKind) => void;
}) {
  const value = `record::${result.href}`;
  return (
    <CommandItem value={value} onSelect={() => onSelectRecord(result, kind)} className={ITEM_CLASS}>
      <PaletteRow label={result.label} sublabel={result.sublabel} />
    </CommandItem>
  );
}

/** The one row shape both layers render — a label and an optional
 *  sublabel. Neither sets its own selected-state styling: the parent
 *  `CommandItem` (see ITEM_CLASS above) carries `data-[selected=true]:`,
 *  and this label inherits that color rather than recomputing it, so
 *  there is exactly one place selection is decided rather than two that
 *  could disagree. */
function PaletteRow({ label, sublabel }: { label: string; sublabel?: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <div className="min-w-0 flex-1 truncate text-body-s">{label}</div>
      {sublabel ? (
        <div className="max-w-[50%] shrink-0 truncate text-caption text-ink-3">{sublabel}</div>
      ) : null}
    </div>
  );
}
