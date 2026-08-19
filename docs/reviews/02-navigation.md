# Navigation & information architecture review

Scope: `app/(marketing)`, `app/(auth)`, `app/(onboarding)`, `app/(app)` (54 routes), and
the four tokenized public surfaces. ICP framing per `.agents/product-marketing.md`
Discrepancy 1: contract pilots are the only paying/signup audience; aircraft operators are
the pilot's clients, reached only via `/invoice/[token]`, `/estimate/[token]`,
`/packet/[token]`, `/vendor/[token]`.

## Persona pathways (explicit answers)

**(a) Prospective contract pilot landing on `/`:** Yes, one click to each. Header
(`app/(marketing)/site-header.tsx:57-74`) and hero (`app/(marketing)/page.tsx:358-372`)
both link directly to `/pricing` and `/signup` from every marketing page.

**(b) Aircraft operator AP desk:** Depends entirely on arrival path, and the two paths
have opposite outcomes.
- Via a tokenized share link (the documented, expected arrival path): **stranded**. See
  the Critical finding below — none of the four token surfaces, or their `not-found`
  pages, contain a single link to anywhere else in the product.
- Via curiosity on `/` (typing the product name after seeing it on an invoice): **oriented
  without needing a click.** The eyebrow "For independent contract pilots"
  (`app/(marketing)/page.tsx:342`) and the hero body state plainly this is the pilot's own
  books software, and `/pricing` confirms no operator tier exists. An AP desk reading this
  page correctly self-selects out with nothing further to do — that half of persona (b)
  is not a finding.

---

### [CRITICAL] The four client-facing token surfaces have zero links to anywhere else in the product
- Where:
  - `components/logo.tsx:26-49` — `Logo` renders `<span><svg>…</svg></span>`, not an anchor
  - `app/invoice/[token]/page.tsx:358` — `<Logo />` (no `href`)
  - `app/estimate/[token]/page.tsx:156` — `<Logo />`
  - `app/packet/[token]/page.tsx:87` — `<Logo />`
  - `app/vendor/[token]/page.tsx:175` — `<Logo />`
  - `app/invoice/[token]/not-found.tsx:32`, `app/estimate/[token]/not-found.tsx:18`,
    `app/packet/[token]/not-found.tsx:31`, `app/vendor/[token]/not-found.tsx:22` — same
    unlinked `<Logo />`
  - URLs: `/invoice/[token]`, `/estimate/[token]`, `/packet/[token]`, `/vendor/[token]`
    and their 404 states (8 pages total)
- Issue: On every one of these 8 pages the only brand mark on screen is `Logo`, and
  `components/logo.tsx` defines it as a plain `<span>` wrapping an `<svg>` with no
  `NextLink`, no `<a>`, no `onClick` — confirmed by reading the component. None of the 8
  pages imports `NextLink` pointed at `/`, `/pricing`, or any other product page (the
  vendor page's only outbound link, `app/vendor/[token]/page.tsx:372-377`, goes to
  `/packet/[token]`, another token surface). An AP clerk who opens an invoice link, an
  estimate link, a credential packet, or a vendor rollup — the exact audience the task
  frames as "reached by no-login tokenized links" — has no way, in any number of clicks,
  to find out what "V1" is, that it's a product at all, or where a curious click would
  even go. This is not the "no operator signup" decision working as intended (that
  decision is deliberate and documented); it is the absence of any orientation path at
  all, on pages whose own primary actions are real money events: the "Pay $X online"
  button (`app/invoice/[token]/page.tsx:456-474`) and the "Set up autopay" /
  "Turn autopay off" forms (`app/vendor/[token]/page.tsx:298-363`). A skeptical AP desk
  that cannot verify what it's clicking through to is a desk more likely to hesitate on
  exactly those two actions, which is the pilot's own revenue.
- Fix: Make the `Logo` mark on these 8 pages (and only these — not the in-app rail's
  logo, which intentionally stays inert) a link to `/`, the way `app/(auth)/auth-brand.tsx`
  already does for the auth surface. Since `/` immediately explains what V1 is without any
  operator-specific content needing to exist, this alone closes the gap; a one-line caption
  under the mark (e.g. "V1 is the books software your pilot uses to bill you.") would
  remove the remaining ambiguity without requiring any new operator-facing page.

### [HIGH] No contact or support channel anywhere on the marketing surface
- Where: `app/(marketing)/site-header.tsx:33-80` (full file — 4 links: How it works,
  Pricing, Log in, Get started), `app/(marketing)/site-footer.tsx:25-47` (`COLUMNS`: Product
  → How it works/Pricing, Account → Log in/Get started, Legal → Terms/Privacy)
- Issue: Every link on both marketing chrome components is enumerated above — there is no
  email address, contact form, chat link, or "questions?" affordance anywhere in the
  marketing route group. This matters more than it would on a typical SaaS site because
  the funnel has no trial to fall back on: `lib/stripe/server.ts`'s
  `INTRO_FIRST_MONTH_LABEL` comment states the $5-first-month offer "replaced the 7-day
  free trial," so `/signup` asks directly for a card
  (`app/(auth)/signup/signup-form.tsx:211-223`). A prospect with one unanswered question —
  something the landing/pricing FAQs don't happen to cover — has no visible next step
  except entering a card to find out, or leaving.
- Fix: Add a support/contact link (mailto or a form) to the footer's Account or a new
  column, and/or an inline link on the two FAQ sections
  (`app/(marketing)/page.tsx:300-313`, `app/(marketing)/pricing/page.tsx:348-375`) for a
  question not already answered.

### [MEDIUM] No back-link or breadcrumb on any of the 7 primary record detail pages
- Where: `app/(app)/trips/[id]/page.tsx`, `clients/[id]/page.tsx`, `estimates/[id]/page.tsx`,
  `documents/[id]/page.tsx`, `expenses/[id]/page.tsx`, `logbook/[id]/page.tsx`,
  `crew/[id]/page.tsx` — none contain a link back to their list. Shell:
  `components/ledger/page-shell.tsx:21-52` (`LPageShell` takes only `title`, `subtitle`,
  `action`, `children` — no breadcrumb slot). Contrast:
  `app/(app)/clients/[id]/statement/page.tsx:85-89` uses the same shell's `action` slot for
  `<NextLink href={`/clients/${id}`}>Back to client</NextLink>`.
- Issue: There is no breadcrumb component anywhere in the codebase (confirmed by a
  full-repo search; the only "breadcrumb" hits are unrelated comment metaphors in
  `app/(onboarding)/onboarding/onboarding-wizard.tsx:36` and
  `app/(auth)/welcome/actions.ts:162`), and the one component every migrated screen shares,
  `LPageShell`, has no slot for one. The pattern that would fix this already exists and is
  proven to work — it's simply applied to the statement page (a third-level, low-traffic
  screen) and not to the seven highest-traffic detail pages a pilot opens dozens of times a
  day from Trips, Clients, Estimates, Documents, Expenses, Logbook, and Crew. The only ways
  back from any of those seven are the browser's Back button or re-clicking the same rail
  section, and the latter loses any list-view filter or scroll position (e.g.
  `/invoices?show=all`, `app/(app)/invoices/page.tsx:422`, or the receipts "Missing" view,
  `app/(app)/receipts/page.tsx:203`, both drop back to the plain unfiltered list).
- Fix: Add a `Back to <section>` link in `LPageShell`'s `action` slot on the seven `[id]`
  pages, the same shape `clients/[id]/statement/page.tsx` already uses.

### [MEDIUM] Command palette "Go to" list omits the exact feature that answers the product's lead pre-signup objection
- Where: `lib/nav.ts:144-174` (`NAV_COMMANDS`) — `Create` group (lines 145-155) has no
  "Import logbook" entry; `Go to` group (lines 156-173) has no entry for `/logbook/import`,
  `/accounting/journal`, `/accounting/reconcile`, or `/invoices/recurring`. Contrast:
  `app/(marketing)/page.tsx:300-304` — FAQ: *"I already keep a logbook. Do I have to start
  over? No. Import a ForeFlight or LogTen Pro export, or any CSV through the column
  mapper…"*; the feature this answers lives at `/logbook/import`, reachable in-product only
  via `app/(app)/logbook/page.tsx:269`.
- Issue: `command-palette.tsx`'s own header comment calls the palette "the product's first
  search of any kind" and `lib/nav.ts`'s comment on `NAV_COMMANDS` describes it as "the half
  of 'search any feature' that is not a top-level section" — but a pilot who signed up
  specifically because the FAQ promised logbook import cannot find that screen by typing
  "import" or "logbook" into ⌘K; only "Import expenses" (bank statements) and "Log mileage"
  appear. The other three omissions (`/accounting/journal`, `/accounting/reconcile`,
  `/invoices/recurring`) are lower-stakes since each is one click from its own section index,
  which is itself one rail click away — logbook import is the one genuinely
  marketing-load-bearing gap.
- Fix: Add `{ href: "/logbook/import", label: "Import logbook", group: "Create", keywords: ["foreflight", "logten", "csv"] }`
  to `NAV_COMMANDS`, and add the three "Go to" entries for consistency with every other
  section's sub-pages.

### [MEDIUM] "Expenses" and "Receipts" are two rail-level nav sections over the same table, with no link between them
- Where: `lib/nav.ts:83` (`{ href: "/expenses", label: "Expenses", group: "BUSINESS" }`),
  `lib/nav.ts:87` (`{ href: "/receipts", label: "Receipts", group: "RECORDS" }`);
  `app/(app)/receipts/page.tsx:16-32` header comment: *"There is no standalone 'receipt'
  record in this product... This page is a second READ of that same table."*
- Issue: Two separate, rail-visible, differently-grouped nav entries both render
  `pilot.expenses`, one filtered by billing/category state and one filtered by whether
  `receipt_path` is set. Confirmed by grep of both files' `href`s: `expenses/page.tsx` never
  links to `/receipts`, and `receipts/page.tsx` links to `/expenses/new` and `/expenses/[id]`
  (individual rows) but never to the `/expenses` list itself. A pilot has no way to learn,
  from either screen, that the other one exists and shows the same underlying records from
  a different angle — they'd have to notice it in the rail themselves and infer the
  relationship.
- Fix: Add a one-line cross-link on each page ("Every expense, including these — see
  Expenses" / "Missing a receipt? See Receipts") so the relationship is stated rather than
  left for a pilot to reverse-engineer from two menu labels.

### [LOW] `/settings/export` cross-links only the logbook export, not the accounting-journal or per-report exports
- Where: `app/(app)/settings/export/page.tsx:217-239` — the page's closing card explicitly
  cross-links `/logbook` and `/logbook/export` ("Your flight time already has its own full
  CSV export... the same download as the button on the Logbook page"). No equivalent card
  exists for `/accounting/journal/export` (`app/(app)/accounting/journal/export/route.ts`)
  or the eight `/reports/*/export` routes, despite the page's own subtitle claiming "every
  business, compliance and accounting record this product holds for you."
- Issue: The page already establishes the pattern of pointing to a feature's own,
  better-formatted export rather than duplicating it — it just does that for one of nine
  such routes (logbook) and silently omits the other eight (the journal export and each
  report's export). A pilot on this page looking for their P&L or ledger CSV has no cue
  that those exports exist elsewhere, only the raw `journal-entries`/`journal-lines` table
  dumps this page does list (lines 149-158).
- Fix: Add the same short cross-link pattern for `/accounting/journal/export` and a
  "reports have their own export buttons — see Reports" line pointing at `/reports`.

### [LOW] Command palette's record search excludes aircraft, crew, and logbook entries
- Where: `app/api/command-search/route.ts:9-19` — header comment enumerates exactly six
  searchable record types: clients, invoices, trips, estimates, expenses, documents.
- Issue: Two of the fourteen rail sections (Aircraft, Crew) and one of the highest-volume
  ones (Logbook) have no free-text record search in ⌘K at all — a pilot cannot type a tail
  number or a crew member's name and jump to that record the way they can for a client or
  invoice. Documented as a deliberate scope choice in the route's own comment, not an
  oversight, but it is a real, user-facing search gap on sections that are themselves
  top-level nav items.
- Fix: If in scope for a future pass, add `aircraft` (by tail number/type) and `crew` (by
  name) to `RECORD_GROUPS` in `command-palette.tsx:175-182` and the corresponding query in
  `command-search/route.ts`.

### [LOW] Marketing header/footer are not session-aware
- Where: `app/(marketing)/site-header.tsx:57-74` (Log in / Get started render
  unconditionally); `app/(marketing)/pricing/page.tsx`, `terms/page.tsx`, `privacy/page.tsx`
  (none import or call `getSessionContext`, confirmed by grep). Contrast:
  `app/(marketing)/page.tsx:322-324` — `/` itself does check session and redirects a
  signed-in pilot to their dashboard or `/welcome`.
- Issue: A signed-in pilot who navigates to `/pricing`, `/terms`, or `/privacy` (e.g. from a
  bookmark, or curiosity while signed in) sees "Log in" and "Get started" in the header as
  if signed out. Not a dead end — `/login` and `/signup` both redirect an already-signed-in
  visitor with an account straight to the dashboard (`app/(auth)/login/page.tsx:20-22`,
  `app/(auth)/signup/page.tsx:10-12`) — but it is an extra, wrongly-labeled hop instead of a
  direct "Back to your account" link the way `app/(auth)/auth-brand.tsx:51-73` provides.
- Fix: Low priority given the self-healing redirect; if addressed, thread the same session
  check `/` already does into the shared marketing layout or header so `/pricing`/`/terms`/
  `/privacy` can swap "Log in / Get started" for a dashboard link when signed in.
