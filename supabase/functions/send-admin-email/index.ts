// send-admin-email
// Sends transactional notifications from rolf@prosperwise.ca (admin@ is a
// Google Group with no login of its own, so Gmail auth runs as this real
// account instead — see _shared/google-token.ts). Additive to the Wix
// relay — callers decide whether to invoke this based on NOTIFICATION_CHANNEL.
//
// Runs PII Shield BEFORE building the raw RFC 2822 message; rejects with
// 422 on hit. JWT validated in code.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkOutboundPii } from "../_shared/pii-shield.ts";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { buildRawEmail, base64UrlEncode } from "../_shared/gmail-mime.ts";

const GATEWAY_URL = "https://gmail.googleapis.com/gmail/v1";
const SENDER_DISPLAY = "ProsperWise <rolf@prosperwise.ca>";
const APP_URL = "https://app.prosperwise.ca";

function appendAppLinkText(body: string): string {
  if (body.includes(APP_URL)) return body;
  return `${body.replace(/\s+$/, "")}\n\n—\nProsperWise: ${APP_URL}\n`;
}

function appendAppLinkHtml(body: string): string {
  if (body.includes(APP_URL)) return body;
  const footer = `<hr style="border:none;border-top:1px solid #2A4034;margin:24px 0 12px" /><p style="font-family:'DM Sans',sans-serif;font-size:13px;color:#8a8a8a;margin:0">ProsperWise &middot; <a href="${APP_URL}" style="color:#f59e0b;text-decoration:none">${APP_URL}</a></p>`;
  if (/<\/body\s*>/i.test(body)) return body.replace(/<\/body\s*>/i, `${footer}</body>`);
  return `${body}${footer}`;
}

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
      "authorization, x-client-info, apikey, content-type, x-internal-secret, x-region",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// Timing-safe comparison for shared secrets (fixed-time regardless of match position).
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function asList(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter(Boolean);
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Auth: either a Supabase JWT (logged-in staff/user) or an internal call
  // from another edge function presenting the dedicated INTERNAL_FUNCTION_SECRET.
  // We deliberately no longer accept the raw SUPABASE_SERVICE_ROLE_KEY as a
  // bearer token — that credential should never traverse the network as a
  // reusable authorization value for a general-purpose function.
  const authHeader = req.headers.get("Authorization") || "";
  const internalSecretHeader = req.headers.get("x-internal-secret") || "";
  const INTERNAL_FUNCTION_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET") || "";

  const isInternal =
    internalSecretHeader.length > 0 &&
    INTERNAL_FUNCTION_SECRET.length > 0 &&
    timingSafeEqual(internalSecretHeader, INTERNAL_FUNCTION_SECRET);

  if (!isInternal) {
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const to = asList(payload.to);
  const cc = asList(payload.cc);
  const bcc = asList(payload.bcc);
  const subject = String(payload.subject ?? "").trim();
  const text = typeof payload.text === "string" ? payload.text : undefined;
  const html = typeof payload.html === "string" ? payload.html : undefined;
  const replyTo = typeof payload.replyTo === "string" ? payload.replyTo : undefined;

  if (to.length === 0 || !subject || (!text && !html)) {
    return new Response(
      JSON.stringify({ error: "Required: to, subject, and at least one of text/html" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Append app link to every notification (text + html variants)
  const textWithLink = text ? appendAppLinkText(text) : undefined;
  const htmlWithLink = html ? appendAppLinkHtml(html) : undefined;

  // PII Shield — block financial/health PII before it leaves Canadian infra
  const piiCheckText = `${subject}\n${textWithLink ?? ""}\n${htmlWithLink ?? ""}`;
  const pii = checkOutboundPii(piiCheckText);
  if (pii.blocked) {
    console.warn(`[send-admin-email] PII Shield blocked: ${pii.reason} (${pii.matched})`);
    return new Response(
      JSON.stringify({ error: "PII Shield blocked", reason: pii.reason }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const raw = buildRawEmail({ from: SENDER_DISPLAY, to, cc, bcc, subject, text: textWithLink, html: htmlWithLink, replyTo });
  const rawEncoded = base64UrlEncode(raw);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const accessToken = await getServiceGoogleAccessToken(admin);

    const gmRes = await fetch(`${GATEWAY_URL}/users/me/messages/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: rawEncoded }),
    });

    const gmBody = await gmRes.text();
    if (!gmRes.ok) {
      console.error(`[send-admin-email] Gmail API failed [${gmRes.status}]: ${gmBody}`);
      return new Response(
        JSON.stringify({ error: "Gmail send failed", status: gmRes.status, body: gmBody }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const parsed = JSON.parse(gmBody);
    console.log(`[send-admin-email] Sent to ${to.join(",")} (id: ${parsed.id})`);
    return new Response(
      JSON.stringify({ sent: true, messageId: parsed.id, threadId: parsed.threadId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[send-admin-email] Unexpected error:", msg);
    return new Response(JSON.stringify({ error: "Internal error", details: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
