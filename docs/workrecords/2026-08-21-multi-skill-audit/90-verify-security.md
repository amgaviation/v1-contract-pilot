# Adversarial verification — security audit (02-security.md)

Every finding re-checked against the code. Verdicts: 3 confirmed, 6 adjusted, 0 refuted.

## SEC-2026-08-21-01 — reminders cron's service-role client charges cards — ADJUSTED (high -> medium)

The mechanism is real and correctly described. `app/api/reminders/run/route.ts:90` builds the
service-role client and `:124` hands it to `runAllDueAutopay`, which selects all writable accounts
(`lib/autopay/run.ts:141-148`), calls `generate_autopay_invoice` (`:244`) and then issues + charges
off-session (`lib/autopay/charge.ts:123,161`). Entry point 3's own text bounds this client to
"decide whether a reminder is due, send it, record the outcome" (`lib/supabase/service-role.ts:71`)
and calls a new use "a NEW decision" (`:96`); nothing in the header was amended for autopay. The
prescribed grep (`:43`) does return exactly the ten documented paths — verified by running it — so
the check is genuinely blind to a client passed as a parameter.

Severity lowered because the auditor priced this as an exploitable widening and it is not:
`pilot.generate_autopay_invoice` is `revoke all ... from public` + `from authenticated`, granted to
`service_role` only (`supabase/migrations/20260819100000_autopay_unattended_generation.sql:191-193`),
re-derives five preconditions including schedule ownership and client consent, and the
`(account_id, schedule_id, period_start)` unique index makes generation idempotent; the pass
re-checks `accountIsReadOnly`/`isEntitled` per account and `tests/autopay-unattended-gating.test.mjs`
pins that behaviour; every failed-but-issued charge alerts (`lib/autopay/run.ts:317-323`). What is
actually broken is the CONTROL, not the money path: the allow-list document no longer describes what
the client does, and the check it prescribes cannot notice. Fix as proposed (rewrite entry point 3,
brand the client type so parameter passing is greppable). The AUTOPAY_UNATTENDED_ENABLED flag /
per-run cap is a hardening suggestion, not a defect — the holds pass needs one because it DELETES
records irrecoverably; a wrongly generated invoice is visible and voidable.

## SEC-2026-08-21-02 — share tokens never expire — ADJUSTED (medium -> low)

Factually correct: neither `20260809060000_invoice_public_share.sql` nor
`20260814111000_estimate_share.sql` contains an expiry column or predicate, while
`client_vendor_links` enforces `expires_at` both in SQL and in application code
(`app/api/autopay/start/route.ts:59`). `pilot.estimate_public` gates on `revoked_at is null` and
status only (`20260814111000:195`), and an invoice token does unlock receipt bytes read with the
service-role key (`lib/invoice-share-receipts.ts:255-262`).

Downgraded to low: this is a hardening gap, not a control failure. The token is 256 CSPRNG bits, is
never derived from a row id, rotation is revocation by construction (`unique (account_id,
invoice_id)`, `20260809060000:69-72`), the pilot has a one-press revoke, and the SECURITY DEFINER
function is the whole boundary and is unchanged by the absence of an expiry. Comparing it to a
vendor link is not like for like — the vendor link authorizes a saved-card mandate, an invoice link
displays one document. The recommended backfill would also silently kill live links a pilot mailed
six months ago; if it is adopted, it needs UI that shows the expiry at mint time.

## SEC-2026-08-21-03 — /estimate/ missing from the proxy allow-list — CONFIRMED (medium)

Verified end to end. `lib/supabase/proxy.ts` allow-lists `/invoice/` (:223), `/packet/` (:234),
`/vendor/` (:243), `/api/autopay/` (:251), `/store/` (:262) and nothing for `/estimate/`; the root
matcher (`proxy.ts:25-27`) excludes only Next static output and `ocr/`, so `/estimate/<token>` is
matched and an anonymous request falls to `:305`, where `next` is set to `path + search` — the
43-char bearer token into a `/login?next=` query string, and thence into access logs, history and
any Referer. `app/(app)/estimates/[id]/share-panel.tsx:70` mints exactly that URL for a client with
no account, and `app/estimate/[token]/respond-actions.ts` (accept/decline) posts to the same
blocked path. Note the secondary consequence the finding understates: the estimate share feature is
inert in production, not merely leaky. The repo already has the mechanical guard pattern for this
class (`tests/cron-allowlist.test.mjs`); extending it to token route directories is the right fix.

## SEC-2026-08-21-04 — robots.ts lists two of four token routes — CONFIRMED (low)

`app/robots.ts:66-70` disallows `/invoice/` and `/packet/` under a comment about tokens leaking via
crawled referrers; `/estimate/` and `/vendor/` are absent. `app/layout.tsx:42`'s
`robots:{index:false,follow:false}` does cover them, so this is defence-in-depth drift, correctly
scored low.

## SEC-2026-08-21-05 — holds cron secret comparison leaks length — CONFIRMED (low)

`app/api/holds/run/route.ts:73-79` returns false on a length mismatch before
`nodeTimingSafeEqual`, under a comment claiming it "does not leak length through an early return".
The sibling route hashes both sides first and documents precisely this
(`app/api/reminders/run/route.ts:186-205`). Same `CRON_SECRET`, and per SEC-01 that secret now gates
card charges as well as purges. Shared implementation is the right fix.

## SEC-2026-08-21-06 — generate_recurring_invoice lacks search_path = '' — ADJUSTED (low -> info, wrong location)

The property is real and it is the only one: `grep "set search_path" supabase/migrations/*.sql`
returns exactly one non-empty setting across 130 statements. But the cited file is wrong — the live
definition is `supabase/migrations/20260809050000_mileage_and_recurring_fixes.sql:185`
(`set search_path = pilot, pg_catalog`), not `20260809030000_recurring_invoices.sql`, which does not
define the function at all. Downgraded to info: the path is pinned (not inherited), the body
schema-qualifies its tables, and shadowing would require CREATE on schema `pilot`, which
`authenticated` does not hold. Worth normalising for consistency and worth the proconfig assertion
in tenancy-verify; not a defect to prioritise.

## SEC-2026-08-21-07 — no Stripe idempotency key on the autopay PaymentIntent — CONFIRMED (low)

`lib/stripe/connect.ts:601-622` creates the PaymentIntent with `off_session:true, confirm:true` and
passes only `{ stripeAccount }`; no `idempotencyKey` appears anywhere in `lib/` or `app/`. The
residual is correctly stated: the generations unique index prevents a re-generated period, so the
exposure is a lost response leaving a genuinely-paid invoice recorded as issued-not-charged (it
alerts, `lib/autopay/run.ts:317`). One-line fix, worth taking.

## SEC-2026-08-21-08 — storefront action reads accountId from the form body — ADJUSTED (low -> info)

The contradiction is real: `app/store/[accountId]/actions.ts:20-22` claims the action "takes no
destination for the money beyond the account id already in the public URL", and `:30-34` reads
`accountId` from `formData` with only a `startsWith("acct_")` check. `lib/supabase/proxy.ts:262`
allow-lists `/store/` with no NODE_ENV gate.

Info rather than low: this is the Connect sample, both the page and `createStorefrontCheckout`
refuse to run without the sample Stripe configuration (`sampleConnectConfigError()`,
`lib/sample-connect/client.ts`), the price is re-read server-side, and the worst outcome is unpaid
Checkout Sessions on an account already connected to this platform. Binding the segment via
`.bind(null, accountId)` is still the correct fix — mostly so the comment stops being false.

## SEC-2026-08-21-09 — expiration_coverage_gaps executable by PUBLIC — ADJUSTED (info, wrong location)

Verdict on substance stands, location corrected: the function is created at
`supabase/migrations/20260805070000_phase3_clients_trips_expenses.sql:246` and granted at `:384`
with no preceding `revoke all ... from public`, which is why PUBLIC retains the default EXECUTE. It
is not defined in `20260807060000_operator_qualifications.sql` (that file only references it). It is
`security invoker` and reads only `pg_catalog`, and by design it must return zero rows, so an anon
caller learns nothing. Fix as written.

## The most important thing the auditor missed

**Tenant business data leaves the tenant boundary to the vendor's inbox on the unattended money
path, and no entry-point paragraph accounts for it.** `lib/autopay/run.ts:319` (and `:333`,
`lib/autopay/charge.ts` message strings) hand `alertOperator` a detail line carrying the account id,
invoice id, schedule id, invoice number, saved-method label and decline reason; `lib/alerts.ts:53`
mails it to `BRAND.supportEmail`, a human-read platform inbox, unattended, on a schedule. This is
the single case where per-tenant business detail crosses to AMG by design, and it directly qualifies
entry point 3's stated guarantee that "nothing it reads leaves the account it belongs to"
(`lib/supabase/service-role.ts:97`) as well as the public "What we can and can't see" copy at
`app/(marketing)/your-data/page.tsx:116-120`. The audit examined which client reads the data and
never asked where the data goes afterwards. Either narrow the detail lines to opaque identifiers the
operator can resolve inside the product, or say plainly on the your-data page that failure
diagnostics reach support.
