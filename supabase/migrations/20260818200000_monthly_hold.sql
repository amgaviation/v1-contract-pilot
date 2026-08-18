-- ============================================================================
-- THE MONTHLY HOLD — pause billing for up to two months
--
-- The columns landed with 20260818090000 (hold_started_at, hold_ends_at,
-- retention_paid_until) and the two-month ceiling is already a CHECK there.
-- This migration adds the three state transitions and nothing else.
--
--   place_hold      an eligible owner starts a hold.
--   resume_from_hold  they come back early, or the hold runs its course and
--                   they pay again.
--   expire_hold     the hold ran out and was not paid for: the account's
--                   COMMERCIAL records go, the AIRMAN records stay.
--
-- ── WHAT A HOLD IS, MECHANICALLY ─────────────────────────────────────────
--
-- Stripe stops collecting; this product stops accepting writes. Those are
-- two separate facts and BOTH are needed, which is the part worth being
-- precise about because the obvious reading of the Stripe API is wrong.
--
-- The pinned SDK (22.5.0) has subscriptions.resume() but NO
-- subscriptions.pause(): `status = 'paused'` is not something a caller can
-- ask for, it arises from trial settings. The available mechanism is
-- `pause_collection`, and pause_collection deliberately leaves the
-- subscription ACTIVE and the customer's access INTACT — it is designed for
-- "keep serving them, stop charging them", which is the opposite of a hold.
--
-- So Stripe alone cannot express this. hold_started_at is the local half,
-- and lib/entitlements.ts's accountIsReadOnly() reads it directly — exactly
-- the same shape as deactivated_at (20260818140000), and for the same
-- underlying reason: `status` belongs to the webhook and will keep saying
-- 'active' throughout a hold.
--
-- ── WHY EXPIRY IS A FUNCTION AND NOT A DELETE IN THE JOB ─────────────────
--
-- expire_hold below is the ONLY thing the scheduled pass is allowed to call,
-- and it takes one account id and no filter. The job's job is to decide
-- WHICH accounts are due; what happens to one is defined here, next to the
-- purge it delegates to, where the airman-record guarantee is already
-- asserted by scripts/account-lifecycle-db-verify.mjs. A scheduled pass that
-- carried its own DELETE statements would be a second place that could get
-- the retain list wrong, and the one place it is written down is the whole
-- design of 20260818090000.
--
-- expire_hold REFUSES to run on an account that is not actually due. That is
-- not defensive decoration: the caller is a cron job with a service-role
-- client and a WHERE clause, and a wrong WHERE clause is the realistic way
-- this product destroys a paying customer's records. The function re-derives
-- due-ness from the row itself, so the job cannot talk it into purging an
-- account that is on a live hold, has paid for retention, or was never on
-- hold at all.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SPLITTING THE PURGE — the owner check and the deletes are different jobs.
--
-- 20260818090000 put pilot.assert_account_owner INSIDE purge_business_data,
-- which is right for the path it was written for (a pilot clearing their own
-- account) and fatal for this one. expire_hold runs from a scheduled pass
-- with NO session: auth.uid() is null, the owner check refuses, and the
-- purge could never have happened. It was never going to work in production,
-- and the db verify script caught it on the first run that reached it.
--
-- The fix is to separate the two responsibilities rather than to weaken
-- either:
--
--   purge_business_data_rows   the deletes, no authorization of its own.
--                              Granted to NOBODY. Callable only from another
--                              SECURITY DEFINER function in this schema,
--                              each of which has already established the
--                              right to call it.
--   purge_business_data        owner check, then the rows. Still what a
--                              pilot's own session calls. Unchanged from the
--                              caller's point of view.
--   expire_hold                due-ness check, then the rows.
--
-- The retain/purge split — commercial records go, airman records never — now
-- lives in purge_business_data_rows, and scripts/account-lifecycle-verify.mjs
-- reads its delete list from there. That list is still written in exactly one
-- place; it just moved one function inward.
-- ----------------------------------------------------------------------------

create or replace function pilot.purge_business_data_rows(target_account uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from pilot.journal_lines   where account_id = target_account;
  delete from pilot.journal_entries where account_id = target_account;
  delete from pilot.accounts_chart  where account_id = target_account;

  delete from pilot.bank_statement_matches where account_id = target_account;
  delete from pilot.bank_transactions      where account_id = target_account;
  delete from pilot.bank_import_batches    where account_id = target_account;
  delete from pilot.bank_source_files      where account_id = target_account;
  delete from pilot.bank_accounts          where account_id = target_account;

  delete from pilot.invoice_reminder_sends where account_id = target_account;
  delete from pilot.invoice_late_fees      where account_id = target_account;
  delete from pilot.invoice_shares         where account_id = target_account;
  delete from pilot.invoice_payments       where account_id = target_account;
  delete from pilot.invoice_lines          where account_id = target_account;
  delete from pilot.invoices               where account_id = target_account;

  delete from pilot.estimate_shares where account_id = target_account;
  delete from pilot.estimate_lines  where account_id = target_account;
  delete from pilot.estimates       where account_id = target_account;

  delete from pilot.recurring_invoice_generations where account_id = target_account;
  delete from pilot.recurring_invoice_schedules   where account_id = target_account;

  delete from pilot.mileage_entries where account_id = target_account;
  delete from pilot.expenses        where account_id = target_account;

  delete from pilot.guarantee_periods where account_id = target_account;
  delete from pilot.trip_legs         where account_id = target_account;
  delete from pilot.trip_days         where account_id = target_account;
  delete from pilot.trips             where account_id = target_account;

  delete from pilot.client_vendor_links where account_id = target_account;
  delete from pilot.client_tax_forms    where account_id = target_account;
  delete from pilot.client_rates        where account_id = target_account;
  delete from pilot.clients             where account_id = target_account;

  delete from pilot.stripe_connect_events where account_id = target_account;

  update pilot.accounts
     set business_data_purged_at = now()
   where id = target_account;
end;
$$;

comment on function pilot.purge_business_data_rows(uuid) is
  'The deletes, with NO authorization of its own — every caller must have '
  'established the right first. Granted to nobody. Deletes the COMMERCIAL '
  'records and deliberately spares the airman''s: logbook, aircraft, '
  'documents, operator qualifications, currency snapshots, and the invoice/ '
  'estimate number sequences. scripts/account-lifecycle-verify.mjs reads its '
  'delete list from this function.';

revoke all on function pilot.purge_business_data_rows(uuid) from public;
revoke all on function pilot.purge_business_data_rows(uuid) from authenticated;

-- The owner-facing wrapper keeps its name, its grant and its behaviour.
create or replace function pilot.purge_business_data(target_account uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pilot.assert_account_owner(target_account);
  perform pilot.purge_business_data_rows(target_account);
end;
$$;

revoke all on function pilot.purge_business_data(uuid) from public;
grant execute on function pilot.purge_business_data(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- pilot.place_hold — start a hold that ends at `ends_at`.
--
-- ELIGIBILITY THAT NEEDS STRIPE (has this account actually been billing for
-- two months?) is checked in the server action, because only Stripe knows
-- how many invoices were paid. What is checked HERE is everything derivable
-- from the row, so a bug in that action cannot produce an impossible state:
-- no double hold, no hold on a deactivated account, no hold that ends in the
-- past, and — via the CHECK from 20260818090000 — none longer than 62 days.
-- ----------------------------------------------------------------------------

create or replace function pilot.place_hold(target_account uuid, ends_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_hold timestamptz;
  deactivated  timestamptz;
begin
  perform pilot.assert_account_owner(target_account);

  select hold_started_at, deactivated_at
    into current_hold, deactivated
    from pilot.accounts
   where id = target_account;

  if deactivated is not null then
    raise exception 'This account is deactivated; reactivate it before placing a hold'
      using errcode = '22023';
  end if;

  if current_hold is not null then
    raise exception 'This account is already on hold'
      using errcode = '22023';
  end if;

  if ends_at <= now() then
    raise exception 'A hold must end in the future'
      using errcode = '22023';
  end if;

  update pilot.accounts
     set hold_started_at = now(),
         hold_ends_at    = ends_at
   where id = target_account;
end;
$$;

comment on function pilot.place_hold(uuid, timestamptz) is
  'Starts a monthly hold ending at ends_at. Refuses a second hold, a hold on '
  'a deactivated account, and a hold ending in the past; the 62-day ceiling '
  'is the CHECK from 20260818090000. Stripe-side eligibility (two months of '
  'paid invoices) is the server action''s to check — only Stripe knows it.';

revoke all on function pilot.place_hold(uuid, timestamptz) from public;
grant execute on function pilot.place_hold(uuid, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- pilot.resume_from_hold — end the hold, keep everything.
--
-- Deliberately does NOT check whether the hold has expired. A pilot coming
-- back on day 70, after the window closed but before the scheduled pass ran,
-- should be allowed back in — refusing them would be punishing them for the
-- job's cadence. If the pass already purged, the records are gone and this
-- still correctly restores writing.
-- ----------------------------------------------------------------------------

create or replace function pilot.resume_from_hold(target_account uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pilot.assert_account_owner(target_account);

  update pilot.accounts
     set hold_started_at = null,
         hold_ends_at    = null
   where id = target_account;
end;
$$;

comment on function pilot.resume_from_hold(uuid) is
  'Clears the hold. Destroys nothing, and deliberately does not care whether '
  'the window already closed — a pilot returning late is still returning.';

revoke all on function pilot.resume_from_hold(uuid) from public;
grant execute on function pilot.resume_from_hold(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- pilot.expire_hold — the destructive one.
--
-- Called ONLY by the scheduled pass, with the service-role client, one
-- account at a time. It re-derives due-ness from the row and refuses
-- otherwise, so the job's WHERE clause is not the only thing standing
-- between a paying customer and a purge.
--
-- DUE means all three: on hold, the window has closed, and retention is not
-- paid up. retention_paid_until in the future spares the records for as long
-- as it is paid — that is the whole product of the retention fee, and it is
-- checked here rather than in the job for the same reason as everything else
-- in this function.
-- ----------------------------------------------------------------------------

create or replace function pilot.expire_hold(target_account uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  started   timestamptz;
  ends      timestamptz;
  retained  timestamptz;
begin
  select hold_started_at, hold_ends_at, retention_paid_until
    into started, ends, retained
    from pilot.accounts
   where id = target_account;

  if started is null or ends is null then
    raise exception 'expire_hold: account % is not on hold', target_account
      using errcode = '22023';
  end if;

  if ends > now() then
    raise exception 'expire_hold: account % is on a hold that has not expired', target_account
      using errcode = '22023';
  end if;

  if retained is not null and retained > now() then
    raise exception 'expire_hold: account % has paid data retention through %',
      target_account, retained
      using errcode = '22023';
  end if;

  -- The commercial records go; the logbook, documents, aircraft, operator
  -- qualifications and currency snapshots do not. That split lives in
  -- purge_business_data and is asserted by the db verify script, so it is
  -- stated in exactly one place and proved in exactly one place.
  perform pilot.purge_business_data_rows(target_account);

  -- The hold is over either way. Clearing it is what stops a second pass
  -- from re-purging an account that has nothing left to purge.
  update pilot.accounts
     set hold_started_at = null,
         hold_ends_at    = null
   where id = target_account;
end;
$$;

comment on function pilot.expire_hold(uuid) is
  'Purges an expired, unpaid hold''s COMMERCIAL records and clears the hold. '
  'Never touches airman records (see pilot.purge_business_data). Re-derives '
  'due-ness from the row and refuses an account that is not on hold, whose '
  'hold has not expired, or whose retention is paid — so a wrong WHERE '
  'clause in the scheduled pass cannot destroy a live tenant''s data.';

-- NOT granted to `authenticated`. Unlike every other function in this
-- lifecycle, no pilot ever calls this: it is the scheduled pass acting on an
-- account whose owner has, by definition, stopped showing up. It therefore
-- also carries no assert_account_owner — there is no owner in the request to
-- assert. Its safety comes from the due-ness re-derivation above and from
-- the route that calls it, which refuses without CRON_SECRET.
revoke all on function pilot.expire_hold(uuid) from public;
revoke all on function pilot.expire_hold(uuid) from authenticated;
