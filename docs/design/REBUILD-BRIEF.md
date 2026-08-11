# V1 Design Rebuild — Direction Brief

Author: UI/UX direction researcher (7-agent overhaul session, 2026-08-11).
Executor: design-system agent, ~1 hour build window.
Scope of change is exactly the surface the repo's own architecture defines: the `<Theme>`
props in `app/layout.tsx`, the defaults in `components/ui/index.tsx`, `app/globals.css`
(one of the four `verify-tokens` exempt files), and the three shell files
`app/(app)/layout.tsx`, `app/(app)/page-shell.tsx`, `app/(app)/nav-rail.tsx` (plus
`lib/nav.ts` for nav grouping data). No new CSS framework, no icon library, no
per-screen rewrites. Every value named below is a Radix token or an existing exempt-file
custom property — `npm run tokens:verify` must stay green.

All Radix facts below were verified against the installed package,
`@radix-ui/themes@3.3.0` (`node_modules/@radix-ui/themes/dist/esm/components/theme.props.js`,
`theme.js`, `props/color.prop.js`, `props/radius.prop.js`,
`helpers/get-matching-gray-color.js`) — not from memory.

---

## 1. The direction, in one paragraph

**"Flight department, not flight sim."** V1 becomes a light-canvas financial workspace in
the Mercury/Stripe mold — white panels on a cool slate ground, one calm indigo accent,
subtle radius, dense tabular figures — wrapped in a single deliberately dark surface: the
navigation rail, rendered as a nested dark theme in the same indigo/slate palette. The
dark rail gives the product the Linear-class, all-day-professional-tool read (and quietly
echoes a night flight deck without a single piece of cockpit kitsch — no gauges, no
altimeter fonts, no glowing green), while the content canvas stays light because this is
where a pilot audits money and decimal hours, and finance-grade tools earn trust on a
light ground. The rebuild feel comes from five simultaneous, token-level shifts — accent
blue→indigo, radius none→small, cards ghost→surface on a gray-2 canvas, body text
light→regular, and the dark rail — which together change every pixel of every screen
through the theme, not through screen-by-screen edits.

Research anchors (fetched live 2026-08-11): Linear's dark-first density and restraint
([LogRocket on "Linear design"](https://blog.logrocket.com/ux-design/linear-design/),
[Linear's own redesign notes](https://linear.app/now/how-we-redesigned-the-linear-ui),
[925studios breakdown](https://www.925studios.co/blog/linear-design-breakdown-saas-ui-2026));
fintech dashboards (Mercury, Ramp, Stripe) staying light-first and leading with one
auditable number because trust beats fashion for money surfaces
([Masterly fintech dashboard patterns](https://www.themasterly.com/blog/fintech-dashboard-design-guide),
[SaaS dashboard survey](https://www.925studios.co/blog/saas-dashboard-design-examples-2026)).
V1 is both kinds of tool at once — all-day professional *and* financial — so it takes the
dark chrome from the first family and the light canvas from the second.

## 2. Dark mode: the decision

**Root stays pinned `appearance="light"`. One nested dark surface: the nav rail (and the
phone top bar), via `<Theme appearance="dark">`. No OS-following, no class strategy, no
head script.**

Why not full dark or dual-mode:

- Dual-mode doubles the visual-QA surface across ~40 screens inside a 4-hour window with a
  "zero visual bugs" mandate — it is exactly where that mandate dies. The repo already
  removed the `.light`/`.dark` head-script strategy once (see the `app/layout.tsx` Theme
  comment); re-adding it would also resurrect `suppressHydrationWarning` and the dual
  `viewport.themeColor`.
- Full dark fights the product's own outputs: the invoice PDF (`lib/pdf-palette.ts`) and
  the public `/invoice/[token]` page a pilot's *client* sees are light documents; the
  screens that edit them should look like them.

Why the nested dark rail is safe, verified from source (`theme.js`, v3.3.0):

- A nested `<Theme>` accepts `appearance`; passing an explicit `"dark"` stamps
  `class="radix-themes dark"` on that element **and auto-enables `hasBackground`**
  (`hasBackground = isRoot || appearanceIsExplicit` in `ThemeImpl`), so the rail paints
  its own dark ground (`--color-background` ≈ `#111113`, dark slate-1) with no extra CSS.
- It inherits `accentColor`/`resolvedGrayColor` from the root context, so the rail is the
  *same* indigo/slate system at night — one theme, two grounds.
- `app/globals.css` already carries the dormant `.radix-themes.dark` selector that flips
  `--v1-logo-mark` to `#ffffff` — the file's own comment records this exact mechanism as
  verified. The wordmark inverts to white on the rail automatically; the bug stays
  `#036BFC` per the logo kit ("one blue, everywhere"). **Zero brand CSS changes needed.**
- It renders server-side with no client script, so there is no flash and no hydration
  concern.
- `Theme` is already re-exported from `@/components/ui` (`export * from "@radix-ui/themes"`),
  so the rail imports it without touching the `verify-tokens` import ban.

`lib/brand.ts` `THEME_COLOR = "#fcfcfd"` **does not change**: browser chrome continues the
page ground, which stays light slate-1 — and the accent change below keeps the slate
pairing (verified: `getMatchingGrayColor("indigo") === "slate"`, and
`--slate-1: #fcfcfd` light in the installed `styles.css`). Update only the comment's
"blue" reference to "indigo".

## 3. Exact `<Theme>` props (`app/layout.tsx`)

```tsx
<Theme
  accentColor="indigo"     // was "blue"
  grayColor="auto"         // unchanged — resolves to slate for indigo (verified)
  radius="small"           // was "none"
  scaling="90%"            // unchanged
  panelBackground="solid"  // unchanged
  appearance="light"       // unchanged — root stays pinned light
>
```

All values are legal in 3.3.0 (`themePropDefs`: appearance `inherit|light|dark`; radius
`none|small|medium|large|full`; scaling `90%|95%|100%|105%|110%`; panelBackground
`solid|translucent`; grays `auto|gray|mauve|slate|sage|olive|sand`; 26 accents).

- **`accentColor="indigo"`** (`--indigo-9: #3E63DD`, verified). Radix `blue` (#0090FF at
  step 9) is brighter and cooler than anything in the brand family; indigo sits in the
  same hue family as the marketing navy `#0B1F33`, so the app accent, the marketing
  ground, and the dark rail read as one blue-family system while the Signal Blue bug
  (`#036BFC`, a brand constant, never retinted) still pops against all three. Every solid
  button, focus ring, link, tab indicator and current-nav marker shifts at once — the
  cheapest whole-product change in the system.
- **`grayColor="auto"`** — keep the coupling the current comment argues for. Auto resolves
  indigo→slate, same as blue→slate, so `THEME_COLOR` stays truthful (re-assert in its
  comment, per that file's instruction to re-check on accent change).
- **`radius="small"`** — the rebuild's texture change. `none` read brutalist; `small` is
  the precision-instrument register dense pro tools actually use (Linear sits at ~4–8px).
  `medium` is consumer-soft; rejected. Update the layout comment block (it currently
  documents `radius="none"` as the owner's choice — the owner's rebuild order supersedes
  it; say so in the comment).
- **`scaling="90%"`** — density is a feature: a month of trips or a year of logbook
  entries on one screen is the product's promise. Unchanged.
- **`panelBackground="solid"`** — unchanged, and now load-bearing twice: surface Cards
  become the product's default panel (§5) and translucency behind decimal-hour columns is
  a legibility bug.
- **`appearance="light"`** — root pinned light; dark exists only as the nested rail
  theme (§2, §4).

## 4. App shell redesign (`app/(app)/layout.tsx`, `nav-rail.tsx`, `page-shell.tsx`, `lib/nav.ts`)

### 4.1 Canvas

The `<main>` Box gets `style={{ background: "var(--gray-2)" }}` (keep existing padding
`p={{ initial: "4", md: "5" }}` and `Container size="4"`). Surface Cards (§5) sit on this
as white panels — the Mercury/Stripe canvas-and-panel hierarchy, all tokens.

### 4.2 Nav rail — the dark surface

Structure (desktop, `sm` and up):

```tsx
<Box asChild width={{ initial: "100%", sm: "240px" }} flexShrink="0"
     display={{ initial: "none", sm: "block" }}>
  <aside>
    <Theme appearance="dark" asChild>   {/* paints its own dark ground; see §2 */}
      <Flex direction="column" height="100%">
        {/* logo block: unchanged content — Logo + descriptor line.
            Wordmark auto-inverts to white via globals.css. */}
        {/* grouped nav (below) */}
        {/* account block pinned bottom: unchanged content/position */}
      </Flex>
    </Theme>
  </aside>
</Box>
```

Notes: width 232→240px (labels + group headers breathe; still narrow). The old
`borderRight`/`background: var(--gray-a2)` styles on the wrapper Box are **removed** — the
dark theme paints the ground; add `style={{ borderRight: "1px solid var(--gray-a5)" }}`
*inside* the dark theme so the hairline resolves against the dark scale. If `asChild`
composition on `Theme` fights the Flex, an inner `<Theme appearance="dark">` div with
`height="100%"` is equally fine — do not fight it for long.

**Grouped sections.** `lib/nav.ts` stays the single source: extend `NavItem` with an
optional `group` label and render group headers in the rail. Grouping (supersedes the old
flat PLAN order under the rebuild mandate — record that in the `lib/nav.ts` comment):

- **OPS** — Overview, Trips, Logbook
- **BUSINESS** — Estimates, Invoices, Expenses, Clients
- **RECORDS** — Documents, Reports
- (separator) Settings — apart, as today

Group header treatment: `<Text size="1" color="gray" weight="medium" style={{ textTransform:
"uppercase", letterSpacing: "var(--letter-spacing-1, 0.06em)" }}>` — wait: `letterSpacing`
with a literal is banned by `verify-tokens` (inline-style rule). Use
`<Text size="1" color="gray" weight="medium">` in plain uppercase *text* ("OPS") and skip
letter-spacing entirely; the size-1 gray cap label is enough. `mt="4"` before each group
after the first, `mb="1"` after the header, `px="3"`.

**Link treatment** (both RailLink and StripLink; keep `aria-current`):

- Every link: `px="3" py="2"`, `style={{ borderRadius: "var(--radius-2)", borderLeft:
  "2px solid transparent" }}` (constant 2px border on all states so activation never
  shifts layout; `borderLeft` is not on the verify-tokens banned camelCase list —
  `borderRadius` is, and stays a `var()`).
- Current: `borderLeft: "2px solid var(--accent-9)"`, `background: "var(--accent-a3)"`,
  text `highContrast weight="medium"` (as today). On the dark ground this is the one
  restrained instrument gesture: a course-bar edge, not a glow.
- Idle: text `color="gray"`, no background. Hover (optional, only if trivial): skip —
  Radix Text has no hover prop and a CSS file rule is out of scope for the hour.

**Account block** ("Signed in to" + legal name): unchanged content, pinned bottom as
today; on the dark ground it needs no restyle (gray/default Text resolve via the dark
scale automatically).

### 4.3 Phone top bar + strip

Wrap the existing phone-only `<Box display={{ initial: "block", sm: "none" }}>` contents
in the same `<Theme appearance="dark">` and delete its `background: var(--gray-a2)` /
light border styles (dark theme paints the ground; keep a `borderBottom: "1px solid
var(--gray-a5)"` *inside* the dark theme). NavStrip links get the same treatment as
RailLink minus the left border (use `background: var(--accent-a3)` + highContrast only —
a left edge reads wrong on a horizontal strip). Same nodes always in the DOM, `display`
toggled — preserve that invariant.

### 4.4 Header

Stays light (it belongs to the canvas, not the chrome). Changes:

- Make it sticky: `style={{ position: "sticky", top: 0, zIndex: 1, background:
  "var(--color-background)", borderBottom: "1px solid var(--gray-a4)" }}` on the existing
  header Flex (replaces the current borderBottom-only style). No backdrop-filter — banned
  outside tokens and unnecessary on a solid ground.
- Content unchanged: right-aligned `user.email` (size 1 gray) + Sign out (size 1, soft,
  gray, still a form POST). Do not add AMG or account name here (brand decision #18; the
  rail already answers "whose data").

### 4.5 Page title pattern (`page-shell.tsx`)

- Outer gap `"4"` → `"5"` — panels on a canvas need one more step of air under the title.
- Title: `Heading size="6" trim="start"` unchanged. Subtitle: `Text size="2"
  color="gray"` unchanged. Action slot unchanged.
- No border under the title block; the canvas/panel contrast now does that job.

### 4.6 Density + figures

Unchanged and reaffirmed: `scaling="90%"`, table sizes as-is, `.tnum` on every money and
decimal-hours figure (existing globals.css utility — audit item in §8, not a new rule).

### 4.7 Empty-state visual language

One pattern, applied wherever a list/table is empty (no new component file; it is a
composition recipe using the new Card default):

```tsx
<Card>                                {/* surface by default after §5 */}
  <Flex direction="column" align="center" py="8" gap="2">
    <Text size="2" weight="medium">No invoices yet</Text>
    <Text size="2" color="gray">Log a trip and its billable days become your first draft.</Text>
    <Button size="2" variant="soft" mt="2">…primary action…</Button>
  </Flex>
</Card>
```

No illustrations, no icons, no dashed borders. Copy stays pilot-correct (trips/legs,
certificate not license — per the aviation terminology rules the product already follows).

## 5. Component-default changes (`components/ui/index.tsx`)

| Component | Now | Becomes | Why |
|---|---|---|---|
| `Card` | `variant="ghost"` | `variant="surface"` | The single biggest rebuild lever: ~144 app call sites flip from flat regions to bordered white panels on the gray-2 canvas at once. Marketing already passes `variant="surface"` explicitly at its mock/pricing call sites, so nothing doubles up. **Keep** the ghost-outdent rule in globals.css (dormant guard for any future explicit ghost; its header comment gains one line saying the default moved). |
| `Text` | `weight="light"` | *(remove — Radix regular)* | Light body copy at size 1–2 over 90% scaling is thin on glass in daylight (pilots read this on phones at FBOs). Regular is the Linear/Stripe register. The one explicit `weight="light"` call site (marketing hero sub-line) keeps its prop and is unaffected. |
| `TextField.Root` | `variant="soft" size="1" color="gray"` | `variant="surface" size="2"` (drop color) | Bordered inputs match bordered panels; and `size="2"` retires the recorded WCAG 2.5.8 target-size debt (21.6px → 28.8px controls) — the file's own comment says this is the two-word fix; the rebuild is the moment to take it. |
| `Select.Root` | `size="1"` | *(remove — Radix default is "2")* | Must move in lockstep with TextField or mixed forms go ragged (the file documents exactly this failure). |
| `Select.Trigger` | `variant="soft" color="gray"` | `variant="surface"` (drop color) | Same input family as TextField. |
| `Tabs.List` | `color="blue"` | `color="indigo"` | Tracks the accent, per that default's own stated intent. |
| `Badge` | `variant="solid" color="red"` | unchanged | Status glanceability; red-as-overdue semantics documented and kept. |
| `Callout.Root` | `color="amber"` | unchanged | Caution-by-default stands. |
| `Spinner` | `size="3"` | unchanged | — |

Update the file's header comment table to match. The "REJECTED" block stands as written
(Button stays Radix-solid-primary; no gray Text default) — except the `Button
radius="none"` entry's premise changed: note that Theme radius is now "small" and Buttons
inherit it, same conclusion (no per-component radius default).

## 6. Marketing-site translation (`app/(marketing)/*`, `globals.css` `.v1-m-*` block)

**The navy stays.** `--v1-marketing-navy: #0B1F33` is cut from the brand asset files
(`navy.svg`, `white.svg`, `app-icon.svg`) — replacing it means touching brand artwork,
which is out of bounds (§7). The rebuild makes the navy *more* coherent, not different:
indigo app accent + slate grays + navy hero are now one blue family, and the dark app
rail visually rhymes with the navy hero a prospect saw before signing up.

- **Hero**: navy gradient + Signal-Blue glow unchanged. Buttons inside it inherit the new
  indigo accent automatically.
- **Section rhythm**: alternate page-ground sections with `var(--gray-2)` band sections
  (the same canvas token the app now uses), so marketing sections mirror the app's
  canvas/panel system. Hairlines stay `--gray-a5/6`.
- **Radius**: the Theme change rounds every Radix component on the page already. Bring
  the three custom frames along in globals.css (exempt file, and `var()` radii pass
  verify-tokens anywhere): `.v1-m-mock-frame { border-radius: var(--radius-3); overflow:
  hidden; }` (overflow so the chrome bar clips), `.v1-m-eyebrow { border-radius:
  var(--radius-2); }`, `.v1-m-mock-dot { border-radius: var(--radius-full); }`
  (`--radius-full` is a real Radix token — 9999px under `radius="small"`, verified in the
  installed styles.css — so the chrome dots become the circles they were drawn as).
  Delete the stale "Radius stays 0 throughout" sentence from the `.v1-m-*` block comment.
- **Product mock** (`product-mock.tsx`): needs zero changes — it is a real Radix tree, so
  it picks up indigo/small-radius/surface automatically and keeps advertising the real
  product. Verify it in QA rather than editing it.
- **CTA band**: navy, unchanged.

## 7. Do not touch

- **The mark.** `--v1-logo-mark` (literal black / white-on-dark) and `--v1-logo-bug`
  (`#036BFC` on every ground) are trademark constants from the logo kit, never wired to
  the accent. The three dark-mode selectors in globals.css stay exactly as written — the
  rail now *depends* on `.radix-themes.dark`. `--v1-logo-size`, `.v1-logo` sizing rules:
  unchanged. Favicons: unchanged (browser chrome is out of theme scope, per layout.tsx).
- **Brand strings** (`lib/brand.ts`): names, lockup, attribution — and attribution's
  placement rule (app footer + marketing about page ONLY; decision #18). `CURRENCY_DISCLAIMER`
  verbatim — counsel-reviewed.
- **`THEME_COLOR`** value `#fcfcfd` (verified still slate-1 under indigo; comment update
  only).
- **The invoice PDF** (`lib/pdf-palette.ts`, `lib/invoice-pdf.tsx`) and the public
  `/invoice/[token]` + `/packet/[token]` pages' light document character. The PDF palette
  bridge may be left on blue scales this pass — it is a client-facing *document*, not app
  chrome; retinting it is a separate, deliberate decision (flag as follow-up, do not do
  it in the hour).
- **`scripts/verify-tokens.mjs`**: no new exemptions, no rule edits. The whole brief is
  designed to pass it as-is.
- **Auth gate, server/client component split, skip link, `aria-current`, the
  form-POST sign-out, the always-mounted phone/desktop nav invariant** — structural
  correctness the redesign must preserve, listed so it is checked, not assumed.

## 8. Visual-QA checklist (final sweep executes this)

Gates first: `npm run tokens:verify`, typecheck, build — all green.

Per screen (all app sections × list/detail/new, auth pages, error/404, /welcome,
marketing pages, public invoice/packet), at 360px, 768px, 1280px:

1. No horizontal page scroll anywhere (the mock scrolls only inside its own frame).
2. Rail: wordmark renders **white** on the dark rail, bug stays `#036BFC`; descriptor and
   account block legible (dark-scale gray, not light-scale).
3. Exactly one nav item current per route, on all 10 routes; active = left bar +
   `--accent-a3` fill; idle links don't shift when becoming active (constant 2px border).
4. Phone strip: dark, horizontally scrollable, all 10 items reachable by touch and Tab;
   nothing clipped.
5. Sticky header: never overlaps content or focus rings while scrolling; sign-out
   focus-visible ring visible.
6. Canvas/panel: gray-2 canvas behind every page; no Card-inside-Card double borders; no
   negative-margin/overlap regressions from the ghost→surface flip (check Overview KPI
   row, settings panels, auth/error shells specifically — the screens globals.css names).
7. Forms: TextField and Select side by side are equal height (both size 2); no form got a
   stray size-1 control; focus rings indigo.
8. Accent audit: no leftover blue-vs-indigo mismatch (Tabs indicator, links, solid
   buttons all indigo); Badge/Callout semantic colors unchanged (red overdue, amber
   caution, green paid).
9. Radius audit: small radius everywhere Radix owns; no square-vs-rounded collisions
   (rail active pill, marketing frames now `var(--radius-3)`, mock chrome clipped).
10. Figures: every money and decimal-hours column tabular (`.tnum`) and right-ragged
    columns still aligned at 90% scaling.
11. Empty states: every list screen's empty state matches §4.7 (no orphaned old pattern).
12. Marketing: navy hero + glow intact; alternating gray-2 bands; muted ink
    (`--v1-marketing-navy-ink-muted`) still passes contrast on navy; FAQ +/– markers;
    product mock shows the NEW theme (indigo, radius, surface cards) — if it shows the
    old look, something imported around the theme.
13. Public invoice/packet pages: still light documents, print/PDF unchanged.
14. No hydration warnings in console (nested dark theme is server-rendered; there is no
    appearance script); `theme-color` chrome matches the light canvas.
15. Keyboard pass: skip link still lands on `#main-content`; Tab order through dark rail
    visible (focus ring must be checked on the dark ground specifically).
