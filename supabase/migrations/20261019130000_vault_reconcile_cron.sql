-- Every 15 minutes: complete each family's Drive structure (personal drawers for new adults; structure for a new
-- household in a family that already has a Family Vault). The shared secret is a Vault secret named
-- vault_reconcile_cron_secret, created out of band.
SELECT cron.schedule(
  'vault-reconcile',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://rpxevcovasrgmrzkpknu.supabase.co/functions/v1/vault-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json', 'x-region', 'ca-central-1',
      'x-vault-reconcile-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'vault_reconcile_cron_secret'), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
