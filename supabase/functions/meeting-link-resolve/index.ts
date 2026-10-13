// meeting-link-resolve: staff-only. Google's short booking links (calendar.app.google/...) cannot be shown inside a page; they
// redirect to a full schedule address that can. This follows the redirect and returns the embeddable address, so a type can be
// added with the short link a person copies from Google Calendar. Only Google Calendar hosts are followed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  const headers = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data } = await userClient.auth.getUser();
    if (!data?.user?.email?.endsWith("@prosperwise.ca")) return json({ error: "Not authorized" }, 401);

    const { url } = await req.json().catch(() => ({ url: "" }));
    let parsed: URL;
    try { parsed = new URL(String(url)); } catch { return json({ error: "That is not a link." }, 400); }
    if (parsed.protocol !== "https:" || !["calendar.app.google", "calendar.google.com"].includes(parsed.hostname)) {
      return json({ error: "Paste a booking link from Google Calendar (calendar.app.google/… or calendar.google.com/…)." }, 400);
    }
    const res = await fetch(parsed.toString(), { redirect: "follow" });
    const final = new URL(res.url);
    if (final.hostname !== "calendar.google.com") return json({ error: "That link did not lead to a Google Calendar booking page." }, 400);
    const m = final.pathname.match(/\/appointments\/schedules\/([\w-]+)/);
    if (!res.ok || !m) return json({ error: "Couldn't find the booking page behind that link." }, 400);
    return json({ ok: true, embed_url: `https://calendar.google.com/calendar/appointments/schedules/${m[1]}?gv=true` });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
