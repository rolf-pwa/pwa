import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { provisionClientFolderTree } from "../_shared/vault-provisioning.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ---- Staff auth -------------------------------------------------------
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const householdId: string | undefined = body?.household_id;
    if (!householdId || typeof householdId !== "string") {
      return json({ error: "household_id is required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Idempotent: no-ops (success, vaultRootFolderId of the existing vault)
    // if this household is already provisioned — safe to click more than once.
    const result = await provisionClientFolderTree(admin, householdId);
    if (!result.ok) return json({ error: result.error }, 500);

    return json({ success: true, vaultRootFolderId: result.vaultRootFolderId });
  } catch (e) {
    console.error("crm-intake-push error", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
