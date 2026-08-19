-- ============================================================================
-- pilot.generate_autopay_invoice — the service-role door into recurring
-- generation, so autopay can finally run without the pilot present.
--
-- ── WHY THIS EXISTS ───────────────────────────────────────────────────────
--
-- "Autopay" has never been automatic. The whole chain — compute due periods,
-- generate the draft, issue it, charge the saved card — has only ever fired
-- when the pilot is signed in and clicks "Create all due" in the recurring
-- due-queue. A pilot who enables autopay and then flies for two weeks
-- collects nothing in that window, and nothing tells them so. For the
-- persona this product is built for — someone who may be unreachable for
-- days at a time — that is the opposite of what the feature name promises.
--
-- The blocker was never the TypeScript. It is that the ONLY atomic write
-- path, pilot.generate_recurring_invoice (20260809050000), is unreachable
-- from a scheduled pass by construction:
--
--   * it authorizes with `account_id in (select pilot.current_account_ids())`,
--     and current_account_ids() resolves through auth.uid(). Outside a
--     PostgREST request carrying a user JWT there is no auth.uid(), so that
--     predicate matches zero rows for every account — the function does not
--     fail loudly, it simply reports "recurring schedule not found or not
--     yours" for everything;
--   * and it is granted EXECUTE to `authenticated` only. A service-role
--     caller is refused before the body runs at all.
--
-- Neither is a defect. That function was written for an interactive caller
-- and is correct for one. What was missing is a sibling for the unattended
-- caller, which is what this is — the same shape as pilot.expire_hold
-- (20260818200000): explicit account parameter instead of auth.uid(),
-- revoked from public and authenticated, granted to service_role, and
-- re-deriving every precondition from the row rather than trusting the
-- job's WHERE clause.
--
-- ── WHY IT RE-DERIVES INSTEAD OF TRUSTING THE CALLER ──────────────────────
--
-- This is the only path in the product that can create and (via the caller's
-- follow-on Stripe call) charge an invoice with no human confirming it that
-- day. expire_hold's reasoning applies with full force here: the job's
-- SELECT must not be the only thing standing between a client and a charge
-- they did not expect. So the guards below are deliberately redundant with
-- the caller's own filtering, and each one refuses rather than warns:
--
--   1. THE SCHEDULE MUST BELONG TO target_account. The account is a
--      parameter, never derived from the schedule — so a caller that pairs
--      the wrong account with a schedule id gets a refusal, not a
--      cross-tenant write. This is the check that replaces RLS, which
--      SECURITY DEFINER does not get for free.
--   2. THE SCHEDULE MUST BE ACTIVE — same as the interactive sibling.
--   3. THE SCHEDULE MUST HAVE autopay = true. THE LOAD-BEARING ONE. A
--      recurring schedule without autopay keeps its existing behavior
--      exactly: it waits for the pilot's click. Because this function
--      refuses them outright, no bug in the scheduled pass — a dropped
--      WHERE clause, an inverted boolean — can start silently auto-issuing
--      invoices for schedules nobody opted into automating. The narrowing
--      is enforced here, in the one place that cannot be bypassed, which is
--      also why the function is named for autopay rather than for the
--      service role that calls it.
--   4. THE CLIENT MUST ACTUALLY BE ENROLLED (autopay_consented_at is not
--      null — the consent timestamp; see clients_autopay_consistent in
--      20260817160000, which moves all five autopay_* columns together).
--      Without this an unattended pass could generate and issue an invoice
--      for a client with no saved method, leaving an issued invoice that
--      silently never gets charged — worse than not generating it.
--   5. THE PERIOD MUST NOT BE IN THE FUTURE. Cheap, and it bounds the blast
--      radius of a calendar bug in the caller's due-period math to "missed
--      a period" (recoverable, the pilot clicks the button) instead of
--      "billed a client eleven months ahead" (a refund and an apology).
--
-- livemode is deliberately NOT checked here. pilot.clients.autopay_livemode
-- records which Stripe mode the consent was captured in, and only the
-- caller knows which mode it is currently running against; comparing them
-- is the caller's job, at the point it builds the charge.
--
-- ── WHAT DOES NOT CHANGE ──────────────────────────────────────────────────
--
-- IDEMPOTENCY. This is the property that matters most for an unattended
-- charger, and it is inherited unchanged rather than reinvented: the three
-- inserts are the effects of ONE top-level statement, and the last of them
-- takes the unique (account_id, schedule_id, period_start) on
-- pilot.recurring_invoice_generations. A second caller for the same
-- (schedule, period) — a cron retry, two overlapping passes, or the pass
-- racing the pilot's own click on the interactive path, which writes the
-- same ledger — raises 23505 and rolls back the invoice and line it just
-- inserted along with it. Nothing is left behind, and the period cannot be
-- generated twice. That constraint is what makes double-generation
-- impossible rather than unlikely (20260809030000's own header), and it is
-- shared by both doors on purpose: the interactive and unattended paths
-- contend on the same row, so they cannot double-bill each other either.
--
-- The invoice is still a DRAFT when this returns, exactly as the
-- interactive sibling leaves it. Issuing and charging remain the caller's
-- follow-on work, unchanged — this function widens who may generate, not
-- what generation does.
-- ============================================================================

create or replace function pilot.generate_autopay_invoice(
  target_account uuid,
  p_schedule_id uuid,
  p_period_start date
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule pilot.recurring_invoice_schedules%rowtype;
  v_consented timestamptz;
  v_invoice_id uuid;
begin
  -- GUARD 1 — tenancy. account_id is matched against the caller-supplied
  -- target_account, never read out of the schedule and trusted. Same
  -- deliberately-indistinct message as the interactive sibling: a caller
  -- must not be able to tell "no such schedule" from "not this account's"
  -- and probe for real ids.
  select * into v_schedule
    from pilot.recurring_invoice_schedules
   where id = p_schedule_id
     and account_id = target_account;

  if not found then
    raise exception 'generate_autopay_invoice: recurring schedule not found or not this account''s'
      using errcode = 'P0002';
  end if;

  -- GUARD 2 — paused schedules generate nothing, attended or not.
  if not v_schedule.active then
    raise exception 'generate_autopay_invoice: recurring schedule % is paused', p_schedule_id
      using errcode = 'P0001';
  end if;

  -- GUARD 3 — autopay-only. See the header: this is what keeps an
  -- unattended pass from ever touching a schedule the pilot did not
  -- explicitly opt into automating.
  if not v_schedule.autopay then
    raise exception 'generate_autopay_invoice: recurring schedule % does not have autopay enabled', p_schedule_id
      using errcode = 'P0001';
  end if;

  -- GUARD 4 — the client's consent record must be present. Reading only
  -- autopay_consented_at is sufficient: clients_autopay_consistent
  -- (20260817160000) makes all five autopay_* columns null or non-null
  -- together, so a non-null consent timestamp means the saved customer and
  -- payment method are there too.
  select autopay_consented_at into v_consented
    from pilot.clients
   where id = v_schedule.client_id
     and account_id = target_account;

  if v_consented is null then
    raise exception 'generate_autopay_invoice: client % is not enrolled in autopay', v_schedule.client_id
      using errcode = 'P0001';
  end if;

  -- GUARD 5 — never generate a period that has not started.
  if p_period_start > current_date then
    raise exception 'generate_autopay_invoice: period % is in the future', p_period_start
      using errcode = 'P0001';
  end if;

  -- The same three writes as pilot.generate_recurring_invoice, in the same
  -- order, for the same reason: they are the effects of one statement, so
  -- the ledger's unique violation below rolls the invoice and line back
  -- with it. account_id is always v_schedule.account_id — which guard 1
  -- has already proven equals target_account.
  insert into pilot.invoices (account_id, client_id, tax_rate_bps)
    values (v_schedule.account_id, v_schedule.client_id, v_schedule.tax_rate_bps)
    returning id into v_invoice_id;

  insert into pilot.invoice_lines
    (account_id, invoice_id, line_type, description, quantity, unit_amount_cents, taxable)
    values
    (v_schedule.account_id, v_invoice_id, 'other', v_schedule.description, 1,
     v_schedule.amount_cents, true);

  -- THE reservation, and the double-charge guard. Contended with the
  -- interactive path on purpose — both doors take this same row.
  insert into pilot.recurring_invoice_generations
    (account_id, schedule_id, period_start, invoice_id)
    values
    (v_schedule.account_id, p_schedule_id, p_period_start, v_invoice_id);

  return v_invoice_id;
end;
$$;

comment on function pilot.generate_autopay_invoice(uuid, uuid, date) is
  'Unattended sibling of pilot.generate_recurring_invoice, for the scheduled pass: same three atomic writes (invoice, line, generations ledger) and the same unique-constraint idempotency, but authorized by an explicit target_account instead of auth.uid() so a service-role caller with no session can reach it. Re-derives five preconditions from the rows rather than trusting the job''s WHERE clause — schedule belongs to target_account, schedule is active, schedule has autopay = true, the client''s autopay consent record exists, and the period has already started. Refuses anything else. Does NOT check livemode (the caller knows its Stripe mode) and does NOT issue or charge — it returns a DRAFT, exactly as the interactive sibling does. Granted to service_role only; see 20260819100000 for why the interactive function could not simply be reused.';

revoke all on function pilot.generate_autopay_invoice(uuid, uuid, date) from public;
revoke all on function pilot.generate_autopay_invoice(uuid, uuid, date) from authenticated;
grant execute on function pilot.generate_autopay_invoice(uuid, uuid, date) to service_role;

-- The schedules table's own comment has asserted since 20260809030000 that
-- it is "Inert data only — nothing reads this table except the
-- recurring-invoices page computing what is due; there is no background
-- job." The function above is the background job's door, so that sentence
-- stops being true the moment the scheduled pass starts calling it.
-- Correcting it here rather than letting it rot: a stale comment that
-- describes a security-relevant property ("nothing else reads this") is
-- exactly the kind of drift that makes the next reader trust the wrong
-- thing.
comment on table pilot.recurring_invoice_schedules is
  'A standing cadence a pilot bills a client on (fixed description + amount, monthly or quarterly). Read by the recurring-invoices page computing what is due, and — for rows with autopay = true only — by the scheduled pass, through pilot.generate_autopay_invoice (20260819100000). Generation is recorded in pilot.recurring_invoice_generations, whose unique constraint is what makes a (schedule, period) pair unrepeatable for both callers. Does not (yet) bill a monthly guarantee via guarantee_periods — see this table''s amount_cents comment for why that was judged unsafe to build in this pass.';
