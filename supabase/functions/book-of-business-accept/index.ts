// "Accept" on a Book of Business opportunity: creates a task for the person who clicked and marks the opportunity accepted. Staff only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { acceptOpportunity } from "../_shared/opportunity-accept.ts";

const ALLOWED_ORIGINS = ["https://prosperwise-portal.web.app", "https://prosperwise.lovable.app", "https://app.prosperwise.ca", "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app"];
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

async function requireStaff(req: Request): Promise<{ id: string; email: string } | { error: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { error: "Missing authorization header" };
  const { data, error } = await createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }).auth.getUser();
  if (error || !data?.user) return { error: "Not authenticated" };
  if (!data.user.email?.endsWith("@prosperwise.ca")) return { error: "Not authorized" };
  return { id: data.user.id, email: data.user.email };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const cors = { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const who = await requireStaff(req);
  if ("error" in who) return json({ error: who.error }, 401);
  const body = await req.json().catch(() => ({}));
  const id = String(body?.opportunity_id || "");
  if (!id) return json({ error: "opportunity_id is required" }, 400);
  const r = await acceptOpportunity(createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }), id, who.id, who.email);
  return r.ok ? json({ ok: true, task_id: r.taskId, already: r.already }) : json({ error: r.error }, 400);
});
