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

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !user) throw new Error("Unauthorized");
    // Domain check
    if (!user.email?.toLowerCase().endsWith("@prosperwise.ca")) {
      return new Response(JSON.stringify({ error: "Access denied: unauthorized domain" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { primaryId, duplicateId } = await req.json();
    if (!primaryId || !duplicateId) throw new Error("primaryId and duplicateId required");
    if (primaryId === duplicateId) throw new Error("Cannot merge a contact with itself");

    // Fetch both contacts
    const [{ data: primary }, { data: duplicate }] = await Promise.all([
      supabase.from("contacts").select("*").eq("id", primaryId).single(),
      supabase.from("contacts").select("*").eq("id", duplicateId).single(),
    ]);

    if (!primary || !duplicate) throw new Error("One or both contacts not found");

    // --- 1. Merge contact fields: fill empty primary fields from duplicate ---
    const fieldsToMerge = [
      "email", "phone", "address", "lawyer_name", "lawyer_firm",
      "accountant_name", "accountant_firm", "executor_name", "executor_firm",
      "poa_name", "poa_firm",
      "ia_financial_url", "google_drive_url", "just_wealth_url", "charter_url",
      "last_name",
    ];
    const updates: Record<string, any> = {};
    for (const field of fieldsToMerge) {
      if (!primary[field] && duplicate[field]) {
        updates[field] = duplicate[field];
      }
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from("contacts").update(updates).eq("id", primaryId);
    }

    // --- 2. Transfer all related records ---
    const tablesToTransfer = [
      { table: "holding_tank", column: "contact_id" },
      { table: "vineyard_accounts", column: "contact_id" },
      { table: "storehouses", column: "contact_id" },
      { table: "business_pipeline", column: "contact_id" },
      { table: "portal_tokens", column: "contact_id" },
      { table: "portal_requests", column: "contact_id" },
      { table: "portal_task_interactions", column: "contact_id" },
      { table: "task_collaborators", column: "contact_id" },
      { table: "sovereignty_audit_trail", column: "contact_id" },
      { table: "staff_notifications", column: "contact_id" },
      { table: "marketing_update_reads", column: "contact_id" },
      { table: "shareholders", column: "contact_id" },
      { table: "family_relationships", column: "contact_id" },
      { table: "family_relationships", column: "member_contact_id" },
      { table: "household_relationships", column: "contact_id" },
      { table: "household_relationships", column: "member_contact_id" },
      { table: "portal_otps", column: "contact_id" },
    ];

    const transferResults: string[] = [];
    for (const { table, column } of tablesToTransfer) {
      const { data: rows, error: fetchErr } = await supabase
        .from(table)
        .select("id")
        .eq(column, duplicateId);

      if (fetchErr) {
        transferResults.push(`${table}.${column}: error - ${fetchErr.message}`);
        continue;
      }
      if (rows && rows.length > 0) {
        const { error: updateErr } = await supabase
          .from(table)
          .update({ [column]: primaryId })
          .eq(column, duplicateId);
        if (updateErr) {
          transferResults.push(`${table}.${column}: error - ${updateErr.message}`);
        } else {
          transferResults.push(`${table}.${column}: ${rows.length} record(s) transferred`);
        }
      }
    }

    // --- 3. Delete the duplicate contact ---
    const { error: deleteErr } = await supabase
      .from("contacts")
      .delete()
      .eq("id", duplicateId);

    if (deleteErr) {
      throw new Error(`Records transferred but failed to delete duplicate: ${deleteErr.message}`);
    }

    // --- 4. Log to audit trail ---
    await supabase.from("sovereignty_audit_trail").insert({
      contact_id: primaryId,
      user_id: user.id,
      action_type: "contact_merge",
      action_description: `Merged duplicate contact "${duplicate.full_name}" (${duplicateId}) into this record. Transfers: ${transferResults.join("; ")}`,
      proposed_data: { duplicateId, duplicateName: duplicate.full_name, transfers: transferResults },
    });

    return new Response(
      JSON.stringify({
        success: true,
        primaryId,
        duplicateDeleted: duplicateId,
        fieldsMerged: Object.keys(updates),
        transfers: transferResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
