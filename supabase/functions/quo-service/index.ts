import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkOutboundPii, piiBlockMessage } from "../_shared/pii-shield.ts";

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
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

const QUO_API_KEY = Deno.env.get("QUO_API_KEY")!;
const QUO_PHONE_NUMBER_RAW = Deno.env.get("QUO_DEFAULT_PHONE_NUMBER_ID")!;
const QUO_BASE_URL = "https://api.openphone.com/v1";

// Quo `from` must be either a phone-number ID (PN...) or E.164 (+17787215208).
// The secret may have been stored as a formatted number — coerce it.
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

const QUO_FETCH_TIMEOUT_MS = 15000;

async function quoFetch(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUO_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${QUO_BASE_URL}${path}`, {
      ...init,
      headers: {
        "Authorization": QUO_API_KEY,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Quo API timed out after ${QUO_FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Quo API ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function normalizePhone(phone: string): string {
  if (!phone) return phone;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return phone.startsWith("+") ? phone : `+${digits}`;
}

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { action } = body;

    // ---- sendSms ----
    if (action === "sendSms") {
      const { contactId, to, content } = body;
      if (!to || !content) {
        return new Response(JSON.stringify({ error: "Missing 'to' or 'content'" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // PII Shield (Glass Box compliance)
      const piiCheck = checkOutboundPii(content);
      if (piiCheck.blocked) {
        // Log the blocked attempt for audit
        await adminClient.from("quo_messages").insert({
          contact_id: contactId || null,
          direction: "outbound",
          from_number: "blocked",
          to_number: normalizePhone(to),
          body: "[REDACTED — PII BLOCKED]",
          status: "blocked",
          sent_by: userId,
          portal_visible: false,
          pii_blocked: true,
          pii_block_reason: piiCheck.reason,
        });
        return new Response(JSON.stringify({
          error: piiBlockMessage(piiCheck.reason || "Sensitive content"),
          blocked: true, reason: piiCheck.reason,
        }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const toNum = normalizePhone(to);

      // Record the attempt before calling OpenPhone -- if the call throws or
      // the invocation is killed by a platform-level timeout, this row still
      // exists so staff can see it failed instead of it vanishing silently.
      const { data: pendingRow, error: pendingErr } = await adminClient
        .from("quo_messages")
        .insert({
          contact_id: contactId || null,
          direction: "outbound",
          from_number: QUO_PHONE_NUMBER_ID,
          to_number: toNum,
          body: content,
          status: "pending",
          sent_by: userId,
          portal_visible: false,
          occurred_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (pendingErr) throw pendingErr;

      try {
        const result = await quoFetch("/messages", {
          method: "POST",
          body: JSON.stringify({
            from: QUO_PHONE_NUMBER_ID,
            to: [toNum],
            content,
          }),
        });

        const msg = result?.data || result;
        await adminClient.from("quo_messages").update({
          quo_message_id: msg?.id,
          from_number: msg?.from || QUO_PHONE_NUMBER_ID,
          status: msg?.status || "sent",
          portal_visible: true,
          occurred_at: msg?.createdAt || new Date().toISOString(),
          read_at: new Date().toISOString(),
        }).eq("id", pendingRow.id);

        return new Response(JSON.stringify({ success: true, message: msg }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (sendErr: any) {
        const errorMessage = sendErr?.message || String(sendErr);
        await adminClient.from("quo_messages").update({
          status: "failed",
          error_detail: errorMessage,
          portal_visible: false,
        }).eq("id", pendingRow.id);
        return new Response(JSON.stringify({ error: `Send failed: ${errorMessage}` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ---- listMessages ----
    if (action === "listMessages") {
      const { contactId } = body;
      if (!contactId) {
        return new Response(JSON.stringify({ error: "Missing contactId" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase
        .from("quo_messages")
        .select("*")
        .eq("contact_id", contactId)
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return new Response(JSON.stringify({ messages: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- listCalls ----
    if (action === "listCalls") {
      const { contactId } = body;
      if (!contactId) {
        return new Response(JSON.stringify({ error: "Missing contactId" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase
        .from("quo_calls")
        .select("*")
        .eq("contact_id", contactId)
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return new Response(JSON.stringify({ calls: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- inbox (global, all contacts) ----
    if (action === "inbox") {
      const { limit = 100 } = body;
      const [msgRes, callRes, archRes] = await Promise.all([
        supabase.from("quo_messages").select("*").order("occurred_at", { ascending: false }).limit(limit),
        supabase.from("quo_calls").select("*").order("occurred_at", { ascending: false }).limit(limit),
        supabase.from("quo_inbox_archive").select("thread_key, last_message_at"),
      ]);
      if (msgRes.error) throw msgRes.error;
      if (callRes.error) throw callRes.error;

      const contactIds = Array.from(new Set([
        ...(msgRes.data || []).map((m: any) => m.contact_id).filter(Boolean),
        ...(callRes.data || []).map((c: any) => c.contact_id).filter(Boolean),
      ]));
      let contactsById: Record<string, any> = {};
      if (contactIds.length) {
        const { data: contacts } = await adminClient
          .from("contacts")
          .select("id, first_name, last_name, phone")
          .in("id", contactIds);
        contactsById = Object.fromEntries((contacts || []).map((c: any) => [c.id, c]));
      }

      return new Response(JSON.stringify({
        messages: msgRes.data || [],
        calls: callRes.data || [],
        contacts: contactsById,
        archive: archRes.data || [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- archiveThread / unarchiveThread ----
    if (action === "archiveThread") {
      const { threadKey, contactId, phoneDigits, lastMessageAt } = body;
      if (!threadKey) {
        return new Response(JSON.stringify({ error: "Missing threadKey" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await adminClient.from("quo_inbox_archive").upsert({
        thread_key: threadKey,
        contact_id: contactId || null,
        phone_digits: phoneDigits || null,
        last_message_at: lastMessageAt || null,
        archived_by: userId,
        archived_at: new Date().toISOString(),
      }, { onConflict: "thread_key" });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "unarchiveThread") {
      const { threadKey } = body;
      if (!threadKey) {
        return new Response(JSON.stringify({ error: "Missing threadKey" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await adminClient
        .from("quo_inbox_archive").delete().eq("thread_key", threadKey);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- deleteThread (permanent — removes all messages + calls in thread) ----
    if (action === "deleteThread") {
      const { threadKey, contactId, phoneDigits } = body;
      if (!threadKey) {
        return new Response(JSON.stringify({ error: "Missing threadKey" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let deletedMessages = 0;
      let deletedCalls = 0;

      const deleteByMatch = async (table: "quo_messages" | "quo_calls") => {
        if (contactId) {
          const { data, error } = await adminClient.from(table)
            .delete().eq("contact_id", contactId).select("id");
          if (error) throw error;
          return data?.length || 0;
        }
        if (phoneDigits) {
          // Match orphan records by last 10 digits of from_number or to_number
          const { data: rows, error } = await adminClient.from(table)
            .select("id, from_number, to_number")
            .is("contact_id", null);
          if (error) throw error;
          const last10 = (p: string | null) => (p || "").replace(/\D/g, "").slice(-10);
          const ids = (rows || [])
            .filter((r: any) => last10(r.from_number) === phoneDigits || last10(r.to_number) === phoneDigits)
            .map((r: any) => r.id);
          if (ids.length > 0) {
            const { error: delErr } = await adminClient.from(table).delete().in("id", ids);
            if (delErr) throw delErr;
          }
          return ids.length;
        }
        return 0;
      };

      deletedMessages = await deleteByMatch("quo_messages");
      deletedCalls = await deleteByMatch("quo_calls");

      // Clean up archive entry too
      await adminClient.from("quo_inbox_archive").delete().eq("thread_key", threadKey);

      return new Response(JSON.stringify({
        success: true, deletedMessages, deletedCalls,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- unreadCount (lightweight badge query) ----
    if (action === "unreadCount") {
      const [{ count: msgCount }, { count: callCount }] = await Promise.all([
        supabase.from("quo_messages").select("id", { count: "exact", head: true })
          .eq("direction", "inbound").is("read_at", null),
        supabase.from("quo_calls").select("id", { count: "exact", head: true })
          .eq("direction", "inbound").is("read_at", null),
      ]);
      return new Response(JSON.stringify({ unread: (msgCount || 0) + (callCount || 0) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- markRead (single record or all) ----
    if (action === "markRead") {
      const { recordType, recordId, all } = body;
      const stamp = new Date().toISOString();
      if (all) {
        await adminClient.from("quo_messages").update({ read_at: stamp })
          .eq("direction", "inbound").is("read_at", null);
        await adminClient.from("quo_calls").update({ read_at: stamp })
          .eq("direction", "inbound").is("read_at", null);
      } else if (recordType && recordId) {
        const table = recordType === "call" ? "quo_calls" : "quo_messages";
        await adminClient.from(table).update({ read_at: stamp }).eq("id", recordId);
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- togglePortalVisible ----
    if (action === "togglePortalVisible") {
      const { recordType, recordId, visible } = body;
      const table = recordType === "call" ? "quo_calls" : "quo_messages";
      const { error } = await adminClient
        .from(table)
        .update({ portal_visible: !!visible })
        .eq("id", recordId);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- syncContact (push Sanctuary contact → Quo, name+phone only) ----
    if (action === "syncContact") {
      const { contactId } = body;
      const { data: contact, error: cErr } = await adminClient
        .from("contacts").select("id, first_name, last_name, phone").eq("id", contactId).single();
      if (cErr || !contact?.phone) {
        return new Response(JSON.stringify({ error: "Contact has no phone" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const payload = {
        defaultFields: {
          firstName: contact.first_name || "",
          lastName: contact.last_name || "",
          phoneNumbers: [{ name: "Mobile", value: normalizePhone(contact.phone) }],
        },
      };

      const { data: existing } = await adminClient
        .from("quo_contact_sync").select("quo_contact_id").eq("contact_id", contactId).maybeSingle();

      let quoContact: any;
      if (existing?.quo_contact_id) {
        quoContact = await quoFetch(`/contacts/${existing.quo_contact_id}`, {
          method: "PATCH", body: JSON.stringify(payload),
        });
      } else {
        quoContact = await quoFetch("/contacts", {
          method: "POST", body: JSON.stringify(payload),
        });
      }

      const quoId = (quoContact?.data || quoContact)?.id;
      if (quoId) {
        await adminClient.from("quo_contact_sync").upsert({
          contact_id: contactId,
          quo_contact_id: quoId,
          last_synced_at: new Date().toISOString(),
          sync_direction: "bidirectional",
        }, { onConflict: "contact_id" });
      }

      return new Response(JSON.stringify({ success: true, quoContactId: quoId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- createContactFromPhone (creates a fresh contact + back-links all matching messages/calls) ----
    if (action === "createContactFromPhone") {
      const { phone, firstName, lastName, email } = body;
      if (!phone) {
        return new Response(JSON.stringify({ error: "Missing phone" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const normalized = normalizePhone(phone);
      const digits = normalized.replace(/\D/g, "").slice(-10);

      const { data: contact, error: insertErr } = await adminClient
        .from("contacts")
        .insert({
          first_name: firstName || "",
          last_name: lastName || "Unknown",
          full_name: `${firstName || ""} ${lastName || "Unknown"}`.trim(),
          phone: normalized,
          email: email || null,
          created_by: userId,
        })
        .select("id")
        .single();
      if (insertErr) throw insertErr;

      // Back-link any messages/calls whose number ends with the same 10 digits
      const { data: orphanMsgs } = await adminClient
        .from("quo_messages").select("id, from_number, to_number, direction").is("contact_id", null);
      const msgIds = (orphanMsgs || []).filter((m: any) => {
        const cp = m.direction === "inbound" ? m.from_number : m.to_number;
        return (cp || "").replace(/\D/g, "").slice(-10) === digits;
      }).map((m: any) => m.id);
      if (msgIds.length) {
        await adminClient.from("quo_messages").update({ contact_id: contact.id }).in("id", msgIds);
      }

      const { data: orphanCalls } = await adminClient
        .from("quo_calls").select("id, from_number, to_number, direction").is("contact_id", null);
      const callIds = (orphanCalls || []).filter((c: any) => {
        const cp = c.direction === "inbound" ? c.from_number : c.to_number;
        return (cp || "").replace(/\D/g, "").slice(-10) === digits;
      }).map((c: any) => c.id);
      if (callIds.length) {
        await adminClient.from("quo_calls").update({ contact_id: contact.id }).in("id", callIds);
      }

      return new Response(JSON.stringify({
        success: true,
        contactId: contact.id,
        linkedMessages: msgIds.length,
        linkedCalls: callIds.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- linkPhoneToContact (link orphan messages/calls to an existing contact) ----
    if (action === "linkPhoneToContact") {
      const { phone, contactId } = body;
      if (!phone || !contactId) {
        return new Response(JSON.stringify({ error: "Missing phone or contactId" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const digits = phone.replace(/\D/g, "").slice(-10);

      // Optionally update the contact's phone if blank
      const { data: existing } = await adminClient
        .from("contacts").select("phone").eq("id", contactId).single();
      if (existing && !existing.phone) {
        await adminClient.from("contacts").update({ phone: normalizePhone(phone) }).eq("id", contactId);
      }

      const { data: orphanMsgs } = await adminClient
        .from("quo_messages").select("id, from_number, to_number, direction").is("contact_id", null);
      const msgIds = (orphanMsgs || []).filter((m: any) => {
        const cp = m.direction === "inbound" ? m.from_number : m.to_number;
        return (cp || "").replace(/\D/g, "").slice(-10) === digits;
      }).map((m: any) => m.id);
      if (msgIds.length) {
        await adminClient.from("quo_messages").update({ contact_id: contactId }).in("id", msgIds);
      }

      const { data: orphanCalls } = await adminClient
        .from("quo_calls").select("id, from_number, to_number, direction").is("contact_id", null);
      const callIds = (orphanCalls || []).filter((c: any) => {
        const cp = c.direction === "inbound" ? c.from_number : c.to_number;
        return (cp || "").replace(/\D/g, "").slice(-10) === digits;
      }).map((c: any) => c.id);
      if (callIds.length) {
        await adminClient.from("quo_calls").update({ contact_id: contactId }).in("id", callIds);
      }

      return new Response(JSON.stringify({
        success: true,
        linkedMessages: msgIds.length,
        linkedCalls: callIds.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ---- searchContacts (lightweight typeahead for the link dialog) ----
    if (action === "searchContacts") {
      const { q } = body;
      if (!q || q.length < 2) {
        return new Response(JSON.stringify({ contacts: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, phone, email")
        .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
        .limit(10);
      return new Response(JSON.stringify({ contacts: data || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[quo-service] error:", err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
