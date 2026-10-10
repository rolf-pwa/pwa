import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-region",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const BodySchema = z.object({
  session_key: z.string().min(12).max(128),
  source: z.enum(["discovery", "discovery/embed", "discovery_embed"]).optional(),
  message_count: z.number().int().min(0).max(10000).optional(),
  reached_lead_capture: z.boolean().optional(),
  lead_captured: z.boolean().optional(),
  final_phase: z.enum(["chat", "lead_capture", "complete"]).optional(),
  ended: z.boolean().optional(),
});

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Parse JSON. sendBeacon delivers as text/plain, so handle both.
    let raw: unknown;
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      raw = await req.json();
    } else {
      const txt = await req.text();
      raw = txt ? JSON.parse(txt) : {};
    }

    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { session_key, message_count, reached_lead_capture, lead_captured, final_phase, ended } = parsed.data;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Server is not configured");

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Build patch — only include explicitly provided fields so we never overwrite with null.
    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { last_activity_at: nowIso };
    if (typeof message_count === "number") patch.message_count = message_count;
    if (typeof reached_lead_capture === "boolean") patch.reached_lead_capture = reached_lead_capture;
    if (typeof lead_captured === "boolean") patch.lead_captured = lead_captured;
    if (final_phase) patch.final_phase = final_phase;
    if (ended) patch.ended_at = nowIso;

    const { error } = await supabase.from("georgia_session_starts").update(patch).eq("session_key", session_key);

    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("georgia-session-update error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
