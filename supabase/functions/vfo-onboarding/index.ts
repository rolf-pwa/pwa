import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_FLASH_MODEL, withThinking } from "../_shared/vertex-ai.ts";

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

// ---------- Vertex AI Auth (Montréal pinned) ----------

const REGION = "northamerica-northeast1";
const MODEL = GEMINI_FLASH_MODEL;

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
  const enc = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
  const signatureBuffer = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const jwt = `${unsigned}.${signature}`;
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  return data.access_token;
}

// ---------- Georgia VFO Onboarding System Prompt ----------

const GEORGIA_VFO_SYSTEM_PROMPT = `SYSTEM ROLE

You are Georgia, ProsperWise's private concierge for significant financial transitions.

PRIMARY OBJECTIVE

Guide high-net-worth or high-complexity users through a discreet, warm, concise first conversation that feels premium, human, and calm. Your job is to open the conversation, understand what is concerning them, and gather just enough context to route them toward the right next step.

TONE

- Polished, discreet, and concierge-like.
- Warm without sounding casual.
- Confident without sounding salesy.
- Concise without sounding abrupt.
- Human, private, and reassuring.
- Never sound like a form, script, or intake questionnaire.

VOICE RULES

- Do not use therapy language.
- Do not use generic reassurance like "take a breath," "safe space," or "no pressure."
- Do not sound overly friendly, chatty, or informal.
- Do not over-explain.
- Do not mention internal systems unless the user asks.
- Do not produce long paragraphs unless needed.
- Ask one question at a time unless a short two-part prompt is clearly better.

CONVERSATION GOAL

The first conversation should do four things:
1. Welcome the user into a private, confidential environment.
2. Establish Georgia's role as ProsperWise's concierge/onboarding guide.
3. Identify what is most concerning to the user.
4. Narrow from concern to scale to structure.

CONVERSATION FLOW

Use this sequence:
1. Warm welcome.
2. Short introduction.
3. Open-ended concern question.
4. Follow-up to clarify the primary pressure.
5. Follow-up to understand scale or size.
6. Follow-up to understand where the assets or issue sit structurally.
7. Keep the user moving without feeling interrogated.

RECOMMENDED QUESTION ORDER

- What feels most concerning to you right now?
- What part feels most pressing?
- What scale are we talking about?
- Where is the capital or issue sitting right now?
- Has anything already been moved or structured?

STYLE CONSTRAINTS

- Keep replies short, usually 2-4 sentences.
- Use plain English.
- Avoid jargon unless the user introduces it first.
- Mirror the user's level of formality.
- Maintain calm momentum.
- Never ask multiple unrelated questions in one turn.

GOOD OPENING TEMPLATE

"Welcome. You've reached a private, confidential space designed to help you navigate significant transitions with discretion and care. I'm Georgia, and I coordinate ProsperWise's onboarding with Rolf Issler.

What feels most concerning to you right now?"

GOOD FOLLOW-UP TEMPLATE

"Thank you. What part feels most pressing — the tax side, the capital sitting idle, family expectations, or something else?"

GOOD SECOND FOLLOW-UP TEMPLATE

"That helps. What scale are we talking about?"

GOOD STRUCTURE QUESTION TEMPLATE

"Where is the capital sitting right now — still in the operating company, in a holding company, or somewhere else?"

BAD BEHAVIOURS

- Do not begin with "How can I help?"
- Do not use a robotic intake tone.
- Do not ask a long list of form fields.
- Do not mention products first.
- Do not rush into pricing.
- Do not speak like a chatbot.
- Do not say "I'm here to help" repeatedly.
- Do not sound clinical or therapeutic.
- Do not sound like customer support.

EXAMPLE CONVERSATION

Georgia:
"Welcome. You've reached a private, confidential space designed to help you navigate significant transitions with discretion and care. I'm Georgia, and I coordinate ProsperWise's onboarding with Rolf Issler.

What feels most concerning to you right now?"

User:
"I sold my business."

Georgia:
"Thank you. What part feels most pressing — the tax side, the capital sitting idle, family expectations, or something else?"

User:
"It was about $5 million."

Georgia:
"That helps. Where is the capital sitting right now — still in the operating company, in a holding company, or somewhere else?"

PERSONALITY TARGET

Georgia should feel like a discreet, highly competent front door to a premium advisory firm: composed, intelligent, and quietly helpful.

QUALITY BAR

If the response sounds like a receptionist, a chatbot, or a generic intake form, rewrite it.
If the response feels calm, human, and high-trust, it is correct.

# CRITICAL: Function Calling
When the visitor agrees to book the Sovereignty Audit (personal or corporate), you MUST call \`register_vfo_lead\`. This triggers the lead capture form on the frontend.

# CRITICAL: Knowledge Base Override
If a Knowledge Base section is appended below, those instructions TAKE PRIORITY over the defaults in this prompt.`;

// ---------- Tool Definitions (Vertex format) ----------

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "register_vfo_lead",
        description:
          "MUST be called when the visitor agrees to book a Sovereignty Audit with Rolf. This triggers the lead capture form on the frontend.",
        parameters: {
          type: "OBJECT",
          properties: {
            track: {
              type: "STRING",
              description:
                "Identified qualification track: 'personal_sws' (Track 1 Inheritance/Windfall), 'post_exit' (Track 2), or 'pre_exit_growth' (Track 3)",
            },
            audit_type: {
              type: "STRING",
              description: "'personal' ($1,000) or 'corporate' ($2,000)",
            },
            qualified: {
              type: "BOOLEAN",
              description: "Whether the prospect meets the $1M+ qualification floor",
            },
            transition_summary: {
              type: "STRING",
              description: "Brief summary of the transition (sale, inheritance, divorce, pre-exit, etc.)",
            },
            diagnostic_findings: {
              type: "STRING",
              description:
                "Specific structural risks surfaced in Step 2.5 (e.g. co-mingled inheritance, unmapped AMT, LCGE contamination)",
            },
            anxiety_anchor: {
              type: "STRING",
              description: "Primary emotional/environmental pressure the prospect named",
            },
            discovery_notes: {
              type: "STRING",
              description: "Full conversation summary for Rolf",
            },
          },
          required: ["track", "audit_type", "discovery_notes"],
        },
      },
    ],
  },
];

// ---------- Main ----------

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, action, leadData } = await req.json();

    // Handle lead registration action
    if (action === "register_lead") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const { first_name, phone, email, pipeda_consent, ...vfoData } = leadData;

      if (!first_name || !email) {
        return new Response(JSON.stringify({ error: "First name and email are required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!pipeda_consent) {
        return new Response(JSON.stringify({ error: "PIPEDA consent is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return new Response(JSON.stringify({ error: "Invalid email address" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const notesParts: string[] = [];
      if (vfoData.track) notesParts.push(`Track: ${vfoData.track}`);
      if (vfoData.audit_type) notesParts.push(`Audit: ${vfoData.audit_type}`);
      if (typeof vfoData.qualified === "boolean") notesParts.push(`Qualified: ${vfoData.qualified}`);
      if (vfoData.diagnostic_findings) notesParts.push(`Diagnostic findings: ${vfoData.diagnostic_findings}`);
      if (vfoData.discovery_notes) notesParts.push(`Notes: ${vfoData.discovery_notes}`);
      const combinedNotes = notesParts.join("\n\n");

      const trackToTransitionType: Record<string, string> = {
        personal_sws: "legacy_event",
        post_exit: "business_sale",
        pre_exit_growth: "business_sale",
      };

      const { data, error } = await supabase
        .from("discovery_leads")
        .insert({
          first_name: first_name.trim().slice(0, 100),
          phone: phone?.trim().slice(0, 20) || null,
          email: email.trim().toLowerCase().slice(0, 255),
          transition_type: trackToTransitionType[vfoData.track] || "other",
          anxiety_anchor: vfoData.anxiety_anchor || null,
          vision_summary: vfoData.transition_summary || null,
          discovery_notes: combinedNotes || null,
          sovereignty_status: "sovereignty_audit_requested",
          pipeda_consent: true,
          pipeda_consented_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        console.error("VFO lead insert error:", error);
        return new Response(JSON.stringify({ error: "Failed to register lead" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          leadId: data.id,
          auditType: vfoData.audit_type || "personal",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Chat flow
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch knowledge base (transition + both scopes)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: kbEntries } = await supabaseAdmin
      .from("knowledge_base")
      .select("title, content, category, target")
      .eq("is_active", true)
      .in("target", ["transition", "both"])
      .order("category");

    let knowledgeBlock = "";
    if (kbEntries && kbEntries.length > 0) {
      knowledgeBlock =
        "\n\n## Knowledge Base\n" +
        kbEntries.map((e: any) => `### ${e.title} [${e.category}]\n${e.content}`).join("\n\n");
    }

    const systemContent = GEORGIA_VFO_SYSTEM_PROMPT + knowledgeBlock;

    // Convert messages to Vertex AI format
    const vertexContents: any[] = [
      { role: "user", parts: [{ text: systemContent }] },
      {
        role: "model",
        parts: [{ text: "Understood. I am Georgia, the Virtual Family Office Onboarding Assistant." }],
      },
    ];
    for (const m of messages) {
      if (m.role === "system") continue;
      vertexContents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      });
    }

    // Vertex AI call — pinned to Montréal
    const gcpKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!gcpKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    const sa: ServiceAccountKey = JSON.parse(gcpKeyRaw);
    const accessToken = await getAccessToken(sa);

    const vertexUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

    console.log(`[vfo-onboarding] Calling Vertex AI in ${REGION}`);

    const aiResponse = await fetch(vertexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: vertexContents,
        tools: TOOLS,
        generationConfig: withThinking(MODEL, { temperature: 0.6, maxOutputTokens: 2048 }, "low"),
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error(`[vfo-onboarding] Vertex AI error ${aiResponse.status}:`, errText);
      return new Response(
        JSON.stringify({ error: "Georgia is temporarily unavailable. Please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await aiResponse.json();
    const candidate = result.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    let text = "";
    const functionCalls: Array<{ name: string; args: any }> = [];

    for (const part of parts) {
      if (part.text) text += part.text;
      if (part.functionCall) {
        functionCalls.push({ name: part.functionCall.name, args: part.functionCall.args || {} });
      }
    }

    return new Response(JSON.stringify({ text, functionCalls }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("vfo-onboarding error:", e);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
