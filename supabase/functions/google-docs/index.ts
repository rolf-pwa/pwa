import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-region",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

async function getValidToken(supabaseAdmin: any, userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("google_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) throw new Error("Google not connected. Please reconnect with Drive access.");

  if (new Date(data.token_expiry) <= new Date()) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: data.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tokens = await res.json();
    if (tokens.error) throw new Error(`Token refresh failed: ${tokens.error}`);

    const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await supabaseAdmin
      .from("google_tokens")
      .update({ access_token: tokens.access_token, token_expiry: newExpiry })
      .eq("user_id", userId);

    return tokens.access_token;
  }

  return data.access_token;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const accessToken = await getValidToken(supabaseAdmin, userId);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // List recent Google Docs from Drive
    if (action === "list") {
      const q = url.searchParams.get("q") || "";
      const query = `mimeType='application/vnd.google-apps.document'${q ? ` and fullText contains '${q.replace(/'/g, "\\'")}'` : ""}`;
      const params = new URLSearchParams({
        q: query,
        orderBy: "modifiedTime desc",
        pageSize: "20",
        fields: "files(id,name,modifiedTime,webViewLink)",
      });

      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Failed to list docs");

      return new Response(JSON.stringify({ files: data.files || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get a Google Doc's content as plain text
    if (action === "get") {
      let docId = url.searchParams.get("docId");
      const docUrl = url.searchParams.get("url");

      // Extract doc ID from URL if provided
      if (!docId && docUrl) {
        const match = docUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (match) docId = match[1];
      }

      if (!docId) {
        return new Response(JSON.stringify({ error: "docId or url parameter required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get doc metadata
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${docId}?fields=id,name,modifiedTime`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const meta = await metaRes.json();
      if (!metaRes.ok) throw new Error(meta.error?.message || "Failed to get doc metadata");

      // Export as plain text
      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${docId}/export?mimeType=text/plain`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!exportRes.ok) {
        const errText = await exportRes.text();
        throw new Error(`Failed to export doc: ${errText}`);
      }
      const content = await exportRes.text();

      return new Response(JSON.stringify({
        id: meta.id,
        name: meta.name,
        modifiedTime: meta.modifiedTime,
        content,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use 'list' or 'get'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("google-docs error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
