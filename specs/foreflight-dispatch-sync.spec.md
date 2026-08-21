# Feature: ForeFlight Dispatch Sync — operator flights become trips

## Overview

A contract pilot flies for several operators, each of which already runs
ForeFlight Dispatch. Today the pilot retypes what they flew: a trip and its
legs by hand in this app, then a separate CSV export from ForeFlight Logbook
to get the same flights into their logbook. This feature connects a *client*
(the operator) to that operator's ForeFlight Dispatch tenant, pulls the flights
the pilot is released crew on, and offers them as reviewable drafts that — on
the pilot's confirmation — become `pilot.trips` + `pilot.trip_legs` with real
OOOI times, and `pilot.logbook_entries` with `source = 'foreflight_sync'`.

Value: day-count billing and FAA currency stop being hand-typed from the same
flight twice, and the invoice the operator receives is built from the
operator's own dispatch record.

## Decisions taken in the workshop

| Decision | Choice |
| --- | --- |
| Data source | ForeFlight **Dispatch API** (`public-api.foreflight.com`), not AADP obstacles, not CloudAhoy |
| Connection scope | **Per client** — one credential per operator, on `pilot.clients` |
| Write policy | **Draft-confirm** — nothing writes to trips or the logbook until the pilot confirms |
| Delivery | **Poll `List Modified Flights` on a cron**, with webhook push as an optional later accelerator |
| Tier | Pro and above (business-depth automation; see `lib/entitlements.ts` gating principle) |
| API access | **Assumed granted.** See Prerequisites — this is a blocking external dependency |

## Prerequisites (external, blocking)

- [ ] Dispatch API access provisioned for each operator tenant the pilot connects.
      Dispatch is an **operator-side** product: the credential is issued by the
      operator's ForeFlight account, not by the pilot's. The pilot cannot
      self-serve this; onboarding copy must say so plainly.
- [ ] Confirm against the live Dispatch API docs, before implementation:
      exact auth scheme (API key vs OAuth client credentials), the
      `List Modified Flights` request/response shape and its documented 31-day
      range cap, rate limits, and whether webhooks are available on the
      operator's plan (the Dispatch Guide documents a WebHooks section, but its
      shape is unverified here).
- [ ] Legal: confirm the pilot is permitted to hold and store operator dispatch
      credentials, and what retention the operator expects on cancellation.

## Functional requirements (EARS)

### Connection

**FR-001 — Connect a client to a Dispatch tenant.**
When an account member with the `pro` tier or above submits valid ForeFlight
Dispatch credentials for a client, the system shall store the credential
encrypted, scoped to that `account_id` and `client_id`, and record
`connected_at` and the connecting member.

**FR-002 — Credentials are never readable back.**
The system shall never return a stored Dispatch credential, in whole or in
part, to any client-side surface, log line, error message, or export.

**FR-003 — Verify on connect.**
When a credential is submitted, the system shall perform a single read-only
Dispatch call before persisting it, and shall reject the connection if that
call does not authenticate.

**FR-004 — Disconnect.**
When a member disconnects a client's Dispatch connection, the system shall
delete the stored credential, stop all future syncs for that client, and
retain already-confirmed trips, legs and logbook entries unchanged.

**FR-005 — Tier loss.**
While the account's tier is below `pro`, the system shall not run scheduled
syncs and shall not accept new connections, and shall retain existing
credentials and confirmed records.

### Sync

**FR-006 — Scheduled poll.**
While a client has an active connection, the system shall, once per scheduled
run, request flights modified since that connection's `last_synced_at`.

**FR-007 — Range cap.**
Where the interval since `last_synced_at` exceeds the API's documented maximum
modified-since window, the system shall issue sequential requests each within
that window rather than one over-wide request.

**FR-008 — Crew filter.**
The system shall retain only flights on which the connected pilot appears as
an assigned or released crew member, and shall discard all other flights
without persisting them.

**FR-009 — Manual sync.**
When a member triggers "Sync now" for a connected client, the system shall run
the same sync path as the scheduled run, and shall rate-limit manual runs to no
more than one per client per minute.

**FR-010 — Idempotency.**
When a sync returns a flight whose Dispatch flight identifier already has a
draft or a confirmed record for that account, the system shall update the
existing draft rather than create a second one, and shall never modify a
confirmed record.

**FR-011 — Advance the cursor only on success.**
When a sync run completes without error, the system shall set
`last_synced_at` to the run's start time; when a run fails, the system shall
leave `last_synced_at` unchanged.

**FR-012 — Failure surfacing.**
When a client's sync fails on three consecutive scheduled runs, the system
shall mark the connection `needs_attention` and surface it in the existing
Needs Attention queue.

### Draft review and confirmation

**FR-013 — Drafts, not writes.**
When a sync retains a flight, the system shall create a **sync draft** holding
the mapped trip, legs and logbook fields plus the raw payload, and shall write
nothing to `pilot.trips`, `pilot.trip_legs` or `pilot.logbook_entries`.

**FR-014 — Confirmation creates records.**
When a member confirms a sync draft, the system shall, in one transaction,
create the trip (`trip_kind = 'contract_pilot'`, `billing_state = 'unbilled'`,
`client_id` = the connected client), its legs, and one `logbook_entries` row
per leg with `source = 'foreflight_sync'` and `foreflight_sync_id` set to the
Dispatch flight identifier.

**FR-015 — Rates come from the pilot's deal, never from Dispatch.**
The system shall populate `day_rate_cents` and `day_count` from the client's
defaults and the trip's date span, and shall never read a rate, price or
amount from the Dispatch payload.

**FR-016 — Edit before confirm.**
When a member edits a draft's mapped fields before confirming, the system shall
persist the edits on the draft and use the edited values on confirmation.

**FR-017 — Dismiss.**
When a member dismisses a draft, the system shall retain the dismissal so the
same Dispatch flight is not re-offered, and shall allow the member to undo the
dismissal.

**FR-018 — Attach to an existing trip.**
Where a draft's dates and tail number match an existing unbilled trip, the
system shall offer attaching the legs to that trip instead of creating a new
one.

**FR-019 — Post-confirmation updates.**
When Dispatch reports a change to a flight the pilot has already confirmed,
the system shall record a *change notice* showing the differing fields, and
shall not alter the confirmed trip, legs or logbook entries.

**FR-020 — Lineage.**
The system shall record every sync run as a row in
`pilot.logbook_import_batches` with a `source_format` of `foreflight_dispatch`,
so a confirmed entry can be traced to the run that produced it.

### Tenancy

**FR-021 — Isolation.**
The system shall scope every table this feature adds by `account_id` with RLS
and column-scoped grants, using the composite-foreign-key pattern established
in `20260805070000_phase3_clients_trips_expenses.sql`.

## Non-functional requirements

**Security**
- Credentials encrypted at rest; the decryption key lives in server env, never
  in the database, and never crosses to a client component.
- No Dispatch call is ever made from the browser. All calls originate from
  server code holding `server-only`.
- Cron endpoints authenticate the same way `/api/reminders/run` and
  `/api/holds/run` do; an unauthenticated call returns 401 and does no work.
- Dispatch payloads are treated as untrusted input: every field is validated
  and type-narrowed before it reaches a mapper, and free-text fields
  (remarks, crew names, airport names) are never rendered as HTML.
- The raw payload retained on a draft is purged with the account under the
  existing purge boundary; add it to `tenancy-verify` coverage.

**Performance**
- A scheduled run processes one connection's modified-flight window in a single
  request page-loop; p95 under 10 s per connection.
- The whole cron run completes within the platform's function timeout for up to
  200 connected clients; beyond that it must batch across runs rather than
  extend the timeout.
- Draft list renders in under 500 ms p95 at 500 pending drafts.

**Reliability**
- Every outbound Dispatch call has a timeout and bounded retry with backoff;
  a 429 respects `Retry-After` and does not advance the cursor.
- A partially-processed run leaves no half-written draft: draft creation per
  flight is atomic.

**Observability**
- Each run records: connection, window requested, flights returned, retained,
  drafts created/updated, outcome, duration. No credential and no payload
  body in logs.

## Acceptance criteria

**AC-001 — Connecting a client.**
Given a `pro`-tier account with a client that has no Dispatch connection,
When a member submits valid Dispatch credentials for that client,
Then the connection is verified against the API, stored encrypted, shown as
connected, and the credential is not present in any server response payload.

**AC-002 — Invalid credentials.**
Given a member on the connect screen,
When they submit credentials the Dispatch API rejects,
Then no credential row is written and the form shows an actionable error that
does not echo the submitted secret.

**AC-003 — First sync produces drafts only.**
Given a connected client with three released flights for this pilot,
When a sync runs,
Then three sync drafts exist, and `pilot.trips`, `pilot.trip_legs` and
`pilot.logbook_entries` have no new rows.

**AC-004 — Confirmation writes the full chain.**
Given a sync draft for a two-leg flight,
When the pilot confirms it,
Then one trip is created for the connected client with `billing_state =
'unbilled'`, two `trip_legs` rows carry the Dispatch OOOI times as UTC
`out_at`/`in_at`, and two `logbook_entries` rows exist with `source =
'foreflight_sync'` and a non-null `foreflight_sync_id`.

**AC-005 — Re-sync is idempotent.**
Given a draft already created from Dispatch flight `F`,
When a later sync returns `F` again unchanged,
Then no second draft is created and no confirmed record is modified.

**AC-006 — Change after confirmation.**
Given the pilot has confirmed the draft for flight `F`,
When Dispatch returns `F` with a changed in-time,
Then a change notice is recorded showing old and new values, and the confirmed
trip, legs and logbook entries are byte-for-byte unchanged.

**AC-007 — Failed run does not lose flights.**
Given a connection with `last_synced_at` at T,
When a sync run fails mid-window,
Then `last_synced_at` is still T and the next run re-requests the same window.

**AC-008 — Crew filter.**
Given the operator's tenant contains flights this pilot is not crew on,
When a sync runs,
Then those flights produce no draft and are not persisted in any form.

**AC-009 — Tenant isolation.**
Given accounts A and B each connected to a Dispatch tenant,
When a member of A queries drafts, connections or change notices,
Then no row belonging to B is returned under any query path, and
`tenancy-verify` passes for every new table.

**AC-010 — Tier downgrade.**
Given a connected client on an account that drops to `solo`,
When the scheduled run executes,
Then that connection is skipped, its credential is retained, and previously
confirmed trips and logbook entries remain fully readable and editable.

**AC-011 — Disconnect.**
Given a connected client with confirmed trips,
When the member disconnects,
Then the credential row is deleted, no further sync runs for that client, and
the confirmed trips and logbook entries are unaffected.

**AC-012 — Rates never come from Dispatch.**
Given a Dispatch payload containing any price or cost field,
When a draft is confirmed,
Then the trip's `day_rate_cents` derives solely from the client's default or
the member's edit, and no Dispatch monetary value is persisted.

## Error handling

| Condition | Response | Pilot-facing message |
| --- | --- | --- |
| Credential rejected by Dispatch on connect | 400, nothing stored | "ForeFlight didn't accept those credentials. Check them with the operator and try again." |
| Member below `pro` attempts connect | 403 | "Dispatch sync is part of Pro. Your logbook and currency stay available on every plan." |
| Not a member of the account / wrong tenant | 404 (not 403 — no existence leak) | "Not found." |
| Dispatch 401 during a scheduled run | Run fails, cursor held, connection flagged after 3 | "We couldn't reach *(operator)*'s ForeFlight. The credentials may have been revoked." |
| Dispatch 429 | Honour `Retry-After`, cursor held | Silent; surfaced only after 3 consecutive failures |
| Dispatch 5xx / timeout | Bounded retry, then fail run, cursor held | Silent; as above |
| Malformed / unmappable flight payload | Flight skipped, run continues, recorded on the batch | "One flight from this sync couldn't be read. It's been left out — you can add it by hand." |
| Confirm on a draft already confirmed | 409, no write | "This flight is already in your trips." |
| Manual sync inside the rate-limit window | 429 | "Just synced. Try again in a moment." |
| Cron endpoint called unauthenticated | 401, no work performed | — |

## Implementation TODO

### Database (`engineer` — migrations are high-stakes)
- [ ] Migration: `pilot.foreflight_connections` — `(account_id, client_id)`
      unique, encrypted credential, `last_synced_at`, `status`
      (`active` / `needs_attention` / `disabled`), `connected_at`,
      `connected_by`. Composite FK to `pilot.clients (account_id, id)`.
- [ ] Migration: `pilot.foreflight_sync_drafts` — mapped fields, raw payload,
      `dispatch_flight_id`, state (`pending` / `confirmed` / `dismissed`),
      unique on `(account_id, dispatch_flight_id)`.
- [ ] Migration: `pilot.foreflight_change_notices` — for FR-019.
- [ ] Extend `logbook_import_batches.source_format` check to include
      `foreflight_dispatch`.
- [ ] RLS policies + column-scoped grants on all three tables, matching the
      Phase 3 pattern.
- [ ] Add the new tables to the account-purge boundary.

### Backend (`engineer`)
- [ ] `lib/foreflight/client.ts` — typed Dispatch client: auth, timeouts,
      retry/backoff, `Retry-After`, paging. `server-only`.
- [ ] `lib/foreflight/credentials.ts` — encrypt/decrypt, never-return-plaintext
      boundary.
- [ ] `lib/foreflight/map-flight.ts` — Dispatch flight → trip/legs/logbook
      fields. Pure and unit-testable, mirroring `lib/logbook-import/`'s shape.
- [ ] `lib/foreflight/sync.ts` — window computation, range-cap splitting, crew
      filter, idempotent draft upsert, cursor advance-on-success only.
- [ ] `lib/foreflight/confirm.ts` — transactional draft → trip + legs + logbook
      entries, reusing the existing trip-derived logbook writer.
- [ ] `app/api/foreflight/sync/route.ts` — cron entry, authed like
      `/api/reminders/run`; register in `vercel.json`.
- [ ] Server actions: connect, disconnect, sync now, confirm, edit, dismiss,
      undismiss. Every one behind `requireAccount` + tier gate.
- [ ] `lib/entitlements.ts` — add the feature at `minTier: "pro"`.

### Frontend (`coder`, under direction)
- [ ] Client detail: Dispatch connection panel — connect, status, last synced,
      disconnect, "Sync now".
- [ ] `/trips/from-foreflight` (or a drawer on `/trips`): draft review list —
      per-draft diff-style preview of the trip, legs and logbook entries that
      confirming would create.
- [ ] Draft edit form with the same validation as manual trip entry.
- [ ] Change-notice surface on the trip detail page.
- [ ] Needs Attention entry for `needs_attention` connections.
- [ ] Empty, loading, error and "no new flights" states.
- [ ] Help copy stating the operator must issue the credential.

### Testing
- [ ] Unit: `map-flight` against recorded fixtures — never live pilot or
      operator data, per the house rule in `lib/logbook-import/foreflight.ts`.
- [ ] Unit: window splitting at the range cap; cursor held on failure.
- [ ] Unit: idempotent upsert; confirmed records immutable on re-sync.
- [ ] DB: `scripts/foreflight-sync-verify.mjs` — RLS isolation, purge, grants;
      wire into `verify:all`.
- [ ] `npm run verify:all` (migrations + tenancy), `logbook:verify`,
      `currency:verify`, `trip:verify`, `npm test`.
- [ ] `reviewer` PASS before any push.

## Out of scope

- Writing anything back to ForeFlight (no flight creation, no logbook push).
- CloudAhoy `/flights` and the AADP obstacles API. If pilot-scoped logbook sync
  is wanted later, it becomes a second adapter behind the same draft-confirm
  boundary.
- Webhook push. Poll-based sync ships first; a webhook is a latency
  optimisation to be specified only after its availability and signing scheme
  are confirmed.
- Auto-invoicing a confirmed trip. Confirmation lands an *unbilled* trip; the
  existing invoicing flow is unchanged.
- Weight & balance, fuel, and performance data from Dispatch.
