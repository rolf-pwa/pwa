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
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-region",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => null);
    const request_id = typeof body?.request_id === "string" ? body.request_id : "";
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    const sender_type = body?.sender_type;
    const sender_name = typeof body?.sender_name === "string" ? body.sender_name.trim() || null : null;
    const portal_token = typeof body?.portal_token === "string" ? body.portal_token : null;

    if (!request_id || !content || (sender_type !== "client" && sender_type !== "advisor")) {
      return new Response(JSON.stringify({ error: "Missing or invalid fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !serviceKey || !publishableKey) {
      throw new Error("Missing backend configuration");
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    if (sender_type === "advisor") {
      const authHeader = req.headers.get("Authorization") ?? "";

      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Auth required" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabaseUser = createClient(supabaseUrl, publishableKey, {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      });

      const { data: userData, error: userError } = await supabaseUser.auth.getUser();

      if (userError || !userData.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    let requestData: any = null;

    if (sender_type === "client") {
      if (!portal_token) {
        return new Response(JSON.stringify({ error: "Auth required" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: tokenData } = await supabase
        .from("portal_tokens")
        .select("contact_id")
        .eq("token", portal_token)
        .eq("revoked", false)
        .gte("expires_at", new Date().toISOString())
        .maybeSingle();

      if (!tokenData) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data } = await supabase
        .from("portal_requests")
        .select("contact_id, request_type, status, contacts(full_name)")
        .eq("id", request_id)
        .maybeSingle();

      requestData = data;

      if (!requestData || requestData.contact_id !== tokenData.contact_id) {
        return new Response(JSON.stringify({ error: "Not authorized" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } else {
      const { data } = await supabase
        .from("portal_requests")
        .select("contact_id, request_type, status, contacts(full_name)")
        .eq("id", request_id)
        .maybeSingle();

      requestData = data;

      if (!requestData) {
        return new Response(JSON.stringify({ error: "Request not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { error: insertError } = await supabase
      .from("portal_request_messages")
      .insert({
        request_id,
        sender_type,
        sender_name,
        content,
      });

    if (insertError) throw insertError;

    if (sender_type === "client") {
      const contactName = requestData?.contacts?.full_name || "A client";
      const requestType = requestData?.request_type || "request";

      await supabase.from("staff_notifications").insert({
        title: `${contactName} replied to a ${requestType} request`,
        body: content.length > 100 ? `${content.substring(0, 100)}…` : content,
        link: "/requests",
        contact_id: requestData?.contact_id || null,
        source_type: "request_message",
      });
    }

    if (sender_type === "advisor") {
      if (requestData?.status === "submitted") {
        await supabase
          .from("portal_requests")
          .update({ status: "in_progress" })
          .eq("id", request_id);
      }

      // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions runtime
      EdgeRuntime.waitUntil(
        fetch(`${supabaseUrl}/functions/v1/notify-portal-request`, {
          method: "POST",
          headers: { "x-region": "ca-central-1",
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ request_id, event_type: "message" }),
        })
          .then((r) => r.text().then((t) => console.log(`[Notify] notify-portal-request responded ${r.status}: ${t}`)))
          .catch((e) => console.error("[Notify] Background error:", e))
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Portal request reply error:", e);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});