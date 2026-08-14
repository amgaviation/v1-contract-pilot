-- ===========================================================================
-- SAMPLE CONNECT — the user → V2 account mapping
--
-- WHAT THIS IS FOR. The sample Stripe Connect integration (lib/sample-connect,
-- app/sample-connect, app/store) creates a V2 Stripe account per user and has
-- to remember which account belongs to whom. That mapping is the ONLY thing
-- it stores; onboarding status, capability status and subscription status are
-- always read live from the Stripe API, never cached here, because
-- requirements change without this application doing anything and a stored
-- "onboarded" goes stale silently.
--
-- WHY A SEPARATE TABLE INSTEAD OF pilot.accounts.connect_account_id. That
-- column already exists and already holds an acct_… id — but it belongs to
-- the PRODUCTION Connect integration (Standard accounts linked by OAuth,
-- direct charges, no application fee: lib/stripe/connect.ts). The two models
-- are not interchangeable:
--
--   * production ids come from an OAuth grant this platform can revoke via
--     /oauth/deauthorize; sample ids are accounts this platform CREATED;
--   * production charges carry no application fee, by an explicit product
--     decision stated in the pilot-facing UI; sample charges do;
--   * pilot.connect_account_link and pilot.connect_account_unlink enforce the
--     OAuth round trip as the only way that column may change.
--
-- Writing a V2 id into that column would put an account the OAuth flow never
-- granted in front of code that assumes it did, and the first symptom would
-- be a pilot's real invoice payment link failing. Hence a table of its own,
-- with a name that says what it is.
--
-- SAFE TO DROP. Nothing in the product depends on this table. Removing the
-- sample means dropping it and deleting the directories named above.
-- ===========================================================================

create table if not exists pilot.sample_connect_accounts (
  -- One row per user. The auth user is the natural key here rather than
  -- pilot.accounts.id, because the sample is a per-person demo and does not
  -- model the multi-seat account the real product does.
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- The V2 account id (acct_…). Text, not uuid — Stripe's format.
  stripe_account_id text not null,

  -- Which Stripe mode minted it. A test-mode acct_ id is meaningless to a
  -- live-mode key and vice versa; recording it makes a mode mix-up legible
  -- instead of presenting as "account not found".
  livemode boolean not null default false,

  created_at timestamptz not null default now(),

  -- One Stripe account maps to at most one user, so a mis-scoped write shows
  -- up as a constraint violation rather than two dashboards fighting over the
  -- same merchant.
  constraint sample_connect_accounts_stripe_account_unique unique (stripe_account_id),
  constraint sample_connect_accounts_stripe_account_shape check (stripe_account_id like 'acct\_%')
);

comment on table pilot.sample_connect_accounts is
  'Sample Connect integration only: maps an auth user to the V2 Stripe account created for them. Not used by the production Connect integration, which stores its OAuth-granted Standard account id on pilot.accounts.connect_account_id.';

-- ---------------------------------------------------------------------------
-- RLS. Same posture as every other tenant-scoped table here: on, with
-- policies that scope by the row's own owner. A user may read and create
-- their own mapping and nothing else.
-- ---------------------------------------------------------------------------
alter table pilot.sample_connect_accounts enable row level security;

drop policy if exists sample_connect_accounts_select on pilot.sample_connect_accounts;
create policy sample_connect_accounts_select
  on pilot.sample_connect_accounts
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists sample_connect_accounts_insert on pilot.sample_connect_accounts;
create policy sample_connect_accounts_insert
  on pilot.sample_connect_accounts
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- NO UPDATE AND NO DELETE POLICY, deliberately. Repointing a user at a
-- different Stripe account is not an edit anyone should make from the
-- browser: the account this platform created is the account it must keep
-- talking to. Starting over means deleting the row with service-role access,
-- which is a considered act rather than a stray PATCH.

grant select, insert on pilot.sample_connect_accounts to authenticated;
