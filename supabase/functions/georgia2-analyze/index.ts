// georgia2-analyze — screens the optional free-text answer in the Georgia
// diagnostic. Public and unauthenticated (visitors are anonymous), so it is
// defensive: capped length, a per-session call limit, a global hourly
// circuit breaker, and a PII pre-check so account numbers / SINs never reach
// the model.
//
// It returns ONLY fixed categories -- never model text:
//   { ok, threat_detected, threat_source?, extraction?, degraded?, pii? }
// Threat detection is layered so no single model call can suppress it:
// keyword patterns first (no model), then two independent Vertex passes
// (classifier + conservative verifier); any one tripping wins. If Vertex is
// unavailable the keyword layer still applies and the request is marked
// degraded rather than failed, so the visitor's flow is never blocked.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";
import { checkOutboundPii } from "../_shared/pii-shield.ts";
import { keywordThreat, type ThreatSource } from "../_shared/georgia-safety.ts";
import { classifyFreeform, loadServiceAccount, verifyThreat } from "../_shared/georgia-llm.ts";

const MAX_CALLS_PER_SESSION = 3;
const GLOBAL_HOURLY_LIMIT = 300;

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowedSuffixes = ["prosperwise.ca", "prosperwise.lovable.app", ".lovable.app", ".lovableproject.com", "localhost"];
  const allow =
    !origin || allowedSuffixes.some((s) => origin.endsWith(s) || origin.includes(s)) ? origin || "*" : "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

const BodySchema = z.object({
  session_key: z.string().min(6).max(128),
  text: z.string().trim().min(1).max(1000),
});

serve(async (req) => {
  const cors = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Invalid request" }, 400);
    const { session_key, text } = parsed.data;

    // 1. Keyword layer -- no model, no outbound call, always runs first.
    if (keywordThreat(text)) {
      return json({ ok: true, threat_detected: true, threat_source: "keywords" satisfies ThreatSource });
    }

    // 2. Never send account numbers / SINs / health terms to the model.
    const pii = checkOutboundPii(text, { skipDollarAmountRule: true });
    if (pii.blocked) return json({ ok: false, pii: true });

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false },
    });

    // 3. Abuse limits (fail closed to keyword-only, never to an error the visitor sees).
    const { data: session } = await db
      .from("georgia2_sessions")
      .select("analyze_count")
      .eq("session_key", session_key)
      .maybeSingle();
    const used = session?.analyze_count ?? 0;
    if (used >= MAX_CALLS_PER_SESSION) {
      return json({ ok: true, threat_detected: false, degraded: true });
    }
    const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const { count: recent } = await db
      .from("georgia2_sessions")
      .select("id", { count: "exact", head: true })
      .gt("analyze_count", 0)
      .gte("last_activity_at", hourAgo);
    if ((recent ?? 0) >= GLOBAL_HOURLY_LIMIT) {
      return json({ ok: true, threat_detected: false, degraded: true });
    }
    await db
      .from("georgia2_sessions")
      .upsert(
        { session_key, analyze_count: used + 1, last_activity_at: new Date().toISOString() },
        { onConflict: "session_key" },
      );

    // 4. Two independent model passes; either tripping the threat flag wins.
    try {
      const sa = await loadServiceAccount();
      const [classified, verifierFlag] = await Promise.all([classifyFreeform(sa, text), verifyThreat(sa, text)]);
      if (classified.threat_detected || verifierFlag) {
        return json({
          ok: true,
          threat_detected: true,
          threat_source: (classified.threat_detected ? "model" : "verifier") satisfies ThreatSource,
        });
      }
      return json({
        ok: true,
        threat_detected: false,
        extraction: {
          emotional_state: classified.emotional_state,
          primary_friction: classified.primary_friction,
        },
      });
    } catch (e) {
      console.error("[georgia2-analyze] model analysis failed, keyword layer only:", e);
      return json({ ok: true, threat_detected: false, degraded: true });
    }
  } catch (error) {
    console.error("georgia2-analyze error", error);
    // Never break the visitor's flow over an analysis problem.
    return json({ ok: true, threat_detected: false, degraded: true });
  }
});
