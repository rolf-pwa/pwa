-- Tier 2A is Traditional Legacy (no Charter) and Tier 2B is Chartered Legacy, the step before Tier 3. The labels were the
-- other way round. Existing families keep the meaning they had: swap the stored value. Run together with the code change.
UPDATE public.families
SET service_tier = CASE service_tier
  WHEN 'tier_2a' THEN 'tier_2b'::public.service_tier
  WHEN 'tier_2b' THEN 'tier_2a'::public.service_tier
END
WHERE service_tier IN ('tier_2a', 'tier_2b');
