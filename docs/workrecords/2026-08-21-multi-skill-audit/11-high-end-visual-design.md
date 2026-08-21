# High-end visual design audit — V1 marketing/product surfaces

**Summary.** The premise in my brief ("Radix Themes, no Tailwind") does not match the
codebase: `scripts/verify-tokens.mjs` and `docs/design/LEDGER.md` show the product runs
Tailwind v4 over a hand-written token sheet (`app/design/ledger.css` +
`app/design/marketing.css`), and `@radix-ui/themes` is explicitly uninstalled and
regression-fenced (`scripts/verify-tokens.mjs:446-451`). I audited against the real
system. That system is unusually mature for a pre-launch product: the marketing surface
(`app/design/marketing.css`) already implements double-bezel screenshot trays, an
island-orb CTA arrow, a glass floating nav with a hamburger-to-X morph and staggered
mobile menu, radial glow fields on the brand bands, and `prefers-reduced-motion` /
`scripting: enabled` guards on every animated primitive — i.e. most of what a generic
"make it look expensive" skill would ask for is already built, token-compliant, and
documented with the reasoning intact. My findings below are the real remaining gaps,
not a re-run of the skill's generic checklist against a system that has already
outgrown it.

---

## Findings (most severe first)

### 1. Pricing cards carry no visual hierarchy — no featured/recommended tier
**Severity:** Medium
**Location:** `app/(marketing)/pricing/page.tsx:138-195`, `components/ledger/index.tsx:104-118`

All three tier cards render through the same unconditional `<LCard>` (`rounded-card
border border-hair bg-card p-5 shadow-card`, `components/ledger/index.tsx:104-118`) with
no prop for emphasis. The JSX loop (`pricing/page.tsx:140-193`) applies identical
classes to Solo, Pro and Business — same border weight, same shadow, same corner
treatment. On a three-tier SaaS pricing page this is a real cost: nothing tells the eye
which plan the product wants a first-time buyer to land on, so the page reads as three
equally-weighted options rather than a guided decision. This is the single clearest
place left where "expensive because precise" is being left on the table — the fix needs
no new visual value at all, only a conditional application of tokens that already exist.

**Fix (fully compliant — `border-hair`, `border-accent`, `shadow-raised`, `bg-accent-soft`,
`LPill tone="accent"` all already declared in `ledger.css` / `pricing-model.ts`):**
```tsx
// pricing/page.tsx — inside the TIER_ORDER.map, before the return:
const featured = tier === "pro"; // or read from pricing-model if this should be data-driven

<LCard
  key={tier}
  className={cn(
    "flex h-full flex-col gap-4",
    featured && "border-accent shadow-raised ring-1 ring-accent/20"
  )}
>
  {featured ? (
    <LPill tone="accent" className="absolute -translate-y-8">Most pilots start here</LPill>
  ) : null}
  ...
```
Every value in that diff (`border-accent`, `shadow-raised`, `LPill tone="accent"`) is
already declared in `ledger.css:202-219` / `components/ledger/index.tsx:122-186` — this
is composition, not a new token.

---

### 2. Section headings across the whole page run at one weight — no typographic rhythm between primary and secondary beats
**Severity:** Medium
**Location:** `app/(marketing)/page.tsx:596, 707, 746, 788, 856, 931`

Every H2 on the landing page after the hero — "You log the trip once" (line 596),
"Getting paid runs through your own Stripe account" (707), "Four promises" (746),
"Questions pilots ask us" (788), "What else is in there" (856), "Start with your next
trip." (931) — is set in the identical class string `mkt-display-s font-display
font-bold`. Six sections of equal visual shout in a row means none of them shout: the
page has a single H1 at `--text-display` and then a flat plateau at `--text-display-s`
for everything else, so scrolling through it, no section reads as more or less
important than its neighbours. The token scale already has the range to fix this
(`ledger.css:262-273` declares `--text-h1` through `--text-h2`/`--text-h3` distinctly
from the display sizes) — it just isn't being used to differentiate a primary
conversion beat ("Getting paid…", "Four promises") from a supporting one ("Questions
pilots ask us", the FAQ rail heading).

**Fix (compliant — `text-h2`/`text-h1` already declared in `ledger.css:265-270`):** drop
one step to `font-display text-h2 font-bold` (already the pattern used on
`pricing/page.tsx:202` and `pricing/page.tsx:281`) for the FAQ and spec-block headings,
and reserve `mkt-display-s` for the two sections actually carrying a conversion action
directly beneath them (Getting Paid, Close). This is a class-string change in
`page.tsx` only, no CSS edit.

---

### 3. `LEmpty` (the one empty-state primitive) has never been given a visual anchor — every empty state in the product is pure text
**Severity:** Low-Medium
**Location:** `components/ledger/index.tsx:224-259`

`LEmpty` renders a heading, one paragraph, and up to two actions — no icon slot, no
illustration slot, no muted numeral/glyph. That is a deliberate restraint choice per its
own comment (`index.tsx:215-223`, "ported... same split... no default title/body/action")
and is consistent with the brand's "quiet, not decorated" ethos — I am not recommending
an icon library (the skill's default move) since Ledger has never used one and adding
one now would be the first decorative asset in the whole system, a much bigger call than
this audit's scope. But the primitive currently has literally nothing to distinguish "no
data yet" from "a paragraph of body copy" at a glance — no `text-ink-3`-toned numeral,
no dashed `border-hair` frame. Every screen reusing `LEmpty` inherits that flatness.

**Fix (compliant — uses only existing tokens, no new visual value):** give `LEmpty` an
optional quiet frame using tokens already in the sheet:
```tsx
<div className={cn("flex flex-col items-center gap-3 rounded-card border border-dashed border-hair px-3 py-10 text-center", className)}>
```
`border-dashed` + `border-hair` is zero new hex/shadow/radius — purely a Tailwind
utility against an existing color token, so it does not touch `tokens:verify`'s
regulated categories at all. This gives every empty state in the product (not just
marketing) a one-line lift with no new primitive.

---

### 4. The hero's product shot is the only screenshot given real presentational weight; the three in-page shots (`invoice`, `logbook`) are unstyled beyond the shared tray
**Severity:** Low
**Location:** `app/(marketing)/product-shot.tsx:91-142`, `page.tsx:632`

`ProductShot` is intentionally uniform (`onBrand` is its only variant), which is correct
restraint for a component reused across three different band tones. But the two
non-hero, non-`onBrand` shots (invoice at `page.tsx:224`, logbook at `page.tsx:239`) sit
directly under a paragraph of body text with no additional framing device (no caption
rhythm change, no size-relationship to the row's step number) — they read as attachments
rather than as evidence being pointed to. This is intentional per the component's own
"only where the picture answers the same thing the words do" comment
(`page.tsx:212-216`), so I am not proposing new chrome; flagging it only because a
reviewer scanning for "does every screenshot pull its weight" should know this was a
considered trade-off, not an oversight, and there is no cheap token-compliant lift
available beyond what's already there (the tray already is the "double-bezel" treatment
the generic skill would ask for).

---

### 5. `REJECTED BY tokens:verify` — a few generic-agency moves the skill would reach for, and why they're already blocked
Per the brief, listing rejected-but-tempting ideas beside their compliant alternative:

- **Per-component custom gradient meshes / colored orbs beyond the two navy `.mkt-glow`
  variants** (skill §3A "Ethereal Glass"). REJECTED: any new `radial-gradient(...)` or
  `rgba(...)` literal outside `app/design/marketing.css` trips the `color-function` rule
  (`scripts/verify-tokens.mjs:287-291`), and `marketing.css` itself is value-exempt but
  is the *only* place to add one. **Compliant alternative:** extend `.mkt-glow`/`
  .mkt-glow-low` in `marketing.css` with a third named variant if a future section needs
  its own glow — the existing two already prove the pattern works within the rule.
- **A second card-radius scale for "premium" panels (skill's `rounded-[2rem]`
  squircles).** REJECTED: `border-radius` values outside `var(--radius-*)` fail the
  `border-radius` rule (`verify-tokens.mjs:326-333`) everywhere except the two exempt
  CSS sheets. **Compliant alternative:** `--radius-card` (12px, `ledger.css:304`) is
  already the largest declared radius and is deliberately restrained versus the skill's
  32px suggestion — that restraint is the fintech register's whole point
  (`LEDGER.md:9-16`), not a gap to fill.
- **Custom per-instance drop shadows for "floating" cards** (skill §4A). REJECTED: any
  `box-shadow` not resolving through `var(--shadow-*)` fails outside the two exempt
  sheets (`verify-tokens.mjs:346-353`). **Compliant alternative:** `shadow-float`
  (`ledger.css:127` / `313`) already exists specifically for "a light card floating on
  the navy ground" — it is unused outside the hero's `ProductShot onBrand`; a future
  floating panel should reach for it before inventing anything.
- **A fourth vendored display face for extra "signage" flavor** (skill's banned/allowed
  font list). REJECTED: `font-family` outside `var()` fails the `font-family` rule
  (`verify-tokens.mjs:336-340`), and `lib/fonts.ts` is the only place a face is loaded.
  **Compliant alternative:** none needed — Archivo pinned to width 112
  (`LEDGER.md:90`) already gives the "semi-expanded signage" read the skill is
  reaching for; a fourth face would fight it.

---

## What I did not cover

- The authenticated product (`app/(app)/**`, `components/ledger/page-shell.tsx`,
  `tabs.tsx`, `segmented.tsx`, `forms.tsx`, `dialog.tsx`) — the brief's focus areas
  (marketing page, nav, footer, product-shot, reveal, pricing) are all signed-out
  surfaces, and I stayed there. Density/rhythm inside real data screens (Invoices,
  Trips, the day grid) is a materially different review and is already governed by a
  separate migration document (`docs/design/LEDGER.md`'s phase table) that is mid-flight
  — judging it against a "make it look expensive" lens without reading every migrated
  screen would be guesswork.
- `/terms`, `/privacy`, `/your-data` were not opened; only `/pricing` and
  `/how-it-works` were spot-checked against the homepage's section-rhythm pattern
  (finding #2 likely recurs there — I did not verify line numbers on unread files, so I
  am not citing it as a finding).
- No screenshot/visual rendering was taken (no browser tool in this run) — every
  finding above is inferred from source and token definitions, not from a rendered
  screen. A visual pass with actual pixels would likely surface additional cases the
  regex-level review here cannot, especially spacing rhythm at real viewport widths.
- `docs/RESPONSIVE-CONTRACT.md` was not read in full; findings above don't touch
  responsive behavior, only desktop-authored hierarchy/craft.
- I did not run `npm run tokens:verify` myself to confirm current-tree cleanliness —
  my compliance claims above are based on reading the rule patterns and the declared
  token names, not on an executed pass.
