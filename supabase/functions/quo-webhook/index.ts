import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callFromEvent, smsFromEvent, verifyCallizySignature, voicemailFromEvent } from "../_shared/callizy.ts";

// PUBLIC endpoint — Quo posts here. HMAC signature is the only auth.

const QUO_SIGNING_SECRET = Deno.env.get("QUO_WEBHOOK_SIGNING_SECRET")!;
const QUO_API_KEY = Deno.env.get("QUO_API_KEY")!;
const QUO_PHONE_NUMBER_RAW = Deno.env.get("QUO_DEFAULT_PHONE_NUMBER_ID") || "";
const QUO_BASE_URL = "https://api.openphone.com/v1";

const AFTER_HOURS_REPLY =
  "Thanks for your message — you've reached us outside our business hours (Mon–Fri, 9am–5pm PT). " +
  "We'll respond as soon as we're back online. For sensitive or account-related matters, " +
  "please use the Ask for Help section in your Sovereign Portal.";

const AUTO_REPLY_COOLDOWN_HOURS = 12;

function resolveQuoFrom(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (trimmed.startsWith("PN")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed.startsWith("+") ? trimmed : `+${digits}`;
}
const QUO_PHONE_NUMBER_ID = resolveQuoFrom(QUO_PHONE_NUMBER_RAW);

function normalizePhone(phone: string): string {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone.startsWith("+") ? phone : `+${digits}`;
}

// Determine if a moment falls outside Mon–Fri 9am–5pm America/Los_Angeles (Pacific).
function isAfterHoursPacific(now: Date = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value || "";
  const hourStr = parts.find((p) => p.type === "hour")?.value || "0";
  let hour = parseInt(hourStr, 10);
  if (hour === 24) hour = 0; // hour12:false sometimes emits "24"
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  const inBusinessWindow = !isWeekend && hour >= 9 && hour < 17;
  return !inBusinessWindow;
}

async function sendAutoReply(admin: any, toNumber: string): Promise<void> {
  if (!QUO_API_KEY || !QUO_PHONE_NUMBER_ID || !toNumber) return;
  const toNum = normalizePhone(toNumber);

  // Cooldown — don't auto-reply if any outbound (auto or manual) was sent recently
  const cutoff = new Date(Date.now() - AUTO_REPLY_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
  const { data: recent } = await admin
    .from("quo_messages")
    .select("id")
    .eq("direction", "outbound")
    .eq("to_number", toNum)
    .gte("occurred_at", cutoff)
    .limit(1);
  if (recent && recent.length > 0) {
    console.log("[quo-webhook] auto-reply skipped — recent outbound exists for", toNum);
    return;
  }

  try {
    const res = await fetch(`${QUO_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "Authorization": QUO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: QUO_PHONE_NUMBER_ID,
        to: [toNum],
        content: AFTER_HOURS_REPLY,
      }),
    });
    const text = await res.text();
    let result: any = {};
    try { result = text ? JSON.parse(text) : {}; } catch { /* ignore */ }
    if (!res.ok) {
      console.error("[quo-webhook] auto-reply send failed", res.status, text);
      return;
    }
    const msg = result?.data || result;
    await admin.from("quo_messages").insert({
      quo_message_id: msg?.id || null,
      contact_id: null,
      direction: "outbound",
      from_number: msg?.from || QUO_PHONE_NUMBER_ID,
      to_number: toNum,
      body: AFTER_HOURS_REPLY,
      status: msg?.status || "sent",
      portal_visible: true,
      occurred_at: msg?.createdAt || new Date().toISOString(),
      read_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[quo-webhook] auto-reply error", e);
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, openphone-signature, x-openphone-signature, x-callizy-signature",
};

async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader || !QUO_SIGNING_SECRET) return false;

  // OpenPhone signature header format: "hmac;1;<timestamp>;<base64-signature>"
  // We support both that format and a plain hex/base64 signature for resilience.
  let providedSig = signatureHeader.trim();
  let timestamp = "";
  if (providedSig.includes(";")) {
    const parts = providedSig.split(";");
    timestamp = parts[2] || "";
    providedSig = parts[3] || "";
  }

  const signedPayload = timestamp ? `${timestamp}.${rawBody}` : rawBody;

  const enc = new TextEncoder();
  // OpenPhone provides the signing key as base64; fall back to raw if decode fails
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(QUO_SIGNING_SECRET), (c) => c.charCodeAt(0));
  } catch {
    keyBytes = enc.encode(QUO_SIGNING_SECRET);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(signedPayload));
  const sigBytes = new Uint8Array(sigBuf);
  const computedB64 = btoa(String.fromCharCode(...sigBytes));
  const computedHex = Array.from(sigBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  return providedSig === computedB64 || providedSig === computedHex;
}

async function findContactByPhone(admin: any, phone: string): Promise<string | null> {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "").slice(-10); // last 10 digits
  const { data } = await admin
    .from("contacts")
    .select("id, phone")
    .not("phone", "is", null)
    .limit(500);
  for (const c of data || []) {
    const cd = (c.phone || "").replace(/\D/g, "").slice(-10);
    if (cd && cd === digits) return c.id;
  }
  return null;
}

/** Callizy posts here with ?provider=callizy. Its texts and calls are stored in the same tables as Quo's, marked provider = callizy. */
async function handleCallizy(req: Request, rawBody: string): Promise<Response> {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const valid = await verifyCallizySignature(rawBody, req.headers.get("x-callizy-signature"), Deno.env.get("CALLIZY_WEBHOOK_SIGNING_SECRET"));
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let payload: any = {};
  try { payload = JSON.parse(rawBody); } catch { payload = { raw: rawBody }; }
  const event: string = payload?.event || "unknown";
  const { data: logRow } = await admin.from("quo_webhook_events").insert({ event_type: `callizy:${event}`, quo_event_id: payload?.data?.sms_id || payload?.data?.call_id || null, payload, signature_valid: valid, processed: false }).select("id").single();
  if (!valid) return json({ error: "Invalid signature" }, 401);

  try {
    const data = payload?.data ?? {};
    const at = payload?.timestamp;
    if (event === "sms.received" || event === "sms.sent") {
      const m = smsFromEvent(event, data, at);
      if (!m.id) throw new Error("sms event without an id");
      const contactId = await findContactByPhone(admin, m.direction === "inbound" ? m.from : m.to);
      await admin.from("quo_messages").upsert({
        quo_message_id: m.id, provider: "callizy", contact_id: contactId, direction: m.direction, from_number: m.from, to_number: m.to, body: m.body,
        status: m.direction === "inbound" ? "received" : "delivered", media_urls: [], portal_visible: true, occurred_at: m.at,
        ...(m.direction === "outbound" ? { read_at: new Date().toISOString() } : {}),
      }, { onConflict: "quo_message_id" });
    } else if (event === "call.completed" || event === "call.missed") {
      const c = callFromEvent(event, data, at);
      if (!c.id) throw new Error("call event without an id");
      const contactId = await findContactByPhone(admin, c.direction === "inbound" ? c.from : c.to);
      await admin.from("quo_calls").upsert({
        quo_call_id: c.id, provider: "callizy", contact_id: contactId, direction: c.direction, from_number: c.from, to_number: c.to, status: c.status,
        duration_seconds: c.duration, portal_visible: true, is_voicemail: false, occurred_at: c.at,
        ...(c.transcript ? { transcript: c.transcript } : {}), ...(c.summary ? { summary: c.summary } : {}),
      }, { onConflict: "quo_call_id" });
    } else if (event === "voicemail.received") {
      const v = voicemailFromEvent(data, at);
      if (!v.id) throw new Error("voicemail event without an id");
      const contactId = await findContactByPhone(admin, v.from);
      await admin.from("quo_calls").upsert({
        quo_call_id: v.id, provider: "callizy", contact_id: contactId, direction: "inbound", from_number: v.from, to_number: v.to, status: "voicemail",
        duration_seconds: v.duration, portal_visible: true, is_voicemail: true, voicemail_url: v.url || null, occurred_at: v.at,
        ...(v.transcript ? { transcript: v.transcript } : {}),
      }, { onConflict: "quo_call_id" });
      let title = `New voicemail from ${v.from || "an unknown caller"}`;
      let link = "/inbox";
      if (contactId) {
        const { data: c } = await admin.from("contacts").select("first_name, last_name").eq("id", contactId).single();
        const name = `${c?.first_name || ""} ${c?.last_name || ""}`.trim();
        if (name) title = `New voicemail from ${name}`;
        link = `/contacts/${contactId}`;
      }
      await admin.from("staff_notifications").insert({ title, body: v.transcript || `Voicemail received at ${new Date().toLocaleString()}`, link, contact_id: contactId, source_type: "voicemail" });
    }
    // Contact events and call.started are logged above and otherwise ignored. No auto-reply is sent for Callizy texts yet.
    if (logRow?.id) await admin.from("quo_webhook_events").update({ processed: true }).eq("id", logRow.id);
    return json({ ok: true });
  } catch (err: any) {
    console.error("[quo-webhook] callizy processing error:", err);
    if (logRow?.id) await admin.from("quo_webhook_events").update({ processing_error: err.message || String(err) }).eq("id", logRow.id);
    return json({ error: err.message || "Processing failed" }, 500);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const rawBody = await req.text();
  // Callizy is told by the ?provider=callizy on its webhook address, its own signature header, or its body shape (an "event" and no Quo "type").
  const looksCallizy = new URL(req.url).searchParams.get("provider") === "callizy" || req.headers.has("x-callizy-signature") ||
    (() => { try { const j = JSON.parse(rawBody); return typeof j?.event === "string" && j?.type === undefined; } catch { return false; } })();
  if (looksCallizy) return await handleCallizy(req, rawBody);
  const sigHeader =
    req.headers.get("openphone-signature") ||
    req.headers.get("x-openphone-signature") ||
    req.headers.get("openphone-signature-v2");

  const isValid = await verifySignature(rawBody, sigHeader);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: any = {};
  try { payload = JSON.parse(rawBody); } catch { payload = { raw: rawBody }; }

  const eventType = payload?.type || payload?.event || "unknown";
  const eventId = payload?.id || payload?.eventId || null;

  // Always log the event (even invalid) for forensic audit
  const { data: logRow } = await admin.from("quo_webhook_events").insert({
    event_type: eventType,
    quo_event_id: eventId,
    payload,
    signature_valid: isValid,
    processed: false,
  }).select("id").single();

  if (!isValid) {
    console.warn("[quo-webhook] invalid signature, rejecting");
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const data = payload?.data?.object || payload?.data || payload;

    // ---- Messages ----
    if (eventType === "message.received" || eventType === "message.delivered") {
      const isInbound = eventType === "message.received";
      const fromNum = data?.from || "";
      const toNum = Array.isArray(data?.to) ? data.to[0] : (data?.to || "");
      const counterparty = isInbound ? fromNum : toNum;
      const contactId = await findContactByPhone(admin, counterparty);

      if (eventType === "message.received") {
        await admin.from("quo_messages").upsert({
          quo_message_id: data?.id,
          contact_id: contactId,
          direction: "inbound",
          from_number: fromNum,
          to_number: toNum,
          body: data?.body || data?.text || "",
          status: data?.status || "received",
          media_urls: data?.media || [],
          quo_user_id: data?.userId || null,
          portal_visible: true,
          occurred_at: data?.createdAt || new Date().toISOString(),
        }, { onConflict: "quo_message_id" });

        // After-hours auto-reply (Mon–Fri 9am–5pm PT)
        if (isAfterHoursPacific() && fromNum) {
          await sendAutoReply(admin, fromNum);
        }
      } else {
        // delivered → upsert outbound (captures messages sent from Quo mobile/desktop app too)
        if (data?.id) {
          await admin.from("quo_messages").upsert({
            quo_message_id: data.id,
            contact_id: contactId,
            direction: "outbound",
            from_number: fromNum,
            to_number: toNum,
            body: data?.body || data?.text || "",
            status: "delivered",
            media_urls: data?.media || [],
            quo_user_id: data?.userId || null,
            portal_visible: true,
            occurred_at: data?.createdAt || new Date().toISOString(),
          }, { onConflict: "quo_message_id" });
        }
      }

    }

    // ---- Calls ----
    else if (eventType === "call.completed") {
      const direction = data?.direction === "incoming" ? "inbound" : "outbound";
      const fromNum = data?.from || "";
      const toNum = Array.isArray(data?.to) ? data.to[0] : (data?.to || "");
      const counterparty = direction === "inbound" ? fromNum : toNum;
      const contactId = await findContactByPhone(admin, counterparty);

      // Voicemail detection: inbound call that wasn't answered, or has voicemail payload
      const voicemailObj = data?.voicemail || data?.voiceMail || null;
      const isVoicemail =
        direction === "inbound" &&
        (!!voicemailObj ||
          data?.answeredAt === null ||
          data?.status === "no-answer" ||
          data?.status === "missed");
      const voicemailUrl =
        voicemailObj?.url ||
        voicemailObj?.media?.[0]?.url ||
        (isVoicemail ? (data?.media?.[0]?.url || null) : null);

      await admin.from("quo_calls").upsert({
        quo_call_id: data?.id,
        contact_id: contactId,
        direction,
        from_number: fromNum,
        to_number: toNum,
        status: data?.status || "completed",
        duration_seconds: data?.duration || voicemailObj?.duration || 0,
        quo_user_id: data?.userId || null,
        portal_visible: true,
        is_voicemail: isVoicemail,
        voicemail_url: voicemailUrl,
        occurred_at: data?.completedAt || data?.createdAt || new Date().toISOString(),
      }, { onConflict: "quo_call_id" });

      // Staff bell notification for new voicemails
      if (isVoicemail) {
        const callerLabel = fromNum || "Unknown caller";
        let title = `New voicemail from ${callerLabel}`;
        let link = "/inbox";
        if (contactId) {
          const { data: c } = await admin
            .from("contacts").select("first_name, last_name").eq("id", contactId).single();
          const name = `${c?.first_name || ""} ${c?.last_name || ""}`.trim();
          if (name) title = `New voicemail from ${name}`;
          link = `/contacts/${contactId}`;
        }
        await admin.from("staff_notifications").insert({
          title,
          body: voicemailObj?.transcript || `Voicemail received at ${new Date().toLocaleString()}`,
          link,
          contact_id: contactId,
          source_type: "voicemail",
        });
      }
    }
    else if (eventType === "call.recording.completed") {
      if (data?.callId) {
        const url = data?.media?.[0]?.url || data?.url || null;
        const isVm = data?.type === "voicemail" || data?.kind === "voicemail";
        const update: Record<string, unknown> = isVm
          ? { voicemail_url: url, is_voicemail: true }
          : { recording_url: url };
        await admin.from("quo_calls").update(update).eq("quo_call_id", data.callId);
      }
    }
    else if (eventType === "call.transcript.completed") {
      const callId = data?.callId || data?.id;
      const dialogue = data?.dialogue || data?.segments || [];
      const transcript = Array.isArray(dialogue)
        ? dialogue.map((d: any) => `${d.identifier || d.speaker || "Speaker"}: ${d.content || d.text || ""}`).join("\n")
        : (data?.transcript || "");
      if (callId) {
        await admin.from("quo_calls").update({ transcript }).eq("quo_call_id", callId);
      }
    }
    else if (eventType === "call.summary.completed") {
      const callId = data?.callId || data?.id;
      const summary = data?.summary?.summary || data?.summary || "";
      const nextSteps = Array.isArray(data?.summary?.nextSteps)
        ? data.summary.nextSteps.join("\n")
        : (data?.nextSteps || "");
      if (callId) {
        await admin.from("quo_calls")
          .update({ summary, next_steps: nextSteps })
          .eq("quo_call_id", callId);
      }
    }

    // ---- Deletes (sync removals from Quo/OpenPhone) ----
    else if (eventType === "message.deleted" || eventType === "message.removed") {
      const id = data?.id || data?.messageId;
      if (id) {
        await admin.from("quo_messages").delete().eq("quo_message_id", id);
        console.log(`[quo-webhook] deleted message ${id}`);
      }
    }
    else if (eventType === "call.deleted" || eventType === "call.removed") {
      const id = data?.id || data?.callId;
      if (id) {
        await admin.from("quo_calls").delete().eq("quo_call_id", id);
        console.log(`[quo-webhook] deleted call ${id}`);
      }
    }

    // ---- Contacts (two-way sync from Quo) ----
    else if (eventType === "contact.created" || eventType === "contact.updated") {
      const quoContactId = data?.id;
      if (quoContactId) {
        const phoneList = data?.defaultFields?.phoneNumbers || [];
        const firstPhone = phoneList[0]?.value || "";
        const contactId = await findContactByPhone(admin, firstPhone);
        if (contactId) {
          await admin.from("quo_contact_sync").upsert({
            contact_id: contactId,
            quo_contact_id: quoContactId,
            last_synced_at: new Date().toISOString(),
            sync_direction: "bidirectional",
          }, { onConflict: "contact_id" });
        }
      }
    }

    if (logRow?.id) {
      await admin.from("quo_webhook_events")
        .update({ processed: true }).eq("id", logRow.id);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[quo-webhook] processing error:", err);
    if (logRow?.id) {
      await admin.from("quo_webhook_events")
        .update({ processing_error: err.message || String(err) }).eq("id", logRow.id);
    }
    return new Response(JSON.stringify({ error: err.message || "Processing failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
