// balance-update-notify: staff-triggered. After the monthly import is committed, Georgia tells each person that their
// balances are updated: a portal notification plus an email, with no figures in either. Each person is told about their
// own accounts (the head of household can see household accounts when they open their own in the portal).
//   preview  { snapshotDate }  who would be notified, who has no email, who was already told
//   send     { snapshotDate }  sends it; one notice per person per snapshot date, recorded in balance_update_notices

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendServiceEmailDetailed } from "../_shared/service-email.ts";
import { AGENT_SENDER } from "../_shared/onboarding-agent.ts";
import { NOTICE_TITLE, balanceEmail, noticeBody, planNotices } from "../_shared/balance-notice.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];
function cors(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".lovable.app") || origin.endsWith(".lovableproject.com") ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-region",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const MAX_SEND = 200;

async function requireStaff(req: Request): Promise<{ userId: string } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data } = await userClient.auth.getUser();
  if (!data?.user?.email?.endsWith("@prosperwise.ca")) return null;
  return { userId: data.user.id };
}

async function plan(snapshotDate: string) {
  const { data: snaps } = await db.from("account_harvest_snapshots").select("contact_id").eq("snapshot_date", snapshotDate);
  const ids = (snaps ?? []).map((s: any) => s.contact_id).filter(Boolean) as string[];
  const unique = [...new Set(ids)];
  const { data: contacts } = unique.length ? await db.from("contacts").select("id, first_name, last_name, email, household_id").in("id", unique) : { data: [] as any[] };
  const hhIds = [...new Set((contacts ?? []).map((c: any) => c.household_id).filter(Boolean))];
  const { data: hhs } = hhIds.length ? await db.from("households").select("id, label").in("id", hhIds) : { data: [] as any[] };
  const hhLabel = new Map((hhs ?? []).map((h: any) => [h.id, h.label]));
  const { data: done } = await db.from("balance_update_notices").select("contact_id").eq("snapshot_date", snapshotDate);
  return planNotices({
    snapshotContactIds: ids,
    contacts: (contacts ?? []).map((c: any) => ({ id: c.id, firstName: c.first_name, lastName: c.last_name, email: c.email, household: c.household_id ? hhLabel.get(c.household_id) ?? null : null })),
    alreadyNotified: new Set((done ?? []).map((d: any) => d.contact_id)),
  });
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers });
  try {
    const staff = await requireStaff(req);
    if (!staff) return json({ error: "Not authorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const snapshotDate = String(body?.snapshotDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) return json({ error: "snapshotDate (YYYY-MM-DD) required" }, 400);

    const p = await plan(snapshotDate);
    if (action === "preview") return json({ ok: true, plan: p });

    if (action === "send") {
      if (p.send.length > MAX_SEND) return json({ error: `Too many recipients (${p.send.length}); the limit is ${MAX_SEND} per send.` }, 400);
      const result = { sent: 0, emailFailed: 0, skipped: 0, errors: 0 };
      for (const r of p.send) {
        // Claim this person for this date first, so a second click or a retry can never notify them twice.
        const { data: claimed, error: claimErr } = await db.from("balance_update_notices").insert({ snapshot_date: snapshotDate, contact_id: r.contactId, sent_by: staff.userId }).select("id").maybeSingle();
        if (claimErr) {
          // 23505 = this person was already notified for this date (a second click or a retry); anything else is a real failure.
          if (claimErr.code === "23505") result.skipped++; else { result.errors++; console.error("[balance-update-notify] claim failed:", claimErr.message); }
          continue;
        }
        if (!claimed?.id) { result.errors++; continue; }
        await db.from("portal_client_notifications").insert({ contact_id: r.contactId, title: NOTICE_TITLE, body: noticeBody(snapshotDate), source_type: "balances_updated", link_tab: "financials" });
        const { subject, html } = balanceEmail(r.firstName, snapshotDate);
        const sent = await sendServiceEmailDetailed(db, { to: r.email, subject, html, from: Deno.env.get("ONBOARDING_AGENT_FROM") || AGENT_SENDER });
        await db.from("balance_update_notices").update({ portal_notified: true, email_sent: sent.ok }).eq("id", claimed.id);
        if (sent.ok) result.sent++; else result.emailFailed++;
      }
      return json({ ok: true, result, noEmail: p.noEmail.length });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
