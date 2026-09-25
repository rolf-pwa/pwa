import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowedSuffixes = [
    "prosperwise.ca",
    "prosperwise.lovable.app",
    ".lovable.app",
    ".lovableproject.com",
    "localhost",
  ];
  const allow =
    !origin ||
    allowedSuffixes.some((s) => origin.endsWith(s) || origin.includes(s))
      ? origin || "*"
      : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

const BodySchema = z.object({
  session_key: z.string().min(6).max(128),
  source: z.string().max(64).optional(),
  domain: z.enum(["corporate", "personal"]).nullable().optional(),
  catalyst: z.string().max(64).nullable().optional(),
  spoke: z.string().max(40).nullable().optional(),
  answers: z.record(z.string(), z.any()).optional(),
  scale: z.number().min(0).max(1_000_000_000).optional(),
  chosen_pathway: z.string().max(64).nullable().optional(),
  final_phase: z.enum(["chat", "lead_capture", "complete"]).optional(),
  reached_lead_capture: z.boolean().optional(),
  lead_captured: z.boolean().optional(),
  ended: z.boolean().optional(),
  // First-reach timestamps per Stepper-labeled step -- the client only
  // ever sends these once per step per session (see session-tracker.ts),
  // so a later, earlier, or repeated value here is trusted as-is; this
  // endpoint doesn't need to guard against overwriting an earlier value.
  step_domain_reached_at: z.string().datetime().optional(),
  step_catalyst_reached_at: z.string().datetime().optional(),
  step_diagnostic_reached_at: z.string().datetime().optional(),
  step_pathway_reached_at: z.string().datetime().optional(),
  step_confidential_reached_at: z.string().datetime().optional(),
});

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let raw: unknown;
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) raw = await req.json();
    else {
      const txt = await req.text();
      raw = txt ? JSON.parse(txt) : {};
    }

    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { session_key, ended, ...rest } = parsed.data;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {
      session_key,
      last_activity_at: nowIso,
      ...rest,
    };
    if (ended) patch.ended_at = nowIso;
    if (!patch.user_agent) {
      const ua = req.headers.get("user-agent");
      if (ua) patch.user_agent = ua.slice(0, 500);
    }
    const ref = req.headers.get("referer");
    if (ref) patch.referrer = ref.slice(0, 500);

    // Upsert on session_key
    const { error } = await supabase
      .from("georgia2_sessions")
      .upsert(patch, { onConflict: "session_key" });

    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("georgia2-session error", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
