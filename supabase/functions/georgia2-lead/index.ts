import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";
import { checkOutboundPii } from "../_shared/pii-shield.ts";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { buildRawEmail, base64UrlEncode } from "../_shared/gmail-mime.ts";

// primary_noise_exposure is a bucketed label derived from the client's
// already-computed noise_strain gauge -- no separate weight table needed
// server-side, unlike the gauges themselves (see risk_scores_calculated
// below, which trusts the client's own computeGauges() output rather than
// re-deriving it here: recomputing would mean duplicating derive.ts's full
// CATALYST_QUESTIONS risk-weight table, a large, easily-drifting
// duplication for data that's already self-reported/self-computed by
// design -- Phase 2's Delta Engine is what later reconciles this baseline
// against independently-observed reality, not this endpoint).
function bucketNoiseExposure(noiseStrain: number): "Low" | "Moderate" | "High" | "Critical" {
  if (noiseStrain >= 75) return "Critical";
  if (noiseStrain >= 50) return "High";
  if (noiseStrain >= 25) return "Moderate";
  return "Low";
}

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

const RiskScoresSchema = z.object({
  tax_drag_risk: z.number().min(0).max(100),
  structure_safety: z.number().min(0).max(100),
  noise_strain: z.number().min(0).max(100),
  readiness_score: z.number().min(0).max(100),
});

const BodySchema = z.object({
  session_key: z.string().min(6).max(128),
  first_name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(255),
  mobile: z.string().trim().max(40).nullable().optional(),
  domain: z.enum(["corporate", "personal"]),
  catalyst: z.string().min(1).max(64),
  chosen_pathway: z.enum([
    "survey",
    "academy_guide",
    "confidential_roadmap",
    // legacy values
    "vfo_stabilization",
    "vfo_catalyst_guide",
    "standalone_build",
    "academy_pass",
  ]),

  scale: z.number().min(0).max(1_000_000_000),
  answers: z.record(z.string(), z.any()).default({}),
  // The 4 gauges, already computed client-side by computeGauges() (the
  // same values BlueprintCanvas has been rendering live all along) --
  // optional/nullable so a legacy or mid-migration client build that
  // hasn't started sending this yet still submits successfully.
  risk_scores_calculated: RiskScoresSchema.nullable().optional(),
});

const APP_NAME = "ProsperWise";
const SENDER_DISPLAY = "Georgia · ProsperWise <rolf@prosperwise.ca>";

function roadmapEmailHtml(opts: {
  firstName: string;
  catalystLabel: string;
  scaleFormatted: string;
  risk: z.infer<typeof RiskScoresSchema> | null;
}): string {
  const { firstName, catalystLabel, scaleFormatted, risk } = opts;
  const gaugeRows = risk
    ? `
      <tr><td style="padding:6px 0;color:#334155;font-family:'DM Sans',sans-serif;font-size:14px;">Tax Drag Risk</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1e293b;font-family:'DM Sans',sans-serif;font-size:14px;">${risk.tax_drag_risk}/100</td></tr>
      <tr><td style="padding:6px 0;color:#334155;font-family:'DM Sans',sans-serif;font-size:14px;">Structure Safety</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1e293b;font-family:'DM Sans',sans-serif;font-size:14px;">${risk.structure_safety}/100</td></tr>
      <tr><td style="padding:6px 0;color:#334155;font-family:'DM Sans',sans-serif;font-size:14px;">Noise Strain</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1e293b;font-family:'DM Sans',sans-serif;font-size:14px;">${risk.noise_strain}/100</td></tr>
      <tr><td style="padding:6px 0;color:#334155;font-family:'DM Sans',sans-serif;font-size:14px;">Readiness</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1e293b;font-family:'DM Sans',sans-serif;font-size:14px;">${risk.readiness_score}/100</td></tr>
    `
    : "";

  return `
    <div style="font-family:'DM Sans',sans-serif;color:#334155;max-width:520px;margin:0 auto;">
      <p style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;">Sovereignty Operating System™</p>
      <h2 style="font-family:'Cormorant Garamond',serif;font-weight:300;font-size:24px;color:#1e293b;margin:4px 0 16px;">Your Confidential Roadmap</h2>
      <p style="font-size:14px;line-height:1.6;">Hi ${firstName},</p>
      <p style="font-size:14px;line-height:1.6;">Thanks for walking through Georgia's diagnostic. Based on what you shared — ${catalystLabel}, ${scaleFormatted} — here's your private risk snapshot:</p>
      ${gaugeRows ? `<table style="width:100%;border-collapse:collapse;margin:16px 0;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">${gaugeRows}</table>` : ""}
      <p style="font-size:14px;line-height:1.6;">No pitch, no commitment. When you're ready to go deeper, the Sovereignty Survey is a 90-minute working session built around exactly what you've told Georgia — you leave with a Stabilization Map, an Immediate Risk Scan, and a 30-Day Action Framework.</p>
      <p style="font-size:14px;line-height:1.6;"><a href="https://www.prosperwise.ca/sovereignty-audit#pricing" style="color:#a37c58;">Learn more about the Sovereignty Survey →</a></p>
      <p style="font-size:14px;line-height:1.6;margin-top:24px;">— Rolf &amp; the ${APP_NAME} team</p>
    </div>
  `.trim();
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: parsed.error.flatten().fieldErrors }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const data = parsed.data;
    const risk = data.risk_scores_calculated ?? null;
    const primaryNoiseExposure = risk ? bucketNoiseExposure(risk.noise_strain) : null;

    // Insert the lead
    const { data: lead, error: insertErr } = await supabase
      .from("georgia2_leads")
      .insert({
        session_key: data.session_key,
        first_name: data.first_name,
        email: data.email,
        mobile: data.mobile || null,
        domain: data.domain,
        catalyst: data.catalyst,
        chosen_pathway: data.chosen_pathway,
        scale: data.scale,
        answers: data.answers,
        risk_scores_calculated: risk,
        primary_noise_exposure: primaryNoiseExposure,
      })
      .select("id")
      .single();
    if (insertErr) throw insertErr;

    // Mark session as captured
    await supabase
      .from("georgia2_sessions")
      .upsert(
        {
          session_key: data.session_key,
          lead_captured: true,
          reached_lead_capture: true,
          final_phase: "complete",
          chosen_pathway: data.chosen_pathway,
          domain: data.domain,
          catalyst: data.catalyst,
          scale: data.scale,
          answers: data.answers,
          risk_scores_calculated: risk,
          last_activity_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
        },
        { onConflict: "session_key" }
      );

    // Best-effort staff notification via existing staff_notifications table
    try {
      await supabase.from("staff_notifications").insert({
        title: `Georgia 2.0 lead · ${data.first_name}`,
        body: `${data.domain} / ${data.catalyst} · $${data.scale.toLocaleString()} · ${data.chosen_pathway} · ${data.email}`,
        source_type: "georgia2_lead",
        link: "/leads",
      });
    } catch (notifyErr) {
      console.warn("staff_notifications insert failed (non-fatal):", notifyErr);
    }

    // Confidential roadmap pathway: email the value exchange promised on
    // the button ("Just Email My Confidential Roadmap"). Best-effort --
    // never fail the whole submission (and never block the visitor's
    // already-successful lead capture) if Gmail send has a problem.
    if (data.chosen_pathway === "confidential_roadmap") {
      try {
        const catalystLabel = data.catalyst.replace(/_/g, " ");
        const scaleFormatted = new Intl.NumberFormat("en-CA", {
          style: "currency",
          currency: "CAD",
          maximumFractionDigits: 0,
        }).format(data.scale);
        const html = roadmapEmailHtml({
          firstName: data.first_name,
          catalystLabel,
          scaleFormatted,
          risk,
        });
        const subject = "Your Confidential Roadmap — ProsperWise";

        // Reflecting the lead's own self-reported catalyst/scale back to
        // them isn't the leak this shield exists to prevent (same
        // rationale send-contact-email uses for the same relaxation) --
        // every other outbound-PII rule (SIN, account numbers, health
        // terms) still applies in full.
        const pii = checkOutboundPii(`${subject}\n${html}`, { skipDollarAmountRule: true });
        if (pii.blocked) {
          console.warn(`[georgia2-lead] PII Shield blocked roadmap email: ${pii.reason}`);
        } else {
          const rawMessage = buildRawEmail({
            from: SENDER_DISPLAY,
            to: [data.email],
            subject,
            html,
          });
          const accessToken = await getServiceGoogleAccessToken(supabase);
          const gmRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ raw: base64UrlEncode(rawMessage) }),
          });
          if (!gmRes.ok) {
            console.error(`[georgia2-lead] Roadmap email send failed [${gmRes.status}]: ${await gmRes.text()}`);
          }
        }
      } catch (emailErr) {
        console.error("[georgia2-lead] Roadmap email failed (non-fatal):", emailErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, lead_id: lead.id, chosen_pathway: data.chosen_pathway }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("georgia2-lead error", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
