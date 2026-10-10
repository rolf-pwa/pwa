// Process the email_digest_queue: group pending task notifications per
// recipient, send ONE digest email, and mark the rows as sent.
// Triggered by pg_cron every 10 minutes.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mintMagicLink, plainPortalUrl } from "../_shared/portal-magic-link.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-digest-cron-secret, x-region",
};

const CRON_SECRET = Deno.env.get("DIGEST_CRON_SECRET");

function isCronCaller(req: Request): boolean {
  if (!CRON_SECRET) return false;
  return req.headers.get("x-digest-cron-secret") === CRON_SECRET;
}

const EVENT_LABEL: Record<string, string> = {
  comment: "New comment",
  completed: "Completed",
  reopened: "Reopened",
  updated: "Updated",
};

function getChannels(): { wix: boolean; gmail: boolean } {
  const ch = (Deno.env.get("NOTIFICATION_CHANNEL") || "wix").toLowerCase();
  return { wix: ch === "wix" || ch === "both", gmail: ch === "gmail" || ch === "both" };
}

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

async function sendViaGmail(to: string, subject: string, text: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return { sent: false, reason: "no_supabase_env" };
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-admin-email`, {
      method: "POST",
      headers: { "x-region": "ca-central-1",
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        "x-internal-secret": Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "",
      },
      body: JSON.stringify({ to, subject, text }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[Digest] Gmail send failed: ${res.status} ${body}`);
      return { sent: false, reason: "gmail_error" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[Digest] Gmail error:", err);
    return { sent: false, reason: "gmail_error" };
  }
}

async function sendViaWix(email: string, subject: string, message: string) {
  const WIX_SITE_URL = Deno.env.get("WIX_SITE_URL");
  const WIX_OTP_SECRET = Deno.env.get("WIX_OTP_SECRET");
  if (!WIX_SITE_URL || !WIX_OTP_SECRET) return { sent: false, reason: "no_wix_config" };
  const baseUrl = WIX_SITE_URL.replace(/\/sendOtp\/?$/, "");
  const notifyUrl = `${baseUrl}/sendNotification`;
  try {
    const res = await fetch(notifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        subject,
        message,
        event_type: "task_digest",
        title: subject,
        email_subject: subject,
        subject_line: subject,
        update_title: subject,
        secret: WIX_OTP_SECRET,
        template_id: "VC9ofWh",
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error("[Digest] Wix relay failed:", res.status, body);
      return { sent: false, reason: "wix_error" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[Digest] Wix error:", err);
    return { sent: false, reason: "wix_error" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (!isCronCaller(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: pending, error } = await supabase
      .from("email_digest_queue")
      .select("id, contact_id, recipient_email, first_name, task_name, task_event, link_tab, created_at")
      .is("sent_at", null)
      .order("created_at", { ascending: true })
      .limit(1000);

    if (error) {
      console.error("[Digest] Fetch failed:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }

    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ processed: 0, recipients: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Group by recipient_email
    const groups = new Map<string, typeof pending>();
    for (const row of pending) {
      const key = row.recipient_email;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    const channels = getChannels();
    let recipientsSent = 0;
    let itemsProcessed = 0;
    const errors: string[] = [];

    for (const [email, items] of groups.entries()) {
      const firstName = items[0].first_name || "there";
      const contactId = items[0].contact_id;
      const count = items.length;

      // Mint a single magic link to the tasks tab
      let url = plainPortalUrl();
      if (contactId) {
        const link = await mintMagicLink(supabase, { contactId, targetHash: "tasks" });
        if (link?.url) url = link.url;
      }

      // Build digest body
      const lines = items
        .map((i) => `• ${EVENT_LABEL[i.task_event] || "Update"}: ${i.task_name}`)
        .join("\n");

      const subject =
        count === 1
          ? `1 update on your action items`
          : `${count} updates on your action items`;

      const message = `Hi ${firstName},\n\nYou have ${count === 1 ? "a new update" : `${count} new updates`} on your action items:\n\n${lines}\n\nOpen your portal:\n${url}\n\n(This one-tap link is valid for 1 hour and works once. After that, sign in at https://app.prosperwise.ca)\n\nThank you,\nProsperWise Team`;

      const tasks: Promise<{ sent: boolean; reason?: string }>[] = [];
      if (channels.gmail) tasks.push(sendViaGmail(email, uniqueifySubject(subject), message));
      if (channels.wix) tasks.push(sendViaWix(email, subject, message));

      const results = await Promise.all(tasks);
      const anySent = results.some((r) => r.sent);

      if (anySent) {
        const ids = items.map((i) => i.id);
        const { error: updateErr } = await supabase
          .from("email_digest_queue")
          .update({ sent_at: new Date().toISOString() })
          .in("id", ids);
        if (updateErr) {
          console.error(`[Digest] Failed to mark ${email} items sent:`, updateErr);
          errors.push(`mark_sent ${email}: ${updateErr.message}`);
        } else {
          recipientsSent++;
          itemsProcessed += items.length;
          console.log(`[Digest] Sent digest of ${items.length} item(s) to ${email}`);
        }
      } else {
        const reasons = results.map((r) => r.reason || "unknown").join(",");
        console.error(`[Digest] All channels failed for ${email}: ${reasons}`);
        errors.push(`send ${email}: ${reasons}`);
      }
    }

    return new Response(
      JSON.stringify({
        processed: itemsProcessed,
        recipients: recipientsSent,
        total_pending: pending.length,
        errors: errors.length ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[Digest] Fatal:", err);
    return new Response(JSON.stringify({ error: err.message || "internal" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
