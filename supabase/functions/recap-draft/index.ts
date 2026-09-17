// Uses Deno.serve
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
const MODEL = "gemini-2.5-flash";

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
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
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

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
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { date } = await req.json();
    const targetDate = date || new Date().toISOString().split("T")[0];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // Gather day's activity
    const dayStart = `${targetDate}T00:00:00Z`;
    const dayEnd = `${targetDate}T23:59:59Z`;

    const [
      { data: requests },
      { data: pipelineChanges },
      { data: contactsModified },
      { data: holdingTankChanges },
      { data: auditEntries },
      { data: reviewItems },
    ] = await Promise.all([
      sb.from("portal_requests").select("request_type, request_description, status, contact_id").gte("created_at", dayStart).lte("created_at", dayEnd),
      sb.from("business_pipeline").select("category, status, amount, notes").gte("updated_at", dayStart).lte("updated_at", dayEnd),
      sb.from("contacts").select("full_name, households(governance_status)").gte("updated_at", dayStart).lte("updated_at", dayEnd),
      sb.from("holding_tank").select("account_name, status, current_value").gte("updated_at", dayStart).lte("updated_at", dayEnd),
      sb.from("sovereignty_audit_trail").select("action_type, action_description").gte("created_at", dayStart).lte("created_at", dayEnd),
      sb.from("review_queue").select("action_type, action_description, status").gte("created_at", dayStart).lte("created_at", dayEnd),
    ]);

    const activitySummary = JSON.stringify({
      date: targetDate,
      portal_requests: requests || [],
      pipeline_changes: pipelineChanges || [],
      contacts_modified: contactsModified || [],
      holding_tank_activity: holdingTankChanges || [],
      audit_trail: auditEntries || [],
      review_queue: reviewItems || [],
    });

    // Authenticate with GCP service account for Vertex AI
    const gcpKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!gcpKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    const sa: ServiceAccountKey = JSON.parse(gcpKeyRaw);
    const accessToken = await getAccessToken(sa);

    // Call Vertex AI directly — pinned to Montreal (northamerica-northeast1)
    const vertexUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

    console.log(`[recap-draft] Calling Vertex AI in ${REGION} with model ${MODEL}`);

    const systemPrompt = `You are a daily operations assistant for ProsperWise, a boutique family office advisory firm. Write a concise daily recap in well-structured markdown.

FORMAT RULES (follow exactly):
- Use ## for each section heading (e.g. ## Client Requests)
- Under each heading, use bullet points (- ) for each item
- Indent sub-details with nested bullets (  - )
- Include names, amounts, and statuses where available
- Skip any section that has no data — do not include empty sections
- End with a ## Key Takeaways section containing 2-3 bullet points summarizing the most important items

SECTIONS (use these exact headings when data exists):
## Client Requests
## Pipeline Activity
## Contacts Updated
## Holding Tank
## Governance & Compliance
## Key Takeaways

Keep it professional, concise, and action-oriented.`;

    const aiResponse = await fetch(vertexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: systemPrompt + "\n\nGenerate a daily recap for " + targetDate + " based on this activity data:\n\n" + activitySummary }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4000,
        },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error(`[recap-draft] Vertex AI error ${aiResponse.status}:`, errText);
      throw new Error("AI gateway error: " + errText);
    }

    const aiResult = await aiResponse.json();
    const draft = aiResult.candidates?.[0]?.content?.parts?.[0]?.text || "No activity found for this date.";

    return new Response(JSON.stringify({ draft, date: targetDate }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("recap-draft error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
