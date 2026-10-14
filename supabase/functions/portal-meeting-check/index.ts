// portal-meeting-check: called by the client portal and VFO while a booking scheduler is open and when it is closed. It looks on
// Rolf's calendar for a review meeting the client has just booked, records it, and tells the page what it found, so the
// "your meeting is booked" message appears at once instead of at Georgia's next check. Only adults (head of family, spouse) are
// checked, only for meetings their family owes right now, and nothing but the meeting's name and date is returned.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePortalContact } from "../_shared/portal-auth.ts";
import { findBooking } from "../_shared/review-calendar.ts";
import { KIND_LABEL, isFamilyAdult, meetingsOwedNow, pacificDate, requiredMeetings } from "../_shared/review-windows.ts";
import { scopeToUnit, viewerUnit } from "../_shared/review-unit-for-contact.ts";

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

Deno.serve(async (req) => {
  const headers = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers });
  try {
    const { portal_token } = await req.json().catch(() => ({}));
    const who = await validatePortalContact(db, portal_token);
    if (!who) return json({ error: "Unauthorized" }, 401);

    const { data: me } = await db.from("contacts").select("id, family_id, family_role, is_minor, household_id").eq("id", who.contactId).maybeSingle();
    if (!me?.family_id) return json({ ok: true, found: [] });
    const { data: heads } = await db.from("contacts").select("household_id").eq("family_id", me.family_id).eq("family_role", "head_of_family");
    if (!isFamilyAdult({ role: me.family_role, isMinor: me.is_minor, householdId: me.household_id }, (heads ?? []).map((h: any) => h.household_id))) return json({ ok: true, found: [] });

    const today = pacificDate(Date.now());
    const unit = await viewerUnit(db, me.family_id, me.household_id);
    const [{ data: tracked }, { data: contacts }] = await Promise.all([
      scopeToUnit(db.from("review_obligations").select("id, mode, window_key, status, booked_start, booked_event_id").eq("family_id", me.family_id).lte("window_start", today).gte("window_end", today), unit),
      unit.householdId ? db.from("contacts").select("email, is_minor").eq("household_id", unit.householdId) : db.from("contacts").select("email, is_minor").eq("family_id", me.family_id),
    ]);
    const fam = { service_tier: unit.tier };
    const owed = meetingsOwedNow((fam?.service_tier ?? null) as any, today, (tracked ?? []) as any).filter((o) => !o.bookedStart);
    if (!owed.length) return json({ ok: true, found: [] });

    const emails = [...new Set((contacts ?? []).filter((c: any) => !c.is_minor && c.email).map((c: any) => String(c.email).trim().toLowerCase()))];
    const { data: cfg } = await db.from("review_agent_config").select("mode").eq("id", true).maybeSingle();
    const mode = cfg?.mode === "live" ? "live" : "shadow";
    const found: { label: string; start: string }[] = [];
    const cache = new Map<string, any[]>();
    for (const o of owed) {
      const w = requiredMeetings((fam?.service_tier ?? null) as any, Number(today.slice(0, 4))).find((m) => m.key === o.windowKey);
      if (!w) continue;
      const booking = await findBooking(db, emails, o.kind, w.windowStart, w.windowEnd, cache);
      if (!booking || booking.start < Date.now()) continue;
      const start = new Date(booking.start).toISOString();
      const row = (tracked ?? []).find((t: any) => t.window_key === o.windowKey);
      if (row) {
        await db.from("review_obligations").update({ booked_event_id: booking.id, booked_start: start, status: row.status === "paused" ? "paused" : "booked", updated_at: new Date().toISOString() }).eq("id", row.id);
      } else {
        // No record yet for this window (a family whose tier changed, say): track it for bookings only, never invite.
        await db.from("review_obligations").insert({ family_id: me.family_id, household_id: unit.householdId, kind: o.kind, window_key: o.windowKey, window_start: w.windowStart, window_end: w.windowEnd, tier: fam?.service_tier ?? null, mode, status: "booked", booked_event_id: booking.id, booked_start: start, invite: false });
      }
      await db.from("review_agent_events").insert({ family_id: me.family_id, obligation_id: row?.id ?? null, mode, kind: "booking_detected", detail: { start, source: "portal" } });
      found.push({ label: KIND_LABEL[o.kind], start });
    }
    return json({ ok: true, found });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
