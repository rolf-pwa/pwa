-- The iA product on each insurance policy, as iA's own guide names them. The CRM's policy_type is coarser: it cannot tell Access Life from Term,
-- or Participating from Whole Life, and iA's self-serve options (My Client Space) depend on which product it is. Optional; filled in by hand or from statements.
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS ia_product text
  CHECK (ia_product IN ('access_life', 'transition', 'term', 'whole_life', 'participating_life', 'universal_life', 'accifamily', 'acci_7_plus', 'disability', 'cancer_guard', 'other'));
