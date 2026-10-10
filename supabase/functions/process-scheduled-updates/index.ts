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
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Find all unsent updates that are due
    const { data: dueUpdates, error: fetchErr } = await supabase
      .from("marketing_updates")
      .select("*")
      .eq("sent", false)
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", new Date().toISOString());

    if (fetchErr) {
      console.error("[Scheduler] Fetch error:", fetchErr);
      return new Response(JSON.stringify({ error: fetchErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!dueUpdates || dueUpdates.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let processed = 0;
    const errors: string[] = [];

    for (const update of dueUpdates) {
      console.log(`[Scheduler] Processing scheduled update: "${update.title}" (id: ${update.id}, scheduled_at: ${update.scheduled_at})`);

      try {
        // Call notify-portal-request directly via fetch for better error visibility
        const notifyUrl = `${supabaseUrl}/functions/v1/notify-portal-request`;
        const notifyRes = await fetch(notifyUrl, {
          method: "POST",
          headers: { "x-region": "ca-central-1",
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "apikey": serviceKey,
          },
          body: JSON.stringify({
            notify_type: "marketing_update",
            title: update.title,
            url: update.url,
            target_governance_status: update.target_governance_status,
            target_contact_ids: update.target_contact_ids || [],
            target_household_ids: update.target_household_ids || [],
          }),
        });

        const notifyBody = await notifyRes.text();
        console.log(`[Scheduler] notify-portal-request response for "${update.title}": ${notifyRes.status} ${notifyBody}`);

        if (!notifyRes.ok) {
          const errMsg = `notify-portal-request failed for update ${update.id}: ${notifyRes.status} ${notifyBody}`;
          console.error(`[Scheduler] ${errMsg}`);
          errors.push(errMsg);

          // Insert a staff notification about the failure
          await supabase.from("staff_notifications").insert({
            title: `⚠️ Scheduled update failed: ${update.title}`,
            body: `The system failed to send notifications for this scheduled update. Error: ${notifyBody.substring(0, 200)}`,
            source_type: "system_error",
          });

          continue;
        }

        // Mark as sent only on success
        const { error: updateErr } = await supabase
          .from("marketing_updates")
          .update({ sent: true } as any)
          .eq("id", update.id);

        if (updateErr) {
          console.error(`[Scheduler] Failed to mark update ${update.id} as sent:`, updateErr);
          errors.push(`Failed to mark ${update.id} as sent: ${updateErr.message}`);
          continue;
        }

        console.log(`[Scheduler] ✅ Successfully sent and marked update: "${update.title}"`);
        processed++;
      } catch (invokeErr: any) {
        const errMsg = `Exception processing update ${update.id}: ${invokeErr.message}`;
        console.error(`[Scheduler] ${errMsg}`);
        errors.push(errMsg);

        await supabase.from("staff_notifications").insert({
          title: `⚠️ Scheduled update error: ${update.title}`,
          body: `Exception: ${invokeErr.message}`,
          source_type: "system_error",
        });
      }
    }

    const result = {
      processed,
      total: dueUpdates.length,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log(`[Scheduler] Run complete: ${processed}/${dueUpdates.length} processed${errors.length > 0 ? `, ${errors.length} error(s)` : ""}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[Scheduler] Fatal error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
