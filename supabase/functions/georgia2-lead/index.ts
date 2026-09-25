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

// Mirrors georgiaInsights()/bcContextNotes() in src/modules/intake/lib/derive.ts
// -- keep in sync (minus the "Your Next Step" insight and the empty-state
// fallback text, neither of which apply once lead capture is already done).
// Computed from already-validated domain/catalyst/answers/risk_scores_calculated
// rather than trusting free-text sent by the client -- this is a public,
// unauthenticated endpoint and these strings get embedded directly into an
// outbound email, so the content must come from server-trusted inputs only.
function computeNarrativeInsights(
  risk: z.infer<typeof RiskScoresSchema> | null,
  catalyst: string,
  answers: Record<string, unknown>,
): { tag: string; body: string }[] {
  if (!risk) return [];
  const insights: { tag: string; body: string }[] = [];
  // Order matters (person first): Decision Readiness, Governance Readiness,
  // Noise Exposure, then Tax Exposure -- mirrors georgiaInsights() in derive.ts.
  if (risk.readiness_score <= 40) {
    insights.push({
      tag: "Decision Readiness",
      body: "It is completely normal to feel paralyzed right now. Your nervous system is catching up with a massive life change. We will prioritize reducing your cognitive overhead — no major plans are needed today.",
    });
  }
  if (risk.structure_safety <= 40) {
    insights.push({
      tag: "Governance Readiness",
      body: "Without a written charter and professionals working as one team, decisions get made case-by-case, under pressure. Putting your family boundaries and the purpose of your capital in writing is the durable fix.",
    });
  }
  if (risk.noise_strain >= 70) {
    insights.push({
      tag: "Noise Exposure",
      body: "With many eyes on this transition, the noise level around you is incredibly high. You have a legal and emotional right to step back. The single best decision right now is to declare a Quiet Period while we sort the sequence.",
    });
  }
  const probateExposure = catalyst === "inheritance" && answers.probate === "yes";
  if (risk.tax_drag_risk >= 70 || probateExposure) {
    insights.push({
      tag: "Tax Exposure",
      body:
        "There are structural tax drags apparent in your profile. In British Columbia, the sequence of how you receive and shelter capital dictates what you keep. Let's address tax exposures before any money moves." +
        (probateExposure
          ? " BC probate fees run about 1.4% on estate value over $50,000 — and assets held in joint tenancy or a trust may bypass probate entirely, so structure matters before anything is distributed."
          : ""),
    });
  }
  if (insights.length === 0) {
    insights.push({
      tag: "Foundations in Good Standing",
      body: "Your answers point to a steady footing — decision readiness, governance, noise, and tax exposure are all within a healthy range. The plan below is about keeping it that way while capital moves.",
    });
  }
  return insights;
}

// Keep in sync with ACTION_PLAN in src/modules/intake/lib/derive.ts.
const ACTION_PLAN: { title: string; detail: string }[] = [
  {
    title: "Deposit funds into a secure Holding Account",
    detail: "Park incoming capital somewhere secure and insured, so nothing is deployed before there is a plan.",
  },
  {
    title: "Institute a 90-day (minimum) Stabilization Period",
    detail:
      "Halt all irreversible commitments. Do not sign discretionary investment mandates or respond to financial solicitations until your footing is steady.",
  },
  {
    title: "Centralize your documents",
    detail:
      "Gather your wills, powers of attorney, account statements, tax returns, and corporate records in one secure place, so every professional works from the same facts.",
  },
];

function computeBcContextNotes(domain: "corporate" | "personal", catalyst: string, answers: Record<string, unknown>): string[] {
  const notes: string[] = [];
  if (domain === "corporate") {
    notes.push("BC-registered CCPCs may access the Lifetime Capital Gains Exemption (LCGE): $1,250,000 per shareholder.");
    if (answers.holdco && answers.holdco !== "yes") {
      notes.push("Without an active HoldCo, retained earnings face full corporate + personal tax on distribution.");
    }
    if (answers.lcge === "unsure") {
      notes.push("Multiplying the LCGE through family trusts requires 24-month share holding rules — plan early.");
    }
    if (answers.purification === "yes") {
      notes.push("Excess passive cash inside the OpCo can disqualify the LCGE — purification is the first move.");
    }
  }
  if (domain === "personal") {
    if (catalyst === "divorce_restructuring") {
      notes.push("BC Family Law Act: family property is presumed 50/50 unless a cohabitation or marriage agreement applies.");
    }
    if (catalyst === "executive_exit" && answers.tax_deferral === "no") {
      notes.push("Retiring allowance rollovers into RRSP room can shelter significant severance from immediate BC tax.");
    }
    if (catalyst === "sudden_windfall") {
      notes.push("A 90-day Quiet Period in a separate high-interest account is the strongest first structural move.");
    }
  }
  return notes;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

// Hub + spoke handoff derived client-side from the chosen answers (see
// deriveDiagnosticPayload in src/modules/intake/lib/derive.ts) -- validated
// here against fixed enums so nothing free-form is ever stored in these
// columns. Keep the enum lists in sync with derive.ts.
const DiagnosticPayloadSchema = z.object({
  spoke: z.enum([
    "Business_Exit",
    "Pre_Exit_Growth",
    "Inheritance",
    "Divorce",
    "Executive_Retirement",
    "Financial_Windfall",
    "Emergency_Override",
  ]),
  emotional_state: z.enum(["relief", "anxiety", "guilt", "grief", "loss_of_identity", "euphoria"]).nullable(),
  relational_state: z.enum(["private", "small_circle", "public_knowledge"]).nullable(),
  timeline_urgency: z.enum(["pre_liquidity", "under_30_days", "one_to_six_months", "over_six_months"]).nullable(),
  primary_friction: z
    .enum([
      "family_pressure",
      "professional_pressure",
      "internal_paralysis",
      "operational_overload",
      "liquidity_gap",
      "no_friction",
    ])
    .nullable(),
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
    "clarity_call",
    // legacy values
    "vfo_stabilization",
    "vfo_catalyst_guide",
    "standalone_build",
    "academy_pass",
  ]),

  // No longer collected by the diagnostic (person-first redesign); still
  // accepted so an older cached client build submits successfully.
  scale: z.number().min(0).max(1_000_000_000).nullable().optional(),
  answers: z.record(z.string(), z.any()).default({}),
  // The 4 gauges, already computed client-side by computeGauges() (the
  // same values BlueprintCanvas has been rendering live all along) --
  // optional/nullable so a legacy or mid-migration client build that
  // hasn't started sending this yet still submits successfully.
  risk_scores_calculated: RiskScoresSchema.nullable().optional(),
  // Optional so an older cached client build still submits successfully.
  diagnostic_payload: DiagnosticPayloadSchema.nullable().optional(),
});

const APP_NAME = "ProsperWise";
const SENDER_DISPLAY = "Georgia · ProsperWise <rolf@prosperwise.ca>";

function roadmapEmailHtml(opts: {
  firstName: string;
  catalystLabel: string;
  risk: z.infer<typeof RiskScoresSchema> | null;
  insights: { tag: string; body: string }[];
  bcNotes: string[];
}): string {
  const { firstName, catalystLabel, risk, insights, bcNotes } = opts;
  const gaugeRows = risk
    ? `
      <tr><td style="padding:6px 0;color:#334155;font-family:'DM Sans',sans-serif;font-size:14px;">Tax Drag Risk</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1e293b;font-family:'DM Sans',sans-serif;font-size:14px;">${risk.tax_drag_risk}/100</td></tr>
      <tr><td style="padding:6px 0;color:#334155;font-family:'DM Sans',sans-serif;font-size:14px;">Structure Safety</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1e293b;font-family:'DM Sans',sans-serif;font-size:14px;">${risk.structure_safety}/100</td></tr>
      <tr><td style="padding:6px 0;color:#334155;font-family:'DM Sans',sans-serif;font-size:14px;">Noise Strain</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1e293b;font-family:'DM Sans',sans-serif;font-size:14px;">${risk.noise_strain}/100</td></tr>
      <tr><td style="padding:6px 0;color:#334155;font-family:'DM Sans',sans-serif;font-size:14px;">Readiness</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1e293b;font-family:'DM Sans',sans-serif;font-size:14px;">${risk.readiness_score}/100</td></tr>
    `
    : "";

  const insightsHtml = insights.length
    ? insights
        .map(
          (ins) => `
      <div style="border-left:3px solid #a37c58;background:#faf9f7;padding:10px 14px;margin-bottom:10px;">
        <p style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#a37c58;margin:0 0 4px;font-family:'DM Sans',sans-serif;">${escapeHtml(ins.tag)}</p>
        <p style="font-size:13px;line-height:1.55;color:#334155;margin:0;font-family:'DM Sans',sans-serif;">${escapeHtml(ins.body)}</p>
      </div>`
        )
        .join("")
    : "";

  const actionPlanHtml = `
      <p style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin:20px 0 8px;">Your Action Plan</p>
      <ol style="margin:0;padding-left:18px;">
        ${ACTION_PLAN.map(
          (a) => `<li style="font-size:13px;line-height:1.6;color:#334155;margin-bottom:8px;"><strong style="color:#1e293b;">${escapeHtml(a.title)}</strong><br/>${escapeHtml(a.detail)}</li>`
        ).join("")}
      </ol>`;

  const bcNotesHtml = bcNotes.length
    ? `
      <p style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;margin:20px 0 8px;">British Columbia Context</p>
      <ul style="margin:0;padding-left:18px;">
        ${bcNotes.map((n) => `<li style="font-size:13px;line-height:1.6;color:#334155;margin-bottom:4px;">${escapeHtml(n)}</li>`).join("")}
      </ul>`
    : "";

  return `
    <div style="font-family:'DM Sans',sans-serif;color:#334155;max-width:520px;margin:0 auto;">
      <p style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8;">Sovereignty Operating System™</p>
      <h2 style="font-family:'Cormorant Garamond',serif;font-weight:300;font-size:24px;color:#1e293b;margin:4px 0 16px;">Your Confidential Roadmap</h2>
      <p style="font-size:14px;line-height:1.6;">Hi ${firstName},</p>
      <p style="font-size:14px;line-height:1.6;">Thanks for walking through Georgia's diagnostic. Based on what you shared — ${catalystLabel} — here's your private risk snapshot:</p>
      ${gaugeRows ? `<table style="width:100%;border-collapse:collapse;margin:16px 0;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">${gaugeRows}</table>` : ""}
      ${insightsHtml ? `<div style="margin:16px 0;">${insightsHtml}</div>` : ""}
      ${bcNotesHtml}
      ${actionPlanHtml}
      <p style="font-size:14px;line-height:1.6;margin-top:20px;">No pitch, no commitment. When you're ready, the Sovereignty Survey is the next step.</p>
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
    const payload = data.diagnostic_payload ?? null;
    const primaryNoiseExposure = risk ? bucketNoiseExposure(risk.noise_strain) : null;

    // The lead is created once, when the visitor submits their contact
    // details (results are emailed automatically at that moment). Later
    // calls for the same session -- a pathway click, or re-submitting after
    // going Back -- update that lead instead of creating a duplicate.
    const { data: existing } = await supabase
      .from("georgia2_leads")
      .select("id, email, chosen_pathway")
      .eq("session_key", data.session_key)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fields = {
      first_name: data.first_name,
      email: data.email,
      mobile: data.mobile || null,
      domain: data.domain,
      catalyst: data.catalyst,
      chosen_pathway: data.chosen_pathway,
      scale: data.scale ?? null,
      answers: data.answers,
      risk_scores_calculated: risk,
      primary_noise_exposure: primaryNoiseExposure,
      diagnostic_payload: payload,
      spoke: payload?.spoke ?? null,
      emotional_state: payload?.emotional_state ?? null,
      relational_state: payload?.relational_state ?? null,
      timeline_urgency: payload?.timeline_urgency ?? null,
      primary_friction: payload?.primary_friction ?? null,
    };

    let leadId: string;
    if (existing) {
      const { error: updateErr } = await supabase.from("georgia2_leads").update(fields).eq("id", existing.id);
      if (updateErr) throw updateErr;
      leadId = existing.id;
    } else {
      const { data: lead, error: insertErr } = await supabase
        .from("georgia2_leads")
        .insert({ session_key: data.session_key, ...fields })
        .select("id")
        .single();
      if (insertErr) throw insertErr;
      leadId = lead.id;
    }

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
          spoke: payload?.spoke ?? null,
          scale: data.scale ?? null,
          answers: data.answers,
          risk_scores_calculated: risk,
          last_activity_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
        },
        { onConflict: "session_key" }
      );

    // Best-effort staff notification via existing staff_notifications table.
    // A new lead always notifies; an existing one only when they've now
    // picked a next step (Survey / Talk It Through) -- the hot signal.
    const pickedNextStep =
      existing &&
      existing.chosen_pathway !== data.chosen_pathway &&
      (data.chosen_pathway === "survey" || data.chosen_pathway === "clarity_call");
    if (!existing || pickedNextStep) {
      try {
        await supabase.from("staff_notifications").insert({
          title: existing
            ? `Georgia 2.0 lead chose ${data.chosen_pathway.replace(/_/g, " ")} · ${data.first_name}`
            : `Georgia 2.0 lead · ${data.first_name}`,
          body: `${data.domain} / ${data.catalyst} · ${data.chosen_pathway} · ${data.email}`,
          source_type: "georgia2_lead",
          link: "/leads",
        });
      } catch (notifyErr) {
        console.warn("staff_notifications insert failed (non-fatal):", notifyErr);
      }
    }

    // Email the results automatically the moment the lead is submitted (or
    // if they went Back and corrected their email). Best-effort -- never
    // fail the visitor's already-successful submission over a Gmail problem.
    if (!existing || existing.email !== data.email) {
      try {
        const catalystLabel = data.catalyst.replace(/_/g, " ");
        const html = roadmapEmailHtml({
          firstName: data.first_name,
          catalystLabel,
          risk,
          insights: computeNarrativeInsights(risk, data.catalyst, data.answers),
          bcNotes: computeBcContextNotes(data.domain, data.catalyst, data.answers),
        });
        const subject = "Your Confidential Roadmap — ProsperWise";

        // Reflecting the lead's own self-reported answers back to them
        // isn't the leak this shield exists to prevent (same rationale
        // send-contact-email uses for the same relaxation) -- every other
        // outbound-PII rule (SIN, account numbers, health terms) still
        // applies in full.
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
      JSON.stringify({ success: true, lead_id: leadId, chosen_pathway: data.chosen_pathway }),
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
