-- ===========================================================================
-- Estimates: a draft with no lines cannot be sent
--
-- WHY. pilot.invoices has refused to issue an empty document since Phase 5
-- (invoices_protect_issued: "An invoice with no line items has nothing to
-- bill and nothing to draft a PDF from — catch it at the one moment it
-- matters (leaving draft) rather than downstream"), but Phase 10 never
-- carried that rule over to estimates. The UI disables its send button
-- while a draft has no lines, which is a courtesy, not an enforcement: two
-- tabs on the same draft can race — one deletes the last line while the
-- other sends — and the database happily mints a numbered, sent estimate
-- totalling $0.00. A quote is the first document a client sees from this
-- pilot; an empty one with a permanent number in the account's sequence is
-- exactly the "quietly did something other than what was asked" failure
-- this schema family exists to avoid.
--
-- SHAPE. Mirrors the invoice guard's check verbatim — a NOT EXISTS against
-- the lines table on precisely the draft -> sent transition, raised as a
-- plain P0001 the app maps to a sentence (estimateRefusalMessage). It is
-- its own trigger rather than an edit to pilot.estimates_protect so this
-- migration stays purely additive.
--
-- Draft -> sent ONLY, matching the invoice guard's scope: that is the
-- transition that mints the number ("a race mints a numbered, sent
-- estimate with zero lines" is the defect). declined -> sent re-activates
-- a quote that already has its number and that the client has already
-- seen; the app's own draft-only line editing means its lines cannot have
-- been emptied through this product's screens.
--
-- FIRING ORDER. BEFORE UPDATE triggers run alphabetically, so
-- estimates_assign_number_on_issue has already called
-- pilot.next_estimate_number() by the time this raises. No number is
-- burned: the raise aborts the whole statement, and the sequence increment
-- rolls back with it — the same fact the Phase 5 file records for the
-- identical ordering of invoices_assign_number_on_issue and
-- invoices_protect_issued (its LOW 15 note).
--
-- Additive only. All fixtures synthetic; no live pilot data.
-- ===========================================================================

create or replace function pilot.estimates_require_lines_on_send()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Same dual service_role check as every guard in this schema family —
  -- current_setting('role', true) for PostgREST's SET ROLE over a pooled
  -- connection, current_user for a direct service_role session (see
  -- invoices_protect_issued's third-pass note in the Phase 5 migration).
  if current_user = 'service_role' or current_setting('role', true) = 'service_role' then
    return new;
  end if;

  if old.status = 'draft' and new.status = 'sent' then
    -- An estimate with no line items quotes nothing — refuse it at the one
    -- moment it matters (leaving draft), exactly as invoices_protect_issued
    -- does for an invoice. The raw uuid in the message never reaches the
    -- pilot: estimateRefusalMessage rewords it.
    if not exists (
      select 1 from pilot.estimate_lines
       where account_id = new.account_id and estimate_id = new.id
    ) then
      raise exception 'estimate % cannot be sent with no line items', new.id;
    end if;
  end if;

  return new;
end;
$$;

comment on function pilot.estimates_require_lines_on_send() is
  'Refuses draft -> sent for an estimate with zero lines, mirroring invoices_protect_issued''s empty-document check. P0001; the app maps the message to a sentence.';

drop trigger if exists estimates_require_lines_on_send on pilot.estimates;
create trigger estimates_require_lines_on_send
  before update on pilot.estimates
  for each row execute function pilot.estimates_require_lines_on_send();
