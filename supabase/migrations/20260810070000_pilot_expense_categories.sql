-- ===========================================================================
-- The expenses a contract pilot actually self-funds
--
-- The eight categories this schema shipped with — airline, hotel,
-- rental_car, rideshare, fuel, meals, parking, other — describe TRAVEL.
-- They were ported verbatim from an earlier system and they cover the
-- reimbursable side of a trip well.
--
-- They do not describe the pilot's BUSINESS. A freelance professional
-- pilot self-funds recurrent training (five figures a year, and commonly
-- their single largest annual deduction), their FAA medical, their own
-- loss-of-licence and liability insurance, an EFB subscription, a headset,
-- uniform items, and association dues. Every one of those landed in
-- "other", and /reports/year-end then grouped them into one opaque bucket
-- under that name — so the largest line on the report a pilot hands their
-- accountant was literally "Other". A rebilled one printed on a client
-- invoice as the word "Expense".
--
-- Source for the list: the aviation-expert reference's "Business setup,
-- invoicing, getting paid" section, which names training, medical, EFB
-- subscriptions, headset, uniforms and dues as the self-funded costs
-- freelancers carry, and calls self-funded training "one of their biggest
-- financial pains".
--
-- NOTHING IS RENAMED OR REMOVED. Three years of expenses reference the
-- existing eight, and this is additive only: no backfill, no
-- reclassification, no migration of historical rows. A pilot who has been
-- filing training under "other" keeps those rows exactly as they are and
-- can recategorise them at their own pace, or not at all.
--
-- NOT ADDED, deliberately:
--   * home office — a Schedule C deduction computed from square footage or
--     the simplified per-foot method, not from a receipt. Modelling it as
--     an expense row would invite a pilot to enter a number this product
--     has no basis to compute.
--   * a 50%-limited flag on meals. The limit is real (IRC 274(n)) but it
--     is a tax-preparation rule with exceptions this product should not be
--     encoding as law. The year-end report names the category; the CPA
--     applies the limit.
-- ===========================================================================

alter table pilot.expenses drop constraint if exists expenses_category_check;

alter table pilot.expenses
  add constraint expenses_category_check
  check (category in (
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

comment on column pilot.expenses.category is
  'Filing taxonomy only — nothing computes on it. The first eight are travel costs, usually rebilled; the last seven are what a freelance pilot self-funds and deducts. Additive: existing rows keep whatever they were filed under.';
