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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!apiKey || apiKey !== Deno.env.get("EXTERNAL_API_KEY")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Hard safety cap: this endpoint is intended for backup snapshots, not
    // arbitrary data extraction. Any single-table page is limited to 1000 rows;
    // callers must paginate with ?offset= to walk larger tables. This prevents
    // a single API key holder from siphoning the entire dataset in one call.
    const url = new URL(req.url);
    const PAGE = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") ?? "1000")));
    const OFFSET = Math.max(0, Number(url.searchParams.get("offset") ?? "0"));
    const range = (q: any) => q.range(OFFSET, OFFSET + PAGE - 1);

    const [households, contacts, corporations, shareholders] = await Promise.all([
      range(supabase.from("households").select("*")),
      range(supabase.from("contacts").select("*")),
      range(supabase.from("corporations").select("*")),
      range(supabase.from("shareholders").select("*")),
    ]);

    const [families, vineyardAccounts, storehouses, corpVineyard, corpShareholders, portalRequests, auditTrail] = await Promise.all([
      range(supabase.from("families").select("*")),
      range(supabase.from("vineyard_accounts").select("*")),
      range(supabase.from("storehouses").select("*")),
      range(supabase.from("corporate_vineyard_accounts").select("*")),
      range(supabase.from("corporate_shareholders").select("*")),
      range(supabase.from("portal_requests").select("*, messages:portal_request_messages(*)")),
      range(supabase.from("sovereignty_audit_trail").select("*")),
    ]);

    // NOTE: portal_tokens was previously included here. It contained credential
    // metadata (token hashes, expiry) that should never leave the backend in a
    // routine export. Excluded intentionally.

    return new Response(JSON.stringify({
      _meta: { limit: PAGE, offset: OFFSET, note: "Paginate with ?offset=<n>&limit=<=1000>" },
      households: households.data || [],
      contacts: contacts.data || [],
      corporations: corporations.data || [],
      shareholders: shareholders.data || [],
      families: families.data || [],
      vineyard_accounts: vineyardAccounts.data || [],
      storehouses: storehouses.data || [],
      corporate_vineyard_accounts: corpVineyard.data || [],
      corporate_shareholders: corpShareholders.data || [],
      portal_requests: portalRequests.data || [],
      audit_trail: auditTrail.data || [],
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Export error:", e);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
