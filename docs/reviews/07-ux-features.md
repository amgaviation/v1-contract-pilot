# 07 — UX & Features Review

Scope: `app/(app)` + shared components (`components/`, `app-shell.tsx`, `nav-rail.tsx`,
`command-palette.tsx`). Methodology: `ux-expert` skill's 8-dimension audit framework
(Information Architecture, Visual Hierarchy, Screen Real Estate, Interaction Cost,
Cognitive Load, Context & Orientation, Data Presentation, Responsiveness & Edge Cases).

---

### [HIGH] Destructive-action confirm dialogs split into two incompatible focus/error-recovery patterns

- Where:
  - Pattern A (dialog stays open on failure, focus retained on the still-enabled confirm
    button): `app/(app)/trips/[id]/delete-trip-button.tsx:26-38`,
    `app/(app)/expenses/[id]/delete-expense-button.tsx:15-29`,
    `app/(app)/logbook/[id]/delete-logbook-entry-button.tsx:13-24`
  - Pattern B (dialog closes the instant the confirm button is clicked, regardless of
    outcome; error renders elsewhere on the page after the dialog is already gone; focus
    falls wherever the browser sends it, not to the error): `app/(app)/documents/[id]/delete-document-button.tsx:15-26`,
    `app/(app)/invoices/[id]/status-actions.tsx:300-328` (send), `:425-439` (reminder),
    `:502-512` (void), `app/(app)/invoices/[id]/lines-editor.tsx:174-183` (remove line),
    `app/(app)/estimates/[id]/status-actions.tsx:142-145` (mark sent), `:232-235` (convert
    to invoice), `:257-260` (delete draft)
  - URL routes: `/trips/[id]`, `/expenses/[id]`, `/logbook/[id]`, `/documents/[id]`,
    `/invoices/[id]`, `/estimates/[id]`
- Issue: Two near-identical "Delete this X?" / "Void this invoice?" confirmation flows
  exist side by side with opposite behavior on failure. `delete-expense-button.tsx`'s own
  comment: "Keep the dialog open on failure so focus stays on the still-enabled confirm
  button instead of falling back to `<body>`." But `delete-document-button.tsx`'s comment
  says the opposite of its own sibling: "Closes the instant it's pressed — the same
  always-closes-on-click shape invoices/[id]/status-actions.tsx's void-invoice dialog
  keeps." Both comments show the authors were aware of the other pattern and chose
  differently per file. For a keyboard or screen-reader user, voiding a sent invoice or
  deleting a document that fails silently drops focus to `<body>` — the error text (`role="alert"`,
  rendered below the button) is never announced as connected to the action just taken, and
  has to be found by re-reading the page. The delete-trip/expense/logbook flows get this
  right; six or more sibling flows for equally destructive or irreversible actions
  (void an invoice, delete an invoice line, delete an estimate draft) do not.
- Fix: Standardize on Pattern A (trips/expenses/logbook's shape) for every
  `LConfirmDialog` whose action can fail: keep the dialog open and show the error inside
  it on failure, closing only on success. Update `documents/[id]/delete-document-button.tsx`,
  `invoices/[id]/status-actions.tsx` (all three dialogs), `invoices/[id]/lines-editor.tsx`,
  and `estimates/[id]/status-actions.tsx` (all three dialogs) to match.

---

### [HIGH] Core money-loop list screens don't get the mobile table treatment Overview and the day grid get

- Where: the responsive "table at `md`+, stacked cards below it" pattern exists in exactly
  two files in the whole `app/(app)` tree — `app/(app)/overview/page.tsx:1490-1503` (comment)
  / `:1504` (`<div className="md:hidden">`) / `:1561` (`<div className="hidden md:block">`),
  and `app/(app)/trips/day-grid.tsx:810-812,832`. Every other list table — `app/(app)/trips/page.tsx:376`
  (7 columns: Dates/Client/Aircraft/Days/Value/Status/Billing), `app/(app)/invoices/page.tsx:435`
  (8 columns), `app/(app)/expenses/page.tsx:596` (8 columns), `app/(app)/clients/page.tsx:99`,
  plus Documents, Estimates, Crew, Aircraft, Accounting Journal and every report — renders a
  single `<LTable>` that relies on `LTable`'s own `overflow-x-auto` wrapper
  (`components/ledger/index.tsx:318-337`) for narrow viewports.
  URL routes: `/trips`, `/invoices`, `/expenses`, `/clients`, and effectively every other
  list route in the product.
- Issue: Overview's own comment explaining why it special-cased its unbilled-by-client
  table states the exact failure mode left everywhere else: "a contract pilot reads this
  between legs, standing in an FBO, and a seven-column table on a ~375px screen shows the
  Client column and hides the two cells the module exists for — the unbilled amount and the
  Draft invoice button — behind a horizontal scroll." Trips (7 columns), Invoices (8
  columns) and Expenses (8 columns) are at least as wide, are opened at least as often on a
  phone (they are the core daily-use screens, not a dashboard summary), and get none of
  that treatment — a pilot on a phone scrolls a cramped table sideways to find the invoice
  balance or the trip value instead of reading a stacked card.
- Fix: Extend the `hidden md:block` / `block md:hidden` split already proven on Overview
  and the day grid to Trips, Invoices, and Expenses first (the three explicitly named as
  the core money loop), then the remaining list screens. The card content for each is
  already implied by what Overview's own stacked-card version prioritizes: primary link +
  amount first, secondary facts on one caption line beneath.

---

### [MEDIUM] Trips, Invoices, Expenses, and Clients lists have no way to reach rows past their ~1000-row cap

- Where: `app/(app)/trips/page.tsx:87` (`TRIP_LIMIT = 1000`), `:252-258` (truncation
  `LAlert`, no pagination control); `app/(app)/invoices/page.tsx:79` (`LIST_LIMIT = 1000`),
  `:322-329`; `app/(app)/expenses/page.tsx:66` (`EXPENSES_LIMIT = 1000`);
  `app/(app)/clients/page.tsx:21` (`CLIENTS_LIMIT = 1000`); `app/(app)/receipts/page.tsx:73`
  (`EXPENSES_LIMIT = 500`). Contrast `app/(app)/logbook/page.tsx:45` (`PAGE_SIZE = 200`)
  with real Newer/Older pagination at `:477-499`.
  URL routes: `/trips`, `/invoices`, `/expenses`, `/clients`, `/receipts` vs. `/logbook`.
- Issue: Logbook (and, per the site map, the accounting journal) paginate for real — a
  pilot can page back through their whole history. Trips, Invoices, Expenses, Clients and
  Receipts instead load up to the cap in one shot and, once hit, show only a warning
  banner ("Showing your 1000 most recent trips. Older ones aren't on this screen…") with no
  link, page control, or date-range narrower to reach anything past it from that screen.
  Command palette search is the only way back to an older record once a list has grown
  past the cap.
- Fix: Give Trips, Invoices, Expenses, and Clients the same page-size + Newer/Older
  pagination Logbook already implements, instead of a single capped read plus a warning.

---

### [MEDIUM] Clients list has no filter or search of any kind

- Where: `app/(app)/clients/page.tsx` (full file) — the only affordance is column sort
  (archived-last, then alphabetical, `:48-49`); no search input, no active/archived
  toggle, no filter chips. Contrast `app/(app)/trips/page.tsx:268-323` (client/status/billing
  filter chips) and `app/(app)/expenses/page.tsx:399-434` (client filter chips, "No
  client" bucket).
  URL route: `/clients`.
- Issue: Trips, Invoices, and Expenses all give the pilot a way to narrow a long list;
  Clients — the record every other screen links back to — gives none. On an account with
  many clients (the Business tier explicitly supports a second pilot/bookkeeper and a
  larger roster, per `lib/entitlements.ts`), finding one client means scanning the full
  table or already knowing to reach for ⌘K.
- Fix: Add at minimum an active/archived toggle (the same "Any client"-style link chips
  used on Trips/Expenses) and a name search box to `/clients`.

---

### [MEDIUM] Settings' 12-tab grouping — built specifically to fix a Miller's-Law overload — doesn't render below 1024px

- Where: `app/(app)/settings/settings-tabs.tsx:20-29` (comment reasoning),
  `:202-226` (render: `LTabsList` wraps as a flat row below `lg`, group `<span>` captions
  are `hidden lg:block` at the class list on `:215`). Cross-reference
  `app/(app)/app-shell.tsx:58-80` for why this codebase treats 1024px/`lg` as the
  boundary that specifically includes iPad portrait ("it is iPad portrait (768 and 834)…
  and — the case that actually gets hit daily — it is an ordinary 1280px or 1440px desktop
  at 150–175% browser zoom").
  URL route: `/settings`.
- Issue: The file's own header comment states the grouping exists because "ELEVEN [now
  twelve] SECTIONS IS A SIDEBAR, NOT A ROW. At this count a single horizontal strip is
  past Miller's 7±2 whichever way it wraps." That diagnosis is correct — and the fix
  (grouped sidebar with cluster headers: Business / Rates & categories / Communication /
  Workspace) only applies at `lg` and up. Below 1024px, which by this same codebase's own
  documented rationale includes iPad portrait — called out elsewhere as this product's
  literal target device ("an iPad in the FBO") — every pilot sees the ungrouped, 12-pill
  wrapped row the comment identifies as the problem.
- Fix: Either lower the grouped-sidebar breakpoint for this specific component (it doesn't
  need the full-width canvas the `lg` rail switch protects), or render the group captions
  inline within the wrapped row below `lg` instead of hiding them outright.

---

### [MEDIUM] Aircraft — a top-level nav destination as of today's build — has no loading.tsx

- Where: no `app/(app)/aircraft/loading.tsx` exists (confirmed by directory listing).
  `app/(app)/aircraft/page.tsx:74-80` runs five parallel Supabase reads (fleet, time-by-tail,
  suggestions, time-by-type, clients) across 375 lines — comparable in shape to
  `app/(app)/logbook/page.tsx`, which does have `app/(app)/logbook/loading.tsx`.
  URL route: `/aircraft`.
- Issue: `aircraft/page.tsx:20-28`'s own header comment states the screen was "promoted
  from its original home at /logbook/aircraft (2026-08-18)" — today's date — to a
  top-level RECORDS nav entry. The promotion did not bring a loading skeleton with it, so
  navigating to a now-primary nav destination gives a blank screen until all five reads
  resolve, unlike every sibling section in its own nav group (Documents, Receipts, Crew,
  Reports all have one).
- Fix: Add `app/(app)/aircraft/loading.tsx`, mirroring the fleet table + time-by-type
  table shape the way `overview/loading.tsx` mirrors its own page's sections.

---

### [MEDIUM] Aircraft retire/restore has no confirmation, unlike the equivalent Clients and Crew archive actions

- Where: `app/(app)/aircraft/fleet-panel.tsx:291-301` — a plain
  `<form action={setAircraftArchived}>` with a `type="submit"` button, no dialog. Contrast
  `app/(app)/clients/[id]/archive-button.tsx:9-16,66-90`, which reasons explicitly about
  this exact tradeoff ("Only archiving is destructive enough to confirm — restoring a
  client has no consequence worth interrupting for") and implements an `LConfirmDialog`
  for the archive half.
  URL route: `/aircraft`.
- Issue: Clients and Crew (`app/(app)/crew/[id]/archive-button.tsx`, confirmed via the
  same `LConfirmDialog` import) both gate archiving behind a confirm dialog while leaving
  restore un-gated — a considered, stated asymmetric design. Aircraft applies neither: one
  click on "Retire" (or "Bring back") submits immediately with no interstitial, for the
  one entity type in this trio where the action is a plain form post rather than a
  client-side handler at all.
- Fix: Apply the same archive-confirms/restore-doesn't pattern to aircraft retirement that
  Clients and Crew already use.

---

### [MEDIUM] Site-map's "bulk actions" claim for /invoices has no shipped equivalent anywhere in the product

- Where: `docs/reviews/00-site-map.md:56` describes `/invoices` as having "bulk actions."
  A full read of `app/(app)/invoices/page.tsx` shows no multi-select UI (no row
  checkboxes, no "select all," no batch toolbar). A repo-wide search for
  `LCheckbox`/`checked=`/`selectAll` inside `app/(app)` turns up only per-row form flags,
  the reconcile board's one-at-a-time `selectedTxn`/`selectedLine` matcher
  (`app/(app)/accounting/reconcile/reconcile-board.tsx:69-70,116`), and the bank-import
  workspace's per-row include/exclude toggle — none of them a "select several existing
  records, act on all of them" pattern.
  URL route: `/invoices`.
- Issue: Either this is a real, documented-but-unshipped feature gap (a pilot chasing a
  dozen overdue invoices sends reminders one at a time, `/invoices/[id]` at a time — no
  way to select several past-due invoices from the list and act on them together), or the
  site-map line is simply inaccurate. Either way this review's scope depends on the
  site-map being ground truth for coverage planning, and on this one point it is not.
- Fix: If bulk actions are intended, the most valuable candidate is bulk reminder-send
  across selected overdue invoices from `/invoices?show=overdue`. If not intended, correct
  `docs/reviews/00-site-map.md`'s description (outside this review's writable scope, so
  flagged here for whoever owns that file).

---

### [LOW] Command palette's "Create" list has "Import expenses" but no "Import logbook"

- Where: `lib/nav.ts:144-174` (`NAV_COMMANDS`). `/expenses/import` has a "Create" entry
  at `:154` ("Import expenses"); `/logbook/import` has no command anywhere in the list
  despite being a comparably prominent feature (the landing page FAQ leads with logbook
  import: "Import a ForeFlight or LogTen Pro export, or any CSV… and carry on from
  there"). `/accounting/journal`, `/accounting/reconcile`, and `/invoices/recurring` are
  likewise absent from the "Go to" group (`:156-173`), though each is one click from its
  own parent section so the gap is smaller there.
  URL route: reachable only via `/logbook` → "Import CSV" button, never via ⌘K.
- Issue: A pilot who has learned to reach for ⌘K for "New trip," "New invoice," and
  "Import expenses" has no reason to expect "Import logbook" behaves differently, and
  typing "import" or "logbook" into the palette will not surface it.
- Fix: Add `{ href: "/logbook/import", label: "Import logbook", group: "Create", keywords: ["foreflight", "logten", "csv"] }`
  to `NAV_COMMANDS`.

---

### [LOW] Overview's "+N more" indicators are inert text, not links

- Where: `app/(app)/overview/page.tsx:1303-1305` (Needs attention: `{attentionMoreCount > 0 ? <p ...>+{attentionMoreCount} more</p> : null}`)
  and `:1774-1776` (Ready to invoice: `+{readyCount - readyTrips.length} more`).
  URL route: `/overview`.
- Issue: Both overflow counts render as a plain `<p>`, not a link. A pilot with more than
  8 needs-attention items or more than 6 ready-to-invoice trips sees the count but has no
  single click to see the rest — they have to already know which underlying screen
  (`/invoices?show=outstanding`, `/clients/[id]`, `/expenses`, `/trips`) covers the
  overflowed item type.
- Fix: At minimum, link "Ready to invoice"'s `+N more` to `/trips?billing_state=unbilled`.
  "Needs attention" mixes item types with no single destination — either link it to the
  most common source (overdue invoices, `/invoices?show=overdue`) or leave a short "see
  Invoices / Clients / Expenses" hint in place of a bare count.

---

### [LOW] No cross-link between /expenses and /receipts despite overlapping purpose

- Where: `app/(app)/expenses/page.tsx:334-347` (action buttons: Import statement, Mileage
  log, Add expense — no link to `/receipts`); `app/(app)/receipts/page.tsx:168-172` (action
  button: Add expense only, no link back to the main expense ledger at `/expenses`).
  URL routes: `/expenses`, `/receipts`.
- Issue: `/receipts` is a second, deliberate read of the same `expenses` table split into
  "on file" / "missing" queues (its own header comment says so explicitly), sitting in a
  different nav group (RECORDS) from `/expenses` (BUSINESS). A pilot working the "Needs
  filing" queue on `/expenses` who wants to systematically clear missing receipts has to
  already know `/receipts` exists in a different part of the rail; neither screen points
  at the other.
- Fix: Add a link from `/expenses`'s existing "Needs filing" card (or its action row) to
  `/receipts?view=missing`, and a link back to `/expenses` from `/receipts`.

---

Coverage note: deep-read — `app-shell.tsx`, `nav-rail.tsx`, `command-palette.tsx`,
`components/ledger/*` (index, forms, dialog, page-shell, segmented, tabs), `lib/nav.ts`,
`docs/design/LEDGER.md`; `/overview` (full 1961-line file + loading.tsx); `/trips` list +
`/trips/[id]` + delete/mark-flown actions; `/invoices` list + `/invoices/[id]` +
status-actions + lines-editor; `/expenses` list + `/expenses/[id]` + delete action;
`/logbook` list + delete action; `/clients` list + `/clients/[id]` + archive action;
`/settings` + settings-tabs; `/accounting` (COA); `/receipts`; one import flow
(`expenses/import/import-workspace.tsx`, full); one estimate detail (`status-actions.tsx`).
Skimmed (structural grep + partial reads + directory/line-count checks) — `/aircraft`,
`/crew`, `/currency`, `/documents`, `/estimates` list, `/expenses/mileage`,
`/expenses/transactions`, `/help`, `/logbook/drafts`, `/logbook/new`,
`/accounting/journal`, `/accounting/reconcile`, all `/reports/*` sub-pages, `/settings/billing*`,
`/settings/export`, `day-grid.tsx`, `leg-editor.tsx`, and every `loading.tsx` (via
directory diff against every `page.tsx`).
