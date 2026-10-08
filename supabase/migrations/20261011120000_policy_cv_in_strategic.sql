-- Per-policy switch: count a policy's cash surrender value in the Strategic Reserve. On by default, which is how the
-- reserve has always been built, so no figure changes until someone turns a policy off.
ALTER TABLE public.insurance_policies ADD COLUMN IF NOT EXISTS cv_in_strategic boolean NOT NULL DEFAULT true;
