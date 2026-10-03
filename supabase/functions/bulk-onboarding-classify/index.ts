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

// ---------- Vertex AI Auth ----------

const REGION = "northamerica-northeast1";
// Was a -preview-06-17 model Google shut down in Aug 2025; every call 404'd and
// degraded silently to "Unknown" client names.
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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");
    // Domain check
    if (!user.email?.toLowerCase().endsWith("@prosperwise.ca")) {
      return new Response(JSON.stringify({ error: "Access denied: unauthorized domain" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { chunkPaths } = await req.json();
    if (!chunkPaths?.length) throw new Error("No chunks provided");

    // Vertex AI auth
    const gcpKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!gcpKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    const sa: ServiceAccountKey = JSON.parse(gcpKeyRaw);
    const accessToken = await getAccessToken(sa);

    const vertexUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

    console.log(`[bulk-classify] Calling Vertex AI in ${REGION} for ${chunkPaths.length} chunk(s)`);

    const results: Array<{ chunkIndex: number; clientName: string; institutions: string[] }> = [];

    for (let i = 0; i < chunkPaths.length; i++) {
      const { data: fileData, error: dlErr } = await adminClient.storage
        .from("statement-uploads")
        .download(chunkPaths[i]);
      if (dlErr || !fileData) {
        console.error(`Failed to download chunk ${i}: ${dlErr?.message}`);
        results.push({ chunkIndex: i, clientName: "Unknown", institutions: [] });
        continue;
      }

      const arrayBuffer = await fileData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let j = 0; j < bytes.length; j++) {
        binary += String.fromCharCode(bytes[j]);
      }
      const base64 = btoa(binary);

      try {
        const aiResponse = await fetch(vertexUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { text: `Extract the primary account holder's full name (a real person, NOT a dealer firm) from this financial statement. Return ONLY JSON: {"client_name": "Firstname Lastname", "institutions": ["institution names"]}. No markdown.` },
                { inlineData: { mimeType: "application/pdf", data: base64 } },
              ],
            }],
            generationConfig: withThinking(MODEL, { temperature: 0, maxOutputTokens: 1024 }, "minimal"),
          }),
        });

        if (!aiResponse.ok) {
          const errText = await aiResponse.text();
          console.error(`[bulk-classify] Vertex AI error for chunk ${i}: ${aiResponse.status}`, errText);
          results.push({ chunkIndex: i, clientName: "Unknown", institutions: [] });
          continue;
        }

        const aiResult = await aiResponse.json();
        const rawContent = aiResult.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const jsonStr = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

        try {
          const parsed = JSON.parse(jsonStr);
          results.push({
            chunkIndex: i,
            clientName: parsed.client_name || "Unknown",
            institutions: parsed.institutions || [],
          });
        } catch {
          results.push({ chunkIndex: i, clientName: "Unknown", institutions: [] });
        }
      } catch (fetchErr) {
        console.error(`[bulk-classify] Fetch error for chunk ${i}:`, fetchErr);
        results.push({ chunkIndex: i, clientName: "Unknown", institutions: [] });
      }

      // Small delay between calls
      if (i < chunkPaths.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    return new Response(
      JSON.stringify({ success: true, classifications: results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("bulk-classify error:", err);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
