import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  mintTrustedDevice,
  validateTrustedDevice,
  revokeAllDevices,
} from "../_shared/trusted-device.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// Fetches the full portal data payload for a freshly-minted token via
// portal-validate, so verify/google-auth never have to duplicate (and
// silently drift from) its data-loading logic. The token must not be
// single_use (login-issued tokens never are), since portal-validate
// treats a single_use token as consumed after one read.
async function fetchFullPortalData(token: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/portal-validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const data = await res.json();
  if (!res.ok || data?.error) {
    throw new Error(data?.error || "Failed to load portal data");
  }
  return data;
}


const ALLOWED_ORIGIN_EXACT = new Set([
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
]);
const ALLOWED_ORIGIN_SUFFIXES = [
  ".lovable.app",
  ".lovableproject.com",
  ".lovable.dev",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  let allowed = "https://app.prosperwise.ca";
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (
      ALLOWED_ORIGIN_EXACT.has(origin) ||
      ALLOWED_ORIGIN_SUFFIXES.some((s) => host.endsWith(s))
    ) {
      allowed = origin;
    }
  } catch { /* ignore */ }
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}


function generateOtp(): string {
  // Cryptographically secure 6-digit OTP with rejection sampling to avoid modulo bias.
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    const n = buf[0];
    if (n < 4_294_000_000) return String(100000 + (n % 900000));
  }
}


serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const { action, email, code, deviceToken, trustDevice } = body as {
      action: string;
      email?: string;
      code?: string;
      deviceToken?: string;
      trustDevice?: boolean;
    };
    const clientIp =
      req.headers.get("cf-connecting-ip") ||
      (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      null;
    const userAgent = req.headers.get("user-agent") || null;

    if (action === "send") {
      if (!email || typeof email !== "string") {
        return new Response(JSON.stringify({ error: "Email is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cleanEmail = email.trim().toLowerCase();

      // Find contact by email
      const { data: contact } = await supabase
        .from("contacts")
        .select("id, first_name, email")
        .ilike("email", cleanEmail)
        .maybeSingle();

      if (!contact) {
        console.log(`[OTP] No contact found for email: ${cleanEmail} — returning silent success`);
        return new Response(JSON.stringify({ sent: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log(`[OTP] Contact found: ${contact.id} (${contact.first_name}) for ${cleanEmail}`);

      // Rate limit: max 3 OTPs per email per hour
      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
      const { count } = await supabase
        .from("portal_otps")
        .select("*", { count: "exact", head: true })
        .eq("email", cleanEmail)
        .gte("created_at", oneHourAgo);

      if ((count ?? 0) >= 3) {
        return new Response(JSON.stringify({ sent: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

      await supabase.from("portal_otps").insert({
        email: cleanEmail,
        code: otp,
        contact_id: contact.id,
        expires_at: expiresAt,
      });

      // Client-facing email must use the approved Wix relay. Other channels remain
      // available only when explicitly configured for diagnostics.
      const channel = (Deno.env.get("NOTIFICATION_CHANNEL") || "wix").toLowerCase();
      const useResend = channel === "resend" || channel === "all";
      const useWix = channel === "wix" || channel === "both" || channel === "all";
      const useGmail = channel === "gmail" || channel === "both" || channel === "all";

      const WIX_SITE_URL = Deno.env.get("WIX_SITE_URL");
      const WIX_OTP_SECRET = Deno.env.get("WIX_OTP_SECRET");
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      const OTP_FROM_ADDRESS = Deno.env.get("OTP_FROM_ADDRESS") || "ProsperWise <noreply@prosperwise.ca>";

      const sendTasks: Promise<unknown>[] = [];
      let deliverySucceeded = false;

      if (useResend && RESEND_API_KEY) {
        sendTasks.push((async () => {
          try {
            const subject = `Your ProsperWise sign-in code: ${otp}`;
            const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
              <p>Hi ${contact.first_name || "there"},</p>
              <p>Your one-time sign-in code is:</p>
              <p style="font-size:28px;font-weight:700;letter-spacing:6px;background:#f5f1e8;padding:16px 24px;border-radius:8px;text-align:center;color:#2A4034">${otp}</p>
              <p>This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
              <p style="margin-top:24px">Thank you,<br/>ProsperWise Team</p>
            </div>`;
            const text = `Hi ${contact.first_name || "there"},\n\nYour one-time sign-in code is:\n\n${otp}\n\nThis code expires in 10 minutes. If you didn't request it, you can ignore this email.\n\nThank you,\nProsperWise Team`;
            const resendRes = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${RESEND_API_KEY}`,
              },
              body: JSON.stringify({
                from: OTP_FROM_ADDRESS,
                to: [cleanEmail],
                subject,
                html,
                text,
              }),
            });
            if (!resendRes.ok) {
              const body = await resendRes.text();
              console.error(`[OTP] Resend failed: ${resendRes.status} ${body}`);
            } else {
              deliverySucceeded = true;
              console.log(`[OTP] Resend delivered to ${cleanEmail}`);
            }
          } catch (rErr) {
            console.error("[OTP] Error calling Resend:", rErr);
          }
        })());
      } else if (useResend) {
        console.warn(`[OTP] RESEND_API_KEY missing`);
      }

      if (useWix && WIX_SITE_URL && WIX_OTP_SECRET) {
        sendTasks.push((async () => {
          try {
            const wixPayload = JSON.stringify({
              email: cleanEmail,
              code: otp,
              secret: WIX_OTP_SECRET,
            });
            const wixRes = await fetch(WIX_SITE_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: wixPayload,
            });
            const wixBody = await wixRes.text();
            if (!wixRes.ok) {
              console.error(`[WixRelay] Failed to send OTP: ${wixRes.status} ${wixBody}`);
            } else {
              deliverySucceeded = true;
              console.log(`[OTP] Wix relay accepted delivery to ${cleanEmail}: ${wixRes.status}`);
            }
          } catch (wixErr) {
            console.error("[WixRelay] Error calling Wix endpoint:", wixErr);
          }
        })());
      } else if (useWix) {
        console.warn(`[OTP] Wix secrets missing! WIX_SITE_URL=${!!WIX_SITE_URL}, WIX_OTP_SECRET=${!!WIX_OTP_SECRET}`);
      }

      if (useGmail) {
        sendTasks.push((async () => {
          try {
            const supabaseUrl = Deno.env.get("SUPABASE_URL");
            const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            if (!supabaseUrl || !serviceKey) {
              console.warn("[OTP] Supabase env missing for Gmail relay");
              return;
            }
            const subject = `Your ProsperWise sign-in code: ${otp}`;
            const text = `Hi ${contact.first_name || "there"},\n\nYour one-time sign-in code is:\n\n${otp}\n\nThis code expires in 10 minutes. If you didn't request it, you can ignore this email.\n\nThank you,\nProsperWise Team`;
            const gmRes = await fetch(`${supabaseUrl}/functions/v1/send-admin-email`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${serviceKey}`,
                "x-internal-secret": Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "",
              },
              body: JSON.stringify({ to: cleanEmail, subject, text }),
            });
            if (!gmRes.ok) {
              const body = await gmRes.text();
              console.error(`[OTP] Gmail relay failed: ${gmRes.status} ${body}`);
            } else {
              deliverySucceeded = true;
              console.log(`[OTP] Gmail relay accepted delivery to ${cleanEmail}`);
            }
          } catch (gmErr) {
            console.error("[OTP] Error calling send-admin-email:", gmErr);
          }
        })());
      }

      await Promise.all(sendTasks);

      if (!deliverySucceeded) {
        return new Response(JSON.stringify({ error: "We couldn't send the access code. Please try again shortly." }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ sent: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      if (!email || !code) {
        return new Response(JSON.stringify({ error: "Email and code required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cleanEmail = email.trim().toLowerCase();

      // Brute-force protection: lock out after 5 failed verify attempts
      // across any active OTPs for this email in the last 10 minutes.
      const tenMinAgo = new Date(Date.now() - 600000).toISOString();
      const { data: recentOtps } = await supabase
        .from("portal_otps")
        .select("id, failed_attempts")
        .eq("email", cleanEmail)
        .gte("created_at", tenMinAgo);
      const totalFailed = (recentOtps || []).reduce(
        (sum: number, r: any) => sum + (r.failed_attempts || 0),
        0,
      );
      if (totalFailed >= 5) {
        await new Promise((r) => setTimeout(r, 1000));
        return new Response(
          JSON.stringify({ error: "Too many failed attempts. Please request a new code." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: otp } = await supabase
        .from("portal_otps")
        .select("*")
        .eq("email", cleanEmail)
        .eq("code", code)
        .eq("verified", false)
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!otp) {
        // Increment failed_attempts on the most recent active OTP (if any)
        const newest = (recentOtps || [])[0];
        if (newest) {
          await supabase
            .from("portal_otps")
            .update({ failed_attempts: (newest.failed_attempts || 0) + 1 })
            .eq("id", newest.id);
        }
        await new Promise((r) => setTimeout(r, 1000));
        return new Response(JSON.stringify({ error: "Invalid or expired code" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Mark as verified
      await supabase.from("portal_otps").update({ verified: true }).eq("id", otp.id);

      // Log portal login
      await supabase.from("portal_logins").insert({ contact_id: otp.contact_id, login_method: "otp" });

      const contactId = otp.contact_id;

      // Create a portal token so the client can use it for subsequent API calls
      const { data: newToken } = await supabase
        .from("portal_tokens")
        .insert({
          contact_id: contactId,
          created_by: contactId, // self-issued via OTP
        })
        .select("token")
        .single();

      // Mint a trusted-device token unless the client explicitly opted out
      let trustedDeviceToken: string | null = null;
      let trustedDeviceExpiresAt: string | null = null;
      if (trustDevice !== false) {
        const minted = await mintTrustedDevice(supabase, {
          contactId,
          ip: clientIp,
          userAgent,
        });
        if (minted) {
          trustedDeviceToken = minted.raw;
          trustedDeviceExpiresAt = minted.expiresAt;
        }
      }

      // Load the full portal data payload via portal-validate, the single
      // source of truth for this shape — see fetchFullPortalData().
      const fullData = await fetchFullPortalData(newToken!.token);

      return new Response(JSON.stringify({
        ...fullData,
        portal_token: newToken?.token || null,
        trusted_device_token: trustedDeviceToken,
        trusted_device_expires_at: trustedDeviceExpiresAt,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "google-auth") {
      // Google OAuth portal login — verify the caller's Supabase session matches the requested email.
      if (!email || typeof email !== "string") {
        return new Response(JSON.stringify({ error: "Email is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const cleanEmail = email.trim().toLowerCase();

      // Require a Supabase access token in the Authorization header and verify it server-side.
      const authHeader = req.headers.get("Authorization") || "";
      const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!accessToken) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const supabaseUserClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        anonKey,
        { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
      );
      const { data: userData, error: userErr } = await supabaseUserClient.auth.getUser();
      const verifiedEmail = userData?.user?.email?.toLowerCase() || "";
      if (userErr || !userData?.user || verifiedEmail !== cleanEmail) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: contact } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, full_name, email, email_notifications_enabled, quiet_period_start_date, google_drive_url, charter_url, asana_url, ia_financial_url, vineyard_ebitda, vineyard_operating_income, vineyard_balance_sheet_summary, family_id, household_id, family_role, is_minor")
        .ilike("email", cleanEmail)
        .maybeSingle();

      if (!contact) {
        return new Response(JSON.stringify({ error: "No account found for this email" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Log portal login
      await supabase.from("portal_logins").insert({ contact_id: contact.id, login_method: "google" });

      // Create a portal token for the session
      const { data: newToken } = await supabase
        .from("portal_tokens")
        .insert({
          contact_id: contact.id,
          created_by: contact.id,
        })
        .select("token")
        .single();

      // Mint trusted device unless client opted out
      let gTrustedDeviceToken: string | null = null;
      let gTrustedDeviceExpiresAt: string | null = null;
      if (trustDevice !== false) {
        const minted = await mintTrustedDevice(supabase, {
          contactId: contact.id,
          ip: clientIp,
          userAgent,
        });
        if (minted) {
          gTrustedDeviceToken = minted.raw;
          gTrustedDeviceExpiresAt = minted.expiresAt;
        }
      }

      // Load the full portal data payload via portal-validate, the single
      // source of truth for this shape — see fetchFullPortalData().
      const fullData = await fetchFullPortalData(newToken!.token);

      return new Response(JSON.stringify({
        ...fullData,
        portal_token: newToken?.token || null,
        trusted_device_token: gTrustedDeviceToken,
        trusted_device_expires_at: gTrustedDeviceExpiresAt,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Trusted-device fast-login: skip OTP if the client presents a valid device token ──
    if (action === "device-login") {
      if (!email || !deviceToken) {
        return new Response(JSON.stringify({ error: "Email and device token required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const cleanEmail = email.trim().toLowerCase();
      const validated = await validateTrustedDevice(supabase, {
        rawToken: deviceToken,
        expectedEmail: cleanEmail,
        ip: clientIp,
        userAgent,
      });
      if (!validated) {
        return new Response(JSON.stringify({ error: "Device not trusted" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Hand off to the existing OTP path by issuing a portal_token and returning data
      await supabase.from("portal_logins").insert({
        contact_id: validated.contactId, login_method: "trusted_device",
      });
      const { data: newToken } = await supabase
        .from("portal_tokens")
        .insert({ contact_id: validated.contactId, created_by: validated.contactId })
        .select("token").single();

      // Reuse portal-validate-shape via a minimal in-line load (kept minimal — only fields the portal needs at boot)
      const { data: contact } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, full_name, email, email_notifications_enabled, quiet_period_start_date, google_drive_url, charter_url, asana_url, ia_financial_url, family_id, household_id, family_role, is_minor")
        .eq("id", validated.contactId).maybeSingle();

      return new Response(JSON.stringify({
        portal_token: newToken?.token || null,
        device_login: true,
        contact,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "revoke-devices") {
      // Caller must already be authenticated to the portal — we accept the
      // current portal_token as proof (rather than a device token).
      const portalTokenStr = (body as any).portal_token;
      if (!portalTokenStr) {
        return new Response(JSON.stringify({ error: "portal_token required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: pt } = await supabase
        .from("portal_tokens")
        .select("contact_id, revoked, expires_at")
        .eq("token", portalTokenStr).maybeSingle();
      if (!pt || pt.revoked || new Date(pt.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      await revokeAllDevices(supabase, pt.contact_id);
      return new Response(JSON.stringify({ revoked: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Portal OTP error:", e);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
