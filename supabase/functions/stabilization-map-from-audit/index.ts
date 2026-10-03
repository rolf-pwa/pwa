import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_PRO_MODEL, withThinking, fetchWithVertexRetry } from "../_shared/vertex-ai.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

// ---------- Vertex AI ----------
const REGION = "northamerica-northeast1";
// gemini-2.5-pro handles long PDFs + complex tool calls far more reliably
// than 2.5-flash, which frequently returns MALFORMED_FUNCTION_CALL on this schema.
const MODEL = GEMINI_PRO_MODEL;
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${enc(header)}.${enc(payload)}`;
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const jwt = `${unsigned}.${signature}`;
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  return data.access_token;
}

// ---------- Extraction Prompt ----------

const EXTRACTION_PROMPT = `You are an expert ProsperWise stabilization analyst. You are drafting a one-page **Stabilization Map** that Rolf Issler will review with the client in their Stabilization Session.

You will receive:
1. A PDF of the client's completed **Sovereignty Audit** (a structured intake covering Family, Inventory, Nucleus/Why, Protocols, and Governance Audit sections).
2. The client's first name.

Your job: read the entire PDF carefully and fill every field of the Stabilization Map with concrete, client-specific content derived STRICTLY from the audit.

## Reading the Audit
- **Part 1 (Your Family)**: family members, spouses, children, special-needs flags.
- **Part 2 (The Inventory)**: Liquid Capital (HISA, Chequing, GICs), Sovereign Capital (Whole/Universal Life CSV), Growth Capital (TFSA, RRSP/RRIF, LIRA, Non-Reg), Real Estate, Business Interests, Expected Inheritance, Liabilities.
- **Part II (The Nucleus / Why)**: The "Sleep Well" 2 AM fear, monthly after-tax "Enough" number, 20-year Mission.
- **Part III (Protocols)**: Liquidity Rule (months of expenses in cash), Generosity Target, Next-Generation philosophy.
- **Part IV (Governance Audit)**: Will status + executors, Enduring Power of Attorney status + attorneys, Representation Agreement status + representatives.
- **Part V (Attachments) + Notes**: tax-credit balances, owed taxes, medical/lifestyle notes, near-term plans (e.g. car purchase, travel).

## Rules
- **Never fabricate** numbers, dates, firm names, or facts not present in the audit. If unknown, say so ("amount unspecified", "tax advisor not yet engaged", etc.).
- **Write in the Sanctuary voice** — calm, direct, non-alarmist, professional. No jargon. No exclamations.
- **Each risk and next step MUST be a single line, max ~70 characters**, following the template style ("Short noun phrase — concrete consequence or action").
- **Always fill all 5 risks and all 5 next steps**. Prioritise the most material exposures revealed by the audit (e.g. missing EPOA, no Liquidity Rule met, untested executor, concentrated single-institution risk, no Storehouse, no Generosity protocol, looming taxable events, etc.).
- **Status fields** MUST use the exact enum values:
  - storehouse_status: "Not Established" | "Partial" | "Established"
  - solicitation_status: "Not Established" | "Partial" | "Established"
  - sovereignty_charter_status: "Not Started" | "In Progress" | "Complete"
  - tax_status: "Not Assessed" | "In Progress" | "Assessed"
- **event_type** must be one of: "Business Exit" | "Inheritance" | "Sudden Windfall" | "Taxable Event". For an audit of established retirees with no recent triggering windfall, choose the closest fit (often "Taxable Event" if RRIF/decumulation pressure, else "Inheritance" if expected transfer).
- **situation_summary**: 1–2 sentences summarising current capital posture and life stage in the style: "[Family] currently holds approximately $X across [institutions]. [Current state — decumulation, accumulation, transition.]"
- **urgency_flag**: 1 sentence describing what is currently absent or exposed — missing EPOA, single-custodian concentration, undocumented liquidity buffer, etc.
- **Detail fields** (storehouse_detail, solicitation_detail, sovereignty_charter_detail, tax_detail): one short sentence each, describing the current state and why.
  - **storehouse**: do they have a defined Liquidity Rule (months of cash) and is it currently funded? Reference HISA/Chequing/GIC balances.
  - **solicitation**: are they currently exposed to advisor/product solicitation (e.g. concentrated at one bank/insurer with no Charter)?
  - **sovereignty_charter**: a Charter does NOT exist yet at audit stage — almost always "Not Started" or "In Progress".
  - **tax**: any T1 credits, owed taxes, RRIF withdrawals, capital gains exposure mentioned?
- **logic_trace**: 3–5 sentences, for Rolf's eyes only, explaining which audit fields drove each major risk, next step, and status choice. Cite specific dollar figures or governance gaps you keyed off.

## Output
Call the \`populate_stabilization_map\` function with all fields filled. Do not return any free text.`;

const TOOL_SCHEMA = {
  functionDeclarations: [
    {
      name: "populate_stabilization_map",
      description: "Populate every field of the Stabilization Map from the Sovereignty Audit PDF.",
      parameters: {
        type: "OBJECT",
        properties: {
          event_type: { type: "STRING", description: "Business Exit | Inheritance | Sudden Windfall | Taxable Event" },
          situation_summary: { type: "STRING" },
          urgency_flag: { type: "STRING" },
          risk_1: { type: "STRING" },
          risk_2: { type: "STRING" },
          risk_3: { type: "STRING" },
          risk_4: { type: "STRING" },
          risk_5: { type: "STRING" },
          next_step_1: { type: "STRING" },
          next_step_2: { type: "STRING" },
          next_step_3: { type: "STRING" },
          next_step_4: { type: "STRING" },
          next_step_5: { type: "STRING" },
          storehouse_status: { type: "STRING" },
          storehouse_detail: { type: "STRING" },
          solicitation_status: { type: "STRING" },
          solicitation_detail: { type: "STRING" },
          sovereignty_charter_status: { type: "STRING" },
          sovereignty_charter_detail: { type: "STRING" },
          tax_status: { type: "STRING" },
          tax_detail: { type: "STRING" },
          logic_trace: { type: "STRING" },
        },
        required: [
          "event_type", "situation_summary", "urgency_flag",
          "risk_1", "risk_2", "risk_3", "risk_4", "risk_5",
          "next_step_1", "next_step_2", "next_step_3", "next_step_4", "next_step_5",
          "storehouse_status", "storehouse_detail",
          "solicitation_status", "solicitation_detail",
          "sovereignty_charter_status", "sovereignty_charter_detail",
          "tax_status", "tax_detail",
          "logic_trace",
        ],
      },
    },
  ],
};

const normEnum = (val: string, allowed: string[], fallback: string) =>
  allowed.includes(val) ? val : fallback;

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ---------- Auth: require an authenticated staff user ----------
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuthClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: userRes, error: userErr } = await supabaseAuthClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;

    // ---------- Parse body ----------
    const { contactId, pdfBase64, pdfName } = await req.json() as {
      contactId?: string; pdfBase64?: string; pdfName?: string;
    };
    if (!contactId || typeof contactId !== "string") {
      return new Response(JSON.stringify({ error: "contactId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!pdfBase64 || typeof pdfBase64 !== "string") {
      return new Response(JSON.stringify({ error: "pdfBase64 is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Rough size check (base64 inflates ~33%)
    const approxBytes = Math.floor((pdfBase64.length * 3) / 4);
    if (approxBytes > MAX_PDF_BYTES) {
      return new Response(JSON.stringify({ error: "PDF exceeds 25 MB limit" }), {
        status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---------- Resolve contact ----------
    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .select("id, first_name, last_name")
      .eq("id", contactId)
      .single();
    if (contactErr || !contact) {
      return new Response(JSON.stringify({ error: "Contact not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---------- Upsert map row in 'generating' state ----------
    const { data: existing } = await supabase
      .from("stabilization_maps")
      .select("id")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let mapId = existing?.id as string | undefined;

    if (!mapId) {
      const { data: inserted, error: insErr } = await supabase
        .from("stabilization_maps")
        .insert({
          contact_id: contactId,
          client_first_name: contact.first_name || "",
          client_last_name: contact.last_name || "",
          session_date: new Date().toISOString().slice(0, 10),
          generation_status: "generating",
          created_by: userId,
        })
        .select("id")
        .single();
      if (insErr || !inserted) throw new Error(insErr?.message || "Failed to seed map");
      mapId = inserted.id;
    } else {
      await supabase
        .from("stabilization_maps")
        .update({
          generation_status: "generating",
          generation_error: null,
          client_first_name: contact.first_name || "",
          client_last_name: contact.last_name || "",
        })
        .eq("id", mapId);
    }

    // ---------- Call Vertex with the PDF inline ----------
    const gcpKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!gcpKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    const sa: ServiceAccountKey = JSON.parse(gcpKeyRaw);
    const accessToken = await getAccessToken(sa);

    const vertexUrl =
      `https://${REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

    const intakeText =
      `Client first name: ${contact.first_name || "(unknown)"}\n` +
      (pdfName ? `Audit file: ${pdfName}\n` : "") +
      `Generate the Stabilization Map by reading the attached PDF.`;

    console.log(`[stabilization-map-from-audit] Calling Vertex for contact ${contactId} (map ${mapId})`);

    const aiRes = await fetchWithVertexRetry(vertexUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: EXTRACTION_PROMPT }] },
          { role: "model", parts: [{ text: "Understood. Provide the audit PDF and I will populate the map." }] },
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
              { text: intakeText },
            ],
          },
        ],
        tools: [TOOL_SCHEMA],
        toolConfig: {
          functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["populate_stabilization_map"] },
        },
        generationConfig: withThinking(MODEL, { temperature: 0.3, maxOutputTokens: 8192 }, "high"),
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error(`[stabilization-map-from-audit] Vertex error ${aiRes.status}:`, errText.slice(0, 500));
      await supabase.from("stabilization_maps")
        .update({ generation_status: "failed", generation_error: `Vertex AI ${aiRes.status}` })
        .eq("id", mapId!);
      return new Response(JSON.stringify({ error: "AI generation failed", mapId }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await aiRes.json();
    const candidate = result.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    let fnCall = parts.find((p: any) => p.functionCall)?.functionCall;

    // Fallback: gemini sometimes emits the function call as Python-style text
    // when it truncates or misformats. Try to recover JSON args from it.
    if ((!fnCall || !fnCall.args) && candidate?.finishReason === "MALFORMED_FUNCTION_CALL") {
      const raw = candidate?.finishMessage || "";
      console.warn("[stabilization-map-from-audit] MALFORMED_FUNCTION_CALL, attempting recovery");
      // best-effort: not reliable enough to use; just log and fail clearly
      console.warn("[stabilization-map-from-audit] raw fragment:", raw.slice(0, 300));
    }

    if (!fnCall || !fnCall.args) {
      const reason = candidate?.finishReason || "unknown";
      console.error("[stabilization-map-from-audit] No function call returned", reason, JSON.stringify(result).slice(0, 800));
      const userMsg = reason === "MAX_TOKENS"
        ? "AI response was cut off — try again"
        : reason === "MALFORMED_FUNCTION_CALL"
        ? "AI returned malformed output — please retry"
        : "AI did not return structured data";
      await supabase.from("stabilization_maps")
        .update({ generation_status: "failed", generation_error: userMsg })
        .eq("id", mapId!);
      return new Response(JSON.stringify({ error: userMsg, mapId }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const args = fnCall.args;
    const update = {
      event_type: normEnum(args.event_type, ["Business Exit", "Inheritance", "Sudden Windfall", "Taxable Event"], "Taxable Event"),
      situation_summary: String(args.situation_summary || "").slice(0, 1200),
      urgency_flag: String(args.urgency_flag || "").slice(0, 1200),
      risk_1: String(args.risk_1 || "").slice(0, 200),
      risk_2: String(args.risk_2 || "").slice(0, 200),
      risk_3: String(args.risk_3 || "").slice(0, 200),
      risk_4: String(args.risk_4 || "").slice(0, 200),
      risk_5: String(args.risk_5 || "").slice(0, 200),
      next_step_1: String(args.next_step_1 || "").slice(0, 200),
      next_step_2: String(args.next_step_2 || "").slice(0, 200),
      next_step_3: String(args.next_step_3 || "").slice(0, 200),
      next_step_4: String(args.next_step_4 || "").slice(0, 200),
      next_step_5: String(args.next_step_5 || "").slice(0, 200),
      storehouse_status: normEnum(args.storehouse_status, ["Not Established", "Partial", "Established"], "Not Established"),
      storehouse_detail: String(args.storehouse_detail || "").slice(0, 500),
      solicitation_status: normEnum(args.solicitation_status, ["Not Established", "Partial", "Established"], "Not Established"),
      solicitation_detail: String(args.solicitation_detail || "").slice(0, 500),
      sovereignty_charter_status: normEnum(args.sovereignty_charter_status, ["Not Started", "In Progress", "Complete"], "Not Started"),
      sovereignty_charter_detail: String(args.sovereignty_charter_detail || "").slice(0, 500),
      tax_status: normEnum(args.tax_status, ["Not Assessed", "In Progress", "Assessed"], "Not Assessed"),
      tax_detail: String(args.tax_detail || "").slice(0, 500),
      logic_trace: String(args.logic_trace || "").slice(0, 4000),
      generation_status: "ready",
      generation_error: null,
    };

    const { error: updErr } = await supabase
      .from("stabilization_maps")
      .update(update)
      .eq("id", mapId!);
    if (updErr) throw updErr;

    // Audit-trail log
    try {
      await supabase.from("sovereignty_audit_trail").insert({
        contact_id: contactId,
        user_id: userId,
        action_type: "stabilization_map_from_audit",
        action_description: `Stabilization Map generated from Sovereignty Audit${pdfName ? `: ${pdfName}` : ""}`,
        proposed_data: { mapId, fileName: pdfName || null },
      });
    } catch (e) {
      console.warn("[stabilization-map-from-audit] audit-trail insert failed", e);
    }

    return new Response(JSON.stringify({ success: true, mapId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[stabilization-map-from-audit] Fatal:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
