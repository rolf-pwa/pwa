// portal-rebalance: a client's response to their portfolio rebalancing (Tier 1 in Q3, Tier 2A in Q4), from the portal or VFO.
// Only after Rolf has published it to the family: the client reviews the proposal first and consents after.
//   acknowledge  records the acknowledgement with the exact wording and proposal shown, completes it for Georgia, and gives Rolf a task to carry it out
//   talk_first   records that the client wants to talk before it is done, pauses Georgia's reminders for two weeks, and tells Rolf
// Only adults (head of family, spouse) can respond, only while the family's live rebalancing window is open. Nothing here changes a
// portfolio: it records consent and hands the work to a person.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePortalContact } from "../_shared/portal-auth.ts";
import { REBALANCE_STATEMENT, REBALANCE_STATEMENT_VERSION, isFamilyAdult, pacificDate, windowLabel } from "../_shared/review-windows.ts";

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

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ASSIGNEE_EMAIL = "rolf@prosperwise.ca";
const familyTitle = (name: string | null) => { const n = (name ?? "").trim(); return !n ? "Family" : /\bfamily$/i.test(n) ? n : `${n} Family`; };
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  const headers = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers });
  try {
    const { portal_token, action } = await req.json().catch(() => ({}));
    const who = await validatePortalContact(db, portal_token);
    if (!who) return json({ error: "Unauthorized" }, 401);
    if (action !== "acknowledge" && action !== "talk_first") return json({ error: "unknown_action" }, 400);

    const { data: me } = await db.from("contacts").select("id, first_name, last_name, family_id, family_role, is_minor, household_id").eq("id", who.contactId).maybeSingle();
    if (!me?.family_id) return json({ error: "Not available" }, 403);
    const { data: heads } = await db.from("contacts").select("household_id").eq("family_id", me.family_id).eq("family_role", "head_of_family");
    if (!isFamilyAdult({ role: me.family_role, isMinor: me.is_minor, householdId: me.household_id }, (heads ?? []).map((h: any) => h.household_id))) return json({ error: "Not available" }, 403);

    const today = pacificDate(Date.now());
    const { data: ob } = await db.from("review_obligations").select("*").eq("family_id", me.family_id).eq("kind", "rebalancing").eq("mode", "live").neq("status", "cancelled").not("published_at", "is", null).lte("window_start", today).is("completed_at", null).order("window_start", { ascending: false }).limit(1).maybeSingle();
    if (!ob) return json({ error: "There is no rebalancing waiting for you right now." }, 404);
    if (ob.acknowledged_at) return json({ ok: true, alreadyAcknowledged: true });

    const { data: fam } = await db.from("families").select("name").eq("id", me.family_id).maybeSingle();
    const family = familyTitle(fam?.name ?? null);
    const name = `${me.first_name ?? ""} ${me.last_name ?? ""}`.trim() || "A client";
    const label = windowLabel(ob.window_start, ob.window_end);
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
    const ua = req.headers.get("user-agent");

    await db.from("rebalance_acknowledgements").insert({
      obligation_id: ob.id, family_id: me.family_id, contact_id: me.id, decision: action === "acknowledge" ? "acknowledged" : "wants_meeting",
      statement_version: REBALANCE_STATEMENT_VERSION, statement_text: REBALANCE_STATEMENT, proposal_summary: ob.proposal_summary ?? null, ip, user_agent: ua,
    });

    const { data: rolf } = await db.from("profiles").select("user_id").eq("email", ASSIGNEE_EMAIL).maybeSingle();
    const task = async (title: string, description: string, dueInDays: number) => {
      if (!rolf?.user_id) return;
      await db.from("pm_tasks").insert({ title, description, status: "open", client_visible: false, assignee_id: rolf.user_id, created_by: rolf.user_id, family_id: me.family_id, contact_id: me.id, due_date: addDays(today, dueInDays) });
    };

    if (action === "acknowledge") {
      await db.from("review_obligations").update({ acknowledged_at: new Date().toISOString(), status: "held", updated_at: new Date().toISOString() }).eq("id", ob.id);
      await task(`Rebalance ${family}: acknowledged`, `${name} reviewed the ${label} rebalancing you published and acknowledged it in the portal on ${today}. Carry it out, then mark it done on Georgia Reviews so the family is told.\n\nThe acknowledgement (wording version ${REBALANCE_STATEMENT_VERSION}, with the proposal they saw) is stored with the family's records.`, 3);
      await db.from("staff_notifications").insert({ title: `Rebalancing acknowledged: ${family}`, body: `${name} acknowledged the ${label} rebalancing.`, link: `/families/${me.family_id}`, contact_id: me.id, source_type: "rebalancing" });
      await db.from("review_agent_events").insert({ family_id: me.family_id, obligation_id: ob.id, mode: "live", kind: "rebalancing_acknowledged", detail: { by: name, label } });
      return json({ ok: true });
    }

    // talk_first: pause Georgia's reminders for two weeks and tell Rolf.
    await db.from("review_obligations").update({ snoozed_until: new Date(Date.now() + 14 * 86_400_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", ob.id);
    await task(`${family} wants to talk before the rebalancing`, `${name} asked to talk about the ${label} rebalancing you published before agreeing to it. They are booking an Interim Strategy Session; if it is not on your calendar, call them.`, 2);
    await db.from("staff_notifications").insert({ title: `${family} wants to talk before rebalancing`, body: `${name} asked to talk before the ${label} rebalancing.`, link: `/families/${me.family_id}`, contact_id: me.id, source_type: "rebalancing" });
    await db.from("review_agent_events").insert({ family_id: me.family_id, obligation_id: ob.id, mode: "live", kind: "rebalancing_talk_first", detail: { by: name, label } });
    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
