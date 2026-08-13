-- ===========================================================================
-- Scheduled payment reminders, and late fees the pilot agreed with their
-- client.
--
-- ***************************************************************************
-- THE TENSION WITH 20260809030000, STATED UP FRONT.
--
-- The recurring-invoices migration's header contains this product's only
-- written position on background jobs, and it is a refusal:
--
--     "If a future engineer is tempted to wire pg_cron to
--      recurring_invoice_schedules and have it call createInvoiceDraft-shaped
--      logic unattended: don't."
--
-- This migration ships the schema for a job that DOES run unattended, so it
-- owes that paragraph an answer rather than a shrug. The refusal rested on
-- two reasons, and they do not survive the move to reminders equally:
--
--   REASON 2 — "never send new money paperwork without review" (docs/PLAN.md:
--   an invoice is "auto-drafted from a trip's facts, reviewed and sent by the
--   pilot — never sent silently"). This reason DOES NOT APPLY to a reminder
--   and that is the whole basis for the difference. A reminder creates no
--   document, moves no status, and states no new fact: it re-sends an invoice
--   the pilot already reviewed, numbered, issued and emailed themself. Nothing
--   here can bill a client for anything. The late-fee half of this migration
--   is subject to reason 2 in full, and obeys it — a fee produces a DRAFT
--   invoice the pilot reviews and sends by hand (see section 5).
--
--   REASON 1 — "a job silently not firing for a week is invisible until a
--   client complains" — APPLIES IN FULL and is answered structurally, not by
--   assertion:
--     * every attempt writes a row in pilot.invoice_reminder_sends, with its
--       TRUE outcome; a failed send is stored as failed, never as sent
--       (lib/email/send.ts's contract, including its outcome-unknown-on-
--       timeout branch);
--     * pilot.accounts.reminders_last_run_at is a per-account watermark, so
--       "when did this last run" is a fact on screen and not a guess;
--     * the run is also reachable by hand from Settings, so the feature works
--       with no scheduler configured at all — which is exactly the shape
--       20260809030000 chose for recurring invoices (a due queue the pilot
--       works through) and this migration keeps as the floor, with the
--       scheduler as the addition on top rather than as a replacement.
--
-- What is NOT built here, deliberately: no pg_cron, no Edge Function, no
-- queue table, no retry/backoff machinery. The scheduler is an HTTP route in
-- the app the platform's own cron calls once a day
-- (app/api/reminders/run/route.ts), because the entire compose-and-render
-- pipeline it needs — React-PDF, the message builder, the preference
-- resolver, receipts — already lives in that server and nothing is served by
-- duplicating it somewhere with less of the app in scope.
-- ***************************************************************************
--
-- EVERYTHING SHIPS DORMANT AND OFF:
--   * every reminder column below defaults to "no reminders";
--   * every late-fee column defaults to NULL, i.e. "no fee agreed";
--   * the route refuses to do anything without CRON_SECRET set;
--   * a send still requires the mail service to be configured at all
--     (emailIsConfigured() — unverified at Resend as of LAUNCH-GATES G5, so
--     the honest expectation is that the first real runs record failures, and
--     the ledger below is what makes that visible instead of silent).
--
-- Additive only. No existing column, constraint, policy or grant is dropped
-- or narrowed. The one existing function replaced is
-- pilot.invoices_protect_issued, re-issued VERBATIM from its current
-- definition (20260810170000) with one string added to its writable-column
-- allowlist — see section 3 for why that is unavoidable and why it is safe.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. pilot.clients — the reminder policy, per client.
--
-- WHY COLUMNS ON pilot.clients AND NOT account_preferences OR A NEW TABLE.
--
-- Against account_preferences: 20260813000000's header states the test for
-- that jsonb column — "nothing in the database computes on it". These values
-- fail that test in the first sentence. A scheduled run reads them to decide
-- whether to email somebody's client; it is the most computed-upon data this
-- feature has. A corrupt or unrecognised preference degrades to the product's
-- own default and nobody is harmed; a corrupt reminder policy either sends
-- mail nobody agreed to or silently stops chasing money. Those are not the
-- same class of value and they do not belong in the same store.
--
-- Against a new table: pilot.client_rates exists because a rate has a SECOND
-- DIMENSION (which day type). A reminder policy has none — it is a scalar
-- contract preference belonging to one client, exactly like payment_terms_days
-- (20260805070000), per_diem_mode/minimum_days (20260807000000),
-- minimum_basis (20260807040000) and cancellation_policy_note. Those are all
-- columns here, each with its own column-scoped grant, and this follows them
-- rather than inventing a fourth shape.
--
-- OFF IS THE DEFAULT AND THE DEFAULT IS EMPTY. Not "off but configured", not
-- "the sensible ladder, disabled" — literally no rungs. A pilot's client
-- relationship is theirs, and a product that shipped a default chase cadence
-- would be making a commercial decision on their behalf the first time it ran.
-- Every existing client row backfills to exactly this state, so this migration
-- cannot cause a single email to be sent.
-- ---------------------------------------------------------------------------

-- The days BEFORE the due date a courtesy note goes out. A subset of
-- {3, 7, 14} — a bounded set rather than a free integer, for two reasons: the
-- UI is a row of checkboxes (an arbitrary integer would need a text field, a
-- parser and an error path for "-5"), and an unbounded set makes "how many
-- emails can this client receive" unanswerable from the schema.
alter table pilot.clients
  add column if not exists reminder_before_due integer[] not null default '{}'::integer[];

alter table pilot.clients
  add column if not exists reminder_on_due boolean not null default false;

-- The days AFTER the due date. One more rung than the before-due set, because
-- 30 days past due is a real and common chase point and 30 days early is not.
alter table pilot.clients
  add column if not exists reminder_after_due integer[] not null default '{}'::integer[];

-- The CHECKs are added separately (and idempotently) because ADD COLUMN ...
-- CHECK cannot be made `if not exists` on its own, and this directory's README
-- records that a `db push` may offer to re-apply a file.
--
-- Each asserts the VOCABULARY (`<@` is array containment: every element comes
-- from the offered set) and a size bound. Both operands are immutable
-- constants, which a CHECK requires.
--
-- WHAT THESE DELIBERATELY DO NOT ASSERT: uniqueness. A CHECK cannot contain a
-- subquery, so "no duplicate rungs" is not expressible here without an
-- immutable helper function, and it does not need to be. A duplicate is
-- HARMLESS by construction: lib/reminders/policy.ts's normalizer de-duplicates
-- on both write and read (it is total over untrusted values either way), and
-- even if it did not, every rung resolves to one rule_key and
-- invoice_reminder_sends' unique index refuses a second row for the same one.
-- So {7,7} can at worst cost one wasted loop iteration; it can never send a
-- second email. The guard for the thing that matters is where this schema
-- always puts it — on the write that would do the damage.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_reminder_before_due_set'
      and conrelid = 'pilot.clients'::regclass
  ) then
    alter table pilot.clients add constraint clients_reminder_before_due_set check (
      reminder_before_due <@ array[3, 7, 14]
      and cardinality(reminder_before_due) <= 3
    );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_reminder_after_due_set'
      and conrelid = 'pilot.clients'::regclass
  ) then
    alter table pilot.clients add constraint clients_reminder_after_due_set check (
      reminder_after_due <@ array[3, 7, 14, 30]
      and cardinality(reminder_after_due) <= 4
    );
  end if;
end $$;

comment on column pilot.clients.reminder_before_due is
  'Days before due_on a courtesy reminder is scheduled for this client, as a subset of {3,7,14}. Empty (the default, and every pre-existing row) means no before-due reminders. A per-client CONTRACT preference in the same family as payment_terms_days — deliberately not in account_preferences, whose stated test is that nothing in the database computes on the value, which a scheduled job reading this plainly does.';

comment on column pilot.clients.reminder_on_due is
  'Whether a reminder is scheduled for the due date itself. False by default and for every pre-existing row.';

comment on column pilot.clients.reminder_after_due is
  'Days after due_on a reminder is scheduled, as a subset of {3,7,14,30}. Empty (the default) means no chase ladder. At most ONE reminder is ever sent per invoice per run: when several rungs come due at once (reminders switched on for an already-overdue invoice), the most advanced one is sent and the rest are recorded as skipped/superseded — see pilot.invoice_reminder_sends.';

-- ADD COLUMN does not extend an existing column-scoped grant — the lesson
-- 20260807000000 learned and 20260807040000 restated. Both INSERT and UPDATE,
-- matching exactly how per_diem_mode / minimum_days / minimum_basis were
-- granted, and additive (no revoke first: this directory's README documents
-- that `revoke insert ... from <role>` drops EVERY column privilege).
grant insert (reminder_before_due, reminder_on_due, reminder_after_due)
  on pilot.clients to authenticated;
grant update (reminder_before_due, reminder_on_due, reminder_after_due)
  on pilot.clients to authenticated;


-- ---------------------------------------------------------------------------
-- 2. pilot.clients — the late fee, per client.
--
-- A LATE FEE IS A CONTRACT TERM, NOT A LAW, and this schema is built so that
-- nothing can forget it. app/(app)/invoices/actions.ts's sendInvoiceReminder
-- comment is the standing instruction:
--
--     "the reference material is explicit that late-fee percentages are
--      negotiated convention rather than law, and a tool inventing a
--      consequence the pilot has not agreed with their client would do them
--      real damage."
--
-- So: NULL by default on every row, per-client opt-in, nothing computed until
-- a pilot has typed a number that exists in an agreement they signed. The
-- product's own copy says "your late fee" and never asserts an entitlement.
--
-- FLAT XOR RATE, enforced by CHECK rather than by convention. Both set is not
-- a richer configuration, it is an ambiguity: the app would have to pick one
-- and the pilot would never know which. The CHECK makes the ambiguous state
-- unrepresentable, so no reader has to define behaviour for it.
-- ---------------------------------------------------------------------------
alter table pilot.clients
  add column if not exists late_fee_flat_cents bigint;

alter table pilot.clients
  add column if not exists late_fee_bps_per_month integer;

alter table pilot.clients
  add column if not exists late_fee_grace_days integer not null default 0;

-- Whether the agreed fee may be MENTIONED in a reminder's wording. Separate
-- from having a fee at all, and separately off: recording the term you agreed
-- and putting it in a chasing email are two decisions, and a pilot who did the
-- first has not thereby made the second. When off (the default) nothing about
-- late fees ever reaches a client's inbox.
alter table pilot.clients
  add column if not exists late_fee_note_on_reminders boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_late_fee_shape'
      and conrelid = 'pilot.clients'::regclass
  ) then
    alter table pilot.clients add constraint clients_late_fee_shape check (
      -- A fee of zero is not a fee; NULL is how "none agreed" is spelled, and
      -- allowing 0 as a second spelling of the same thing invites a reader to
      -- treat one of them as configured.
      (late_fee_flat_cents is null or late_fee_flat_cents > 0)
      -- 500 bps = 5% per month. Every documented contract-pilot late fee sits
      -- at or under 2% per month (1.5% is the convention); the ceiling is
      -- here for the same reason invoices.tax_rate_bps carries one — it
      -- catches the order-of-magnitude fat-finger (150 typed as 1500) that an
      -- unbounded column would put on a client's bill.
      and (late_fee_bps_per_month is null
           or (late_fee_bps_per_month > 0 and late_fee_bps_per_month <= 500))
      -- Flat XOR rate. Never both.
      and not (late_fee_flat_cents is not null and late_fee_bps_per_month is not null)
      -- A grace period with no fee behind it is inert but harmless; bounded so
      -- it stays a grace period rather than a second, hidden payment term.
      and (late_fee_grace_days >= 0 and late_fee_grace_days <= 90)
      -- The note cannot be switched on with nothing to say. Without this, a
      -- reminder could carry "as agreed, a late fee applies" with no agreed
      -- figure anywhere — the exact invented-consequence failure this whole
      -- section exists to prevent.
      and (late_fee_note_on_reminders = false
           or late_fee_flat_cents is not null
           or late_fee_bps_per_month is not null)
    );
  end if;
end $$;

comment on column pilot.clients.late_fee_flat_cents is
  'A flat late fee this client AGREED to, in cents. NULL (the default, and every pre-existing row) means no fee is agreed and none is ever computed or mentioned. Mutually exclusive with late_fee_bps_per_month by CHECK. Never applied automatically: a fee becomes real only as a separate DRAFT invoice the pilot reviews and sends (pilot.invoice_late_fees).';

comment on column pilot.clients.late_fee_bps_per_month is
  'An agreed late fee as basis points of the outstanding balance per complete calendar month past the grace period (150 = 1.5%/month, the common convention). Capped at 500 to catch an order-of-magnitude typo, the same reason invoices.tax_rate_bps is capped. NULL = none agreed. Mutually exclusive with late_fee_flat_cents.';

comment on column pilot.clients.late_fee_grace_days is
  'Days past due_on before an agreed late fee starts accruing. 0 by default. Inert unless one of the two fee columns is set.';

comment on column pilot.clients.late_fee_note_on_reminders is
  'Whether a reminder to this client may STATE the agreed fee ("per our agreement, a late fee of X applies after N days"). Off by default and independently of the fee itself: recording an agreed term and putting it in a chasing email are two decisions. CHECK-bound to a configured fee, so the copy can never claim a consequence with no agreed figure behind it. The statement is display-only, computed at render time, written nowhere, and never presented as part of the balance due — the same posture as clients.cancellation_policy_note ("a NOTE, not a computed rule").';

grant insert (late_fee_flat_cents, late_fee_bps_per_month, late_fee_grace_days,
              late_fee_note_on_reminders)
  on pilot.clients to authenticated;
grant update (late_fee_flat_cents, late_fee_bps_per_month, late_fee_grace_days,
              late_fee_note_on_reminders)
  on pilot.clients to authenticated;


-- ---------------------------------------------------------------------------
-- 3. pilot.invoices.reminders_suppressed — the per-invoice override, and the
--    one place this migration has to touch existing machinery.
--
-- THE PROBLEM THIS SOLVES. "Leave this one alone — they've told me the cheque
-- is signed" is the single most likely thing a pilot wants to say about an
-- automated chase, and the moment they want to say it is always AFTER the
-- invoice was issued. But invoices_protect_issued's structural row diff
-- (20260805090000, as amended) freezes every column of an issued invoice
-- except a named allowlist, and it does so BY DESIGN and by a deliberately
-- structural mechanism: "a FUTURE column added to pilot.invoices would be
-- mutable-on-an-issued-invoice by default unless someone remembered to add it
-- here". That protection works exactly as intended here — a new column is
-- frozen the moment it exists — which means this feature is dead on arrival
-- unless the column is added to the allowlist explicitly.
--
-- WHY ADDING IT IS SAFE, i.e. why this does not reopen the immutability hole
-- the allowlist exists to close. The columns that trigger protects are the
-- ones that decide what the client OWES and what document they hold:
-- client_id, issued_on, due_on, tax_rate_bps, invoice_number, and the lines
-- (guarded separately by invoice_lines_protect_issued). reminders_suppressed
-- is none of those. It changes no total, appears on no PDF, reaches no share
-- page, and is not readable by anyone but the pilot's own account. Flipping it
-- cannot make the client's copy and the pilot's record disagree about a single
-- fact, which is the property the allowlist is defending.
--
-- The function below is a VERBATIM re-issue of its current definition
-- (20260810170000_payment_reversal_partial_resync.sql) with 'reminders_
-- suppressed' added to both halves of the diff and nothing else changed. Do
-- not "tidy" it: the reversal_allowed exception, the draft->sent line and
-- client re-validation, the paid/partial payment assertions and the
-- payment-link columns each closed a specific live-proven bug, and every one
-- of them is load-bearing. Diff this against that file before editing.
-- ---------------------------------------------------------------------------
alter table pilot.invoices
  add column if not exists reminders_suppressed boolean not null default false;

comment on column pilot.invoices.reminders_suppressed is
  'Pilot''s per-invoice override: true means no SCHEDULED reminder is ever sent for this invoice, whatever the client policy says. Default false = follow the client policy (which is itself empty by default). Deliberately not a mirrored copy of the whole policy — the one thing a pilot needs to say about a specific invoice is "leave this one alone", and a per-invoice ladder that could disagree with the client''s would be a second source for one decision. Writable AFTER issue: it is in invoices_protect_issued''s allowlist, because the moment a pilot wants to silence a chase is always after the invoice went out. It moves no money, prints on no document and reaches no client.';

create or replace function pilot.invoices_protect_issued()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reversal_allowed boolean :=
    coalesce(current_setting('pilot.allow_payment_reversal', true), '') = 'on';
begin
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new; -- webhook/service paths (e.g. payment reconciliation) are exempt
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft'   and new.status in ('sent', 'void')) or
      (old.status = 'sent'    and new.status in ('partial', 'paid', 'void')) or
      (old.status = 'partial' and new.status in ('paid', 'void')) or
      -- partial -> sent, correction-driven only. Without this the resync
      -- trigger below RAISES instead of walking the status back, and the
      -- pilot's correction fails outright.
      (old.status = 'partial' and new.status = 'sent' and reversal_allowed) or
      -- Backwards, and only ever driven by a correction row: an invoice
      -- that was marked paid by an overstated payment has to be able to
      -- stop reading as paid once that payment is reversed.
      (old.status = 'paid'    and new.status in ('partial', 'sent') and reversal_allowed)
    ) then
      raise exception 'invoice % cannot move from status % to %', old.id, old.status, new.status;
    end if;

    if old.status = 'draft' and new.status = 'sent' then
      if not exists (
        select 1 from pilot.invoice_lines where account_id = new.account_id and invoice_id = new.id
      ) then
        raise exception 'invoice % cannot be sent with no line items', new.id;
      end if;

      if exists (
        select 1
        from pilot.invoice_lines l
        left join pilot.expenses e on e.account_id = l.account_id and e.id = l.expense_id
        left join pilot.trips t on t.account_id = l.account_id and t.id = coalesce(l.trip_id, e.trip_id)
        where l.account_id = new.account_id and l.invoice_id = new.id
          and coalesce(l.trip_id, e.trip_id) is not null
          and t.client_id is distinct from new.client_id
      ) then
        raise exception 'invoice % cannot be sent: one or more line items'' trips belong to a different client', new.id;
      end if;
    end if;

    if new.status in ('partial', 'paid') then
      declare
        paid_cents bigint;
        due_cents bigint;
      begin
        select amount_paid_cents, balance_due_cents into paid_cents, due_cents
          from pilot.invoice_totals where invoice_id = new.id;
        if coalesce(paid_cents, 0) <= 0 then
          raise exception 'invoice % cannot become status=% with no recorded payment', new.id, new.status;
        end if;
        if new.status = 'paid' and coalesce(due_cents, 0) > 0 then
          raise exception 'invoice % cannot become paid with a nonzero balance due (%)', new.id, due_cents;
        end if;
      end;
    end if;
  end if;

  if old.status = 'draft' then
    return new; -- draft rows are otherwise freely editable
  end if;

  -- 'reminders_suppressed' added by 20260813130000. It is the ONLY addition
  -- to this list in that migration; see its section 3 for why a column that
  -- changes no total, prints on no document and reaches no client is safe
  -- here, and why the rest of this function is a verbatim re-issue.
  if to_jsonb(new) - array[
       'status', 'sent_at', 'delivery_method', 'notes', 'updated_at',
       'stripe_payment_link_id', 'stripe_payment_link_url',
       'stripe_payment_link_livemode', 'stripe_payment_link_amount_cents',
       'reminders_suppressed'
     ]
     is distinct from
     to_jsonb(old) - array[
       'status', 'sent_at', 'delivery_method', 'notes', 'updated_at',
       'stripe_payment_link_id', 'stripe_payment_link_url',
       'stripe_payment_link_livemode', 'stripe_payment_link_amount_cents',
       'reminders_suppressed'
     ]
  then
    raise exception 'invoice % is issued (status=%) and cannot be modified except status/sent_at/delivery_method/notes/payment-link fields/reminders_suppressed', old.id, old.status;
  end if;

  return new;
end;
$$;

-- UPDATE only, deliberately no INSERT grant: an invoice is born un-suppressed
-- (the column defaults false and a draft is not chased at all), and suppression
-- is a decision taken later, about a specific invoice that is already out. Same
-- reasoning as custom_options.archived_at being absent from its INSERT grant.
grant update (reminders_suppressed) on pilot.invoices to authenticated;


-- ---------------------------------------------------------------------------
-- 4. pilot.invoice_reminder_sends — the ledger, and the double-send guard.
--
-- THERE IS NO RECORD ANYWHERE TODAY THAT A REMINDER WAS EVER SENT.
-- invoices.sent_at and delivery_method describe the FIRST send and nothing
-- else, which is why the manual reminder path can be pressed twice in a row
-- with nothing to notice. That was survivable while a human was pressing the
-- button. It is not survivable for a job.
--
-- MODELLED ON pilot.recurring_invoice_generations, whose header states the
-- house rule this table exists to obey:
--
--     "The app still checks first, to fail with a friendly message instead of
--      a raw 23505 — but the constraint is what actually prevents the double
--      bill if that check ever races or gets bypassed."
--
-- So the unique index below is the guard. Two cron invocations overlapping,
-- the manual "run now" button pressed while the scheduled run is in flight, a
-- retried HTTP request — all of them resolve to one row and one email, because
-- the second insert collides rather than because the code was careful.
--
-- WHAT A ROW MEANS: this rung, for this invoice, is CONSUMED and will never be
-- attempted again. All three outcomes consume it, and that is the design:
--   'sent'    — handed to the mail service and an id came back.
--   'failed'  — attempted and refused (a 403 "domain is not verified" is a
--               failed row, never a pretend send), or the mail service stopped
--               answering, in which case the detail says the outcome is
--               genuinely unknown and the pilot must check before resending.
--               The rung is still consumed: a job that retries a failing send
--               daily is how a client gets forty copies of one chase.
--   'skipped' — deliberately not attempted, with the reason: 'superseded'
--               (a later rung came due in the same run and only the most
--               advanced one is ever sent) or 'stale' (a before-due or
--               on-due rung whose moment has passed — a "due in three days"
--               note must never arrive three weeks late).
--
-- WHAT NEVER WRITES A ROW: a run that cannot even attempt a send — the mail
-- service unconfigured, the client with no address on file, a quiet period
-- after a manual chase, a link the client opened yesterday. Those are
-- conditions, not events: they are true again tomorrow, they are DERIVED and
-- shown on the invoice screen from live data (the same "overdue is derived,
-- never stored" rule this schema has held since Phase 5), and consuming a rung
-- for one of them would mean fixing a missing email address silently costs the
-- pilot that rung forever.
--
-- MANUAL SENDS ARE IN THIS TABLE TOO, under rule_key 'manual', and are the one
-- kind that repeats — hence a partial unique INDEX rather than a table
-- constraint. They are here because the scheduler has to know a human already
-- chased this invoice on Tuesday; without that, the product's own manual
-- button and its scheduler chase the same client twice in a week.
-- ---------------------------------------------------------------------------
create table if not exists pilot.invoice_reminder_sends (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,
  invoice_id uuid not null,
  -- Composite FK, the house "pattern 1" idiom: tenant A can never attach a
  -- ledger row to tenant B's invoice. CASCADE for the same reason
  -- recurring_invoice_generations chose it — there is no authenticated DELETE
  -- grant on pilot.invoices at all, so this fires only if a service_role
  -- cleanup removes an invoice, and a ledger row about a row that no longer
  -- exists records nothing.
  foreign key (account_id, invoice_id)
    references pilot.invoices (account_id, id) on delete cascade,

  -- Which rung: 'before_3' / 'before_7' / 'before_14' / 'on_due' /
  -- 'after_3' / 'after_7' / 'after_14' / 'after_30', or 'manual'.
  --
  -- The CHECK is a SHAPE check, not the offered set. lib/reminders/policy.ts
  -- owns which rungs a pilot may choose, and the clients CHECKs above already
  -- bound that; pinning the same list a third time here would mean a fourth
  -- rung is three migrations instead of one, and a historical row would fail a
  -- CHECK the day the set narrowed. Bounded at three digits so it stays a rung
  -- key and not free text.
  rule_key text not null
    check (rule_key ~ '^(before_[0-9]{1,3}|on_due|after_[0-9]{1,3}|manual)$'),

  outcome text not null check (outcome in ('sent', 'failed', 'skipped')),

  -- The mail service's own words on a failure, or the skip reason. Never
  -- shown to a client; shown to the pilot verbatim, because "The domain is not
  -- verified" is the difference between a five-minute DNS fix and an afternoon
  -- of guessing (lib/email/send.ts's own note on the same string).
  detail text,

  -- Resend's message id. The ONLY evidence this product accepts that a send
  -- happened — lib/email/send.ts refuses to call a 2xx with no id successful,
  -- and the CHECK below carries that same contract into storage so no row can
  -- claim 'sent' without it, and no row can claim 'sent' while also carrying a
  -- failure detail.
  provider_message_id text,
  check (
    (outcome = 'sent') = (provider_message_id is not null)
    and (outcome = 'sent' or detail is not null)
  ),

  created_at timestamptz not null default now(),

  unique (account_id, id)
);

comment on table pilot.invoice_reminder_sends is
  'Every reminder this product has attempted for an invoice, scheduled or manual, with its TRUE outcome — a refused send is stored as failed, never as sent. A row means the rung is CONSUMED and will not be attempted again; the partial unique index invoice_reminder_sends_rung_once is what makes that a guarantee rather than an intention (recurring_invoice_generations'' rule: the app checks first for a friendly message, the constraint is the guard). Conditions that merely prevent an attempt today — no mail service, no client address, a recent manual chase — write NOTHING and are derived on screen instead. rule_key ''manual'' is the one repeatable kind: it is how the scheduler knows a human already chased this invoice.';

comment on column pilot.invoice_reminder_sends.provider_message_id is
  'Resend''s returned id. Present exactly when outcome = ''sent'', by CHECK — the storage-level twin of lib/email/send.ts''s refusal to treat an unconfirmed 2xx as a send.';

-- THE GUARD. One attempt per (invoice, rung), ever — except 'manual', which a
-- pilot may press as often as they like and which is a log, not a ladder.
-- A partial unique INDEX rather than a table constraint because a constraint
-- cannot carry a WHERE clause.
create unique index if not exists invoice_reminder_sends_rung_once
  on pilot.invoice_reminder_sends (account_id, invoice_id, rule_key)
  where rule_key <> 'manual';

-- The scheduler's own read: "what has this invoice already had?", newest
-- first, and the quiet-period lookup across an account.
create index if not exists invoice_reminder_sends_invoice_idx
  on pilot.invoice_reminder_sends (account_id, invoice_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 5. pilot.invoice_late_fees — the idempotency ledger for fee invoices.
--
-- ***************************************************************************
-- WHY A SEPARATE INVOICE, AND NOT A LINE ON THE OVERDUE ONE.
--
-- The obvious implementation is a late_fee line appended to the invoice that
-- is late. The schema refuses it, in two independent places, and both refusals
-- are correct:
--
--   * invoice_lines_protect_issued (20260805090000, line ~752) requires
--     status='draft' to INSERT a line. An overdue invoice is by definition not
--     a draft. There is no tenant path to that write at all.
--   * The service_role exemption on that trigger COULD do it, and must not.
--     It exists for webhook/payment reconciliation. Using it here would change
--     invoice_totals.balance_due_cents on a document that has already been
--     numbered, PDF'd, emailed, published to a share link and priced into a
--     Stripe payment link — so the client's copy, the share page, the payment
--     link amount (guarded by invoices_payment_link_amount) and the pilot's
--     record would all disagree about what is owed, with nobody positioned to
--     notice. That is the exact class of defect this schema's totals design
--     exists to prevent.
--
-- So a fee is its OWN invoice: a new draft, for the same client, with one line
-- naming the overdue invoice it relates to. That satisfies both rules the
-- product already holds — invoices_force_draft_on_insert means it is born a
-- draft, and docs/PLAN.md's "reviewed and sent by the pilot — never sent
-- silently" means it stays one until a human reads it. NOTHING in this feature
-- ever issues a fee invoice on its own.
--
-- LINE TYPE: the fee line is written as line_type 'other', NOT a new
-- 'late_fee' value, and this is a deliberate decision rather than an
-- oversight. Widening the invoice_lines CHECK is genuinely one line — but
-- pilot.ledger_sync (20260812100000) posts invoice income through an INNER
-- JOIN on `accounts_chart.system_key = 'income_' || line_type`, and journal
-- entries are balance-enforced by a deferred constraint trigger. A line_type
-- with no seeded chart account would therefore be dropped from the credit
-- side and the entry would raise 'unbalanced' — for every account that ever
-- issued a fee. Doing it properly means seeding income_late_fee for every
-- tenant (a seeder, a trigger and a backfill), widening the estimates
-- line_type CHECK that mirrors this one, and updating three app-side label
-- maps. That is a coherent change and it is not this migration's; 'other'
-- posts to "Other income" today with zero risk, and pilot.invoice_late_fees
-- below is what identifies a fee invoice as a fee invoice regardless of which
-- income bucket it lands in. A future engineer promoting it: seed the chart
-- account FIRST, in its own migration, then widen the CHECK.
-- ***************************************************************************
--
-- IDEMPOTENCY, exactly as recurring_invoice_generations does it: at most one
-- fee per (overdue invoice, period), ever, enforced by a unique constraint.
-- period_start is the first of a calendar month, with the same CHECK that
-- table and guarantee_periods use, so a monthly-accruing fee cannot be billed
-- twice for August because two tabs were open.
--
-- WHAT THAT KEY DOES NOT COVER, stated plainly because the app leans on it.
-- period_start is the month the fee is RAISED IN, not the accrual it covers,
-- so two racing raises land on different keys if — and only if — they straddle
-- a UTC month boundary (23:59 on the 31st and 00:00 on the 1st). Both inserts
-- then succeed and the same accrual is billed twice. The window is seconds
-- wide, twelve times a year, and both documents are DRAFTS a human has to read
-- before a client sees either, which is why this is documented rather than
-- redesigned; keying to the accrual billed (months_billed_through per source
-- invoice) is the change that would close it. A FLAT fee has no such gap: the
-- partial unique index below makes "once, ever" a guarantee at any hour.
-- ---------------------------------------------------------------------------
create table if not exists pilot.invoice_late_fees (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references pilot.accounts(id) on delete cascade,

  -- The invoice that was late. RESTRICT rather than CASCADE: the fee invoice
  -- is a real document the client may already hold, and losing the record of
  -- what it was FOR would leave an unexplained bill in the pilot's books.
  -- (This schema voids rather than deletes invoices, so this is a boundary,
  -- not a workflow.)
  source_invoice_id uuid not null,
  foreign key (account_id, source_invoice_id)
    references pilot.invoices (account_id, id) on delete restrict,

  -- The fee invoice itself. CASCADE, matching recurring_invoice_generations'
  -- reasoning: if a service-role cleanup ever removes the fee invoice, the
  -- period becomes available again rather than permanently spent with nothing
  -- to show for it.
  fee_invoice_id uuid not null,
  foreign key (account_id, fee_invoice_id)
    references pilot.invoices (account_id, id) on delete cascade,

  -- Which accrual period this fee covers, canonically the first of its
  -- calendar month — same shape and same CHECK as guarantee_periods.
  -- period_month and recurring_invoice_generations.period_start, for the same
  -- reason: period arithmetic in this product is CALENDAR arithmetic, never a
  -- 30-day count. A flat fee (which does not accrue) uses the month it was
  -- created in, so "one flat fee per month at most" falls out of the same
  -- constraint without a second code path.
  period_start date not null,
  check (period_start = date_trunc('month', period_start)::date),

  -- Snapshotted, never re-derived. The client's late_fee_* columns are
  -- editable and a later change must not restate a fee already billed — the
  -- same principle as trip_days.rate_cents and
  -- recurring_invoice_schedules.amount_cents.
  amount_cents bigint not null check (amount_cents > 0),
  basis text not null check (basis in ('flat', 'bps_per_month')),
  -- What the rate WAS, for a bps fee, and how many complete months had
  -- accrued. Null for a flat fee. Recorded so the line's own arithmetic can be
  -- re-read years later without reconstructing the client's settings history.
  basis_bps integer check (basis_bps is null or (basis_bps > 0 and basis_bps <= 500)),
  months_accrued integer check (months_accrued is null or months_accrued > 0),
  check ((basis = 'bps_per_month') = (basis_bps is not null)),
  check ((basis = 'bps_per_month') = (months_accrued is not null)),

  created_at timestamptz not null default now(),

  unique (account_id, id),
  -- THE constraint. One fee per overdue invoice per period, ever.
  unique (account_id, source_invoice_id, period_start)
);

comment on table pilot.invoice_late_fees is
  'Proof that a late fee has already been drafted for a given overdue invoice and accrual period, and the snapshot of how it was computed. The unique (account_id, source_invoice_id, period_start) constraint is what makes a double fee for one accrual month impossible rather than unlikely (with one documented gap: two raises straddling a UTC month boundary key differently — see this migration''s section 5 header), and invoice_late_fees_flat_once makes a flat fee once-ever without that caveat — recurring_invoice_generations'' pattern, for the same race (two tabs, a double-click). A fee is always a SEPARATE DRAFT invoice: the overdue document is immutable by invoice_lines_protect_issued, and rewriting it through the service_role exemption would put the client''s copy, the share page and the Stripe link amount out of step with the pilot''s record. Nothing here is ever sent automatically.';

create index if not exists invoice_late_fees_source_idx
  on pilot.invoice_late_fees (account_id, source_invoice_id, period_start);

-- A FLAT FEE IS ONCE, EVER — and unlike the accruing kind, that is an absolute
-- statement the schema can hold absolutely. The composite key above is scoped
-- to a month and so cannot span a month boundary; this one is scoped to the
-- invoice, so a second flat fee for the same overdue invoice is refused no
-- matter when it is attempted. lib/reminders/policy.ts refuses it first for a
-- readable message; this is what makes it true rather than intended.
create unique index if not exists invoice_late_fees_flat_once
  on pilot.invoice_late_fees (account_id, source_invoice_id)
  where basis = 'flat';


-- ---------------------------------------------------------------------------
-- 6. pilot.accounts.reminders_last_run_at — the run watermark.
--
-- Answers reason 1 of the recurring-invoices refusal ("a job silently not
-- firing for a week is invisible"): the Settings panel renders this, so
-- "nothing has run since Tuesday" is a fact on screen rather than something
-- discovered when a client complains.
--
-- WHO MAY WRITE IT: the scheduled run's service-role client and the pilot's
-- own "run now" press. Following 20260812310000's precedent for
-- last_billing_event_at EXACTLY, with one deliberate difference:
--   * that column is billing state, so it was added to
--     accounts_protect_billing_columns. This one is NOT billing state, and
--     adding it there would make the trigger raise "billing/entitlement
--     columns can only be changed by service_role" about an operational
--     timestamp — a misleading message for a future reader, and a lie about
--     what the trigger protects.
--   * it IS granted to authenticated (unlike the watermark), because the
--     manual run is a legitimate tenant action performed by the pilot's own
--     session, and the accounts_update policy already restricts writes to
--     is_account_owner(id).
-- ---------------------------------------------------------------------------
alter table pilot.accounts
  add column if not exists reminders_last_run_at timestamptz;

comment on column pilot.accounts.reminders_last_run_at is
  'When the due-reminder pass last completed for this account, scheduled or run by hand. NULL means it has never run. Purely operational — not billing state, deliberately NOT in accounts_protect_billing_columns (which would misdescribe it), and shown in Settings so a scheduler that has quietly stopped firing is visible rather than discovered from a client.';

grant update (reminders_last_run_at) on pilot.accounts to authenticated;


-- ---------------------------------------------------------------------------
-- 7. RLS — enabled here, in these tables' own first migration, per house rule.
--    No admin-bypass policy anywhere.
--
--    Written directly by `authenticated` at the same trust level as
--    invoice_lines and recurring_invoice_generations: the app runs as the
--    caller's own session and only ever writes its own account_id. The unique
--    index is what prevents a double send; RLS only keeps one tenant out of
--    another's ledger.
-- ---------------------------------------------------------------------------
alter table pilot.invoice_reminder_sends enable row level security;
alter table pilot.invoice_late_fees       enable row level security;

create policy invoice_reminder_sends_select on pilot.invoice_reminder_sends
  for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy invoice_reminder_sends_insert on pilot.invoice_reminder_sends
  for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
-- No UPDATE and no DELETE policy. A send record is a statement about
-- something that already happened to somebody else's inbox; there is no
-- honest edit of one, and a pilot deleting a row to "free up" a rung and
-- re-send is precisely the double-chase this table exists to prevent.
-- (recurring_invoice_generations takes the identical position.)

create policy invoice_late_fees_select on pilot.invoice_late_fees
  for select to authenticated
  using (account_id in (select pilot.current_account_ids()));
create policy invoice_late_fees_insert on pilot.invoice_late_fees
  for insert to authenticated
  with check (account_id in (select pilot.current_account_ids()));
-- Same reasoning: the row records that a fee invoice was drafted for a
-- period. Removing it would let the same period be billed twice, which is the
-- one thing the unique constraint above exists to stop.


-- ---------------------------------------------------------------------------
-- 8. GRANTS — column-scoped, additive, never preceded by a same-table revoke
--    (this directory's README: `revoke insert ... from <role>` drops every
--    column privilege at once).
--
--    id / created_at withheld everywhere: a client never chooses its own
--    primary key (scripts/tenancy-verify.mjs's stated rule) and never stamps
--    its own audit time. account_id IS granted on insert — RLS's WITH CHECK
--    constrains its VALUE; withholding the column would make insert
--    impossible rather than safe.
--
--    A bare INSERT grant on a table with a UNIQUE constraint is an existence
--    oracle (20260805090000's CRITICAL-2), which is a second reason both of
--    these are column-scoped rather than table-wide.
-- ---------------------------------------------------------------------------
grant select on pilot.invoice_reminder_sends to authenticated;
grant insert (account_id, invoice_id, rule_key, outcome, detail, provider_message_id)
  on pilot.invoice_reminder_sends to authenticated;

grant select on pilot.invoice_late_fees to authenticated;
grant insert (account_id, source_invoice_id, fee_invoice_id, period_start,
              amount_cents, basis, basis_bps, months_accrued)
  on pilot.invoice_late_fees to authenticated;

grant select, insert, update, delete
  on pilot.invoice_reminder_sends, pilot.invoice_late_fees
  to service_role;
