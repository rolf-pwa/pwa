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
    const body = await req.json();
    const { portal_token, action } = body;

    if (!portal_token) {
      return new Response(JSON.stringify({ error: "Missing portal_token" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate portal token
    const { data: portalToken, error: tokenError } = await supabase
      .from("portal_tokens")
      .select("contact_id")
      .eq("token", portal_token)
      .eq("revoked", false)
      .gte("expires_at", new Date().toISOString())
      .maybeSingle();

    if (tokenError || !portalToken) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Toggle notifications ──
    if (action === "toggle_notifications") {
      const { enabled } = body;
      if (typeof enabled !== "boolean") {
        return new Response(JSON.stringify({ error: "enabled (boolean) required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: updateErr } = await supabase
        .from("contacts")
        .update({ email_notifications_enabled: enabled })
        .eq("id", portalToken.contact_id);

      if (updateErr) {
        return new Response(JSON.stringify({ error: "Failed to update" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, enabled }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Update asset scope (default) ──
    const { asset_id, asset_table, new_scope } = body;

    if (!asset_id || !asset_table || !new_scope) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["vineyard_accounts", "storehouses"].includes(asset_table)) {
      return new Response(JSON.stringify({ error: "Invalid table" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!["private", "household_shared", "family_shared"].includes(new_scope)) {
      return new Response(JSON.stringify({ error: "Invalid scope" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify the asset belongs to this contact
    const { data: asset, error: assetError } = await supabase
      .from(asset_table)
      .select("id, contact_id")
      .eq("id", asset_id)
      .eq("contact_id", portalToken.contact_id)
      .maybeSingle();

    if (assetError || !asset) {
      return new Response(JSON.stringify({ error: "Asset not found or access denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update the scope
    const { error: updateError } = await supabase
      .from(asset_table)
      .update({ visibility_scope: new_scope })
      .eq("id", asset_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: "Failed to update scope" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Portal update scope error:", e);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
