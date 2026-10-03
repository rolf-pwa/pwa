import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_CLIENT_CHAT_MODEL, withThinking, fetchWithVertexRetry } from "../_shared/vertex-ai.ts";
import { GEORGIA_CLIENT_PROMPT, PORTAL_TOOLS as TOOLS, cleanGeorgiaReply } from "../_shared/georgia-chat-config.ts";

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

// ---------- Vertex AI Auth ----------

const REGION = "northamerica-northeast1"; // Montreal — PIPEDA compliance
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
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${enc(header)}.${enc(payload)}`;
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned)
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Handle form submission action
    if (body.action === "submit_request") {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      const { requestData } = body;
      if (!requestData?.contact_id || !requestData?.request_type || !requestData?.request_description) {
        return new Response(
          JSON.stringify({ error: "Missing required fields" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Require a valid portal_token bound to the requested contact_id.
      const portalToken = requestData.portal_token;
      if (!portalToken || typeof portalToken !== "string") {
        return new Response(
          JSON.stringify({ error: "portal_token is required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { data: tokenRow } = await supabase
        .from("portal_tokens")
        .select("contact_id")
        .eq("token", portalToken)
        .eq("revoked", false)
        .gte("expires_at", new Date().toISOString())
        .maybeSingle();
      if (!tokenRow || tokenRow.contact_id !== requestData.contact_id) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (requestData.request_description.length > 2000) {
        return new Response(
          JSON.stringify({ error: "Description too long (max 2000 characters)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const validTypes = ["banking_withdrawal", "personal_info", "document_request", "data_access", "general_inquiry"];
      if (!validTypes.includes(requestData.request_type)) {
        return new Response(
          JSON.stringify({ error: "Invalid request type" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data, error } = await supabase.from("portal_requests").insert({
        contact_id: requestData.contact_id,
        request_type: requestData.request_type,
        request_description: requestData.request_description.slice(0, 2000),
        request_details: requestData.request_details || {},
        file_urls: requestData.file_urls || [],
        status: "submitted",
      }).select().single();

      if (error) {
        console.error("Insert error:", error);
        return new Response(
          JSON.stringify({ error: "Failed to submit request" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Create in-app notification for staff
      try {
        const { data: contactInfo } = await supabase
          .from("contacts")
          .select("full_name")
          .eq("id", requestData.contact_id)
          .maybeSingle();
        const contactName = contactInfo?.full_name || "A client";
        const typeLabel = requestData.request_type?.replace(/_/g, " ") || "request";
        await supabase.from("staff_notifications").insert({
          title: `${contactName} submitted a new ${typeLabel} request`,
          body: requestData.request_description?.substring(0, 100) || null,
          link: "/requests",
          contact_id: requestData.contact_id,
          source_type: "new_request",
        });
      } catch (notifErr) {
        console.error("[PortalAssistant] Failed to create staff notification:", notifErr);
      }

      // Fire notification email (non-blocking)
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions runtime
      EdgeRuntime.waitUntil(
        fetch(`${supabaseUrl}/functions/v1/notify-portal-request`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ request_id: data.id, event_type: "new" }),
        })
          .then((r) => r.text().then((t) => console.log(`[Notify] notify-portal-request responded ${r.status}: ${t}`)))
          .catch((e) => console.error("[Notify] Background error:", e))
      );

      return new Response(
        JSON.stringify({ success: true, requestId: data.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Chat flow — require a valid portal_token to prevent unauth Vertex AI abuse
    // and KB exfiltration.
    const { messages, portal_token: chatPortalToken } = body;
    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: "messages array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (!chatPortalToken || typeof chatPortalToken !== "string") {
      return new Response(
        JSON.stringify({ error: "portal_token is required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { data: chatTokenRow } = await supabaseAdmin
      .from("portal_tokens")
      .select("contact_id")
      .eq("token", chatPortalToken)
      .eq("revoked", false)
      .gte("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!chatTokenRow) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired portal token" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch active knowledge base entries scoped to portal
    const { data: kbEntries } = await supabaseAdmin
      .from("knowledge_base")
      .select("title, content, category")
      .eq("is_active", true)
      .in("target", ["portal", "both"])
      .order("category");

    let knowledgeBlock = "";
    if (kbEntries && kbEntries.length > 0) {
      knowledgeBlock = "\n\n## Knowledge Base\nUse the following information to answer questions accurately:\n\n" +
        kbEntries.map((e: any) => `### ${e.title} [${e.category}]\n${e.content}`).join("\n\n");
    }

    const systemContent = GEORGIA_CLIENT_PROMPT + knowledgeBlock;
    const userMessages = messages.filter((m: any) => m.role !== "system").map((m: any) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // Authenticate with GCP service account for Vertex AI
    const gcpKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!gcpKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    
    let sa: ServiceAccountKey;
    try {
      sa = JSON.parse(gcpKeyRaw);
    } catch (parseErr) {
      // Try common fixes: trim whitespace, remove BOM, unescape
      let cleaned = gcpKeyRaw.trim().replace(/^\uFEFF/, "");
      // If it looks double-encoded (starts with quote), unwrap
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        try { cleaned = JSON.parse(cleaned); } catch {}
      }
      // Replace literal \n in private_key field that may have been escaped
      try {
        sa = JSON.parse(cleaned);
      } catch {
        console.error("[portal-assistant] GCP key parse failed. First 50 chars:", gcpKeyRaw.substring(0, 50));
        console.error("[portal-assistant] Last 50 chars:", gcpKeyRaw.substring(gcpKeyRaw.length - 50));
        console.error("[portal-assistant] Length:", gcpKeyRaw.length);
        throw new Error("GCP_SERVICE_ACCOUNT_KEY contains invalid JSON. Please re-enter the full JSON key file contents.");
      }
    }
    
    if (!sa.private_key || !sa.client_email || !sa.project_id) {
      throw new Error("GCP key is missing required fields (private_key, client_email, project_id). Please paste the FULL JSON key file.");
    }
    const accessToken = await getAccessToken(sa);

    const vertexUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

    console.log(`[portal-assistant] Calling Vertex AI in ${REGION}`);

    const aiResponse = await fetchWithVertexRetry(vertexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: systemContent }] },
          { role: "model", parts: [{ text: "Understood. I am Georgia, the Client Support Assistant. How can I help?" }] },
          ...userMessages,
        ],
        tools: TOOLS,
        generationConfig: withThinking(MODEL, { temperature: 0.5, maxOutputTokens: 1024 }, "low"),
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error(`[portal-assistant] Vertex AI error ${aiResponse.status}:`, errText);
      return new Response(
        JSON.stringify({ error: "Georgia is temporarily unavailable. Please try again in a moment." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
    return new Response(
      JSON.stringify({ text, functionCalls }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("portal-assistant error:", e);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
