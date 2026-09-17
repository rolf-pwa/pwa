// Portal SMS — allows Sovereign + PWA clients to send/receive SMS
// from the Sovereign Portal. Auth via portal_token (no Supabase user JWT).
// All outbound content runs through PII Shield.

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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const QUO_API_KEY = Deno.env.get("QUO_API_KEY")!;
const QUO_PHONE_NUMBER_ID = Deno.env.get("QUO_DEFAULT_PHONE_NUMBER_ID")!;
const QUO_BASE_URL = "https://api.openphone.com/v1";

async function quoFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${QUO_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Authorization": QUO_API_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Quo API ${res.status}: ${JSON.stringify(data)}`);
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
    const body = await req.json();
    const { action, portal_token } = body;

    if (!portal_token) {
      return new Response(JSON.stringify({ error: "Missing portal_token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Validate portal token
    const { data: tokenRow } = await admin
      .from("portal_tokens")
      .select("contact_id, expires_at")
      .eq("token", portal_token)
      .maybeSingle();

    if (!tokenRow?.contact_id) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (tokenRow.expires_at && new Date(tokenRow.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "Token expired" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Eligibility: governance_status='sovereign' AND fiduciary_entity='pwa' (household-level)
    const { data: contact } = await admin
      .from("contacts")
      .select("id, phone, first_name, last_name, households(governance_status, fiduciary_entity)")
      .eq("id", tokenRow.contact_id)
      .maybeSingle();

    if (!contact) {
      return new Response(JSON.stringify({ error: "Contact not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eligible =
      (contact.households as any)?.governance_status === "sovereign" &&
      (contact.households as any)?.fiduciary_entity === "pwa";

    if (!eligible) {
      return new Response(JSON.stringify({
        error: "SMS messaging is reserved for Sovereign PWA clients",
        eligible: false,
      }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- list ----
    if (action === "list") {
      const { data: messages, error } = await admin
        .from("quo_messages")
        .select("id, direction, body, status, occurred_at, pii_blocked, pii_block_reason")
        .eq("contact_id", contact.id)
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (error) throw error;

      // Mark inbound (from staff to client) as read
      await admin.from("quo_messages")
        .update({ read_at: new Date().toISOString() })
        .eq("contact_id", contact.id)
        .eq("direction", "outbound") // staff→client = outbound from our system
        .is("read_at", null);

      return new Response(JSON.stringify({ messages: messages || [], eligible: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- send ----
    if (action === "send") {
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!content) {
        return new Response(JSON.stringify({ error: "Empty message" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!contact.phone) {
        return new Response(JSON.stringify({ error: "No phone number on file" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // PII Shield (inbound from client too — protect Glass Box logs)
      const piiCheck = checkOutboundPii(content);
      if (piiCheck.blocked) {
        await admin.from("quo_messages").insert({
          contact_id: contact.id,
          direction: "inbound",
          from_number: normalizePhone(contact.phone),
          to_number: "blocked",
          body: "[REDACTED — PII BLOCKED]",
          status: "blocked",
          portal_visible: true,
          pii_blocked: true,
          pii_block_reason: piiCheck.reason,
        });
        return new Response(JSON.stringify({
          error: piiBlockMessage(piiCheck.reason || "Sensitive content"),
          blocked: true, reason: piiCheck.reason,
        }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Send via Quo — from our number, to our number? No: the client's portal
      // message goes to our advisor line. From = our Quo number, To = client.
      // But semantically the client is initiating: we route it as an inbound
      // record into our staff inbox by using the Quo API to send FROM our
      // number TO the staff line is wrong. Instead, we send a normal SMS
      // from our Quo line to the client's phone and log it as inbound from
      // the client's perspective so it shows in staff inbox.
      // Simpler & correct: insert as inbound (client→staff) record only.
      // No actual SMS leaves the system; staff sees it in the Inbox like
      // a real inbound text. Staff replies via existing tooling which sends
      // a real SMS back to the client.
      const stamp = new Date().toISOString();
      const { data: inserted, error: insErr } = await admin
        .from("quo_messages")
        .insert({
          contact_id: contact.id,
          direction: "inbound",
          from_number: normalizePhone(contact.phone),
          to_number: QUO_PHONE_NUMBER_ID,
          body: content,
          status: "received",
          portal_visible: true,
          occurred_at: stamp,
        })
        .select()
        .single();
      if (insErr) throw insErr;

      return new Response(JSON.stringify({ success: true, message: inserted }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
