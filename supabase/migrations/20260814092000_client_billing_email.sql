-- ===========================================================================
-- clients.billing_email — an optional AP/accounting inbox, distinct from
-- contact_email.
--
-- WHY THIS EXISTS. clients.contact_email is the one address invoice sends,
-- manual reminders and scheduled chases all go to (lib/email/send-invoice.ts,
-- lib/reminders/run.ts). Real operator flight departments commonly want
-- invoices delivered to an ap@ / accounting@ inbox rather than to the
-- scheduler or DO who booked the trip and never touches payables — sending
-- a bill to the person who booked the trip instead of the desk that pays it
-- is a common, silent cause of slow payment, precisely the failure reminders
-- then have to paper over.
--
-- A SEPARATE COLUMN, NOT A REPLACEMENT. contact_email keeps meaning "who to
-- talk to about this relationship" — it still backs the client picker, the
-- "no email on file" warnings, and every other surface that names a person.
-- billing_email means "where the money paperwork goes", and is optional:
-- most contract-pilot clients are small enough that one address does both
-- jobs, so this column defaults to NULL and every existing row keeps sending
-- to contact_email exactly as it does today. Additive only, matching every
-- migration in this directory: no existing column, constraint, policy or
-- grant is dropped or narrowed.
--
-- NO FORMAT CHECK, matching contact_email on this same table (20260805070000)
-- — app-side validation (lib/email/send.ts's looksLikeEmail) is the
-- established pattern for every address column here, and this follows it
-- rather than inventing a second one.
-- ===========================================================================

alter table pilot.clients
  add column if not exists billing_email text;

comment on column pilot.clients.billing_email is
  'Optional AP/accounting inbox for invoices and reminders (e.g. ap@operator.com), distinct from contact_email (the relationship contact). Where set, lib/email/send-invoice.ts sends invoice and reminder mail here instead of contact_email; where null (every pre-existing row, and the default for a new client), contact_email is used exactly as before this column existed.';

-- ADD COLUMN does not extend an existing column-scoped grant — this
-- directory's README and every prior column addition on this table
-- (20260807000000, 20260807040000, 20260813130000) restate the same lesson.
-- Additive, no revoke first (a revoke drops every column privilege on the
-- table at once).
grant insert (billing_email) on pilot.clients to authenticated;
grant update (billing_email) on pilot.clients to authenticated;
