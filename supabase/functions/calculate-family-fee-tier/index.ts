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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  };
}

interface FeeTier {
  tier: "sovereign" | "legacy" | "dynasty";
  discount_pct: number;
  annual_savings: number;
}

function calculateTier(totalAssets: number, baseFeeRate = 0.01): FeeTier {
  if (totalAssets >= 5_000_000) {
    const fullFee = totalAssets * baseFeeRate;
    const discountedFee = totalAssets * baseFeeRate * 0.75;
    return { tier: "dynasty", discount_pct: 25, annual_savings: fullFee - discountedFee };
  }
  if (totalAssets >= 1_000_000) {
    const fullFee = totalAssets * baseFeeRate;
    const discountedFee = totalAssets * baseFeeRate * 0.85;
    return { tier: "legacy", discount_pct: 15, annual_savings: fullFee - discountedFee };
  }
  return { tier: "sovereign", discount_pct: 0, annual_savings: 0 };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // ---- Auth: require @prosperwise.ca staff ----
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser();
    const email = userData?.user?.email?.toLowerCase() || "";
    if (userErr || !userData?.user || !email.endsWith("@prosperwise.ca")) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { familyId } = await req.json();

    if (!familyId || typeof familyId !== "string") {
      return new Response(JSON.stringify({ error: "familyId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all contacts in this family
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id")
      .eq("family_id", familyId);

    if (!contacts || contacts.length === 0) {
      // Update family with zero assets
      await supabase
        .from("families")
        .update({
          total_family_assets: 0,
          fee_tier: "sovereign",
          fee_tier_discount_pct: 0,
          annual_savings: 0,
        })
        .eq("id", familyId);

      return new Response(JSON.stringify({ total: 0, tier: "sovereign", discount: 0, savings: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contactIds = contacts.map((c: any) => c.id);

    const [{ data: accounts }, { data: storehouses }, { data: insurancePolicies }] = await Promise.all([
      supabase.from("vineyard_accounts").select("current_value").in("contact_id", contactIds),
      supabase.from("storehouses").select("current_value, asset_type").in("contact_id", contactIds),
      supabase.from("insurance_policies").select("cash_value").in("contact_id", contactIds),
    ]);

    const vineyardTotal = (accounts || []).reduce(
      (sum: number, acc: any) => sum + (Number(acc.current_value) || 0),
      0
    );
    const storehouseTotal = (storehouses || [])
      .filter((s: any) => s.asset_type !== 'Primary Residence & Protected Legacy Accounts')
      .reduce((sum: number, s: any) => sum + (Number(s.current_value) || 0), 0);
    const insuranceCashTotal = (insurancePolicies || [])
      .reduce((sum: number, p: any) => sum + (Number(p.cash_value) || 0), 0);

    const totalAssets = vineyardTotal + storehouseTotal + insuranceCashTotal;

    const { tier, discount_pct, annual_savings } = calculateTier(totalAssets);

    // Update the family record
    await supabase
      .from("families")
      .update({
        total_family_assets: totalAssets,
        fee_tier: tier,
        fee_tier_discount_pct: discount_pct,
        annual_savings: annual_savings,
      })
      .eq("id", familyId);

    return new Response(
      JSON.stringify({
        total: totalAssets,
        tier,
        discount: discount_pct,
        savings: annual_savings,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
