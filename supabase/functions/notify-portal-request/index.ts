import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintMagicLink, plainPortalUrl } from "../_shared/portal-magic-link.ts";


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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

const TYPE_LABELS: Record<string, string> = {
  banking_withdrawal: "Banking & Withdrawals",
  personal_info: "Personal Info",
  document_request: "Document Request",
  data_access: "My Data — Access Request",
  general_inquiry: "General Inquiry",
};

const STATUS_LABELS: Record<string, string> = {
  submitted: "New",
  in_progress: "In Progress",
  resolved: "Resolved",
};

// ── Channel routing ──
// NOTIFICATION_CHANNEL controls outbound transactional email:
//   "wix"   (default) — only Wix Velo relay
//   "gmail"           — only admin@prosperwise.ca via Gmail connector
//   "both"            — fire both (useful for cutover testing)
function getChannels(): { wix: boolean; gmail: boolean } {
  const ch = (Deno.env.get("NOTIFICATION_CHANNEL") || "wix").toLowerCase();
  return { wix: ch === "wix" || ch === "both", gmail: ch === "gmail" || ch === "both" };
}

// ── Gmail (admin@) helper via send-admin-email edge function ──
async function sendViaGmail(args: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<{ sent: boolean; reason?: string; messageId?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return { sent: false, reason: "no_supabase_env" };
  }
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-admin-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        "x-internal-secret": Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "",
      },
      body: JSON.stringify(args),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[Notify] Gmail relay failed: ${res.status} ${body}`);
      return { sent: false, reason: "gmail_error" };
    }
    try {
      const json = JSON.parse(body);
      return { sent: true, messageId: json.messageId };
    } catch {
      return { sent: true };
    }
  } catch (err) {
    console.error("[Notify] Error calling send-admin-email:", err);
    return { sent: false, reason: "gmail_error" };
  }
}

// ── Wix relay helper ──
async function sendViaWix(payload: {
  email: string;
  subject: string;
  message: string;
  event_type: string;
  template_id?: string;
  [key: string]: string | undefined;
}): Promise<{ sent: boolean; reason?: string }> {
  const WIX_SITE_URL = Deno.env.get("WIX_SITE_URL");
  const WIX_OTP_SECRET = Deno.env.get("WIX_OTP_SECRET");

  if (!WIX_SITE_URL || !WIX_OTP_SECRET) {
    console.warn("[Notify] Wix secrets missing, cannot send email");
    return { sent: false, reason: "no_wix_config" };
  }

  const baseUrl = WIX_SITE_URL.replace(/\/sendOtp\/?$/, "");
  const notifyUrl = `${baseUrl}/sendNotification`;

  console.log(
    `[Notify] Sending ${payload.event_type} notification to ${payload.email} via ${notifyUrl} (subject: ${payload.subject})`
  );

  const relayPayload = {
    ...payload,
    // Backward/forward compatibility with Wix relay field naming
    title: payload.subject,
    email_subject: payload.subject,
    subject_line: payload.subject,
    update_title: payload.subject,
    secret: WIX_OTP_SECRET,
    // Allow overriding the template ID per notification type
    ...(payload.template_id ? { template_id: payload.template_id } : {}),
  };

  try {
    const wixRes = await fetch(notifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(relayPayload),
    });

    const wixBody = await wixRes.text();
    console.log(`[Notify] Wix response: ${wixRes.status} ${wixBody}`);

    if (!wixRes.ok) {
      console.error("[Notify] Wix relay failed:", wixRes.status, wixBody);
      return { sent: false, reason: "wix_error" };
    }

    return { sent: true };
  } catch (wixErr) {
    console.error("[Notify] Error calling Wix:", wixErr);
    return { sent: false, reason: "wix_error" };
  }
}

// Append short ET timestamp so Gmail does not collapse / dedup rapid-fire
// notifications with otherwise-identical subjects.
function uniqueifySubject(subject: string): string {
  try {
    const stamp = new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/Toronto",
    });
    return `${subject} · ${stamp} ET`;
  } catch {
    return `${subject} · ${new Date().toISOString().slice(11, 16)} UTC`;
  }
}

// Dispatch to whichever channels are enabled

async function dispatchNotification(args: {
  email: string;
  subject: string;
  message: string;
  event_type: string;
  template_id?: string;
  [key: string]: string | undefined;
}): Promise<{ sent: boolean; channels: Record<string, any> }> {
  const { wix, gmail } = getChannels();
  const channels: Record<string, any> = {};
  const tasks: Promise<void>[] = [];
  if (wix) {
    tasks.push(sendViaWix(args).then((r) => { channels.wix = r; }));
  }
  if (gmail) {
    tasks.push(
      sendViaGmail({ to: args.email, subject: uniqueifySubject(args.subject), text: args.message })
        .then((r) => { channels.gmail = r; })
    );
  }

  await Promise.all(tasks);
  const sent = Object.values(channels).some((r: any) => r?.sent);
  return { sent, channels };
}



serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { notify_type } = body;

    // ─── Marketing update notifications ───
    if (notify_type === "marketing_update") {
      const { title, url, target_governance_status, target_contact_ids, target_household_ids } = body;
      if (!title || !url) {
        return new Response(JSON.stringify({ error: "title and url required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Fetch targeted contacts based on targeting rules
      let contacts: any[] = [];

      if (target_contact_ids && target_contact_ids.length > 0) {
        // Targeted to specific contacts
        const { data } = await supabase
          .from("contacts")
          .select("id, email, first_name, email_notifications_enabled")
          .in("id", target_contact_ids)
          .not("email", "is", null)
          .eq("email_notifications_enabled", true);
        contacts = data || [];
      } else if (target_household_ids && target_household_ids.length > 0) {
        // Targeted to specific households — get all contacts in those households
        const { data } = await supabase
          .from("contacts")
          .select("id, email, first_name, email_notifications_enabled")
          .in("household_id", target_household_ids)
          .not("email", "is", null)
          .eq("email_notifications_enabled", true);
        contacts = data || [];
      } else if (target_governance_status && target_governance_status !== "all") {
        // Governance-status-based targeting -- now a household-level field,
        // so this needs an inner join to filter on it (PostgREST requires
        // `!inner` to filter by an embedded resource's own column).
        const { data } = await supabase
          .from("contacts")
          .select("id, email, first_name, email_notifications_enabled, households!inner(governance_status)")
          .not("email", "is", null)
          .eq("email_notifications_enabled", true)
          .eq("households.governance_status", target_governance_status);
        contacts = data || [];
      } else {
        // No targeting at all -- every notification-eligible contact.
        const { data } = await supabase
          .from("contacts")
          .select("id, email, first_name, email_notifications_enabled")
          .not("email", "is", null)
          .eq("email_notifications_enabled", true);
        contacts = data || [];
      }

      let sent = 0;

      for (const c of contacts || []) {
        if (!c.email) continue;
        const cleanEmail = c.email.trim().toLowerCase();
        const firstName = c.first_name || "there";

        // Insert portal client notification (visible in client portal)
        await supabase.from("portal_client_notifications").insert({
          contact_id: c.id,
          title: `New update: ${title}`,
          body: `A new update "${title}" has been posted for you.`,
          source_type: "marketing_update",
          link_tab: "updates",
        });

        const link = await mintMagicLink(supabase, { contactId: c.id, targetHash: "updates" });
        const url = link?.url || plainPortalUrl();
        await dispatchNotification({
          email: cleanEmail,
          subject: title,
          message: `Hi ${firstName},\n\nA new update has been posted for you: "${title}"\n\nOpen it here:\n${url}\n\n(This one-tap link is valid for 1 hour and works once. After that, sign in at https://app.prosperwise.ca)\n\nThank you,\nProsperWise Team`,
          event_type: "marketing_update",
          template_id: "VEXE9Be",
        });
        sent++;
      }

      return new Response(JSON.stringify({ sent, total: (contacts || []).length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // notify_type: "request" (default) | "task"

    // ─── Task notifications ───
    if (notify_type === "task") {
      const { contact_id, task_name, task_event } = body;
      // task_event: "comment" | "completed" | "reopened" | "updated"

      if (!contact_id || !task_name) {
        return new Response(JSON.stringify({ error: "contact_id and task_name required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: contact } = await supabase
        .from("contacts")
        .select("email, first_name, full_name, email_notifications_enabled")
        .eq("id", contact_id)
        .maybeSingle();

      // Always insert a portal client notification regardless of email settings
      let notifTitle = `Update on: ${task_name}`;
      if (task_event === "comment") notifTitle = `New comment on: ${task_name}`;
      else if (task_event === "completed") notifTitle = `Action item completed: ${task_name}`;
      else if (task_event === "reopened") notifTitle = `Action item reopened: ${task_name}`;

      await supabase.from("portal_client_notifications").insert({
        contact_id,
        title: notifTitle,
        body: task_name,
        source_type: `task_${task_event}`,
        link_tab: "tasks",
      });

      if (!contact?.email) {
        console.log("[Notify] No email for contact, skipping task notification");
        return new Response(JSON.stringify({ sent: false, reason: "no_email" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!contact.email_notifications_enabled) {
        console.log("[Notify] Notifications disabled for contact, skipping");
        return new Response(JSON.stringify({ sent: false, reason: "notifications_disabled" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cleanEmail = contact.email.trim().toLowerCase();
      const firstName = contact.first_name || "there";

      // Enqueue into the digest buffer. The process-email-digest cron groups
      // pending rows per recipient every 10 minutes and ships ONE email,
      // preventing rapid-fire bursts from being threaded/dropped by Gmail.
      const { error: enqueueErr } = await supabase
        .from("email_digest_queue")
        .insert({
          contact_id,
          recipient_email: cleanEmail,
          first_name: firstName,
          task_name,
          task_event: task_event || "updated",
          link_tab: "tasks",
        });

      if (enqueueErr) {
        console.error("[Notify] Failed to enqueue task digest item:", enqueueErr);
        return new Response(JSON.stringify({ sent: false, reason: "enqueue_failed", error: enqueueErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log(`[Notify] Enqueued task digest item for ${cleanEmail} (event: ${task_event})`);
      return new Response(JSON.stringify({ queued: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Portal request notifications (default) ───
    const { request_id, event_type } = body;

    if (!request_id) {
      return new Response(JSON.stringify({ error: "request_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: portalRequest, error: fetchErr } = await supabase
      .from("portal_requests")
      .select("*, contact:contacts(id, email, first_name, full_name, email_notifications_enabled)")
      .eq("id", request_id)
      .single();

    if (fetchErr || !portalRequest) {
      console.error("[Notify] Failed to fetch request:", fetchErr);
      return new Response(JSON.stringify({ error: "Request not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contact = portalRequest.contact as any;
    if (!contact?.email) {
      console.log("[Notify] No email for contact, skipping notification");
      return new Response(JSON.stringify({ sent: false, reason: "no_email" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!contact.email_notifications_enabled) {
      console.log("[Notify] Notifications disabled for contact, skipping");
      return new Response(JSON.stringify({ sent: false, reason: "notifications_disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cleanEmail = contact.email.trim().toLowerCase();
    const requestType = TYPE_LABELS[portalRequest.request_type] || portalRequest.request_type;
    const status = STATUS_LABELS[portalRequest.status] || portalRequest.status;

    const link = await mintMagicLink(supabase, { contactId: contact.id, targetHash: "requests" });
    const url = link?.url || plainPortalUrl();
    const linkFooter = `\n\nOpen it here:\n${url}\n\n(This one-tap link is valid for 1 hour and works once. After that, sign in at https://app.prosperwise.ca)`;

    let subject = "";
    let message = "";

    if (event_type === "new") {
      subject = `Your ${requestType} request has been received`;
      message = `Hi ${contact.first_name || "there"},\n\nWe've received your ${requestType} request and will get back to you shortly.\n\nRequest: ${portalRequest.request_description}${linkFooter}\n\nThank you,\nProsperWise Team`;
    } else if (event_type === "status_update") {
      subject = `Your ${requestType} request is now ${status}`;
      message = `Hi ${contact.first_name || "there"},\n\nYour ${requestType} request has been updated to: ${status}.\n\nRequest: ${portalRequest.request_description}${linkFooter}\n\nThank you,\nProsperWise Team`;
    } else if (event_type === "message") {
      subject = `New message on your ${requestType} request`;
      message = `Hi ${contact.first_name || "there"},\n\nYou have a new message regarding your ${requestType} request.${linkFooter}\n\nThank you,\nProsperWise Team`;
    } else {
      subject = `Update on your ${requestType} request`;
      message = `Hi ${contact.first_name || "there"},\n\nThere's an update on your ${requestType} request.\n\nCurrent status: ${status}${linkFooter}\n\nThank you,\nProsperWise Team`;
    }

    const result = await dispatchNotification({
      email: cleanEmail,
      subject,
      message,
      request_type: requestType,
      status,
      event_type,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[Notify] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
