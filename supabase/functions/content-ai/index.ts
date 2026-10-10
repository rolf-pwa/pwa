import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_DRAFTING_MODEL, withThinking, fetchWithVertexRetry } from "../_shared/vertex-ai.ts";

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
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-region",
  };
}

// ---------- Vertex AI Auth ----------

const REGION = "northamerica-northeast1";
const MODEL = GEMINI_DRAFTING_MODEL;

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
    // Domain check: only @prosperwise.ca staff
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");
    if (!user.email?.toLowerCase().endsWith("@prosperwise.ca")) {
      return new Response(JSON.stringify({ error: "Access denied: unauthorized domain" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, title, body, platform, tone, audience } = await req.json();

    let systemPrompt = "";
    let userPrompt = "";

    if (action === "generate_draft") {
      systemPrompt = `You are a content strategist for a wealth management firm called ProsperWise Advisors. 
You write clear, authoritative, and approachable content about family wealth governance, financial planning, estate planning, and intergenerational wealth transfer.
Tone: ${tone || "professional yet warm"}
Target audience: ${audience || "high-net-worth families and business owners"}
Write in first person plural ("we") representing the firm.
Do NOT include any metadata, headers like "Title:" or "Body:" — just write the content directly.`;

      userPrompt = `Write a content piece with this title: "${title}"

Write a comprehensive article (600-1000 words) that would be suitable as a blog post. Include:
- An engaging opening hook
- 3-4 key points with supporting details
- A clear call to action at the end
- Natural paragraph breaks

Just write the article content, no meta-commentary.`;
    } else if (action === "repurpose") {
      const platformGuides: Record<string, string> = {
        linkedin: `Repurpose for LinkedIn:
- Keep it under 1300 characters
- Start with a compelling hook line
- Use short paragraphs (1-2 sentences each)
- Include relevant emojis sparingly
- End with a question or call to engagement
- Add 3-5 relevant hashtags
- Write in first person ("I") for LinkedIn personal branding`,
        substack: `Repurpose for Substack newsletter:
- Write a newsletter-style piece (800-1500 words)
- Start with a personal anecdote or observation
- Use a conversational, intimate tone
- Include section headers for scannability
- Add a "TL;DR" or key takeaway section
- End with a thoughtful question for readers`,
        wix_blog: `Repurpose for a Wix blog post:
- Write 500-800 words, optimized for SEO
- Include a compelling meta description (under 160 characters) prefixed with "META: "
- Use H2 and H3 headers for structure
- Include bullet points and numbered lists
- End with a clear call to action`,
      };

      systemPrompt = `You are a content repurposing expert for ProsperWise Advisors.
${platformGuides[platform] || "Adapt the content appropriately for the target platform."}
Output ONLY the repurposed content. No meta-commentary.`;

      userPrompt = `Original title: ${title}\n\nOriginal content:\n${body}\n\nRepurpose this for ${platform === "wix_blog" ? "a Wix blog post" : platform === "linkedin" ? "LinkedIn" : "Substack"}.`;
    } else if (action === "improve") {
      systemPrompt = `You are an expert editor for ProsperWise Advisors. Improve the given content by:
- Tightening the prose and removing filler
- Strengthening the opening hook
- Improving transitions
- Making the call to action more compelling
- Fixing grammar or style issues
Output ONLY the improved content.`;
      userPrompt = `Title: ${title}\n\nContent to improve:\n${body}`;
    } else if (action === "suggest_titles") {
      systemPrompt = `You are a content strategist for ProsperWise Advisors.
Generate 5 compelling content titles. Return ONLY a JSON array of 5 title strings.`;
      userPrompt = `Generate 5 content titles about: ${title || body}`;
    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Vertex AI call — pinned to Montreal
    const gcpKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!gcpKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    const sa: ServiceAccountKey = JSON.parse(gcpKeyRaw);
    const accessToken = await getAccessToken(sa);

    const vertexUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

    console.log(`[content-ai] Calling Vertex AI in ${REGION}`);

    const response = await fetchWithVertexRetry(vertexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] },
        ],
        generationConfig: withThinking(MODEL, { temperature: 0.5, maxOutputTokens: 4000 }, "low"),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[content-ai] Vertex AI error ${response.status}:`, errText);
      throw new Error("AI service error");
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("content-ai error:", err);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
