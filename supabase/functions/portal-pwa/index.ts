// portal-pwa — client-portal side of the V2 mobile/PWA features, authed by
// portal token (same model as portal-notifications). Actions:
//   status      -> { enabled, publicKey }   enabled = household has V2 on
//   subscribe   -> stores this device's Web Push subscription for the contact
//   unsubscribe -> removes it
// Everything except `status` requires the household's V2 flag.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePortalContact } from "../_shared/portal-auth.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const cors = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-portal-token",
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body = await req.json().catch(() => null);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const portal = await validatePortalContact(admin, req.headers.get("x-portal-token") ?? body?.portal_token);
    if (!portal) return json({ error: "Unauthorized" }, 401);

    let enabled = false;
    if (portal.householdId) {
      const { data: hh } = await admin.from("households").select("v2_ai_engine_enabled").eq("id", portal.householdId).maybeSingle();
      enabled = hh?.v2_ai_engine_enabled === true;
    }
    const action = body?.action;

    if (action === "status") {
      return json({ enabled, publicKey: enabled ? (Deno.env.get("VAPID_PUBLIC_KEY") ?? null) : null });
    }
    if (!enabled) return json({ error: "Not enabled for this household" }, 409);

    if (action === "subscribe") {
      const s = body?.subscription;
      const endpoint = s?.endpoint;
      const p256dh = s?.keys?.p256dh;
      const auth = s?.keys?.auth;
      if (typeof endpoint !== "string" || !endpoint.startsWith("https://") || endpoint.length > 2000) return json({ error: "Invalid subscription endpoint" }, 400);
      if (typeof p256dh !== "string" || !B64URL.test(p256dh) || typeof auth !== "string" || !B64URL.test(auth)) return json({ error: "Invalid subscription keys" }, 400);
      const ua = typeof body?.userAgent === "string" ? body.userAgent.slice(0, 300) : null;
      // endpoint is UNIQUE: a device handed to another contact is re-pointed, not duplicated.
      const { error } = await admin.from("pwa_push_subscriptions").upsert(
        { endpoint, p256dh, auth, contact_id: portal.contactId, household_id: portal.householdId, user_id: null, user_agent: ua, failure_count: 0 },
        { onConflict: "endpoint" },
      );
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    if (action === "unsubscribe") {
      if (typeof body?.endpoint !== "string") return json({ error: "endpoint is required" }, 400);
      // Scoped to the caller's own contact: one client can't remove another's device.
      const { error } = await admin.from("pwa_push_subscriptions").delete().eq("endpoint", body.endpoint).eq("contact_id", portal.contactId);
      if (error) throw new Error(error.message);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[portal-pwa] error:", message);
    return json({ error: "Internal error" }, 500);
  }
});
