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
      "authorization, x-client-info, apikey, content-type, x-region",
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, contact_id, portal_token, task_gid, update_id, client_name } = await req.json();

    if (!contact_id || !action) {
      return new Response(JSON.stringify({ error: "Missing contact_id or action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!portal_token) {
      return new Response(JSON.stringify({ error: "portal_token is required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate portal_token (always required) — must belong to requested contact
    {
      const { data: tokenData } = await supabase
        .from("portal_tokens")
        .select("contact_id")
        .eq("token", portal_token)
        .eq("revoked", false)
        .gte("expires_at", new Date().toISOString())
        .maybeSingle();

      if (!tokenData || tokenData.contact_id !== contact_id) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Validate contact exists
    const { data: contact } = await supabase
      .from("contacts")
      .select("id, full_name")
      .eq("id", contact_id)
      .maybeSingle();

    if (!contact) {
      return new Response(JSON.stringify({ error: "Invalid contact" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "record_task_interaction") {
      if (!task_gid) {
        return new Response(JSON.stringify({ error: "task_gid required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Upsert task interaction
      await supabase
        .from("portal_task_interactions")
        .upsert(
          { contact_id, task_gid },
          { onConflict: "contact_id,task_gid" }
        );

      // Create staff notification
      const displayName = client_name || contact.full_name || "A client";
      await supabase.from("staff_notifications").insert({
        contact_id,
        title: `${displayName} opened a task`,
        body: `Task GID: ${task_gid}`,
        source_type: "task_opened",
        link: `/contacts/${contact_id}`,
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "record_update_read") {
      if (!update_id) {
        return new Response(JSON.stringify({ error: "update_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("marketing_update_reads").insert({
        contact_id,
        update_id,
      });

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get_interactions") {
      const { data } = await supabase
        .from("portal_task_interactions")
        .select("task_gid")
        .eq("contact_id", contact_id);

      return new Response(JSON.stringify({ data: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get_reads") {
      const { data } = await supabase
        .from("marketing_update_reads")
        .select("update_id")
        .eq("contact_id", contact_id);

      return new Response(JSON.stringify({ data: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get_updates") {
      const { data } = await supabase
        .from("marketing_updates")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      return new Response(JSON.stringify({ data: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("portal-track error:", err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
