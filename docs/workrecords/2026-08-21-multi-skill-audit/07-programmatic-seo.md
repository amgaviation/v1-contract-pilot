# Programmatic SEO audit — verdict: don't

V1's public surface is four pages (`/`, `/how-it-works`, `/pricing`, `/your-data`), no
blog, no CMS, and — pre-launch — no customers, no usage data, and no user-generated
content. Every programmatic-SEO playbook that could apply here (Locations, Personas,
Directory, Glossary, Conversions) needs either proprietary data this product does not yet
have or invented content §5 of `docs/MARKETING.md` forbids outright (rule 8: no invented
statistics; rule on comparisons: workflow-only, no competitor pricing or "X is bad at its
own job" claims). The recommendation is to not build a programmatic SEO program now, and
to fix a real, live exposure gap in `app/robots.ts` instead: two of the four
token-addressed client-facing routes are missing from the crawler disallow list that the
file's own comments say should cover all of them.

---

## Finding 1 — `app/robots.ts` disallow list omits `/estimate/` and `/vendor/`, contradicting its own stated invariant

**Severity: high**
**Location:** `app/robots.ts:60-86`

The disallow array explicitly lists `"/invoice/"` and `"/packet/"` with this comment
directly above them:

```
// Token-addressed client-facing pages. Nothing links to them, but a
// token in a crawled referrer is exactly how a private invoice ends
// up in an index.
"/invoice/",
"/packet/",
```

But the product has **four** token-addressed share routes, not two —
`app/estimate/[token]/page.tsx` and `app/vendor/[token]/page.tsx` are the other two, both
carrying the identical "CLIENT-FACING … unauthenticated route that exposes tenant data"
framing in their own header comments (`app/estimate/[token]/page.tsx:9-10`,
`app/vendor/[token]/page.tsx:9-10`). Neither `/estimate/` nor `/vendor/` appears anywhere
in `app/robots.ts`'s disallow list. The stated rationale for blocking `/invoice/` and
`/packet/` — a token leaking into a crawled referrer — applies with equal force to an
estimate accept/decline link or a vendor rollup link; the omission is not a deliberate
distinction, just an incomplete list.

**Why it is not fully mitigated:** `app/layout.tsx:42` sets `robots: { index: false,
follow: false }` at the root, and neither `app/estimate/[token]/page.tsx` nor
`app/vendor/[token]/page.tsx` sits under `app/(marketing)/layout.tsx` (the only segment
that overrides this to indexable), so both routes do inherit root noindex. **Indexing**
is therefore still blocked. What is not blocked is **crawling**: `/estimate/` and
`/vendor/` are absent from robots.txt's disallow, so a crawler that finds a token (a
forwarded email, a pasted link, an operator AP-desk portal, a browser-extension referrer
leak) will fetch the page — the exact scenario the comment on the neighboring two routes
says it exists to prevent. This breaks the file's own documented defense-in-depth and its
implicit claim to be a complete list of "token-addressed client-facing pages."

**Fix:**

```diff
--- a/app/robots.ts
+++ b/app/robots.ts
@@
-        "/invoice/",
-        "/packet/",
+        "/invoice/",
+        "/estimate/",
+        "/packet/",
+        "/vendor/",
```

Also update the comment above the block (`app/robots.ts:60-63` region) to say "four"
rather than implicitly "two," so the next route addition (there is prior art of exactly
this product adding share routes — three were added across three migrations dated
2026-08-09/10/14) doesn't repeat the same gap. Given `lib/nav.ts:1-14`'s own comment
about a *different* hand-maintained list going stale the same way ("This constant exists
because moving it once already left seven stale references behind"), consider deriving
this list from a shared constant (e.g. a `SHARE_TOKEN_ROUTES` array in `lib/nav.ts` or a
new `lib/share-routes.ts`) imported by both `app/robots.ts` and any future test, the same
way `NAV_SECTIONS` already keeps robots.txt's authenticated-route block in sync. That is
a suggestion for the fix's shape, not a task performed here (out of scope — report only).

---

## Finding 2 — dev harnesses are correctly gated; no action needed

**Severity: info**
**Location:** `app/(dev)/layout-harness/page.tsx:80`, `app/(dev)/seam-harness/page.tsx:107`

Both `app/(dev)/layout-harness/page.tsx` and `app/(dev)/seam-harness/page.tsx` call
`notFound()` when `process.env.NODE_ENV !== "development"`, and `app/(dev)/` is not in
`app/sitemap.ts` or referenced anywhere in `app/robots.ts`'s allow list, so it inherits
root noindex and 404s outside development. `app/(dev)/marketing-shots/` has no page.tsx
at its own level (only a `[screen]` subfolder plus fixture/screen components), so it is
not independently routable; not verified further since it does not add a public URL.
No finding — recorded so this run's coverage on `app/(dev)/` is explicit.

---

## Finding 3 — programmatic SEO is not viable for this product today; do not build a template program

**Severity: n/a (strategic verdict, not a defect)**

Walking the two questions the task poses:

**1. Real search demand vs. keyword-tool noise.** The five topics named in the brief
split into two groups:

- *Real, navigational-adjacent intent that already has strong incumbents*: "1099 quarterly
  taxes," "day-rate invoicing," "per diem tracking" are dominated by IRS.gov, TurboTax,
  QuickBooks, and general freelancer-finance content sites with years of authority. A
  templated page for e.g. "quarterly tax calculator for pilots" competes against
  entrenched, frequently-updated, professionally-reviewed tax content — a category
  `docs/MARKETING.md` itself says V1 belongs to ("books, not workflow software," §3) but
  is nowhere near authoritative enough to win in yet, pre-launch.
- *Genuinely narrow, product-adjacent intent with little to no existing supply*: "logbook
  and invoice duplication" and "Part 135 currency recordkeeping" are close to this
  product's actual mechanic (`docs/MARKETING.md`'s "two generated, one organised" claim,
  and the dark `CURRENCY_ENGINE_ENABLED` feature — `lib/entitlements.ts` and
  `README.md`). These are lower-volume, high-intent queries better served by the existing
  `/how-it-works` page and a handful of deliberately-written explainer pages than by a
  generated template — there is no combinable variable set (no "[N] pilots," no "[state]
  tax," no "[aircraft type]") that would produce more than a handful of genuinely distinct
  pages before repeating the same content with a swapped noun, which is precisely the
  thin-content failure mode this skill's own "Common Mistakes" section names.

**2. Defensible data, honestly assessed: there is none yet.** Working down the skill's own
data-defensibility hierarchy against what this repo actually holds:

- *Proprietary/product-derived*: none usable. The product is pre-launch — `.agents/
  product-marketing.md` and `docs/MARKETING.md` both describe zero customers. There is no
  aggregate "average day rate across N pilots" or "average trips logged per month" to
  template a Locations or Curation page from, and inventing either is a direct §5 rule 8
  violation ("no invented statistics… There are no customers yet" — `docs/MARKETING.md:353`
  and repeated verbatim in this task's own framing).
- *User-generated*: none. No reviews, no community, no public profiles.
- *Licensed*: none held.
- *Public*: the only public data plausibly in scope is FAA airman/aircraft registry data
  or IRS mileage-rate tables — both are weak (bottom of the hierarchy), and the FAA-adjacent
  angle collides directly with the absolute rule "never state or imply the product decides
  whether a pilot is legal to fly" and "no FAA-approval or compliance language"
  (`docs/MARKETING.md` rules; this task's brief repeats it). Any Directory/Profile playbook
  built on FAA registry data risks reading as compliance or currency guidance from a
  product whose actual currency engine is deliberately unshipped and unmarketed
  (`CURRENCY_ENGINE_ENABLED`, dark). That risk is not worth the traffic.

**3. Template justification: not met.** No playbook in the skill's table clears the bar.
Glossary ("what is Part 135 currency," "what is a day rate") is the only playbook that
survives the data-defensibility test, because a glossary's "data source" is expertise, not
proprietary numbers — but a glossary is editorial content, not a template-over-data
program, and produces at most a dozen genuinely useful entries for this audience, not a
programmatic scale play. Building it would mean writing a dozen good pages by hand, which
is copywriting/content-strategy work, not programmatic SEO — recommend against opening a
`/glossary/` template system for a corpus this small, and instead treat it (if pursued at
all) as ordinary editorial pages added to `app/sitemap.ts` one at a time, each hand-reviewed
against `docs/MARKETING.md` §5 the way `/how-it-works` and `/your-data` already are
(`app/(marketing)/how-it-works/page.tsx:48-50`, `app/(marketing)/your-data/page.tsx:38-40`).

**Verdict: don't build programmatic SEO.** Revisit only after the product has real
customers and therefore real, aggregable, anonymized product-derived data (e.g. "invoices
generated," "average time from trip to paid" as a cohort statistic once there is a cohort)
— at that point a Curation or Directory play becomes honest rather than invented. Until
then, the highest-leverage SEO work for this repo is Finding 1 (fix the crawl-surface gap)
and keeping the four hand-written pages correct, not generating more of them.

---

## What I did not cover

- Did not assess keyword search volumes with any live tool (no web access invoked for
  this run beyond the file system) — the demand assessment above is qualitative, based on
  category knowledge and the product's own positioning documents, not a keyword-volume
  export. Flagged as qualitative throughout rather than stated as measured fact.
- Did not audit `/pricing`, `/how-it-works`, `/your-data`, or `/` content itself against
  §5 line-by-line; `docs/reviews/00-site-map.md` through `10-landing-page-copy.md` already
  cover that ground per the brief, and this task's scope is specifically the pSEO
  question plus sitemap/robots correctness.
- Did not verify `app/manifest.ts` (out of this skill's scope; no pSEO or crawl-exposure
  angle applies to a web manifest).
- Did not check whether any external link, backlink, or referrer already exposes a live
  `/estimate/[token]` or `/vendor/[token]` URL in the wild (would require log/analytics
  access not available in this run) — Finding 1 is a code-level gap, not a confirmed
  present-day leak.
- Did not evaluate non-pSEO technical SEO (Core Web Vitals, structured data /
  `schema` skill territory, canonical tags) beyond what directly bears on crawl
  exposure — out of this skill's remit.
