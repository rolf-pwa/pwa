// quarterly-system-review-generate (v2) -- builds a household's Quarterly Review in the Stabilization Map
// document format. Figures and statuses are computed in code (sovereignty-diagnostics + quarterly-review-cards);
// Gemini only writes the narrative (summary, Charter-alignment commentary, 90-day plan). If the AI is
// unavailable the review is still produced, with a rule-based narrative.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";
import { GEMINI_GOVERNANCE_MODEL, generateVertexContent, parseServiceAccountKey, withThinking } from "../_shared/vertex-ai.ts";
import { computeSovereigntyDiagnostics } from "../_shared/sovereignty-diagnostics.ts";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { extractCharter, locateVaultCharter, type CharterExtract } from "../_shared/charter-vault.ts";
import type { CharterFile } from "../_shared/charter-vault-pick.ts";
import { logSystemHealth } from "../_shared/system-health.ts";
import {
  buildAlignmentCards, computeDeltas, dataCompleteness, overallAlignment, quarterLabel, reviewMode,
  type EstateAdult, type EstateFacts, type ReviewCard, type ReviewFacts, type ReviewMode,
} from "../_shared/quarterly-review-cards.ts";
import { allocateForHousehold, applyAllocation, REAL_ESTATE_ASSET_TYPE } from "../_shared/review-allocation.ts";
import { evaluateTargets, type BalanceFigures } from "../_shared/charter-targets.ts";
import { hasLiquidityReserve } from "../_shared/quarterly-review-allocation.ts";

const ALLOWED_ORIGINS = [
  "https://prosperwise-portal.web.app",
  "https://prosperwise.lovable.app",
  "https://app.prosperwise.ca",
  "https://id-preview--339dfc8f-3e82-4b05-8a36-a9f66fc58449.lovable.app",
];

const BodySchema = z.object({
  householdId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  reviewId: z.string().uuid().optional(),
}).refine((v) => v.householdId || v.contactId || v.reviewId, { message: "householdId, contactId or reviewId is required" });

const FRESH_DAYS = 120; // a statement read longer ago than this counts as not updated this quarter

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

/** true = the Vault folder has documents, false = it doesn't, null = couldn't tell. */
function folderFiled(missing: string[], keyword: string, vaultBased: boolean): boolean | null {
  if (!vaultBased) return null;
  if (missing.some((m) => /vault not yet provisioned/i.test(m))) return null;
  const hit = missing.find((m) => m.toLowerCase().includes(keyword.toLowerCase()));
  if (!hit) return true;
  return /advisor to confirm/i.test(hit) ? null : false;
}

const TOOL_SCHEMA = {
  functionDeclarations: [{
    name: "populate_quarterly_review",
    description: "Populate the narrative fields of a household Quarterly Review.",
    parameters: {
      type: "OBJECT",
      properties: {
        review_summary: { type: "STRING" },
        charter_alignment: { type: "STRING" },
        urgency_flag: { type: "STRING" },
        area_notes: {
          type: "OBJECT",
          properties: Object.fromEntries(["charter", "vineyard", "liquidity", "strategic", "philanthropic", "legacy", "liabilities"].map((k) => [k, { type: "STRING" }])),
        },
        action_plan_phase_1: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, detail: { type: "STRING" } }, required: ["title", "detail"] } },
        action_plan_phase_2: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, detail: { type: "STRING" } }, required: ["title", "detail"] } },
        action_plan_phase_3: { type: "ARRAY", items: { type: "OBJECT", properties: { title: { type: "STRING" }, detail: { type: "STRING" } }, required: ["title", "detail"] } },
      },
      required: ["review_summary", "charter_alignment", "urgency_flag", "area_notes", "action_plan_phase_1", "action_plan_phase_2", "action_plan_phase_3"],
    },
  }],
};

const PROMPT = `You are drafting the narrative portions of a ProsperWise **Quarterly Review** for a Virtual Family Office (VFO) client household. The review checks that the household's whole financial system -- the Vineyard, the four Storehouse reserves (Liquidity, Strategic, Philanthropic, Legacy) and liabilities -- is still aligned with the family's written Sovereignty Charter. Rolf Issler will review it with the client.

You will receive verified, already-computed facts: figures, an alignment status and a one-line detail for each area, and the Charter's own words where they exist. These are final and correct.

Your job: draft ONLY the narrative fields. **Never invent, recompute or alter a dollar figure, percentage or status** -- describe their significance instead.

## Rules
- Sanctuary voice: calm, direct, non-alarmist, professional. No jargon, no exclamation marks.
- review_summary: 1-2 sentences on where the household's system stands this quarter overall.
- charter_alignment: 2-4 sentences on whether the household's assets, reserves, protection and documents are serving what the Charter says the family is for. Quote or paraphrase the Charter's purpose/mission/vision where it is provided. If no Charter exists, say plainly that nothing written yet governs the system and treat drafting and ratifying it as the first priority. Do not claim alignment that the statuses do not support.
- urgency_flag: ONE sentence naming the single most important thing to resolve this quarter.
- area_notes: for EACH area (charter, vineyard, liquidity, strategic, philanthropic, legacy, liabilities) write ONE sentence (max ~35 words) explaining WHY the computed action matters for the family given the Charter's purpose, or, if the action is 'No action required', why the area is in line. Use the Desired / Current / Action lines; do not restate every number and never change an amount or a status.
- Action plan: 2-4 concrete items for EACH phase, grounded only in the facts and statuses provided; do not propose work for areas that are already Aligned except to maintain them:
  - Phase 1 (Immediate, Days 1-30): protective and administrative fixes (missing records, unfiled documents, unreviewed items).
  - Phase 2 (Structural Alignment, Days 31-60): the structural changes needed to bring a Partial/Needs Attention area into line with the Charter.
  - Phase 3 (Governance & Reporting, Days 61-90): ratification, reporting and cadence steps, including preparing the next quarterly review.
  - Each item: a short title (max ~50 characters) and one supporting sentence.
- The plan must carry out the computed "Action" lines (they hold the dollar amounts, already worked out); put protective and record-keeping actions in Phase 1 and rebalancing moves in Phase 2. Never alter an amount.
- Never quote internal field names or raw scores. Keep every field concise.

## Output
Call populate_quarterly_review with all fields filled.`;

const SURVEY_PROMPT = `You are drafting the narrative portions of a ProsperWise **Sovereignty Survey** for an EXISTING client household that does not yet have a ratified Sovereignty Charter. The Survey takes what ProsperWise already has on file about the household -- investments, reserves, insurance, estate and tax records, liabilities -- and shows, in the household's own numbers, what is and isn't governed today, and what a written Charter would add. Rolf Issler will walk the client through it.

You will receive verified, already-computed facts: figures, a status and one-line detail for each area, and a list of areas with no records on file. These are final and correct.

Your job: draft ONLY the narrative fields. **Never invent, recompute or alter a dollar figure, percentage or status.**

## Rules
- Sanctuary voice: calm, direct, respectful, never salesy, never alarmist, no exclamation marks. This is an invitation to see their situation clearly, not a pitch.
- A missing record is NOT a finding. For any area listed as "not yet on file" say it has not been assessed or recorded yet -- never imply the client is exposed or unprotected there. Only areas with a "Needs Attention" or "Partial" status are real gaps.
- review_summary: 1-2 sentences on what ProsperWise can see of the household's system today and how complete that picture is.
- charter_alignment: 3-4 sentences on what a Sovereignty Charter would govern for THIS household: use their actual figures and the specific gaps in the statuses (for example reserves with no written purpose, estate documents not reviewed, accounts not tracked). Describe the value concretely; do not use generic marketing language and do not promise outcomes.
- urgency_flag: ONE sentence naming the single most useful thing to settle first.
- area_notes: for EACH area (charter, vineyard, liquidity, strategic, philanthropic, legacy, liabilities) write ONE sentence (max ~35 words) saying what a Charter would set for that area (there is no ratified Charter yet; if one exists but is unratified, whether the area meets its provisions). Use the "Charter targets" lines: cite the stated figure or the Charter's own words and the actual figure. If a target was checked, say whether it was met and by how much. If the Charter is silent on an area, say so plainly. Never contradict the computed status.
- Action plan: 2-4 concrete items for EACH phase, grounded only in the facts and statuses:
  - Phase 1 (Immediate, Days 1-30): complete and verify the household's records and close any protective gaps.
  - Phase 2 (Structural Purification, Days 31-60): clarify the structure the Charter will rest on (reserves, estate documents, accounts).
  - Phase 3 (Governance Ratification, Days 61-90): draft and ratify the Charter and set the quarterly review cadence.
  - Each item: a short title (max ~50 characters) and one supporting sentence.
- Never quote internal field names or raw scores. Keep every field concise.

## Output
Call populate_quarterly_review with all fields filled.`;

function factsBlock(o: {
  household: string; family: string; period: string; track: string; today: string;
  diag: any; cards: ReviewCard[]; deltas: any; charter: any; harvest: { current: number | null };
  mode: ReviewMode; notOnFile: string[];
}): string {
  const lines = [
    `Household: ${o.household} (family: ${o.family}). Review period: ${o.period}. Date: ${o.today}. Track: ${o.track}. Document: ${o.mode === "survey" ? "Sovereignty Survey (no ratified Charter)" : "Quarterly Review (chartered household)"}.`,
    o.notOnFile.length ? `Areas with no records on file yet (not findings): ${o.notOnFile.join("; ")}.` : "All reviewed areas have records on file.",
    `Total assets (AUM): ${money(o.diag.aum)}; Holding Tank ${money(o.diag.holding_tank_total)}; Vineyard ${money(o.diag.vineyard_total)}.`,
    `Storehouse reserves -- Liquidity ${money(o.diag.storehouse_reserves?.liquidity ?? 0)}, Strategic ${money(o.diag.storehouse_reserves?.strategic ?? 0)}, Philanthropic ${money(o.diag.storehouse_reserves?.philanthropic ?? 0)}, Legacy ${money(o.diag.storehouse_reserves?.legacy ?? 0)}.`,
    `Liabilities: ${money((o.diag.personal_liabilities_total ?? 0) + (o.diag.corp_liabilities_total ?? 0))}. Net worth: ${money(o.diag.net_worth ?? o.diag.aum)}. Insurance coverage: ${money(o.diag.insurance_coverage_total ?? 0)}.`,
    o.harvest.current === null
      ? "Withdrawals taken from accounts this year (harvest to date): not yet read from the statements; do not state a figure."
      : `Withdrawals taken from the household's accounts this year (harvest to date): ${money(o.harvest.current)}.`,
    o.deltas.aum !== null
      ? `Change since ${o.deltas.previousLabel ?? "the previous review"}: assets ${o.deltas.aum >= 0 ? "+" : "-"}${money(Math.abs(o.deltas.aum))}${o.deltas.netWorth !== null ? `, net worth ${o.deltas.netWorth >= 0 ? "+" : "-"}${money(Math.abs(o.deltas.netWorth))}` : ""}.`
      : "No previous review to compare against.",
    "",
    "Alignment by area (computed in code: desired state from the Charter, current state, and the action required with its dollar amount):",
    ...o.cards.flatMap((c) => [
      `- ${c.label}: ${c.status}`,
      ...c.desired.map((l) => `    Desired (Charter): ${l}`),
      ...c.current.map((l) => `    Current: ${l}`),
      ...c.actions.map((l) => `    Action: ${l}`),
    ]),
    "",
    "The family's Charter:",
    o.charter.source ? `(source: ${o.charter.source === "household" ? "household Charter" : "earlier-format Charter"}; ${o.charter.ratified ? "ratified" : "not yet ratified"})` : "No Charter is on file.",
    o.charter.purpose ? `Purpose: ${o.charter.purpose}` : "",
    o.charter.mission ? `Mission of capital: ${o.charter.mission}` : "",
    o.charter.vision ? `Vision: ${o.charter.vision}` : "",
    o.charter.values?.length ? `Core values: ${o.charter.values.join(", ")}` : "",
    o.charter.reserveRules ? `Reserve and liquidity rules in the Charter: ${o.charter.reserveRules}` : "",
    o.charter.governance ? `Governance in the Charter: ${o.charter.governance}` : "",
    o.charter.targets?.length
      ? `Every numeric target the Charter states (exactly as stated; those marked 'checked' above were compared with the balance sheet in code): ${o.charter.targets.map((t: any) => `${t.label}${t.quote ? ` ("${t.quote}")` : ""}`).join(" | ")}`
      : o.charter.source ? "No numeric targets were read from the Charter." : "",
    o.charter.unreadable ? "A Charter document is on file in the Vault, but its text could not be read this time; do not claim to know its contents." : "",
  ];
  return lines.filter((l) => l !== "").join("\n");
}

const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const cleanItems = (arr: unknown) =>
  Array.isArray(arr)
    ? arr.filter((b: any) => b && typeof b === "object").map((b: any) => ({ title: clip(b.title, 80), detail: clip(b.detail, 300) })).filter((b) => b.title).slice(0, 5)
    : [];

/** Rule-based narrative used when the AI is unavailable. */
function fallbackNarrative(cards: ReviewCard[], overall: ReturnType<typeof overallAlignment>, mode: ReviewMode) {
  const attention = cards.filter((c) => c.status === "Needs Attention");
  const partial = cards.filter((c) => c.status === "Partial" || c.status === "Not Assessed");
  const item = (c: ReviewCard) => ({ title: clip(`Resolve: ${c.label}`, 80), detail: clip(c.detail, 300) });
  return {
    review_summary: overall.status === "Aligned"
      ? "Every area reviewed this quarter is in line with the household's system."
      : `${overall.attention} area(s) need attention and ${overall.partial} are partially in place this quarter.`,
    charter_alignment: mode === "survey"
      ? "This narrative was generated from rules because the AI drafting step was unavailable. The cards below show what ProsperWise has on file; a Charter would add written rules for each area."
      : "This narrative was generated from rules because the AI drafting step was unavailable. Review each area below against the Charter.",
    urgency_flag: attention[0] ? `Most urgent: ${attention[0].label} -- ${attention[0].detail}` : "No area needs urgent attention this quarter.",
    action_plan: {
      phase_1: attention.slice(0, 3).map(item),
      phase_2: partial.slice(0, 3).map(item),
      phase_3: [mode === "survey"
        ? { title: "Draft and ratify the Charter", detail: "Write the household's purpose, reserve rules and governance down so the system can be reviewed against it." }
        : { title: "Prepare the next quarterly review", detail: "Refresh account values and re-run this review at the start of next quarter." }],
    },
  };
}


const SCAN_DEBOUNCE_HOURS = 6;
const SCAN_TIMEOUT_MS = 140_000;

type ScanOutcome = "started" | "skipped_recent" | "skipped_pending" | "skipped_not_v2" | "skipped_no_vault";

/**
 * Starting a review also scans the household's Vault so the statements are read without anyone having to
 * remember. The V2 scan only HOLDS what it reads for advisor approval in Glass-Box Review (no live record
 * changes), so this is safe to run on its own; V1 households are never auto-scanned because the V1 scan writes
 * directly. Runs in the background, then posts a staff notification saying what to review (or what failed).
 * Skipped when the household was scanned within SCAN_DEBOUNCE_HOURS or already has items waiting.
 */
async function kickOffVaultScan(
  supabase: any, opts: { householdId: string; label: string; jwt: string },
): Promise<ScanOutcome> {
  const { householdId, label, jwt } = opts;
  const { data: hh } = await supabase.from("households").select("v2_ai_engine_enabled, vault_root_folder_id").eq("id", householdId).maybeSingle();
  if (!hh?.v2_ai_engine_enabled) return "skipped_not_v2";
  if (!hh.vault_root_folder_id) return "skipped_no_vault";

  const since = new Date(Date.now() - SCAN_DEBOUNCE_HOURS * 3600_000).toISOString();
  const [{ count: pending }, { count: recent }] = await Promise.all([
    supabase.from("stage2_verification_audit").select("id", { count: "exact", head: true }).eq("household_id", householdId).eq("review_status", "pending"),
    supabase.from("system_health_logs").select("id", { count: "exact", head: true }).eq("household_id", householdId).eq("error_code", "REVIEW_VAULT_SCAN").gte("created_at", since),
  ]);
  if ((pending ?? 0) > 0) return "skipped_pending";
  if ((recent ?? 0) > 0) return "skipped_recent";

  await logSystemHealth(supabase, { function_name: "quarterly-system-review-generate", severity: "INFO", error_code: "REVIEW_VAULT_SCAN", household_id: householdId, error_message: "Vault scan started by a Sovereignty Review." });

  const notify = (title: string, body: string) =>
    supabase.from("staff_notifications").insert({ source_type: "vault_scan", title, body, link: "/glass-box-review" }).then(() => {}, () => {});

  const run = async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), SCAN_TIMEOUT_MS);
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/vault-statement-scan`, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
        body: JSON.stringify({ householdId, skipReviewed: true }),
      });
      clearTimeout(timer);
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { await notify(`${label}: Vault scan failed`, String(out?.error ?? `HTTP ${res.status}`).slice(0, 300)); return; }
      const held = Number(out.v2HeldForReview ?? 0);
      const errors: string[] = Array.isArray(out.errors) ? out.errors : [];
      if (held > 0) {
        await notify(`${label}: ${held} statement${held === 1 ? "" : "s"} ready in Glass-Box Review`, `Approve them, then regenerate the Sovereignty Review so it uses the new figures.${errors.length ? ` ${errors.length} file(s) could not be read.` : ""}`);
      } else if (errors.length) {
        await notify(`${label}: Vault scan couldn't read ${errors.length} file${errors.length === 1 ? "" : "s"}`, errors[0].slice(0, 300));
      } else if (!out.investmentsFolderFound) {
        await notify(`${label}: no Investment Statements folder found in the Vault`, "The Vault scan had nothing to read. Check the Vault's folders.");
      }
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      await notify(`${label}: Vault scan ${aborted ? "is taking longer than expected" : "failed"}`, aborted ? "Check Glass-Box Review in a few minutes for the results." : (e instanceof Error ? e.message : String(e)).slice(0, 300));
    }
  };
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(run()); else void run();
  return "started";
}

serve(async (req) => {
  const cors = getCorsHeaders(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let reviewId: string | undefined;
  const supabase: any = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: parsed.error.flatten().formErrors[0] || "Invalid request" }, 400);

    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData?.user) return json({ error: "Unauthorized" }, 401);
    if (!authData.user.email?.toLowerCase().endsWith("@prosperwise.ca")) return json({ error: "Access denied: unauthorized domain" }, 403);
    const userId = authData.user.id;

    // ---- Resolve household ----
    let householdId = parsed.data.householdId;
    reviewId = parsed.data.reviewId;
    let seedContactId = parsed.data.contactId;
    if (reviewId) {
      const { data: r } = await supabase.from("quarterly_system_reviews").select("id, household_id, contact_id").eq("id", reviewId).maybeSingle();
      if (!r) return json({ error: "Quarterly review not found" }, 404);
      householdId = householdId ?? r.household_id ?? undefined;
      seedContactId = seedContactId ?? r.contact_id ?? undefined;
    }
    if (!householdId && seedContactId) {
      const { data: c } = await supabase.from("contacts").select("household_id").eq("id", seedContactId).maybeSingle();
      householdId = c?.household_id ?? undefined;
    }
    if (!householdId) return json({ error: "This contact has no household, so a quarterly review can't be built." }, 400);

    const { data: contacts } = await supabase.from("contacts").select("id, first_name, last_name, family_role, charter_url").eq("household_id", householdId);
    const roleRank = (r: string | null) => (r === "head_of_family" ? 0 : r === "spouse" ? 1 : 2);
    const primary = [...(contacts ?? [])].sort((a: any, b: any) => roleRank(a.family_role) - roleRank(b.family_role))[0];
    if (!primary) return json({ error: "Household has no contacts" }, 400);
    const contactIds = (contacts ?? []).map((c: any) => c.id);

    // ---- Find or create this quarter's review row ----
    const today = new Date();
    const period = quarterLabel(today);
    if (!reviewId) {
      const { data: existing } = await supabase.from("quarterly_system_reviews").select("id").eq("household_id", householdId).eq("period_label", period).maybeSingle();
      reviewId = existing?.id;
    }
    const base = {
      household_id: householdId, contact_id: primary.id, period_label: period, layout_version: 2,
      client_first_name: primary.first_name || "", client_last_name: primary.last_name || "",
      review_date: today.toISOString().slice(0, 10), generation_status: "generating", generation_error: null,
    };
    if (reviewId) {
      const { error } = await supabase.from("quarterly_system_reviews").update(base).eq("id", reviewId);
      if (error) throw error;
    } else {
      const { data: inserted, error } = await supabase.from("quarterly_system_reviews").insert({ ...base, created_by: userId }).select("id").single();
      if (error || !inserted) throw new Error(error?.message || "Failed to create review record");
      reviewId = inserted.id;
    }

    // ---- Gather facts ----
    const { data: lastMap } = await supabase.from("stabilization_maps").select("diagnostic_inputs").eq("household_id", householdId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { track_type, diagnostics: diag, financials } = await computeSovereigntyDiagnostics(supabase, householdId, lastMap?.diagnostic_inputs ?? {});

    const [{ data: hCharter }, { data: cCharters }, { data: estateRows }] = await Promise.all([
      supabase.from("household_charters").select("status, completed_at, vision_text, core_values").eq("household_id", householdId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("sovereignty_charters").select("intro_callout, intro_note, mission_of_capital, vision_20_year").in("contact_id", contactIds).limit(1),
      supabase.from("estate_documents").select("contact_id, document_type, signed, document_date").eq("household_id", householdId),
    ]);
    const cc = (cCharters ?? [])[0] ?? null;

    // The Charter now lives in the Vault (10 Correspondence, ideally a "Charter" subfolder). Look there first.
    let vaultCharter: CharterFile | null = null;
    let vaultExtract: CharterExtract | null = null;
    let driveToken: string | null = null;
    let saKey: Awaited<ReturnType<typeof parseServiceAccountKey>> | null = null;
    try { saKey = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY")); } catch { /* AI steps fall back */ }
    if (financials.vaultRootFolderId) {
      try {
        const { data: corrTmpl } = await supabase.from("vault_folder_templates").select("display_name").eq("slug", "correspondence").eq("is_active", true).maybeSingle();
        if (corrTmpl) {
          driveToken = await getServiceGoogleAccessToken(supabase);
          vaultCharter = await locateVaultCharter(financials.vaultRootFolderId, corrTmpl.display_name, driveToken);
          if (vaultCharter && saKey) vaultExtract = await extractCharter(saKey, vaultCharter, driveToken);
        }
      } catch (e) {
        console.error("quarterly-system-review-generate: Vault Charter lookup failed:", e instanceof Error ? e.message : String(e));
      }
    }
    const charterSource: "vault" | "household" | "contact" | null = vaultCharter ? "vault" : hCharter ? "household" : (cc || (contacts ?? []).some((c: any) => c.charter_url)) ? "contact" : null;
    // Household Charter: "complete" status or a completed_at stamp. Earlier-format Charter: a linked charter document counts as on file and ratified.
    const ratified = vaultCharter ? vaultCharter.ratified : hCharter ? (/complete/i.test(String(hCharter.status ?? "")) || !!hCharter.completed_at) : (contacts ?? []).some((c: any) => !!c.charter_url);
    const charterText = {
      source: charterSource, ratified,
      purpose: clip(vaultExtract?.purpose || cc?.intro_callout || cc?.intro_note, 700),
      mission: clip(vaultExtract?.mission || cc?.mission_of_capital, 700),
      vision: clip(vaultExtract?.vision || hCharter?.vision_text || cc?.vision_20_year, 900),
      values: vaultExtract?.values?.length ? vaultExtract.values : Array.isArray(hCharter?.core_values) ? hCharter.core_values.slice(0, 8).map((v: any) => clip(typeof v === "string" ? v : v?.name ?? v?.label ?? "", 60)).filter(Boolean) : [],
      reserveRules: vaultExtract?.reserve_rules ?? "",
      governance: vaultExtract?.governance ?? "",
      unreadable: !!vaultCharter && !vaultExtract,
      targets: vaultExtract?.targets ?? [],
    };

    const sh = financials.storehouses as any[];
    const vaultBased = financials.isLegacyClient;
    const missingDocs: string[] = diag.document_readiness.missingCritical ?? [];
    const policies = financials.insurancePolicies as any[];
    const soon = Date.now() + 90 * 86400000;
    const eh = diag.estate_hygiene;
    const loanFlags = (diag.intercompany_loan_flags ?? []).filter((f: any) => f.isOverdue);

    // ---- Capital allocation (shared with the Stabilization Map): income funds -> Liquidity when no Liquidity Reserve
    // is set up, insurance cash value -> Strategic, real estate -> Legacy, Harvest = withdrawals read from statements.
    const { allocation, allocAccounts } = await allocateForHousehold(supabase, financials, diag);
    const adjDiag = applyAllocation(diag, allocation);

    // ---- Charter targets, checked against the SAME balance sheet figures the document shows.
    const liabilitiesTotal = (diag.personal_liabilities_total ?? 0) + (diag.corp_liabilities_total ?? 0);
    const figures: BalanceFigures = {
      areas: { vineyard: allocation.vineyard, liquidity: allocation.reserves.liquidity, strategic: allocation.reserves.strategic, philanthropic: allocation.reserves.philanthropic, legacy: allocation.reserves.legacy, liabilities: liabilitiesTotal },
      totalAssets: allocation.aum, investableAssets: allocation.aum - allocation.realEstateAdded, netWorth: allocation.netWorth,
      monthlySpending: vaultExtract?.monthly_spending ?? null, withdrawnYtd: allocation.harvest,
    };
    const targetResults = evaluateTargets(vaultExtract?.targets ?? [], figures);

    // ---- Estate: documents approved in Glass-Box when there are any, else the hand-entered statuses.
    const adultRows = (contacts ?? []).filter((c: any) => c.family_role === "head_of_family" || c.family_role === "spouse");
    const adults = adultRows.length ? adultRows : [primary];
    const docs = (estateRows ?? []) as any[];
    const estateAdults: EstateAdult[] = adults.map((a: any) => {
      const wills = docs.filter((d) => d.contact_id === a.id && d.document_type === "will");
      const signed = wills.find((d) => d.signed === true);
      return {
        name: a.first_name || "Member",
        will: signed ? "signed" : wills.length ? "unsigned" : "missing",
        willDate: signed?.document_date ?? null,
        poa: docs.some((d) => d.contact_id === a.id && d.document_type === "power_of_attorney") ? "on_file" : "missing",
      };
    });
    const hasManual = !!(eh?.will_status || eh?.poa_status || eh?.beneficiary_coordination_status);
    const estate: EstateFacts = {
      source: docs.length ? "documents" : hasManual ? "manual" : "none",
      adults: estateAdults, trusts: docs.filter((d) => d.document_type === "trust").length,
      manual: { will: eh?.will_status ?? null, poa: eh?.poa_status ?? null, beneficiaries: eh?.beneficiary_coordination_status ?? null },
    };

    // ---- Vineyard: accounts that issue a statement and whether they've been read recently.
    const withStatements = allocAccounts.filter((a) => a.expects_statement);
    const readAccounts = withStatements.filter((a) => a.income_funds_value !== null || a.withdrawals_ytd !== null);
    const staleCutoff = Date.now() - FRESH_DAYS * 86400000;
    const staleAccounts = readAccounts.filter((a) => a.as_of && new Date(a.as_of).getTime() < staleCutoff);
    const liquidityRow = sh.find((x) => x.storehouse_number === 1 && x.asset_type !== REAL_ESTATE_ASSET_TYPE);
    const liquidityTarget = Number(liquidityRow?.target_value) > 0 ? Number(liquidityRow.target_value) : null;

    const facts: ReviewFacts = {
      charter: { source: charterSource, ratified, hasVision: !!charterText.vision },
      balance: {
        vineyard: allocation.vineyard, holdingTank: allocation.holdingTank, liquidity: allocation.reserves.liquidity,
        strategic: allocation.reserves.strategic, philanthropic: allocation.reserves.philanthropic, legacy: allocation.reserves.legacy,
        totalAssets: allocation.aum, liabilities: liabilitiesTotal, netWorth: allocation.netWorth,
        realEstate: allocation.realEstateAdded, cashValue: allocation.cashValueAdded, incomeFundsInLiquidity: allocation.incomeFundsMoved,
      },
      vineyard: {
        accountCount: withStatements.length, statementsRead: readAccounts.length, staleCount: staleAccounts.length,
        statementsFiled: folderFiled(missingDocs, "investment", vaultBased), withdrawalsYtd: allocation.harvest,
      },
      liquidity: { setUp: hasLiquidityReserve({ exists: !!liquidityRow, target: liquidityTarget }), target: liquidityTarget },
      strategic: {
        policyCount: policies.length, coverageTotal: diag.insurance_coverage_total,
        missingCoverageCount: policies.filter((p) => !(Number(p.coverage_amount) > 0)).length,
        missingBeneficiaryCount: policies.filter((p) => !p.primary_beneficiary).length,
        renewalsDueSoon: policies.filter((p) => p.renewal_date && new Date(p.renewal_date).getTime() <= soon && new Date(p.renewal_date).getTime() >= Date.now()).length,
        documentsFiled: folderFiled(missingDocs, "insurance", vaultBased),
      },
      legacy: { realEstate: allocation.realEstateAdded, estate },
      liabilities: {
        total: diag.personal_liabilities_total, corporate: diag.corp_liabilities_total, overdueLoans: loanFlags.length,
        // Yearly interest on liabilities with a rate recorded, and how many have none (can't be costed).
        rated: (() => {
          const rows = (financials.liabilities as any[]).filter((r) => r.holder_type === "contact" && Number(r.current_balance) > 0);
          if (!rows.length) return null;
          const withRate = rows.filter((r) => r.interest_rate_pct !== null && r.interest_rate_pct !== undefined && r.interest_rate_pct !== "");
          const missing = rows.filter((r) => !withRate.includes(r));
          return {
            interest: Math.round(withRate.reduce((s, r) => s + Number(r.current_balance) * Number(r.interest_rate_pct) / 100, 0)),
            unratedCount: missing.length, unratedBalance: missing.reduce((s, r) => s + Number(r.current_balance), 0),
          };
        })(),
        // Credit limit minus balance on HELOCs, credit cards and lines of credit that have a limit recorded.
        revolving: (() => {
          const rows = (financials.liabilities as any[]).filter((r) => ["heloc", "credit_card", "line_of_credit"].includes(r.liability_type) && Number(r.credit_limit) > 0);
          const limit = rows.reduce((s, r) => s + Number(r.credit_limit), 0);
          const available = rows.reduce((s, r) => s + Math.max(0, Number(r.credit_limit) - (Number(r.current_balance) || 0)), 0);
          return rows.length ? { limit, available } : null;
        })(),
      },
      targets: targetResults,
      statementData: {
        // Only accounts that issue a statement (have an account number) can be read from one.
        accounts: withStatements.length,
        withIncomeFunds: withStatements.filter((a) => a.income_funds_value !== null).length,
        withWithdrawals: withStatements.filter((a) => a.withdrawals_ytd !== null).length,
      },
      corporate: track_type === "corporate"
        ? {
          activeAssetRatio: diag.active_asset_ratio?.ratio ?? null, usaOnFile: diag.usa_staleness?.onFile ?? null,
          usaStale: diag.usa_staleness?.isStale ?? null, sbdClawback: diag.sbd_clawback ?? null,
        }
        : null,
    };
    const cards = buildAlignmentCards(facts);
    const overall = overallAlignment(cards);

    const { data: prev } = await supabase.from("quarterly_system_reviews").select("period_label, diagnostics")
      .eq("household_id", householdId).neq("id", reviewId).eq("layout_version", 2).not("diagnostics", "is", null)
      .order("review_date", { ascending: false }).limit(1).maybeSingle();
    const deltas = computeDeltas({ aum: allocation.aum, net_worth: allocation.netWorth }, prev?.diagnostics ? { aum: prev.diagnostics.aum, net_worth: prev.diagnostics.net_worth, label: prev.period_label } : null);

    // ---- Narrative (AI, with a rule-based fallback) ----
    const mode = reviewMode({ source: charterSource, ratified });
    const completeness = dataCompleteness(facts);
    let narrative = fallbackNarrative(cards, overall, mode);
    let aiNote = "AI narrative unavailable; rule-based narrative used.";
    try {
      const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
      const result = await generateVertexContent(
        sa, GEMINI_GOVERNANCE_MODEL,
        [
          { role: "user", parts: [{ text: mode === "survey" ? SURVEY_PROMPT : PROMPT }] },
          { role: "model", parts: [{ text: "Understood. Provide the household facts and I will draft the narrative." }] },
          { role: "user", parts: [{ text: factsBlock({
            household: diag.household_label, family: diag.family_name, period, track: track_type, today: today.toISOString().slice(0, 10),
            diag: adjDiag, cards, deltas, charter: charterText, harvest: { current: allocation.harvest }, mode, notOnFile: completeness.missing,
          }) }] },
        ],
        withThinking(GEMINI_GOVERNANCE_MODEL, { temperature: 0.3, maxOutputTokens: 8192 }, "medium"),
        { tools: [TOOL_SCHEMA as any], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["populate_quarterly_review"] } } },
      );
      const call = (result?.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.functionCall)?.functionCall;
      const a = call?.args;
      const p1 = cleanItems(a?.action_plan_phase_1), p2 = cleanItems(a?.action_plan_phase_2), p3 = cleanItems(a?.action_plan_phase_3);
      if (a && a.review_summary && p1.length + p2.length + p3.length > 0) {
        narrative = {
          review_summary: clip(a.review_summary, 1200), charter_alignment: clip(a.charter_alignment, 1500), urgency_flag: clip(a.urgency_flag, 600),
          action_plan: { phase_1: p1, phase_2: p2, phase_3: p3 },
        };
        // One sentence per area on whether it meets the Charter's provisions. Wording only: it never changes a status.
        for (const c of cards) {
          const note = a.area_notes?.[c.key];
          if (typeof note === "string" && note.trim()) c.charter_note = clip(note.trim(), 300);
        }
        aiNote = `Narrative drafted by ${GEMINI_GOVERNANCE_MODEL} from the computed facts.`;
      }
    } catch (e) {
      console.error("quarterly-system-review-generate: AI step failed:", e instanceof Error ? e.message : String(e));
    }

    const charterFile = vaultCharter ? { name: vaultCharter.name, modifiedTime: vaultCharter.modifiedTime, ratified: vaultCharter.ratified, viaSubfolder: vaultCharter.viaSubfolder, textRead: !!vaultExtract } : null;
    // What was read from the Charter is kept so staff can check it: the provisions, every numeric target and how each was checked.
    const charterExtract = vaultExtract
      ? { purpose: vaultExtract.purpose, mission: vaultExtract.mission, vision: vaultExtract.vision, values: vaultExtract.values, reserve_rules: vaultExtract.reserve_rules, governance: vaultExtract.governance, monthly_spending: vaultExtract.monthly_spending, targets: targetResults }
      : null;
    const diagnostics = {
      ...adjDiag, charter_file: charterFile, charter_extract: charterExtract, track_type, deltas,
      harvest: { current: allocation.harvest, accounts_read: allocation.accountsWithWithdrawalData },
      allocation: { notes: allocation.notes, income_funds_moved: allocation.incomeFundsMoved, income_funds_on_file: allocation.incomeFundsOnFile, cash_value_added: allocation.cashValueAdded, real_estate_added: allocation.realEstateAdded },
      estate: { source: estate.source, adults: estate.adults, trusts: estate.trusts },
      tracked_accounts: readAccounts.length, accounts: withStatements.length, data_completeness: completeness,
    };
    const logic = [
      `Document type: ${mode === "survey" ? "Sovereignty Survey (no ratified Charter on file)" : "Quarterly Review (ratified Charter)"}. Records on file for ${completeness.onFile}/${completeness.total} areas${completeness.missing.length ? ` (not yet on file: ${completeness.missing.join(", ")})` : ""}.`,
      `Statuses are computed from live records: ${cards.map((c) => `${c.label} = ${c.status}`).join("; ")}.`,
      `Overall: ${overall.status} (${overall.attention} need attention, ${overall.partial} partial).`,
      vaultCharter ? `Charter found in the Vault: "${vaultCharter.name}"${vaultCharter.viaSubfolder ? " (Charter subfolder)" : " (Correspondence folder)"}; ${vaultExtract ? "its text was read for the narrative" : "its text could not be read"}.` : "No Charter file found in the Vault Correspondence folder.",
      `Charter source: ${charterSource ?? "none"}${charterSource ? (ratified ? ", ratified" : ", not ratified") : ""}. ${targetResults.length ? `${targetResults.length} numeric target(s) read from the Charter and checked against the balance sheet: ${targetResults.map((t) => `${t.label} = ${t.status}`).join("; ")}.` : "No numeric Charter targets were read."}`,
      `Estate status comes from ${estate.source === "documents" ? "documents read from the Vault and approved in Glass-Box" : estate.source === "manual" ? "the advisor-entered fields on the latest Stabilization Map" : "nothing yet (no estate documents or entered statuses)"}. Accounts read more than ${FRESH_DAYS} days ago count as not updated. Tax is not part of this review.`,
      aiNote,
    ].join(" ");

    const { error: updErr } = await supabase.from("quarterly_system_reviews").update({
      diagnostics, alignment_cards: cards, action_plan: narrative.action_plan, urgency_flag: narrative.urgency_flag,
      charter_alignment: narrative.charter_alignment, review_summary: narrative.review_summary,
      purpose_statement: charterText.purpose, primary_goal: charterText.mission, long_term_vision: charterText.vision,
      cross_system_status: overall.status, review_mode: mode,
      footer_note: "Quarterly review to ensure the Charter, assets, reserves, protection and documents remain aligned and governable over the next 90 days.",
      logic_trace: logic, generation_status: "ready", generation_error: null,
    }).eq("id", reviewId);
    if (updErr) throw updErr;

    // Read this household's statements in the background and tell staff when they're ready (non-blocking, never fails the review).
    let scan: ScanOutcome | "error" = "skipped_not_v2";
    try { scan = await kickOffVaultScan(supabase, { householdId, label: diag.household_label || `${primary.first_name} ${primary.last_name}`.trim(), jwt }); }
    catch (e) { scan = "error"; console.error("quarterly-system-review-generate: vault scan kickoff failed:", e instanceof Error ? e.message : String(e)); }
    await supabase.from("quarterly_system_reviews").update({ diagnostics: { ...diagnostics, vault_scan: scan } }).eq("id", reviewId);

    return json({ success: true, reviewId, period, vaultScan: scan });
  } catch (error) {
    console.error("quarterly-system-review-generate error:", error);
    if (reviewId) {
      await supabase.from("quarterly_system_reviews").update({
        generation_status: "failed", generation_error: error instanceof Error ? error.message : "Unknown error",
      }).eq("id", reviewId).then(() => {}, () => {});
    }
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
