// Charter Alignment Engine.
// Reads verified review + facts, chunks sovereignty_charters into sections,
// asks Gemini 2.5 Flash to align facts to principles, persists results.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { generateVertexContent, parseServiceAccountKey, extractJson, GEMINI_FLASH_MODEL, withThinking } from "../_shared/vertex-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BodySchema = z.object({ review_id: z.string().uuid() });

// Section keys to chunk a Sovereignty Charter into
const CHARTER_SECTION_KEYS: { key: string; title: string; fields: string[] }[] = [
  { key: "purpose", title: "Mission of Capital", fields: ["mission_of_capital", "primary_goal"] },
  { key: "vision", title: "20-Year Vision", fields: ["vision_20_year", "long_term_strategy"] },
  { key: "growth_policy", title: "Vineyard / Growth Policy", fields: ["growth_primary_detail", "growth_primary_label", "growth_secondary_detail", "growth_secondary_label"] },
  { key: "liquidity_policy", title: "Liquidity & Storehouse Policy", fields: ["storehouse_liquidity_detail", "storehouse_strategic_detail", "storehouse_philanthropic_detail", "storehouse_legacy_detail"] },
  { key: "harvest_policy", title: "Harvest / Withdrawal Policy", fields: ["harvest_yield_protocol", "harvest_spending_categories", "harvest_accounts_note", "withdrawal_safeguards"] },
  { key: "quiet_period", title: "Quiet Period", fields: ["quiet_period", "secondary_quiet_period_rule"] },
  { key: "governance", title: "Governance Authority & Roles", fields: ["governance_authority", "roles_responsibilities", "monitoring_cadence", "conflict_resolution"] },
  { key: "succession", title: "Succession & Executors", fields: ["executor_primary", "executor_alternate", "succession_terms"] },
];

type SectionChunk = { key: string; title: string; body: string };

function chunkCharter(charter: Record<string, any>): SectionChunk[] {
  return CHARTER_SECTION_KEYS
    .map(({ key, title, fields }) => ({
      key,
      title,
      body: fields.map((f) => charter?.[f]).filter(Boolean).join("\n\n").trim(),
    }))
    .filter((c) => c.body.length > 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { review_id } = parsed.data;

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } },
    );
    const { data: au } = await authClient.auth.getUser();
    if (!au?.user) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Load review + findings
    const { data: review, error: rErr } = await supabase
      .from("monthly_governance_reviews")
      .select("*").eq("id", review_id).single();
    if (rErr || !review) return json({ error: "Review not found" }, 404);

    const { data: findings } = await supabase
      .from("governance_review_findings").select("*").eq("review_id", review_id);

    // 2. Resolve contacts + primary contact for charter
    let contactIds: string[] = [];
    let primaryContactId: string | null = null;
    if (review.scope_type === "contact") {
      contactIds = [review.scope_id];
      primaryContactId = review.scope_id;
    } else {
      const { data: members } = await supabase
        .from("contacts").select("id, family_role")
        .eq("household_id", review.scope_id);
      contactIds = (members ?? []).map((m) => m.id);
      const hoh = (members ?? []).find((m: any) => m.family_role === "Head of Household") ?? (members ?? [])[0];
      primaryContactId = hoh?.id ?? null;
    }
    if (!primaryContactId) return json({ error: "No contact for charter lookup" }, 404);

    // 3. Load latest charter
    const { data: charter } = await supabase
      .from("sovereignty_charters").select("*")
      .eq("contact_id", primaryContactId)
      .order("updated_at", { ascending: false })
      .limit(1).maybeSingle();

    const sections: SectionChunk[] = charter ? chunkCharter(charter) : [];

    // 4. Build performance facts from snapshots + findings
    const [{ data: vy }, { data: sh }, { data: ht }] = await Promise.all([
      supabase.from("vineyard_accounts").select("id, label, contact_id, current_value").in("contact_id", contactIds),
      supabase.from("storehouses").select("id, label, contact_id, current_value").in("contact_id", contactIds),
      supabase.from("holding_tank").select("id, label, contact_id, current_value").in("contact_id", contactIds),
    ]);
    const sum = (rows: any[]) => rows.reduce((s, r) => s + Number(r.current_value || 0), 0);
    const vyTotal = sum(vy ?? []);
    const shTotal = sum(sh ?? []);
    const htTotal = sum(ht ?? []);

    const facts = [
      { key: "vineyard_total", description: `Vineyard total live balance is $${vyTotal.toLocaleString()}.`, value: vyTotal },
      { key: "storehouse_total", description: `Storehouse total live balance is $${shTotal.toLocaleString()}.`, value: shTotal },
      { key: "holding_tank_total", description: `Holding Tank total is $${htTotal.toLocaleString()} (unallocated/staged).`, value: htTotal },
      ...((findings ?? []).filter((f: any) => f.code === "material_variance").map((f: any) => ({
        key: `variance_${f.id}`,
        description: f.message,
        value: f.account_ref?.delta ?? null,
      }))),
      ...((findings ?? []).filter((f: any) => f.severity === "critical").map((f: any) => ({
        key: `critical_${f.id}`,
        description: f.message,
        value: null,
      }))),
    ];

    if (!sections.length) {
      // No charter, mark needs_review on every fact
      await supabase.from("governance_alignment_results").delete().eq("review_id", review_id);
      const rows = facts.map((f) => ({
        review_id,
        fact_key: f.key,
        performance_fact: f,
        charter_section_key: null,
        charter_principle: "No ratified Charter on file for this contact.",
        alignment_status: "needs_review" as const,
        exception_reason: "Charter missing — alignment cannot be evaluated.",
        recommended_action: "Generate or ratify the Sovereignty Charter, then re-run alignment.",
        evidence_source: { findings: (findings ?? []).map((x: any) => x.id) },
      }));
      if (rows.length) await supabase.from("governance_alignment_results").insert(rows);
      await supabase.from("monthly_governance_reviews").update({
        status: "charter_checked",
        charter_checked_at: new Date().toISOString(),
        counts: { ...(review.counts || {}), aligned: 0, exception: 0, needs_review: rows.length },
      }).eq("id", review_id);
      return json({ ok: true, alignments: rows.length, note: "no_charter" });
    }

    // 5. Call Vertex AI directly (Gemini 2.5 Flash) — no Lovable gateway
    const systemPrompt = `You are the Charter Alignment Engine for ProsperWise's Sovereignty Operating System.
You judge whether monthly performance facts remain aligned with a family's ratified Sovereignty Charter.

Rules:
- Each judgement MUST cite the exact charter section key used (one of the provided keys).
- alignment_status MUST be one of: "aligned" | "exception" | "needs_review".
- "aligned" = the fact is consistent with the cited principle.
- "exception" = the fact clearly violates or breaks the cited principle.
- "needs_review" = ambiguous, insufficient information, or no relevant section.
- Keep charter_principle to one concise sentence quoting/paraphrasing the section.
- Keep exception_reason and recommended_action concise (one sentence each).
- Never invent charter language. If a fact has no matching section, use needs_review.

Output STRICT JSON: { "results": [ { "fact_key": string, "charter_section_key": string|null, "charter_principle": string, "alignment_status": "aligned"|"exception"|"needs_review", "exception_reason": string|null, "recommended_action": string|null } ] }`;

    const userPayload = {
      charter_sections: sections,
      performance_facts: facts,
    };

    let parsedOut: any = {};
    try {
      const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
      const vertexResult = await generateVertexContent(
        sa,
        GEMINI_FLASH_MODEL,
        [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${JSON.stringify(userPayload)}` }] }],
        withThinking(GEMINI_FLASH_MODEL, { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: "application/json" }, "low"),
      );
      const rawText = vertexResult?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "{}";
      parsedOut = extractJson(rawText);
    } catch (aiErr) {
      const message = aiErr instanceof Error ? aiErr.message : String(aiErr);
      await supabase.from("monthly_governance_reviews").update({
        generation_error: `AI error: ${message.slice(0, 500)}`,
      }).eq("id", review_id);
      return json({ error: "AI generation error", message: message.slice(0, 500) }, 502);
    }
    const results: any[] = Array.isArray(parsedOut?.results) ? parsedOut.results : [];

    // 6. Persist alignment results
    await supabase.from("governance_alignment_results").delete().eq("review_id", review_id);
    const sectionByKey = new Map(sections.map((s) => [s.key, s]));
    const rows = results.map((r) => {
      const factObj = facts.find((f) => f.key === r.fact_key);
      const section = r.charter_section_key ? sectionByKey.get(r.charter_section_key) : null;
      return {
        review_id,
        fact_key: r.fact_key || "unknown",
        performance_fact: factObj || { key: r.fact_key },
        charter_section_key: section ? section.key : null,
        charter_principle: r.charter_principle || "",
        alignment_status: ["aligned","exception","needs_review"].includes(r.alignment_status) ? r.alignment_status : "needs_review",
        exception_reason: r.exception_reason || null,
        recommended_action: r.recommended_action || null,
        evidence_source: { charter_id: charter?.id, section_title: section?.title || null },
      };
    });
    if (rows.length) {
      const { error: iErr } = await supabase.from("governance_alignment_results").insert(rows);
      if (iErr) throw iErr;
    }

    const counts = {
      ...(review.counts || {}),
      aligned: rows.filter((r) => r.alignment_status === "aligned").length,
      exception: rows.filter((r) => r.alignment_status === "exception").length,
      needs_review: rows.filter((r) => r.alignment_status === "needs_review").length,
    };
    await supabase.from("monthly_governance_reviews").update({
      status: "charter_checked",
      charter_checked_at: new Date().toISOString(),
      counts,
      generation_error: null,
    }).eq("id", review_id);

    return json({ ok: true, alignments: rows.length, counts });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
