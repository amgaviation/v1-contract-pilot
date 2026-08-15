-- ===========================================================================
-- A REMINDER THAT DEFINITELY DID NOT SEND MAY BE TRIED AGAIN. ONE THAT MAY
-- HAVE SENT MAY NOT.
--
-- ***************************************************************************
-- THE DEFECT THIS FIXES, IN ONE SENTENCE: 20260813130000 made every attempt
-- consume its rung, so a mail service that was down for an hour permanently
-- cost that client that step of the chase. The invoice sits there and the
-- product never mentions it again.
--
-- WHY THE OBVIOUS FIX IS WRONG, and why this migration adds a fourth outcome
-- rather than simply making 'failed' retryable. lib/email/send.ts returns a
-- failure for two situations that are not the same situation:
--
--   * a REFUSAL: a 4xx/5xx from Resend, a malformed address, a missing
--     configuration, a connection that never opened. Nothing was sent and the
--     code knows it. Trying again costs nothing.
--   * an INDETERMINATE result: the request went out and the response timed
--     out. The message may already be queued. Resend has no idempotency key
--     on that endpoint, which is exactly why that branch's error string says
--     "this may or may not have been sent".
--
-- Retrying the second kind puts a SECOND chase for one invoice in a pilot's
-- client's inbox. That is worse than the bug, so the two are stored as
-- different outcomes and only the first is retryable.
-- ***************************************************************************
--
-- ADDITIVE AND SAFE ON A LIVE DATABASE. No column is dropped, no grant is
-- narrowed, no policy is widened. The two objects that change are the outcome
-- vocabulary CHECK (widened, so nothing already stored can fail it) and the
-- partial unique index (rebuilt with one more term in its WHERE clause, which
-- only ever admits rows the old one refused). Existing rows are handled in
-- section 2 and the reasoning is written there.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. THE VOCABULARY: 'unknown' alongside 'sent' / 'failed' / 'skipped'.
--
-- After this migration the two words mean narrower things than they did:
--   'failed': DEFINITELY did not send. Retryable.
--   'unknown': MAY have sent. Never retried, by anything, ever.
--
-- The vocabulary CHECK in 20260813130000 was written inline on the column, so
-- Postgres named it invoice_reminder_sends_outcome_check. Rather than trust
-- that name, the block below finds the constraint by what it SAYS: it is the
-- only CHECK on this table whose definition mentions 'skipped' (the other one,
-- which ties provider_message_id and detail to the outcome, mentions 'sent'
-- and nothing else). A file in this directory may be offered for re-apply, so
-- this has to be safe to run twice, so it is guarded on 'unknown' already
-- being present.
--
-- The OTHER check is deliberately left exactly as it is:
--   (outcome = 'sent') = (provider_message_id is not null)
--   and (outcome = 'sent' or detail is not null)
-- It carries over to 'unknown' unchanged and correctly: an unknown row has no
-- provider id (none came back) and MUST carry a detail (the mail service's own
-- words are the only thing that tells the pilot what to check).
-- ---------------------------------------------------------------------------
do $$
declare
  target text;
begin
  for target in
    select conname
    from pg_constraint
    where conrelid = 'pilot.invoice_reminder_sends'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%skipped%'
      and pg_get_constraintdef(oid) not like '%unknown%'
  loop
    execute format(
      'alter table pilot.invoice_reminder_sends drop constraint %I', target
    );
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_reminder_sends_outcome_vocab'
      and conrelid = 'pilot.invoice_reminder_sends'::regclass
  ) then
    alter table pilot.invoice_reminder_sends
      add constraint invoice_reminder_sends_outcome_vocab
      check (outcome in ('sent', 'failed', 'unknown', 'skipped'));
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. EXISTING ROWS: every pre-existing 'failed' becomes 'unknown'.
--
-- ***************************************************************************
-- THIS IS THE CONSERVATIVE READING AND IT IS THE ONLY HONEST ONE.
--
-- Rows written before this migration predate the distinction entirely. A
-- 'failed' row from last week might record a 403 from an unverified domain
-- (nothing sent, safe to retry) or a ten-second timeout (the mail may be in a
-- client's inbox). The column does not say which, and the only other witness
-- is a free-text `detail` that is user-facing prose, not a machine field, and
-- would have to be pattern-matched to be believed.
--
-- So the migration refuses to guess. Every existing row is re-labelled with
-- the outcome that is actually true of it: this product does not know whether
-- that reminder was delivered. The consequence is that behaviour for existing
-- rows is UNCHANGED: those rungs stay consumed and are never retried, which
-- is precisely what they do today. Nothing that has already happened is
-- re-litigated, no client can receive a second copy of an old chase, and the
-- new retry path applies only to failures recorded from now on, by code that
-- knows which kind it is writing.
--
-- The alternative (leave them 'failed' and let them become retryable) would
-- take the one class of row whose kind is unknowable and treat all of it as
-- safe to re-send. That is the exact trade this whole design refuses.
--
-- 'skipped' and 'sent' rows are untouched: their meaning has not changed.
-- ***************************************************************************
update pilot.invoice_reminder_sends
  set outcome = 'unknown'
  where outcome = 'failed';


-- ---------------------------------------------------------------------------
-- 3. THE GUARD, REBUILT: 'failed' no longer consumes the rung, and nothing
--    else changes.
--
-- The index from 20260813130000 was:
--
--   unique (account_id, invoice_id, rule_key) where rule_key <> 'manual'
--
-- One term is added to the predicate. What that buys, and what it keeps:
--
--   * 'sent', 'unknown' and 'skipped' are all still IN the index, so each of
--     them still consumes the rung permanently. A rung that has been sent
--     cannot be sent again even if every line of application code above it is
--     wrong, which is the property this table was built for
--     (recurring_invoice_generations' rule: the app checks first for a
--     friendly message, the constraint is what makes it true).
--   * 'failed' rows drop OUT of the index, so a rung that definitely did not
--     send can be attempted again and the earlier failure stays on the table
--     as history rather than being deleted to make room. The pilot can see
--     every attempt and what the mail service said about each one.
--   * A RUNG THAT SUCCEEDS AFTER FAILING STILL CANNOT SEND TWICE: the moment
--     the 'sent' row lands it is in the index, and any later 'sent',
--     'unknown' or 'skipped' row for that rung collides with 23505 exactly as
--     it always did. Two overlapping passes that both decide to retry the
--     same failed rung therefore resolve to one recorded send, and the second
--     one's own report says so (lib/reminders/run.ts reads the conflict and
--     tells the pilot a duplicate very probably went out).
--
-- WHAT THE INDEX CANNOT DO, stated so nobody expects it to: it cannot bound
-- how MANY times a failing rung is retried, because a partial unique index has
-- no way to count. That cap is lib/reminders/policy.ts's MAX_REMINDER_ATTEMPTS
-- (three, counting the first attempt), enforced on the read that decides
-- whether a rung is still owed. The failure mode if that code is ever wrong is
-- a rung retried too often, which is visible, bounded by the ladder moving on,
-- and never a duplicate delivery, the index still owns that.
--
-- DROP THEN CREATE, rather than a second index under a new name: two unique
-- indexes on the same columns with different predicates would leave the
-- stricter one in force and this migration would silently do nothing. The
-- window between the two statements is inside one transaction (every file in
-- this directory is applied as one), so no concurrent insert sees the table
-- unguarded.
-- ---------------------------------------------------------------------------
drop index if exists pilot.invoice_reminder_sends_rung_once;

create unique index if not exists invoice_reminder_sends_rung_once
  on pilot.invoice_reminder_sends (account_id, invoice_id, rule_key)
  where rule_key <> 'manual' and outcome <> 'failed';


-- ---------------------------------------------------------------------------
-- 4. RLS AND GRANTS: deliberately unchanged, and this section exists to say
--    so rather than to leave the absence to be noticed.
--
-- The retry path writes exactly one kind of row: another INSERT into
-- pilot.invoice_reminder_sends, for an account the caller already owns. That
-- is covered verbatim by invoice_reminder_sends_insert
-- (with check (account_id in (select pilot.current_account_ids()))) and by the
-- column-scoped insert grant already held by `authenticated`. Nothing about
-- retrying needs a wider policy, so nothing here gets one.
--
-- IN PARTICULAR, NO UPDATE POLICY IS ADDED. A retry does not amend the failed
-- row, it appends a new one, which is what keeps the history readable and is
-- also what keeps the original position intact: there is no honest edit of a
-- statement about something that already happened to somebody else's inbox,
-- and a tenant able to rewrite an outcome is a tenant able to turn 'unknown'
-- into 'failed' and re-send a chase the schema just refused them. The one
-- UPDATE in this file is section 2's, run by the migration itself as the table
-- owner, on rows whose meaning it is correcting once and never again.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 5. The comments, brought back into line with what the table now does.
-- ---------------------------------------------------------------------------
comment on table pilot.invoice_reminder_sends is
  'Every reminder this product has attempted for an invoice, scheduled or manual, with its TRUE outcome. ''sent'' means the mail service took it and returned an id. ''failed'' means it DEFINITELY did not send (a refusal, a bad address, no configuration) and the rung may be attempted again, up to lib/reminders/policy.ts''s MAX_REMINDER_ATTEMPTS; the failed rows stay as history. ''unknown'' means it MAY have sent (the mail service stopped answering mid-request, and that endpoint has no idempotency key) and the rung is never attempted again, because a second chase in a client''s inbox is worse than a missed one. ''skipped'' is a rung deliberately not attempted: ''superseded'' (a later rung came due in the same run) or ''stale'' (a before-due note whose moment has passed). The partial unique index invoice_reminder_sends_rung_once holds all of it from underneath: it covers every outcome except ''failed'', so sent/unknown/skipped consume the rung permanently and no rung can ever be sent twice. Conditions that merely prevent an attempt today, no mail service, no client address, a recent manual chase, write NOTHING and are derived on screen instead. rule_key ''manual'' is the one repeatable kind: it is how the scheduler knows a human already chased this invoice.';

comment on column pilot.invoice_reminder_sends.outcome is
  'sent / failed / unknown / skipped. The line between ''failed'' and ''unknown'' is the line between "nothing was sent and we know it" and "the mail service stopped answering, so this may be in the client''s inbox", lib/email/send.ts returns which of the two it was, and only ''failed'' is ever retried. Rows written before 20260815090000 predate the distinction and were re-labelled ''unknown'' by that migration, because that is what was true of them: nobody knows.';
