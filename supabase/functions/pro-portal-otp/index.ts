import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sha256Hex,
  generateOtp,
  generateSessionToken,
  validateProSession,
} from "../_shared/pro-portal-auth.ts";

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

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour rolling

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json();
    const action = body.action as string;

    if (action === "send") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) {
        return new Response(JSON.stringify({ error: "Email required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Find professional by email (silent success when not found)
      const { data: pro } = await supabase
        .from("professionals")
        .select("id, full_name, email, pro_portal_enabled")
        .ilike("email", email)
        .maybeSingle();

      if (!pro || !pro.pro_portal_enabled) {
        console.log(`[pro-portal-otp] No portal-enabled pro for ${email}`);
        return new Response(JSON.stringify({ sent: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Rate limit: max 3 OTPs per pro per hour
      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
      const { count } = await supabase
        .from("pro_portal_tokens")
        .select("id", { count: "exact", head: true })
        .eq("professional_id", pro.id)
        .gte("created_at", oneHourAgo);
      if ((count ?? 0) >= 3) {
        return new Response(JSON.stringify({ sent: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const otp = generateOtp();
      const otp_code_hash = await sha256Hex(otp);
      const otp_expires_at = new Date(Date.now() + OTP_TTL_MS).toISOString();
      // Placeholder session expiry until OTP is verified.
      const session_expires_at = otp_expires_at;
      // Placeholder token_hash (rotated to real session hash on verify).
      const token_hash = await sha256Hex(`pending:${crypto.randomUUID()}`);

      await supabase.from("pro_portal_tokens").insert({
        professional_id: pro.id,
        token_hash,
        otp_code_hash,
        otp_expires_at,
        session_expires_at,
      });

      // Send via Gmail relay (send-admin-email)
      const subject = `Your ProsperWise Pro Portal code: ${otp}`;
      const text = `Hello ${pro.full_name},\n\nYour one-time access code for the ProsperWise Pro Portal is:\n\n${otp}\n\nThis code expires in 10 minutes. If you didn't request it, you can safely ignore this email.\n\n— ProsperWise`;
      try {
        const gmRes = await fetch(`${SUPABASE_URL}/functions/v1/send-admin-email`, {
          method: "POST",
          headers: { "x-region": "ca-central-1",
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
            "x-internal-secret": Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "",
          },
          body: JSON.stringify({ to: pro.email, subject, text }),
        });
        if (!gmRes.ok) {
          const t = await gmRes.text();
          console.error(`[pro-portal-otp] Gmail relay failed ${gmRes.status}: ${t}`);
        }
      } catch (e) {
        console.error("[pro-portal-otp] send-admin-email error", e);
      }

      return new Response(JSON.stringify({ sent: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      const email = String(body.email || "").trim().toLowerCase();
      const code = String(body.code || "").trim();
      if (!email || !code) {
        return new Response(JSON.stringify({ error: "Email and code required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: pro } = await supabase
        .from("professionals")
        .select("id, full_name, email, firm, professional_type")
        .ilike("email", email)
        .maybeSingle();
      if (!pro) {
        await new Promise((r) => setTimeout(r, 800));
        return new Response(JSON.stringify({ error: "Invalid or expired code" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const otp_code_hash = await sha256Hex(code);
      const { data: row } = await supabase
        .from("pro_portal_tokens")
        .select("id")
        .eq("professional_id", pro.id)
        .eq("otp_code_hash", otp_code_hash)
        .gte("otp_expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!row) {
        await new Promise((r) => setTimeout(r, 800));
        return new Response(JSON.stringify({ error: "Invalid or expired code" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Rotate the placeholder row into a real session
      const rawToken = generateSessionToken();
      const newHash = await sha256Hex(rawToken);
      const sessionExp = new Date(Date.now() + SESSION_TTL_MS).toISOString();

      await supabase
        .from("pro_portal_tokens")
        .update({
          token_hash: newHash,
          otp_code_hash: null,
          otp_expires_at: null,
          session_expires_at: sessionExp,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      await supabase
        .from("professionals")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", pro.id);

      return new Response(
        JSON.stringify({
          session_token: rawToken,
          session_expires_at: sessionExp,
          professional: pro,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "validate") {
      const sess = await validateProSession(supabase, body.session_token);
      if (!sess) {
        return new Response(JSON.stringify({ valid: false }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ valid: true, professional: sess.professional }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "oauth_exchange") {
      // Exchange a Supabase auth bearer token (from Google OAuth) for a
      // pro portal session. The professional must exist by email and be
      // portal-enabled.
      const authHeader = req.headers.get("Authorization") || "";
      const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!jwt) {
        return new Response(JSON.stringify({ error: "Missing auth token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: userRes, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userRes?.user?.email) {
        return new Response(JSON.stringify({ error: "Invalid Google session" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const email = userRes.user.email.toLowerCase();

      const { data: pro } = await supabase
        .from("professionals")
        .select("id, full_name, email, firm, professional_type, pro_portal_enabled")
        .ilike("email", email)
        .maybeSingle();

      if (!pro || !pro.pro_portal_enabled) {
        return new Response(
          JSON.stringify({ error: "No Pro Portal account is linked to this Google email." }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const rawToken = generateSessionToken();
      const newHash = await sha256Hex(rawToken);
      const sessionExp = new Date(Date.now() + SESSION_TTL_MS).toISOString();

      await supabase.from("pro_portal_tokens").insert({
        professional_id: pro.id,
        token_hash: newHash,
        session_expires_at: sessionExp,
        last_used_at: new Date().toISOString(),
      });

      await supabase
        .from("professionals")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", pro.id);

      const { pro_portal_enabled: _pe, ...proSafe } = pro;
      return new Response(
        JSON.stringify({
          session_token: rawToken,
          session_expires_at: sessionExp,
          professional: proSafe,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "staff_impersonate") {
      // Staff-only: mint a short pro portal session for a specific professional
      // so an internal user can preview that pro's portal view.
      const authHeader = req.headers.get("Authorization") || "";
      const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (!jwt) {
        return new Response(JSON.stringify({ error: "Missing auth token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
      });
      const { data: userRes, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userRes?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const proId = String(body.professional_id || "").trim();
      if (!proId) {
        return new Response(JSON.stringify({ error: "professional_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: pro } = await supabase
        .from("professionals")
        .select("id, full_name, email, firm, professional_type, pro_portal_enabled")
        .eq("id", proId)
        .maybeSingle();
      if (!pro || !pro.pro_portal_enabled) {
        return new Response(JSON.stringify({ error: "Pro Portal not enabled for this professional" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const rawToken = generateSessionToken();
      const newHash = await sha256Hex(rawToken);
      // Short 30-minute preview session
      const sessionExp = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await supabase.from("pro_portal_tokens").insert({
        professional_id: pro.id,
        token_hash: newHash,
        session_expires_at: sessionExp,
        last_used_at: new Date().toISOString(),
      });

      console.log(`[pro-portal-otp] staff_impersonate by ${userRes.user.email} -> pro ${pro.id}`);
      const { pro_portal_enabled: _pe, ...proSafe } = pro;
      return new Response(
        JSON.stringify({
          session_token: rawToken,
          session_expires_at: sessionExp,
          professional: proSafe,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "logout") {
      if (body.session_token) {
        const h = await sha256Hex(String(body.session_token));
        await supabase.from("pro_portal_tokens").delete().eq("token_hash", h);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[pro-portal-otp] error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
