/**
 * Second Brain (the staff knowledge index, /brain) is paused: it was never filled, its indexing job has been removed and
 * nothing depends on it. Set this to true to bring its navigation, the ⌘K search and the Assistant's grounding back. The
 * code, tables and edge functions are intact; to resume indexing, also set the BRAIN_CRON_SECRET function secret and the
 * brain_cron_secret Vault secret and re-create the `brain-index-drain` cron job (see migration 20260809*brain*).
 */
export const SECOND_BRAIN_ENABLED = false;
