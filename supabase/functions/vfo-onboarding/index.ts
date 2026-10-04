import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_CLIENT_CHAT_MODEL, withThinking, fetchWithVertexRetry } from "../_shared/vertex-ai.ts";
import { GEORGIA_VFO_SYSTEM_PROMPT, VFO_TOOLS as TOOLS, cleanGeorgiaReply } from "../_shared/georgia-chat-config.ts";

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
const MODEL = GEMINI_CLIENT_CHAT_MODEL;

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

    const aiResponse = await fetchWithVertexRetry(vertexUrl, {
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

    text = cleanGeorgiaReply(text);
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
