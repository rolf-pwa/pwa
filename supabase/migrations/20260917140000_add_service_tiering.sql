-- Client Service Tiering engine (Phase A: staff-only classification).
-- Tier pools across a whole family grouping (spouses, HoldCo/OpCo/trusts,
-- descendants under the same Charter), so these fields live on `families`,
-- not `households` -- household-centric pages read it via the existing
-- households.family_id join, no denormalization needed.
--
-- Source: "Legacy Client Service Tier & Review Cadence Matrix" (Google Doc,
-- id 1uE1h4OYRVZKRzZD3k4PLh_O1BluWZV3iwTZrFPOk9P0). Six tiers: 0 (insurance
-- only), 1 (under $250k), 2A (chartered, $250k-$750k), 2B (no charter,
-- $250k-$750k), 3 (VFO, $750k-$2M), 4 (sovereign enterprise, $2M+).

CREATE TYPE public.service_tier AS ENUM ('tier_0', 'tier_1', 'tier_2a', 'tier_2b', 'tier_3', 'tier_4');

ALTER TABLE public.families
  ADD COLUMN service_tier public.service_tier,
  ADD COLUMN service_tier_source TEXT NOT NULL DEFAULT 'computed'
    CHECK (service_tier_source IN ('computed', 'manual_override')),
  ADD COLUMN service_tier_overridden_at TIMESTAMPTZ,
  ADD COLUMN service_tier_overridden_by UUID REFERENCES auth.users(id),
  ADD COLUMN grouped_aum_cad NUMERIC,
  ADD COLUMN has_ratified_charter BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN service_tier_computed_at TIMESTAMPTZ;

-- corporate_vineyard_accounts never got the custodian field the earlier
-- vineyard_accounts/storehouses migrations added -- needed here so
-- HoldCo/OpCo assets can be pooled into grouped_aum_cad correctly (the
-- source doc explicitly includes them in the family grouping).
ALTER TABLE public.corporate_vineyard_accounts
  ADD COLUMN IF NOT EXISTS custodian TEXT;
