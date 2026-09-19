-- household_charters: Perspective 1 "Treasury & Capital Structure" columns.
-- treasury_snapshot is a computed-once-and-stored JSONB snapshot (same
-- pattern as stabilization_maps.diagnostics), populated by charter-intake's
-- new `recompute_treasury` action which wraps the shared
-- gatherHouseholdFinancials / _shared/sovereignty-diagnostics.ts survey
-- pipeline -- never live-recomputed on render, matching StabilizationMap.tsx's
-- own read-only-from-snapshot precedent. Field names inside the JSON
-- deliberately mirror SovereigntyDiagnostics's own naming
-- (storehouse_reserves / vineyard_total / holding_tank_total / net_worth)
-- for consistency with the Stabilization Map's identical figures.
--
-- vineyard_replenishment_policy / river_boundary_note are the two genuinely
-- new narrative fields from the v2.0 doc's Perspective 1 section -- plain
-- text, matching vision_text's pattern, not another NamedItem[] list.
ALTER TABLE public.household_charters
  ADD COLUMN treasury_snapshot jsonb,
  ADD COLUMN treasury_snapshot_computed_at timestamptz,
  ADD COLUMN vineyard_replenishment_policy text,
  ADD COLUMN river_boundary_note text;
