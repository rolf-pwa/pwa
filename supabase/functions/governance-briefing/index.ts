// Briefing Generator: reads ONLY an approved_for_reporting governance review
// and emits advisor + principal markdown briefings. Never touches raw uploads.
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-region",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BodySchema = z.object({ review_id: z.string().uuid() });

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

    const { data: review, error: rErr } = await supabase
      .from("monthly_governance_reviews").select("*").eq("id", review_id).single();
    if (rErr || !review) return json({ error: "Review not found" }, 404);

    // HARD GUARD: only approved reviews generate briefings.
    if (review.status !== "approved_for_reporting") {
      return json({ error: `Review is not approved (status=${review.status})` }, 409);
    }

    const [{ data: findings }, { data: alignments }] = await Promise.all([
      supabase.from("governance_review_findings").select("*").eq("review_id", review_id),
      supabase.from("governance_alignment_results").select("*").eq("review_id", review_id),
    ]);

    let scopeName = "Household";
    if (review.scope_type === "household") {
      const { data: hh } = await supabase.from("households").select("label").eq("id", review.scope_id).maybeSingle();
      scopeName = hh?.label || scopeName;
    } else {
      const { data: c } = await supabase.from("contacts").select("first_name, last_name").eq("id", review.scope_id).maybeSingle();
      scopeName = c ? `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() : scopeName;
    }

    const facts = (alignments ?? []);
    const status = (s: string) => s.replace(/_/g, " ");
    const advisorLines: string[] = [
      `# Monthly Governance Review — ${scopeName}`,
      `**Period ending:** ${review.period_end}`,
      `**Status:** approved for reporting`,
      ``,
      `## Verified Performance Facts & Charter Alignment`,
    ];
    for (const a of facts) {
      const eff = (a.advisor_override || a.alignment_status) as string;
      advisorLines.push(`- **[${status(eff)}]** ${a.performance_fact?.description ?? a.fact_key}`);
      if (a.charter_principle) advisorLines.push(`  - Charter: _${a.charter_principle}_`);
      if (a.exception_reason) advisorLines.push(`  - Exception: ${a.exception_reason}`);
      if (a.recommended_action) advisorLines.push(`  - Recommended action: ${a.recommended_action}`);
      if (a.advisor_note) advisorLines.push(`  - Advisor note: ${a.advisor_note}`);
    }

    const openFindings = (findings ?? []).filter((f: any) => f.status !== "resolved");
    if (openFindings.length) {
      advisorLines.push(``, `## Open Verification Findings`);
      for (const f of openFindings) {
        advisorLines.push(`- **${f.severity.toUpperCase()}** ${f.message}`);
      }
    }

    advisorLines.push(``, `_Generated from approved review object only. No raw uploads were read._`);

    const advisorMarkdown = advisorLines.join("\n");

    // Principal note: shorter, no severity jargon
    const exceptions = facts.filter((a: any) => (a.advisor_override || a.alignment_status) === "exception");
    const aligned = facts.filter((a: any) => (a.advisor_override || a.alignment_status) === "aligned");
    const principalMarkdown = [
      `# ${scopeName} — Monthly Note`,
      `_Period ending ${review.period_end}_`,
      ``,
      exceptions.length
        ? `This month surfaced **${exceptions.length} Charter exception${exceptions.length === 1 ? "" : "s"}** that warrant your attention:`
        : `All verified activity this month remained aligned with the Charter.`,
      ...exceptions.map((a: any) => `- ${a.performance_fact?.description ?? a.fact_key} — ${a.exception_reason || "see advisor note"}`),
      ``,
      `**Aligned with the Charter:** ${aligned.length} verified facts.`,
      ``,
      `Reviewed and approved by your advisor on ${review.approved_at ? new Date(review.approved_at).toLocaleDateString() : "—"}.`,
    ].join("\n");

    await supabase.from("monthly_governance_reviews").update({
      briefing_markdown: advisorMarkdown,
      briefing_principal_markdown: principalMarkdown,
    }).eq("id", review_id);

    return json({ ok: true, advisor_markdown: advisorMarkdown, principal_markdown: principalMarkdown });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
