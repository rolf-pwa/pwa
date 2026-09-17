import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

const BodySchema = z.object({
  contactId: z.string().uuid().optional(),
  reviewId: z.string().uuid().optional(),
}).refine((value) => value.contactId || value.reviewId, {
  message: "contactId or reviewId is required",
});

type Storehouse = {
  id: string;
  label: string;
  asset_type: string | null;
  current_value: number | null;
  target_value: number | null;
  charter_alignment: "aligned" | "misaligned" | "pending_review";
  storehouse_number: number;
};

type VineyardAccount = {
  id: string;
  account_name: string;
  account_type: string;
  current_value: number | null;
};

type HarvestSnapshot = {
  id: string;
  vineyard_account_id: string | null;
  storehouse_id: string | null;
  snapshot_date: string;
  boy_value: number | null;
  current_harvest: number | null;
  current_value: number | null;
};

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(value);
}

function sumValues(rows: Array<{ current_value: number | null }>) {
  return rows.reduce((total, row) => total + (Number(row.current_value) || 0), 0);
}

function uniqueDefined(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[]));
}

function latestSnapshotsByKey(snapshots: HarvestSnapshot[]) {
  return snapshots.reduce<Record<string, HarvestSnapshot>>((acc, snapshot) => {
    const key = snapshot.vineyard_account_id
      ? `vineyard:${snapshot.vineyard_account_id}`
      : snapshot.storehouse_id
        ? `storehouse:${snapshot.storehouse_id}`
        : null;

    if (!key) return acc;

    const existing = acc[key];
    if (!existing || new Date(snapshot.snapshot_date).getTime() > new Date(existing.snapshot_date).getTime()) {
      acc[key] = snapshot;
    }

    return acc;
  }, {});
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().formErrors[0] || "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = authData.user.id;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let contactId = parsed.data.contactId;
    let reviewId = parsed.data.reviewId;

    if (reviewId && !contactId) {
      const { data: existingReview, error: reviewError } = await supabase
        .from("quarterly_system_reviews")
        .select("id, contact_id")
        .eq("id", reviewId)
        .single();
      if (reviewError || !existingReview) {
        return new Response(JSON.stringify({ error: "Quarterly review not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      contactId = existingReview.contact_id;
    }

    if (!contactId) {
      return new Response(JSON.stringify({ error: "Contact not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, charter_url, households(governance_status)")
      .eq("id", contactId)
      .single();

    if (contactError || !contact) {
      return new Response(JSON.stringify({ error: "Contact not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!reviewId) {
      const { data: existing } = await supabase
        .from("quarterly_system_reviews")
        .select("id")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      reviewId = existing?.id;
    }

    if (!reviewId) {
      const { data: inserted, error: insertError } = await supabase
        .from("quarterly_system_reviews")
        .insert({
          contact_id: contactId,
          created_by: userId,
          client_first_name: contact.first_name || "",
          client_last_name: contact.last_name || "",
          review_date: new Date().toISOString().slice(0, 10),
          generation_status: "generating",
        })
        .select("id")
        .single();
      if (insertError || !inserted) throw new Error(insertError?.message || "Failed to create review record");
      reviewId = inserted.id;
    } else {
      const { error: reviewUpdateError } = await supabase
        .from("quarterly_system_reviews")
        .update({
          generation_status: "generating",
          generation_error: null,
          client_first_name: contact.first_name || "",
          client_last_name: contact.last_name || "",
          review_date: new Date().toISOString().slice(0, 10),
        })
        .eq("id", reviewId);
      if (reviewUpdateError) throw reviewUpdateError;
    }

    const [vineyardRes, storehouseRes, harvestRes, charterRes] = await Promise.all([
      supabase
        .from("vineyard_accounts")
        .select("id, account_name, account_type, current_value")
        .eq("contact_id", contactId)
        .order("created_at"),
      supabase
        .from("storehouses")
        .select("id, label, asset_type, current_value, target_value, charter_alignment, storehouse_number")
        .eq("contact_id", contactId)
        .order("storehouse_number"),
      supabase
        .from("account_harvest_snapshots")
        .select("id, vineyard_account_id, storehouse_id, snapshot_date, boy_value, current_harvest, current_value")
        .eq("contact_id", contactId)
        .order("snapshot_date", { ascending: false }),
      supabase
        .from("sovereignty_charters")
        .select("intro_note, intro_callout, intro_heading, mission_of_capital, vision_20_year")
        .eq("contact_id", contactId)
        .maybeSingle(),
    ]);

    if (vineyardRes.error) throw vineyardRes.error;
    if (storehouseRes.error) throw storehouseRes.error;
    if (harvestRes.error) throw harvestRes.error;

    const charter = charterRes.data || null;
    // Prefer intro_callout (the actual Charter Purpose Statement) over intro_note (which is the meta-format description).
    const purposeStatement = (charter?.intro_callout || charter?.intro_note || "").toString().trim();
    const primaryGoal = (charter?.mission_of_capital || "").toString().trim();
    const longTermVision = (charter?.vision_20_year || "").toString().trim();

    const vineyardAccounts = (vineyardRes.data || []) as VineyardAccount[];
    const storehouses = (storehouseRes.data || []) as Storehouse[];
    const harvestSnapshots = (harvestRes.data || []) as HarvestSnapshot[];
    const latestSnapshots = latestSnapshotsByKey(harvestSnapshots);
    const vineyardTotal = sumValues(vineyardAccounts);
    const storehouseTotal = sumValues(storehouses);

    const vineyardHarvestSnapshots = vineyardAccounts
      .map((account) => latestSnapshots[`vineyard:${account.id}`])
      .filter(Boolean) as HarvestSnapshot[];

    const storehouseHarvestSnapshots = storehouses
      .map((storehouse) => latestSnapshots[`storehouse:${storehouse.id}`])
      .filter(Boolean) as HarvestSnapshot[];

    const totalVineyardBOY = vineyardHarvestSnapshots.reduce((sum, item) => sum + (Number(item.boy_value) || 0), 0);
    const totalVineyardHarvest = vineyardHarvestSnapshots.reduce((sum, item) => sum + (Number(item.current_harvest) || 0), 0);
    const totalStorehouseBOY = storehouseHarvestSnapshots.reduce((sum, item) => sum + (Number(item.boy_value) || 0), 0);
    const totalStorehouseHarvest = storehouseHarvestSnapshots.reduce((sum, item) => sum + (Number(item.current_harvest) || 0), 0);
    const missingVineyardHarvestCount = vineyardAccounts.length - vineyardHarvestSnapshots.length;
    const missingStorehouseHarvestCount = storehouses.length - storehouseHarvestSnapshots.length;
    const negativeHarvestCount = [...vineyardHarvestSnapshots, ...storehouseHarvestSnapshots].filter((item) => (Number(item.current_harvest) || 0) < 0).length;

    const alignedStorehouses = storehouses.filter((item) => item.charter_alignment === "aligned");
    const pendingStorehouses = storehouses.filter((item) => item.charter_alignment === "pending_review");
    const misalignedStorehouses = storehouses.filter((item) => item.charter_alignment === "misaligned");
    const fundedStorehouses = storehouses.filter((item) => (Number(item.target_value) || 0) > 0 && (Number(item.current_value) || 0) >= (Number(item.target_value) || 0));
    const underfundedStorehouses = storehouses.filter((item) => (Number(item.target_value) || 0) > 0 && (Number(item.current_value) || 0) < (Number(item.target_value) || 0));
    const missingStorehouseNumbers = [1, 2, 3, 4].filter((number) => !storehouses.some((item) => item.storehouse_number === number));

    const charterStatus = !contact.charter_url
      ? "Missing"
      : misalignedStorehouses.length > 0
        ? "Needs Attention"
        : pendingStorehouses.length > 0 || missingStorehouseNumbers.length > 0
          ? "Partial"
          : "Aligned";

    const vineyardStatus = vineyardAccounts.length === 0
      ? "Missing"
      : vineyardTotal <= 0
        ? "Needs Review"
        : missingVineyardHarvestCount > 0
          ? "Partial"
        : contact.charter_url
          ? "Aligned"
          : "Partial";

    const storehouseStatus = storehouses.length === 0
      ? "Missing"
      : misalignedStorehouses.length > 0 || underfundedStorehouses.length > 0
        ? "Needs Attention"
        : missingStorehouseHarvestCount > 0
          ? "Partial"
        : missingStorehouseNumbers.length > 0 || pendingStorehouses.length > 0
          ? "Partial"
          : "Aligned";

    const preliminaryGaps = uniqueDefined([
      !contact.charter_url ? "No Charter is linked, so written intent cannot govern the current system." : undefined,
      vineyardAccounts.length === 0 ? "No Vineyard accounts are on record for this contact." : undefined,
      storehouses.length === 0 ? "No Storehouse structure is configured for liquidity and reserve governance." : undefined,
      missingStorehouseNumbers.length > 0 ? `Missing Storehouse lanes: ${missingStorehouseNumbers.map((number) => `#${number}`).join(", ")}.` : undefined,
      misalignedStorehouses.length > 0 ? `${misalignedStorehouses.length} Storehouse item(s) are marked misaligned with the Charter.` : undefined,
      pendingStorehouses.length > 0 ? `${pendingStorehouses.length} Storehouse item(s) still need Charter review.` : undefined,
      underfundedStorehouses.length > 0 ? `${underfundedStorehouses.length} Storehouse target(s) are below required funding levels.` : undefined,
      missingVineyardHarvestCount > 0 ? `${missingVineyardHarvestCount} Vineyard account(s) are missing BOY/current harvest tracking.` : undefined,
      missingStorehouseHarvestCount > 0 ? `${missingStorehouseHarvestCount} Storehouse item(s) are missing BOY/current harvest tracking.` : undefined,
      negativeHarvestCount > 0 ? `${negativeHarvestCount} tracked account(s) show a negative current harvest and need review.` : undefined,
      vineyardAccounts.length > 0 && storehouses.length === 0 ? "Vineyard assets exist without a matching Storehouse reserve framework." : undefined,
      contact.households?.governance_status === "stabilization" ? "Contact is still in Stabilization Phase, so full sovereign governance is not yet complete." : undefined,
    ]);

    const preliminaryPriorities = uniqueDefined([
      !contact.charter_url ? "Link the current Charter so quarterly reviews can measure against written intent." : undefined,
      vineyardAccounts.length === 0 ? "Load or verify Vineyard accounts so the review reflects actual core assets." : undefined,
      storehouses.length === 0 ? "Stand up the four Storehouses and define each lane before the next review." : undefined,
      missingStorehouseNumbers.length > 0 ? `Create the missing Storehouse lanes (${missingStorehouseNumbers.map((number) => `#${number}`).join(", ")}) and assign their purpose.` : undefined,
      misalignedStorehouses.length > 0 ? "Resolve Storehouse items marked misaligned and ratify their intended role." : undefined,
      pendingStorehouses.length > 0 ? "Approve Storehouse items still sitting in pending review." : undefined,
      underfundedStorehouses.length > 0 ? "Fund the under-target Storehouses according to their target floors." : undefined,
      missingVineyardHarvestCount > 0 || missingStorehouseHarvestCount > 0 ? "Complete BOY and current harvest tracking for every matched account before the next quarterly review." : undefined,
      negativeHarvestCount > 0 ? "Review accounts with negative current harvest and confirm whether losses or cash flows explain the variance." : undefined,
      vineyardAccounts.length > 0 && storehouseTotal === 0 ? "Pair core Vineyard assets with reserve and protection lanes before the next 90-day cycle." : undefined,
      contact.households?.governance_status === "stabilization" ? "Complete the move from Stabilization into ratified governance so the system can be enforced." : undefined,
      contact.charter_url && storehouses.length > 0 && vineyardAccounts.length > 0 ? "Reconfirm the next 90-day allocation plan with the Charter, Vineyard, and Storehouse structure side by side." : undefined,
    ]);

    while (preliminaryGaps.length < 5) {
      preliminaryGaps.push("No additional material gap flagged in this quarter's system check.");
    }
    while (preliminaryPriorities.length < 5) {
      preliminaryPriorities.push("No additional priority was required beyond the current governance plan.");
    }

    const gapCount = preliminaryGaps.filter((item) => !item.startsWith("No additional material gap")).length;
    const crossSystemStatus = gapCount === 0 ? "Aligned" : gapCount <= 2 ? "Partial" : "Needs Attention";

    const reviewSummary = `${contact.first_name || "Client"}'s quarterly review compares ${vineyardAccounts.length} Vineyard account(s) totaling ${formatMoney(vineyardTotal)} against ${storehouses.length} Storehouse item(s) totaling ${formatMoney(storehouseTotal)}${contact.charter_url ? " with a Charter on file" : " without a Charter on file"}, alongside current annual harvest tracking of ${formatMoney(totalVineyardHarvest + totalStorehouseHarvest)}.`;
    const alignmentOverview = crossSystemStatus === "Aligned"
      ? "The Charter, Vineyard, and Storehouse structure are currently operating in step with each other."
      : crossSystemStatus === "Partial"
        ? "Core governance pieces exist, but one or more system layers still need completion before the next quarter."
        : "Meaningful gaps remain between written intent, asset placement, and reserve structure that should be resolved in the next 90 days.";

    const charterDetail = !contact.charter_url
      ? "No Charter link is on file, so the review cannot verify that current assets still match written intent."
      : misalignedStorehouses.length > 0
        ? `A Charter is on file, but ${misalignedStorehouses.length} Storehouse item(s) are marked misaligned against it.`
        : pendingStorehouses.length > 0
          ? `A Charter is on file, but ${pendingStorehouses.length} Storehouse item(s) still need review before the system is fully ratified.`
          : "A Charter is on file and there are no flagged Storehouse conflicts against it.";

    const vineyardDetail = vineyardAccounts.length === 0
      ? "No Vineyard accounts are recorded, so the core asset layer cannot be reviewed this quarter."
      : `${vineyardAccounts.length} Vineyard account(s) are recorded with an aggregate value of ${formatMoney(vineyardTotal)} across ${uniqueDefined(vineyardAccounts.map((item) => item.account_type)).join(", ") || "the current account mix"}. Harvest tracking covers ${vineyardHarvestSnapshots.length}/${vineyardAccounts.length} account(s): BOY ${formatMoney(totalVineyardBOY)}, current harvest ${formatMoney(totalVineyardHarvest)}.`;

    const storehouseDetail = storehouses.length === 0
      ? "No Storehouse structure exists yet, so reserves, protection pools, and liquidity lanes are not currently mapped."
      : `${storehouses.length} Storehouse item(s) are present; ${alignedStorehouses.length} aligned, ${pendingStorehouses.length} pending review, ${misalignedStorehouses.length} misaligned, and ${fundedStorehouses.length} fully funded to target. Harvest tracking covers ${storehouseHarvestSnapshots.length}/${storehouses.length} item(s): BOY ${formatMoney(totalStorehouseBOY)}, current harvest ${formatMoney(totalStorehouseHarvest)}.`;

    const crossSystemDetail = crossSystemStatus === "Aligned"
      ? "The Charter, core assets, and reserve lanes are all present and show no material conflicts in this review cycle."
      : crossSystemStatus === "Partial"
        ? "The system is mostly in place, but at least one lane still needs review, funding, or formal Charter linkage."
        : "Written intent, invested assets, reserve structure, and annual harvest tracking are not yet moving together tightly enough for sovereign operation.";

    const logicTrace = [
      `Charter status was set to ${charterStatus} because Charter on file = ${contact.charter_url ? "yes" : "no"}.`,
      `Vineyard review counted ${vineyardAccounts.length} account(s) totaling ${formatMoney(vineyardTotal)}.`,
      `Storehouse review counted ${storehouses.length} item(s), with ${misalignedStorehouses.length} misaligned, ${pendingStorehouses.length} pending, and ${underfundedStorehouses.length} under target.`,
      `Harvest tracking covered ${vineyardHarvestSnapshots.length}/${vineyardAccounts.length} Vineyard account(s) and ${storehouseHarvestSnapshots.length}/${storehouses.length} Storehouse item(s), with total current harvest ${formatMoney(totalVineyardHarvest + totalStorehouseHarvest)}.`,
      `Cross-system status was set to ${crossSystemStatus} based on ${gapCount} material gap(s) across Charter, Vineyard, Storehouse, and harvest tracking layers.`,
    ].join(" ");

    const update = {
      client_first_name: contact.first_name || "",
      client_last_name: contact.last_name || "",
      review_date: new Date().toISOString().slice(0, 10),
      review_summary: reviewSummary,
      alignment_overview: alignmentOverview,
      purpose_statement: purposeStatement,
      primary_goal: primaryGoal,
      long_term_vision: longTermVision,
      charter_status: charterStatus,
      charter_detail: charterDetail,
      vineyard_status: vineyardStatus,
      vineyard_detail: vineyardDetail,
      storehouse_status: storehouseStatus,
      storehouse_detail: storehouseDetail,
      cross_system_status: crossSystemStatus,
      cross_system_detail: crossSystemDetail,
      gap_1: preliminaryGaps[0],
      gap_2: preliminaryGaps[1],
      gap_3: preliminaryGaps[2],
      gap_4: preliminaryGaps[3],
      gap_5: preliminaryGaps[4],
      priority_1: preliminaryPriorities[0],
      priority_2: preliminaryPriorities[1],
      priority_3: preliminaryPriorities[2],
      priority_4: preliminaryPriorities[3],
      priority_5: preliminaryPriorities[4],
      footer_note: "Quarterly review to ensure the Charter, Vineyard, and Storehouse remain aligned and governable over the next 90 days.",
      logic_trace: logicTrace,
      generation_status: "ready",
      generation_error: null,
    };

    const { error: updateError } = await supabase
      .from("quarterly_system_reviews")
      .update(update)
      .eq("id", reviewId);

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ success: true, reviewId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("quarterly-system-review-generate error:", error);

    const parsed = await req.clone().json().catch(() => null) as { reviewId?: string } | null;
    const reviewId = parsed?.reviewId;

    if (reviewId) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );

        await supabase
          .from("quarterly_system_reviews")
          .update({
            generation_status: "failed",
            generation_error: error instanceof Error ? error.message : "Unknown error",
          })
          .eq("id", reviewId);
      } catch (persistError) {
        console.error("quarterly-system-review-generate failed to persist error:", persistError);
      }
    }

    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
