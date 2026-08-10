-- ===========================================================================
-- The seven self-funded categories, on the bank side too
--
-- 20260810070000 widened pilot.expenses.category from eight values to
-- fifteen, adding what a contract pilot actually pays for out of their own
-- pocket: training, medical, insurance, charts, equipment, uniform, dues.
-- It did not touch pilot.bank_transactions, which carries the SAME
-- vocabulary in two CHECK constraints of its own — ported verbatim from
-- pilot.expenses, as that table's own comment says, and then left behind.
--
-- WHAT THAT COST A PILOT. The review queue offers all fifteen categories
-- (transaction-row.tsx's CATEGORIES) and confirmTransaction accepts all
-- fifteen. So a pilot importing the annual FlightSafety recurrent charge
-- picks "Training / recurrent" and presses Confirm.
-- pilot.bank_transaction_confirm inserts the pilot.expenses row happily —
-- the expenses CHECK was widened — and then the follow-up
--   update pilot.bank_transactions set category = p_category
-- violates bank_transactions_category_check. SQLSTATE 23514, the whole
-- function rolls back, and friendlyDbError renders the generic "Some of
-- those values aren't valid together" with no clue which field.
--
-- Seven of the fifteen offered categories were dead that way, and they are
-- exactly the seven a contract pilot is most likely to be reconciling off
-- a personal card. There was no category the pilot could pick that was
-- both accepted AND true.
--
-- This migration does one thing: brings both bank-side CHECKs to the same
-- fifteen values, in the same order, so "ported verbatim from
-- pilot.expenses" is true again. Nothing else changes — no column, no
-- grant, no policy, no data. Widening a CHECK cannot invalidate an
-- existing row, since every stored value is in the original eight.
--
-- THE STANDING LESSON: this vocabulary now lives in three places (two
-- CHECKs here, one on pilot.expenses, plus the TypeScript list the UI
-- renders). Whoever adds a sixteenth category must change all of them, and
-- scripts/bank-import-verify.mjs should assert a category accepted by the
-- expenses CHECK is accepted here too, so the next omission fails a probe
-- instead of a pilot's Confirm button.
-- ===========================================================================

alter table pilot.bank_transactions
  drop constraint if exists bank_transactions_category_check;

alter table pilot.bank_transactions
  add constraint bank_transactions_category_check
  check (category is null or category in (
    -- The original eight, unchanged and in their original order.
    'airline', 'hotel', 'rental_car', 'rideshare', 'fuel',
    'meals', 'parking', 'other',
    -- What a contract pilot pays for out of their own pocket.
    'training',       -- recurrent, type ratings, checkrides, sim time
    'medical',        -- the FAA medical exam itself
    'insurance',      -- the pilot's own loss-of-licence / liability cover
    'charts',         -- EFB and chart subscriptions (ForeFlight, Jeppesen)
    'equipment',      -- headset, flight bag, tablet, kneeboard
    'uniform',        -- jacket, epaulettes, shoes, replacement shirts
    'dues'            -- association and union dues, publications
  ));

-- The suggestion the importer guesses at, before the pilot confirms. Same
-- vocabulary for the same reason: a suggestion the pilot cannot accept is
-- worse than no suggestion.
alter table pilot.bank_transactions
  drop constraint if exists bank_transactions_suggested_category_check;

alter table pilot.bank_transactions
  add constraint bank_transactions_suggested_category_check
  check (suggested_category is null or suggested_category in (
    'airline', 'hotel', 'rental_car', 'rideshare', 'fuel',
    'meals', 'parking', 'other',
    'training', 'medical', 'insurance', 'charts', 'equipment', 'uniform', 'dues'
  ));

comment on column pilot.bank_transactions.category is
  'The pilot''s confirmed choice. Ported verbatim from pilot.expenses.category and kept in lockstep with it — 20260810070000 widened that column to fifteen values and this one was missed, which made seven of the categories the UI offers fail on Confirm with a constraint error naming nothing.';
