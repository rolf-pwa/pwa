// "Run again" on the Book of Business page: starts the weekly run now, in the background, and returns at once.
// The page watches opportunity_runs for the new row. Staff only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runBookOfBusiness } from "../_shared/opportunity-run.ts";
import { trackJob } from "../_shared/job-health.ts";

const ALLOWED_ORIGINS = ["https://prosperwise-portal.web.app", "https://prosperwise.lovable.app", "https://app.prosperwise.ca", "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app"];
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

async function requireStaff(req: Request): Promise<{ ok: true } | { error: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { error: "Missing authorization header" };
  const { data, error } = await createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }).auth.getUser();
  if (error || !data?.user) return { error: "Not authenticated" };
  if (!data.user.email?.endsWith("@prosperwise.ca")) return { error: "Not authorized" };
  return { ok: true };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const cors = { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region" };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
  const auth = await requireStaff(req);
  if ("error" in auth) return json({ error: auth.error }, 401);
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions runtime
  EdgeRuntime.waitUntil(trackJob(db, "book_of_business", () => runBookOfBusiness(db)));
  return json({ started: true });
});
