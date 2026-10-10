import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validateProSession } from "../_shared/pro-portal-auth.ts";
import { checkOutboundPii } from "../_shared/pii-shield.ts";

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
      "authorization, x-client-info, apikey, content-type, x-pro-session, x-region",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = "https://app.prosperwise.ca";

async function notifyViaGmail(opts: { to: string; subject: string; text: string }) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-admin-email`, {
      method: "POST",
      headers: { "x-region": "ca-central-1",
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        "x-internal-secret": Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "",
      },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error(`[engagement-message-send] Gmail relay failed ${res.status}: ${t}`);
    }
  } catch (e) {
    console.error("[engagement-message-send] notify error", e);
  }
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json();
    const engagement_id = String(body.engagement_id || "");
    const messageBody = String(body.body || "").trim();
    if (!engagement_id || !messageBody) {
      return new Response(JSON.stringify({ error: "engagement_id and body required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Identify sender: pro session token OR staff JWT
    let sender_type: "staff" | "pro";
    let sender_id: string | null = null;
    let professional_id: string | null = null;

    const proToken = req.headers.get("x-pro-session");
    if (proToken) {
      const sess = await validateProSession(supabase, proToken);
      if (!sess) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      sender_type = "pro";
      sender_id = sess.professional_id;
      professional_id = sess.professional_id;
    } else {
      const authHeader = req.headers.get("Authorization") || "";
      if (!authHeader.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const supabaseUser = createClient(
        SUPABASE_URL,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user }, error } = await supabaseUser.auth.getUser();
      if (error || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      sender_type = "staff";
      sender_id = user.id;
    }

    // Load engagement (also confirms pro scope when sender is pro)
    const { data: engagement } = await supabase
      .from("professional_engagements")
      .select("id, title, professional_id, status, created_by")
      .eq("id", engagement_id)
      .maybeSingle();
    if (!engagement) {
      return new Response(JSON.stringify({ error: "Engagement not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (sender_type === "pro" && engagement.professional_id !== professional_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (["completed", "archived", "revoked"].includes(engagement.status)) {
      return new Response(JSON.stringify({ error: `Engagement is ${engagement.status}` }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PII Shield: block financial/health PII from leaving Canadian infra
    const pii = checkOutboundPii(messageBody);
    if (pii.blocked) {
      return new Response(
        JSON.stringify({ error: "PII Shield blocked", reason: pii.reason }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Insert message
    const now = new Date().toISOString();
    const { data: inserted, error: insertErr } = await supabase
      .from("engagement_messages")
      .insert({
        engagement_id,
        sender_type,
        sender_id,
        body: messageBody,
        attachments: Array.isArray(body.attachments) ? body.attachments : [],
        read_by_staff_at: sender_type === "staff" ? now : null,
        read_by_pro_at: sender_type === "pro" ? now : null,
      })
      .select("id, created_at")
      .single();
    if (insertErr) throw insertErr;

    // Audit trail
    await supabase.from("sovereignty_audit_trail").insert({
      action_type: "engagement_message_sent",
      action_description: `${sender_type} sent a message on engagement "${engagement.title}"`,
      proposed_data: { engagement_id, message_id: inserted.id, sender_type },
      user_id: sender_type === "staff" ? sender_id : null,
    }).then(() => {}, () => {/* best-effort */});

    // Notify the other party via Gmail relay (link-only, no PII in email body)
    const proRecord = await supabase
      .from("professionals")
      .select("email, full_name")
      .eq("id", engagement.professional_id)
      .maybeSingle();

    if (sender_type === "staff" && proRecord.data?.email) {
      const to = proRecord.data.email;
      const subject = `New message — ${engagement.title}`;
      const text = `Hello ${proRecord.data.full_name || ""},\n\nA new message is waiting for you in the ProsperWise Pro Portal regarding "${engagement.title}".\n\nSign in to view it:\n${APP_URL}/pro-portal/login\n\n— ProsperWise`;
      await notifyViaGmail({ to, subject, text });
    } else if (sender_type === "pro") {
      // Notify the engagement creator (advisor) if we can find their email
      let staffEmail: string | null = null;
      if (engagement.created_by) {
        const { data: prof } = await supabase
          .from("profiles").select("email").eq("user_id", engagement.created_by).maybeSingle();
        staffEmail = prof?.email || null;
      }
      // Fallback: NOTIFICATION_CHANNEL admin (admin@prosperwise.ca)
      if (!staffEmail) staffEmail = "admin@prosperwise.ca";
      const subject = `Pro reply — ${engagement.title}`;
      const text = `${proRecord.data?.full_name || "A professional"} has posted a new reply on the engagement "${engagement.title}".\n\nReview it in the ProsperWise dashboard:\n${APP_URL}/professionals\n`;
      await notifyViaGmail({ to: staffEmail, subject, text });

      // Also drop a staff bell notification
      await supabase.from("staff_notifications").insert({
        title: `Pro reply — ${engagement.title}`,
        body: "A professional posted a new message.",
        link: `/professionals/${engagement.professional_id}`,
        source_type: "engagement_message",
      }).then(() => {}, () => {/* best-effort */});
    }

    return new Response(
      JSON.stringify({ message: { id: inserted.id, created_at: inserted.created_at } }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[engagement-message-send] error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
