// onboarding-agent-admin: staff-only window onto Georgia's onboarding concierge (its tables are service-role only).
//   overview          mode, limits, every case with its household, and the latest events
//   getCase           one household's case(s), checklist progress and recent events
//   setMode           off | shadow | live (live needs confirm: true)
//   setCasePaused     pause or resume one household's case

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { INVITE_TTL_DAYS, inviteState, inviteUrl, newInviteToken, pickInvitee, welcomeRecipients, type InviteContact } from "../_shared/onboarding-invite.ts";
import { CONCIERGE_KEY, PAUSED_COMMENT } from "../_shared/onboarding-checklist.ts";

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

async function requireStaff(req: Request): Promise<{ userId: string; email: string } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data } = await userClient.auth.getUser();
  if (!data?.user?.email?.endsWith("@prosperwise.ca")) return null;
  return { userId: data.user.id, email: data.user.email };
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

    if (action === "overview") {
      const { data: config } = await db.from("onboarding_agent_config").select("*").eq("id", true).maybeSingle();
      const { data: cases } = await db.from("onboarding_cases").select("*").order("updated_at", { ascending: false }).limit(100);
      const ids = [...new Set((cases ?? []).map((c: any) => c.household_id))];
      const { data: hhs } = ids.length ? await db.from("households").select("id, label").in("id", ids) : { data: [] as any[] };
      const label = new Map((hhs ?? []).map((h: any) => [h.id, h.label]));
      const { data: events } = await db.from("onboarding_agent_events").select("id, household_id, mode, kind, detail, created_at").order("created_at", { ascending: false }).limit(60);
      return json({
        config,
        cases: (cases ?? []).map((c: any) => ({ ...c, household_label: label.get(c.household_id) ?? null })),
        events: (events ?? []).map((e: any) => ({ ...e, household_label: label.get(e.household_id) ?? null })),
      });
    }

    if (action === "getCase") {
      const householdId = String(body?.householdId ?? "");
      if (!householdId) return json({ error: "householdId required" }, 400);
      const { data: config } = await db.from("onboarding_agent_config").select("mode").eq("id", true).maybeSingle();
      const { data: cases } = await db.from("onboarding_cases").select("*").eq("household_id", householdId).order("opened_at", { ascending: false });
      const { data: events } = await db.from("onboarding_agent_events").select("id, mode, kind, detail, created_at").eq("household_id", householdId).order("created_at", { ascending: false }).limit(30);
      return json({ mode: config?.mode ?? "off", cases: cases ?? [], events: events ?? [] });
    }

    if (action === "setMode") {
      const mode = String(body?.mode ?? "");
      if (!["off", "shadow", "live"].includes(mode)) return json({ error: "invalid mode" }, 400);
      if (mode === "live" && body?.confirm !== true) return json({ error: "Going live needs confirm: true" }, 400);
      const { data: before } = await db.from("onboarding_agent_config").select("mode").eq("id", true).maybeSingle();
      // Going live starts from now: only households that enrol from this moment are ever contacted.
      const patch: Record<string, unknown> = { mode, updated_at: new Date().toISOString() };
      if (mode === "live" && before?.mode !== "live") patch.since = new Date().toISOString();
      await db.from("onboarding_agent_config").update(patch).eq("id", true);
      await db.from("onboarding_agent_events").insert({ household_id: null, mode, kind: "mode_changed", detail: { from: before?.mode ?? null, to: mode, by: staff.email } });
      return json({ ok: true, mode });
    }

    // ── Invitation links: one per household, for the person Rolf is writing to ──
    if (action === "getInvite" || action === "createInvite" || action === "revokeInvite") {
      const householdId = String(body?.householdId ?? "");
      if (!householdId) return json({ error: "householdId required" }, 400);
      const view = async () => {
        const { data: inv } = await db.from("onboarding_invites").select("*").eq("household_id", householdId).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!inv) return { invite: null };
        const { data: people } = await db.from("contacts").select("id, first_name, last_name, email, family_role, household_id, is_minor").eq("household_id", householdId);
        const invitee = ((people ?? []) as any[]).find((p) => p.id === inv.contact_id);
        const to = invitee ? welcomeRecipients(invitee as InviteContact, (people ?? []) as InviteContact[]) : [];
        return {
          invite: {
            id: inv.id, url: inviteUrl(inv.token), state: inviteState(inv, Date.now()), created_at: inv.created_at, expires_at: inv.expires_at, first_clicked_at: inv.first_clicked_at,
            click_count: inv.click_count, started_at: inv.started_at, welcome_sent_to: inv.welcome_sent_to,
            invitee: invitee ? `${invitee.first_name ?? ""} ${invitee.last_name ?? ""}`.trim() : null,
            recipients: to.map((r) => r.firstName),
            no_email: !invitee?.email,
          },
        };
      };
      if (action === "getInvite") return json(await view());
      if (action === "revokeInvite") {
        await db.from("onboarding_invites").update({ revoked_at: new Date().toISOString() }).eq("household_id", householdId).is("revoked_at", null);
        await db.from("onboarding_agent_events").insert({ household_id: householdId, mode: "live", kind: "invite_revoked", detail: { by: staff.email } });
        return json(await view());
      }
      // createInvite: reuse a still-active one unless a new link is asked for
      const { data: current } = await db.from("onboarding_invites").select("*").eq("household_id", householdId).is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (current && inviteState(current, Date.now()) === "active" && body?.regenerate !== true) return json(await view());
      const { data: people } = await db.from("contacts").select("id, first_name, email, family_role, household_id, is_minor").eq("household_id", householdId);
      const invitee = pickInvitee((people ?? []) as InviteContact[]);
      if (!invitee) return json({ error: "This household has no adult to invite." }, 400);
      if (!invitee.email) return json({ error: `${invitee.first_name ?? "The head of household"} has no email address on file. Add one first, so Georgia has somewhere to write.` }, 400);
      await db.from("onboarding_invites").update({ revoked_at: new Date().toISOString() }).eq("household_id", householdId).is("revoked_at", null);
      await db.from("onboarding_invites").insert({ household_id: householdId, contact_id: invitee.id, token: newInviteToken(), created_by: staff.userId, expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString() });
      await db.from("onboarding_agent_events").insert({ household_id: householdId, mode: "live", kind: "invite_created", detail: { by: staff.email, for: invitee.first_name } });
      return json(await view());
    }

    if (action === "setCasePaused") {
      const caseId = String(body?.caseId ?? "");
      const paused = body?.paused === true;
      const { data: k } = await db.from("onboarding_cases").select("*").eq("id", caseId).maybeSingle();
      if (!k) return json({ error: "case not found" }, 404);
      if (paused && k.status !== "active") return json({ error: `A ${k.status} case can't be paused` }, 400);
      if (!paused && k.status !== "paused") return json({ error: "Case is not paused" }, 400);
      await db.from("onboarding_cases").update({ status: paused ? "paused" : "active", updated_at: new Date().toISOString() }).eq("id", caseId);
      await db.from("onboarding_agent_events").insert({ household_id: k.household_id, case_id: caseId, mode: k.mode, kind: paused ? "paused" : "resumed", detail: { by: staff.email } });
      const parent = (k.checklist as any)?.parent;
      if (parent) await db.from("pm_task_comments").insert({ task_id: parent, author_agent_key: CONCIERGE_KEY, body: PAUSED_COMMENT(paused) });
      return json({ ok: true });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
