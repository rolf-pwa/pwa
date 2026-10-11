// vault-reconcile — keeps each family's Drive structure complete as the family grows. Every 15 minutes (pg_cron,
// shared-secret header, pinned to Canada Central):
//   * an adult added to a household that has a Vault gets a personal drawer ("Personal — Name" in Personal Docs)
//   * a household added to a family that already has a Family Vault gets its own Household Vault structure
// Prospects (governance_status "none") and very new households (so their names have settled) are left alone.
// Creates folders only: it never renames, moves or deletes anything.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { provisionClientFolderTree, ensurePersonalDrawers } from "../_shared/vault-provisioning.ts";
import { hasPersonalDrawerRole } from "../_shared/vault-drawers.ts";
import { planReconcile } from "../_shared/vault-reconcile.ts";
import { logSystemHealth } from "../_shared/system-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("VAULT_RECONCILE_CRON_SECRET");
const SETTLE_MS = 15 * 60_000;
// Only people and households added AFTER this moment are reconciled automatically. Existing clients are brought into
// the structure on purpose (staff use "Provision structure" on the household), never all at once by a background job.
const SINCE = Date.parse(Deno.env.get("VAULT_RECONCILE_SINCE") ?? "") || Number.POSITIVE_INFINITY;
const MAX_HOUSEHOLDS = 5;
const MAX_DRAWER_HOUSEHOLDS = 10;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-vault-reconcile-cron-secret") !== CRON_SECRET) return json({ error: "unauthorized" }, 401);
  const summary = { drawerHouseholds: 0, drawersCreated: 0, householdsProvisioned: 0, errors: [] as string[] };
  try {
    const { data: households } = await db.from("households").select("id, family_id, governance_status, vault_root_folder_id, created_at");
    const { data: families } = await db.from("families").select("id, vault_folder_id");
    const { data: people } = await db.from("contacts").select("id, household_id, family_role, is_minor, personal_vault_folder_id, created_at").not("household_id", "is", null);
    const memberCount = new Map<string, number>();
    for (const c of people ?? []) memberCount.set(c.household_id, (memberCount.get(c.household_id) ?? 0) + 1);
    const plan = planReconcile({
      households: (households ?? []).map((h: any) => ({ id: h.id, family_id: h.family_id, governance_status: h.governance_status, vault_root_folder_id: h.vault_root_folder_id, members: memberCount.get(h.id) ?? 0 })),
      families: (families ?? []) as any,
      adults: (people ?? []).filter((c: any) => hasPersonalDrawerRole(c.family_role, c.is_minor) && Date.parse(c.created_at) >= SINCE).map((c: any) => ({ contact_id: c.id, household_id: c.household_id, personal_vault_folder_id: c.personal_vault_folder_id })),
    });
    const createdAt = new Map<string, number>((households ?? []).map((h: any) => [h.id, Date.parse(h.created_at)]));

    for (const hId of plan.newHouseholds.filter((id) => (createdAt.get(id) ?? 0) >= SINCE && Date.now() - (createdAt.get(id) ?? 0) > SETTLE_MS).slice(0, MAX_HOUSEHOLDS)) {
      const r = await provisionClientFolderTree(db, hId, "new_household");
      if (r.ok) summary.householdsProvisioned++; else summary.errors.push(`household ${hId}: ${r.error}`);
    }
    if (plan.drawers.length) {
      const token = await getServiceGoogleAccessToken(db);
      for (const d of plan.drawers.slice(0, MAX_DRAWER_HOUSEHOLDS)) {
        try { summary.drawersCreated += await ensurePersonalDrawers(db, d.householdId, token, "new_member"); summary.drawerHouseholds++; }
        catch (e) { summary.errors.push(`drawers ${d.householdId}: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }
    if (summary.errors.length) {
      await logSystemHealth(db as any, { function_name: "vault-reconcile", severity: "WARN", error_code: "VAULT_RECONCILE_PARTIAL", error_message: summary.errors.join("; ").slice(0, 900) });
    }
    return json({ ok: true, ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[vault-reconcile]", message);
    await logSystemHealth(db as any, { function_name: "vault-reconcile", severity: "ERROR", error_code: "VAULT_RECONCILE_FAILED", error_message: message.slice(0, 900) });
    return json({ ok: false, error: message, ...summary }, 500);
  }
});
