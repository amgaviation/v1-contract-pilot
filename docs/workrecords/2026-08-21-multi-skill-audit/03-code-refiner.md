# Code Refiner — simplification and complexity review (report only)

Scope: the eight largest modules named in the task, read directly in this session. Overall
these files are unusually well-commented and deliberately structured — most of the
"complexity" is domain complexity (money math, a forward-only state machine, FAA
timing) explained inline, not accidental tangle. The real findings below are a small
number of genuinely duplicated code blocks (same validation or same Stripe-link-retirement
logic hand-copied at two call sites) and one oversized single-function React component.
No refactor was applied — every change below is proposed as a diff/snippet only, per the
task's REPORT ONLY constraint.

## Findings

### 1. [high-risk] `retirePaymentLink` is duplicated, not shared, between the server action and the webhook

- **Location**: `app/(app)/invoices/actions.ts:2445-2509` and `app/api/stripe/connect-webhook/route.ts:1143-1190`
- **Evidence**: Both functions take `{ supabase, accountId/account_id, connectAccountId, invoiceId, paymentLinkId }`, call `deactivatePaymentLink`, catch and log its failure, then run the identical four-column clear:
  ```ts
  // invoices/actions.ts:2473-2485 and connect-webhook/route.ts:1166-1178 — byte-identical shape
  .update(
    {
      stripe_payment_link_id: null,
      stripe_payment_link_url: null,
      stripe_payment_link_livemode: null,
      stripe_payment_link_amount_cents: null,
    } as never,
    { count: "exact" }
  )
  .eq("id", invoiceId)
  .eq("account_id", accountId);
  ```
  The two differ only in: the Supabase client type (`ReturnType<typeof createClient>` vs `ServiceClient`), whether `connectAccountId` is nullable, and the exact wording of the returned notice string.
- **Why this is real duplication and not two coincidentally similar functions**: `invoices/actions.ts`'s own comment above `recordPayment` (line ~40) already says both call sites "retire a stale link the same way" — the codebase already recognizes this as one behavior, it just isn't factored as one function.
- **Fix (proposed, not applied)**: move a generic version to `lib/stripe/connect.ts` (which already exports `deactivatePaymentLink`), parameterized over a minimal client shape (`Pick<SupabaseClient, "from">` covers both call sites) and an injectable notice-string builder so each caller keeps its own wording:
  ```ts
  // lib/stripe/connect.ts
  export async function retireInvoicePaymentLink(params: {
    supabase: { from: SupabaseClient["from"] };
    accountId: string;
    connectAccountId: string | null;
    invoiceId: string;
    paymentLinkId: string;
    baseNotice: string;      // caller-specific first sentence
    stillLiveNotice: string; // caller-specific fallback when Stripe couldn't be reached
  }): Promise<string> { /* body unchanged, both current copies collapse into this */ }
  ```
- **Risk / why flagged high-risk**: this touches the code path that clears a live Stripe Payment Link and the four money-adjacent columns on `invoices` after a payment lands or is corrected — a wrong merge (e.g. swapping which caller's notice text is used, or losing the `connectAccountId` nullability difference) silently leaves a stale, overchargeable payment link live. The DB write itself is identical in both copies today, so a careful merge is low-risk on the write; the risk is entirely in not breaking either caller's specific wording/branching.
- **Verify**: no `scripts/*-verify.mjs` or `tests/*.test.mjs` calls either `retirePaymentLink` copy directly — `payment-reversal-verify.mjs` exercises the underlying `invoice_payments` triggers at the SQL level, not this app-code helper. State this gap plainly if proposing the merge: it would need a new unit-level check (both callers' return strings) before landing.

### 2. [medium] `addLeg` / `updateLeg` duplicate a ~20-line "reload trip range, then parse the form against it" block

- **Location**: `app/(app)/trips/actions.ts:887-904` (`addLeg`) and `app/(app)/trips/actions.ts:956-973` (`updateLeg`)
- **Evidence**: identical in both functions:
  ```ts
  const { data: tripRow, error: tripReadError } = await supabase
    .from("trips")
    .select("starts_on, ends_on")
    .eq("id", tripId)
    .eq("account_id", account.id)
    .maybeSingle();
  if (tripReadError) {
    return { error: friendlyDbError(tripReadError, "trips.select"), values: echoLeg(formData) };
  }
  if (!tripRow) return { error: "That trip no longer exists.", values: echoLeg(formData) };

  const { values, error: parseError } = parseLegForm(
    formData,
    tripRow as { starts_on: string; ends_on: string }
  );
  if (parseError || !values) {
    return { error: parseError ?? "Couldn't read that leg.", values: echoLeg(formData) };
  }
  ```
  `updateLeg`'s own comment (line 932) already says "Same shape as ... addLeg" and "Same fresh, never-trusted-from-the-form read addLeg does" — again, the duplication is acknowledged in prose but not factored.
- **Fix (proposed)**: extract to a private helper in the same file:
  ```ts
  async function loadTripRangeAndParseLeg(
    supabase: Awaited<ReturnType<typeof createClient>>,
    accountId: string,
    tripId: string,
    formData: FormData
  ): Promise<{ values: LegInsert } | { error: string }> {
    const { data: tripRow, error: tripReadError } = await supabase
      .from("trips")
      .select("starts_on, ends_on")
      .eq("id", tripId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (tripReadError) return { error: friendlyDbError(tripReadError, "trips.select") };
    if (!tripRow) return { error: "That trip no longer exists." };

    const { values, error: parseError } = parseLegForm(
      formData,
      tripRow as { starts_on: string; ends_on: string }
    );
    if (parseError || !values) return { error: parseError ?? "Couldn't read that leg." };
    return { values };
  }
  ```
  Both callers then do `const result = await loadTripRangeAndParseLeg(...); if ("error" in result) return { error: result.error, values: echoLeg(formData) };` — the `echoLeg(formData)` call stays at each call site since it always uses the original `formData`, not anything the helper returns.
- **Risk**: leg fields feed FAA 61.57 currency counts per the file's own header — flag as touching FAA-currency-adjacent data, but the extraction is purely mechanical (no branch, no arithmetic changes) so behavior preservation is straightforward to verify by inspection.
- **Verify**: `scripts/trip-verify.mjs` exercises `trip_legs` insert/RLS at the SQL level (fixture leg insert, cross-tenant delete denial) but does not invoke `addLeg`/`updateLeg` themselves, so a manual trace of both call sites pre/post-merge is the only check available; nothing in `tests/*.test.mjs` covers this either.

### 3. [medium] `addInvoiceLine` / `updateInvoiceLine` duplicate the description/quantity/unit-amount/taxable validation block

- **Location**: `app/(app)/invoices/actions.ts:2076-2091` (`addInvoiceLine`) and `app/(app)/invoices/actions.ts:2189-2204` (`updateInvoiceLine`)
- **Evidence**:
  ```ts
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { error: "Give the line a description.", values };

  const quantity = parseQuantity(String(formData.get("quantity") ?? ""));
  if (quantity === undefined) {
    return { error: "Quantity must be a positive number, like 1 or 2.5.", values };
  }

  const unitAmountCents = parseDollarsToCents(
    String(formData.get("unit_amount") ?? "")
  );
  if (unitAmountCents === undefined || unitAmountCents === null || unitAmountCents < 0) {
    return { error: "Unit amount must be an amount like 150 or 150.00.", values };
  }

  const taxable = formData.get("taxable") === "on";
  ```
  is repeated verbatim between the two functions (only `addInvoiceLine` additionally validates `line_type` and `trip_id` before this block).
- **Fix (proposed)**:
  ```ts
  function parseLineAmounts(
    formData: FormData,
    values: LineFormValues
  ):
    | { description: string; quantity: number; unit_amount_cents: number; taxable: boolean }
    | { error: string; values: LineFormValues } {
    const description = String(formData.get("description") ?? "").trim();
    if (!description) return { error: "Give the line a description.", values };

    const quantity = parseQuantity(String(formData.get("quantity") ?? ""));
    if (quantity === undefined) {
      return { error: "Quantity must be a positive number, like 1 or 2.5.", values };
    }

    const unitAmountCents = parseDollarsToCents(String(formData.get("unit_amount") ?? ""));
    if (unitAmountCents === undefined || unitAmountCents === null || unitAmountCents < 0) {
      return { error: "Unit amount must be an amount like 150 or 150.00.", values };
    }

    return {
      description,
      quantity,
      unit_amount_cents: unitAmountCents,
      taxable: formData.get("taxable") === "on",
    };
  }
  ```
  Both callers replace their four blocks with one call and an `"error" in parsed` check.
- **Risk**: this is invoice-line money data (`unit_amount_cents`, `quantity`) — flagged for care even though the extraction changes no arithmetic, only where the four checks live. The two return-shapes differ today (`addInvoiceLine` builds `LineInsert`, `updateInvoiceLine` builds `LineUpdate`); the helper's return type must stay a plain value bag, not either DB type, so each caller keeps assembling its own payload exactly as today.
- **Verify**: no `tests/*.test.mjs` or `scripts/*-verify.mjs` name matches `addInvoiceLine`/`updateInvoiceLine`/`invoice_lines` validation directly — this path is untested at the harness level; a manual trace of both callers' happy-path and each rejection message is the only available check.

### 4. [low] `sendInvoice` / `sendInvoiceReminder` duplicate the custom-message length check

- **Location**: `app/(app)/invoices/actions.ts:1747-1752` (`sendInvoice`) and `app/(app)/invoices/actions.ts:1816-1821` (`sendInvoiceReminder`)
- **Evidence**:
  ```ts
  // sendInvoice
  const note = customMessage?.trim() ?? "";
  if (note.length > MAX_CUSTOM_MESSAGE_CHARS) {
    return {
      error: `That message is longer than ${MAX_CUSTOM_MESSAGE_CHARS} characters. Nothing was sent and the invoice is still a draft. Shorten it and try again.`,
    };
  }

  // sendInvoiceReminder
  const note = customMessage?.trim() ?? "";
  if (note.length > MAX_CUSTOM_MESSAGE_CHARS) {
    return {
      error: `That message is longer than ${MAX_CUSTOM_MESSAGE_CHARS} characters. Nothing was sent. Shorten it and try again.`,
    };
  }
  ```
- **Fix (proposed)**:
  ```ts
  function trimmedCustomMessage(
    customMessage: string | null,
    tooLongSuffix: string
  ): { note: string } | { error: string } {
    const note = customMessage?.trim() ?? "";
    if (note.length > MAX_CUSTOM_MESSAGE_CHARS) {
      return {
        error: `That message is longer than ${MAX_CUSTOM_MESSAGE_CHARS} characters. ${tooLongSuffix} Shorten it and try again.`,
      };
    }
    return { note };
  }
  ```
  `sendInvoice` calls it with `"Nothing was sent and the invoice is still a draft."`; `sendInvoiceReminder` with `"Nothing was sent."`. This preserves each caller's exact current sentence.
- **Risk**: low — pure string validation, no money or state-machine involvement.
- **Verify**: nothing in `tests/*.test.mjs` or `scripts/*-verify.mjs` exercises `sendInvoice`/`sendInvoiceReminder`'s message-length branch; would need a manual trace of both boundary cases (exact `MAX_CUSTOM_MESSAGE_CHARS`, one over).

### 5. [medium] `OverviewPage` is a single ~1,700-line async component with a ~700-line JSX return

- **Location**: `app/(app)/overview/page.tsx:223-1908` (function body), JSX return specifically `1170-1908`
- **Evidence**: `grep -n "^export default async function\|^function "` shows exactly one top-level component (`OverviewPage`, line 223) containing the entire data-fetch (Phase 1 `Promise.all` of 16 queries, plus later phases), all derived-state computation, and the entire page's markup — the "Needs attention" card, KPI row, ready-to-invoice list, expirations panel, etc. — inline in one `return (...)` (lines 1170-1908, confirmed by reading that range). No sub-components exist for any of these panels within this file.
- **Fix (proposed, not applied — too large to inline safely here)**: extract each visually-distinct panel (`NeedsAttentionCard`, `KpiRow`, `ReadyToInvoiceList`, `ExpirationsPanel`, etc.) into local components in the same file (or a co-located `overview/` directory), each taking the already-computed props (`NEEDS_ATTENTION`, `attentionCount`, `errors`, etc.) that the current JSX closes over. This is a pure presentational split — no data-fetching or derivation logic moves, so it does not touch the money/derivation code in Phase 1-3 of the function.
- **Risk**: low for the JSX split itself (server component, no client-side state to preserve across the split), but the file's own comments (e.g. line 1230-1250 on the "Needs attention" card's placement) show the visual ordering carries real product intent — any extraction must keep the exact same conditional-render gates (e.g. `errors.length > 0 || NEEDS_ATTENTION.length > 0 ? (...) : null`) verbatim per panel, not just visually resemble them.
- **Verify**: no automated test renders this page (no jest/vitest, no component test harness in this repo per its own conventions) — a manual side-by-side visual diff (or a snapshot of the rendered HTML before/after) is the only available check; `npm run typecheck` would catch prop-shape mismatches from the split but not visual/ordering regressions.

### 6. [low] Three `ReportWindow` builders in `report-lib.ts` repeat the same "not an ISO date" guard

- **Location**: `app/(app)/reports/pilot-history/report-lib.ts:149-198` — `lastTwelveCalendarMonths` (150-153), `allTimeWindow` (170-172), `lastNinetyCalendarDays` (191-193)
- **Evidence**:
  ```ts
  if (!ISO_DATE_RE.test(today)) {
    throw new Error(`lastTwelveCalendarMonths: not an ISO date: ${today}`);
  }
  // ...and, verbatim except the function name in the message, in the other two
  ```
- **Fix (proposed)**:
  ```ts
  function assertIsoDate(value: string, callerName: string): void {
    if (!ISO_DATE_RE.test(value)) {
      throw new Error(`${callerName}: not an ISO date: ${value}`);
    }
  }
  ```
  Each of the three call sites becomes one line: `assertIsoDate(today, "lastTwelveCalendarMonths");` etc. — the thrown message text is unchanged (still names the specific caller), so any code depending on the exact message (tests, error logs) sees no difference.
- **Risk**: very low — the guard is a defensive assertion, not a computed value; the fix changes nothing about what triggers the throw or its message content.
- **Verify**: not directly named in `tests/*.test.mjs`; `logbook-verify.mjs`/`currency-verify.mjs` exercise this report area at a higher level but a grep of those files for `ISO_DATE_RE`/`not an ISO date` found no match, so this specific guard is unexercised — flag as unverified if applied.

## What I did not cover

- **`app/(app)/settings/export/entities.ts` (2,146 lines)**: read the file's structure (25+ entity export blocks, each a `Pick<...> type` + `HEADER` tuple + `xxxValues()` function). The repetition here is a deliberate one-row-per-CSV-column design, not tangled logic — collapsing it into a declarative column-spec table is a real, larger restructuring (every entity's column order and header text would need to survive verbatim) that this session did not have budget to design and verify safely; flagging it as a candidate for a *separate*, dedicated pass rather than proposing a diff I'm not confident in.
- **`lib/stripe/connect-payments.ts`**: skimmed its export list only; `pendingPaymentDetail`/`failedPaymentDetail` and the `resolveAutoPayment` decision function looked like plausible candidates for a closer pass but were not read in full — this is the most directly money-moving file in the target list (Stripe Connect payment intents/checkout sessions) and a shallow read is not enough basis for a finding here.
- **`app/api/stripe/connect-webhook/route.ts`**: only the `retirePaymentLink` duplicate (finding 1) and the function-name list were examined; the event-handling switch/dispatch logic (`resolveAsyncSettlement`, `handleAutopaySetup`, `sendClientReceipt`, `syncInvoiceStatus`, etc.) was not read function-by-function.
- **`lib/reminders/run.ts`**: only its export list was read; `runDueRemindersForAccount` (280-764, ~480 lines) is the largest function among all eight target files by line count and was not opened.
- **The rest of `app/(app)/invoices/actions.ts`** (`createInvoiceDraft`'s full body was read; `voidInvoice`, `updateInvoiceHeader`, `updateInvoiceNotes` were read) but the file's remaining ~200 lines were not individually traced beyond what's cited above.
- No refactor in this report was applied to any file — every fix above is a proposal only, per the REPORT ONLY constraint.
