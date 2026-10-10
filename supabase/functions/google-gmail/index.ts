import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getValidGoogleAccessToken } from "../_shared/google-token.ts";

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function getHeader(headers: any[], name: string): string {
  return headers?.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

// Only the "list" action survives — this now backs the read-only email
// history panel on a contact's Communications tab, not a full inbox
// client (removed; see git history if that's ever needed again).
serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const accessToken = await getValidGoogleAccessToken(supabaseAdmin, user.id);
    const authH = { Authorization: `Bearer ${accessToken}` };

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const json = (obj: any, status = 200) =>
      new Response(JSON.stringify(obj), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    if (action === "list") {
      const query = url.searchParams.get("q") || "";
      const maxResults = url.searchParams.get("maxResults") || "15";
      const params: Record<string, string> = { maxResults };
      if (query) params.q = query;

      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams(params)}`,
        { headers: authH },
      );
      if (!listRes.ok) throw new Error(`Gmail list ${listRes.status}: ${await listRes.text()}`);
      const listData = await listRes.json();
      if (!listData.messages?.length) return json({ messages: [] });

      const details = await Promise.all(listData.messages.slice(0, parseInt(maxResults)).map(async (m: any) => {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
          { headers: authH },
        );
        return r.ok ? r.json() : null;
      }));
      const messages = details.filter(Boolean).map((msg: any) => ({
        id: msg.id, threadId: msg.threadId, snippet: msg.snippet,
        subject: getHeader(msg.payload?.headers || [], "Subject"),
        from: getHeader(msg.payload?.headers || [], "From"),
        to: getHeader(msg.payload?.headers || [], "To"),
        date: getHeader(msg.payload?.headers || [], "Date"),
        labelIds: msg.labelIds,
      }));
      return json({ messages });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (e) {
    console.error("google-gmail error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
