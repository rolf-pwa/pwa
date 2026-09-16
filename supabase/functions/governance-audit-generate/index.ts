// Quarterly Governance Audit -- full pipeline.
//
// Given a household, runs all four phases in sequence and persists one
// complete, coherent audit document:
//   1. Document extraction -- resolves the Vault's "01 Identity & Legal"
//      and "02 Estate (Wills, POA, Trusts)" category folders (via the same
//      matchVaultCategoryFolder helper computeVaultReadiness already uses)
//      and extracts structured Investor Risk Profile / Will-legal facts
//      from every PDF found there, via Gemini's native PDF input. A
//      genuine simplification over the prototype being ported (a working
//      standalone Python CLI, /Users/admin/Downloads/Review Agent): it
//      rasterizes every PDF page to PNG to work around Claude's lack of
//      native PDF input; Gemini accepts PDFs directly.
//   2. Calc -- pillar totals, estate liquidity (real EstateAsset list built
//      from this household's own accounts' beneficiary_designation field,
//      liabilities, and a registered/non-registered account split for
//      terminal-tax/capital-gains estimates), target Income/Equity split
//      (when an Investor Profile was extracted), and the 1-5 scorecard.
//   3. Narrative -- Vertex drafts the prose sections strictly grounded in
//      the figures computed in step 2, per governance-audit-narrative.ts's
//      house style guide.
//   4. Persistence -- the assembled document lands in governance_audits.
//
// Two calc inputs the CRM has no structured field for today (a household's
// province, and its accounts' current Income/Equity split -- no fund-level
// asset-class tracking exists here) are accepted as optional advisor-
// supplied overrides in the request body, mirroring the household-track
// Stabilization Map's own "Diagnostic Inputs" convention rather than
// guessing at them. Province defaults to "BC"; without a current-equity
// input, the Capital Infrastructure scorecard element is left as an honest
// "PENDING ADVISOR REVIEW" row rather than a fabricated score.
//
// SourceRef.file_path/file_name/page_numbers are always built server-side
// from the real Drive file, never trusted from the model -- same
// never-trust-AI-generated-identifiers principle daily-briefing-generate's
// link resolution already established for this codebase. Every dollar
// figure in the narrative is grounded the same way -- see
// findUngroundedDollarFigures.
//
// Staff-triggered only for now, no cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { driveDownloadFile, driveListChildren, matchVaultCategoryFolder } from "../_shared/vault-provisioning.ts";
import { generateVertexContent, parseServiceAccountKey, type ServiceAccountKey, type VertexContent } from "../_shared/vertex-ai.ts";
import { gatherHouseholdFinancials, inferTrackType } from "../_shared/sovereignty-diagnostics.ts";
import { computePillarTotals, pillarWarnings } from "../_shared/governance-audit-pillars.ts";
import {
  analyzeEstateLiquidity,
  estateAssetSourceRowsFromFinancials,
  estateAssetsFromAccounts,
} from "../_shared/governance-audit-estate.ts";
import { combinedTopMarginalRate, estimateCapitalGainsTax, estimateTerminalTaxOnRegistered } from "../_shared/governance-audit-tax.ts";
import { TAX_TABLES } from "../_shared/governance-audit-tax-config.ts";
import { selectTarget } from "../_shared/governance-audit-targets.ts";
import {
  CAPITAL_INFRASTRUCTURE,
  manualReviewRow,
  scoreCapitalInfrastructure,
  scoreEstateAlignment,
  type ScorecardRow,
} from "../_shared/governance-audit-drift.ts";
import { applyNarrative, findUngroundedDollarFigures, generateAuditNarrative } from "../_shared/governance-audit-narrative.ts";

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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// deno-lint-ignore no-explicit-any
type Db = ReturnType<typeof createClient<any>>;

function admin(): Db {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function requireStaff(req: Request): Promise<{ userId: string; error?: undefined } | { error: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return { error: "Missing authorization header" };
  const supabaseUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data?.user) return { error: "Not authenticated" };
  if (!data.user.email?.endsWith("@prosperwise.ca")) return { error: "Not authorized" };
  return { userId: data.user.id };
}

// -- Schemas, translated field-for-field from the prototype's pydantic models --
// (source is deliberately NOT part of what the model returns -- built server-side, see above)

interface SourceRef {
  file_path: string;
  file_name: string;
  page_numbers: number[];
}

interface InvestorProfile {
  client_name: string | null;
  account_number: string | null;
  form_id: string | null;
  date_signed: string | null;
  total_points: number | null;
  profile_category: string | null;
  stated_choice_of_investments: string | null;
  choice_matches_profile: boolean | null;
  reason_for_mismatch: string | null;
  source: SourceRef;
}

interface NamedParty {
  name: string;
  role: string;
  relationship: string | null;
}
interface BeneficiaryDesignation {
  beneficiary_name: string;
  asset_or_share_description: string;
}
interface KeyClause {
  clause_ref: string | null;
  summary: string;
}

interface LegalDocFacts {
  document_type: string;
  testator_or_grantor_name: string | null;
  date_executed: string | null;
  jurisdiction: string | null;
  parties: NamedParty[];
  beneficiary_designations: BeneficiaryDesignation[];
  key_clauses: KeyClause[];
  notes: string | null;
  source: SourceRef;
}

const INVESTOR_PROFILE_PROMPT = `The attached PDF is (or may be) an Investor Risk Profile questionnaire \
(e.g. a form like "F51-122A"). Read the whole document.

Transcribe it into the given schema, including the account_number this profile was completed for (look \
for "Existing Annuity Contract" or a similar contract-number field), the total_points from the "Points \
for this profile" box, the resulting profile_category, and whether the client's stated \
choice_of_investments matches their calculated profile.

If this document is clearly NOT an Investor Risk Profile questionnaire, still call the function, but \
leave every other field null and set profile_category to "NOT_APPLICABLE" so the caller can tell it \
didn't match.`;

const LEGAL_PROMPT = `The attached PDF is (or may be) a Will or other legal/estate document (it may be a \
scanned image with no text layer -- read it visually page by page; Wills are often 5-10 pages).

Transcribe it into the given schema. In particular:
- parties: executor(s)/trustee(s) (including named alternates and the conditions that trigger them), \
powers of attorney, and any other named role-holders.
- beneficiary_designations: who receives what, as directed by the document.
- key_clauses: any clause that creates a specific right, restriction, or condition worth an advisor's \
attention for financial/estate planning purposes (e.g. a spousal life interest in the home, a trust \
condition, a specific bequest) -- reference the clause number if the document numbers its clauses, and \
describe factually what it does, not why it matters.

If this document is clearly NOT a Will/legal/estate document, still call the function, but set \
document_type to "NOT_APPLICABLE" and leave every other field null/empty.`;

const INVESTOR_PROFILE_TOOL_SCHEMA = {
  functionDeclarations: [
    {
      name: "extract_investor_profile",
      description: "Extract structured data from an Investor Risk Profile questionnaire PDF.",
      parameters: {
        type: "OBJECT",
        properties: {
          client_name: { type: "STRING" },
          account_number: { type: "STRING" },
          form_id: { type: "STRING", description: 'e.g. "F51-122A(23-11)".' },
          date_signed: { type: "STRING", description: "ISO date (YYYY-MM-DD) if determinable." },
          total_points: { type: "INTEGER" },
          profile_category: {
            type: "STRING",
            description: 'e.g. "Prudent", "Moderate", "Balanced", "Growth", "Aggressive", or "NOT_APPLICABLE".',
          },
          stated_choice_of_investments: { type: "STRING" },
          choice_matches_profile: { type: "BOOLEAN" },
          reason_for_mismatch: { type: "STRING" },
        },
        required: ["profile_category"],
      },
    },
  ],
};

const LEGAL_FACTS_TOOL_SCHEMA = {
  functionDeclarations: [
    {
      name: "extract_legal_facts",
      description: "Extract structured facts from a Will or other legal/estate document PDF.",
      parameters: {
        type: "OBJECT",
        properties: {
          document_type: {
            type: "STRING",
            description: '"Will", "Power of Attorney", "Representation Agreement", etc., or "NOT_APPLICABLE".',
          },
          testator_or_grantor_name: { type: "STRING" },
          date_executed: { type: "STRING", description: "ISO date if determinable, else free text (e.g. \"April 2025\")." },
          jurisdiction: { type: "STRING", description: 'e.g. "British Columbia".' },
          parties: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                role: { type: "STRING", description: '"Executor/Trustee", "Alternate Executor", "Power of Attorney", "Beneficiary", ...' },
                relationship: { type: "STRING", description: 'e.g. "husband", "daughter".' },
              },
              required: ["name", "role"],
            },
          },
          beneficiary_designations: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                beneficiary_name: { type: "STRING" },
                asset_or_share_description: { type: "STRING", description: 'e.g. "residue of estate, equally", "specific bequest of $X".' },
              },
              required: ["beneficiary_name", "asset_or_share_description"],
            },
          },
          key_clauses: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                clause_ref: { type: "STRING", description: 'e.g. "Clause 9(a)".' },
                summary: { type: "STRING", description: "Plain-language, factual summary of what the clause does." },
              },
              required: ["summary"],
            },
          },
          notes: { type: "STRING" },
        },
        required: ["document_type"],
      },
    },
  ],
};

const MAX_PDF_BYTES = 15 * 1024 * 1024; // stay well under Vertex's ~20MB inline-request cap
const MAX_PDFS_PER_FOLDER = 5; // bounds one edge function invocation's runtime/cost

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function extractFromPdf(
  sa: ServiceAccountKey,
  prompt: string,
  toolSchema: Record<string, unknown>,
  functionName: string,
  pdfBytes: ArrayBuffer,
  // deno-lint-ignore no-explicit-any
): Promise<Record<string, any> | null> {
  const contents: VertexContent[] = [
    {
      role: "user",
      parts: [
        { text: prompt },
        { inlineData: { mimeType: "application/pdf", data: arrayBufferToBase64(pdfBytes) } },
      ],
    },
  ];
  const result = await generateVertexContent(
    sa,
    "gemini-2.5-flash",
    contents,
    { temperature: 0, maxOutputTokens: 4096 },
    { tools: [toolSchema], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [functionName] } } },
  );
  // deno-lint-ignore no-explicit-any
  const parts = result?.candidates?.[0]?.content?.parts as any[] | undefined;
  const call = parts?.find((p) => p.functionCall)?.functionCall;
  if (!call || call.name !== functionName) return null;
  return call.args ?? {};
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

async function extractCategory<T>(
  db: Db,
  sa: ServiceAccountKey,
  accessToken: string,
  rootChildren: DriveFile[],
  displayName: string,
  prompt: string,
  toolSchema: Record<string, unknown>,
  functionName: string,
  // deno-lint-ignore no-explicit-any
  isApplicable: (args: Record<string, any>) => boolean,
  // deno-lint-ignore no-explicit-any
  buildResult: (args: Record<string, any>, source: SourceRef) => T,
  errors: string[],
): Promise<T[]> {
  const folder = matchVaultCategoryFolder(rootChildren, displayName);
  if (!folder) return [];

  const pdfs = (await driveListChildren(folder.id, accessToken))
    .filter((f) => f.mimeType === "application/pdf")
    .slice(0, MAX_PDFS_PER_FOLDER);

  const results: T[] = [];
  for (const pdf of pdfs) {
    try {
      const bytes = await driveDownloadFile(pdf.id, accessToken);
      if (bytes.byteLength > MAX_PDF_BYTES) {
        errors.push(`${pdf.name}: skipped, larger than ${MAX_PDF_BYTES / (1024 * 1024)}MB`);
        continue;
      }
      const args = await extractFromPdf(sa, prompt, toolSchema, functionName, bytes);
      if (args && isApplicable(args)) {
        results.push(buildResult(args, { file_path: `${displayName}/${pdf.name}`, file_name: pdf.name, page_numbers: [] }));
      }
    } catch (e) {
      errors.push(`${pdf.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return results;
}

/** Phase 2 alone -- resolves the Vault's two category folders and extracts whatever's found. No DB writes; the caller decides what to do with the result. */
async function extractDocuments(
  db: Db,
  sa: ServiceAccountKey,
  vaultRootFolderId: string,
): Promise<{ investorProfiles: InvestorProfile[]; legalFacts: LegalDocFacts[]; errors: string[] }> {
  const accessToken = await getServiceGoogleAccessToken(db);
  const rootChildren = await driveListChildren(vaultRootFolderId, accessToken);

  const { data: templates } = await db
    .from("vault_folder_templates")
    .select("display_name, slug")
    .eq("is_active", true)
    .in("slug", ["identity-legal", "estate"]);
  const templateBySlug = new Map(
    // deno-lint-ignore no-explicit-any
    ((templates ?? []) as any[]).map((t) => [t.slug as string, t.display_name as string]),
  );

  const errors: string[] = [];
  const investorProfiles: InvestorProfile[] = [];
  const legalFacts: LegalDocFacts[] = [];

  const identityLegalDisplayName = templateBySlug.get("identity-legal");
  if (identityLegalDisplayName) {
    investorProfiles.push(
      ...(await extractCategory<InvestorProfile>(
        db,
        sa,
        accessToken,
        rootChildren,
        identityLegalDisplayName,
        INVESTOR_PROFILE_PROMPT,
        INVESTOR_PROFILE_TOOL_SCHEMA,
        "extract_investor_profile",
        (args) => Boolean(args.profile_category) && args.profile_category !== "NOT_APPLICABLE",
        (args, source) => ({
          client_name: args.client_name ?? null,
          account_number: args.account_number ?? null,
          form_id: args.form_id ?? null,
          date_signed: args.date_signed ?? null,
          total_points: typeof args.total_points === "number" ? args.total_points : null,
          profile_category: args.profile_category ?? null,
          stated_choice_of_investments: args.stated_choice_of_investments ?? null,
          choice_matches_profile: typeof args.choice_matches_profile === "boolean" ? args.choice_matches_profile : null,
          reason_for_mismatch: args.reason_for_mismatch ?? null,
          source,
        }),
        errors,
      )),
    );
  }

  const estateDisplayName = templateBySlug.get("estate");
  if (estateDisplayName) {
    legalFacts.push(
      ...(await extractCategory<LegalDocFacts>(
        db,
        sa,
        accessToken,
        rootChildren,
        estateDisplayName,
        LEGAL_PROMPT,
        LEGAL_FACTS_TOOL_SCHEMA,
        "extract_legal_facts",
        (args) => Boolean(args.document_type) && args.document_type !== "NOT_APPLICABLE",
        (args, source) => ({
          document_type: args.document_type,
          testator_or_grantor_name: args.testator_or_grantor_name ?? null,
          date_executed: args.date_executed ?? null,
          jurisdiction: args.jurisdiction ?? null,
          parties: Array.isArray(args.parties) ? args.parties : [],
          beneficiary_designations: Array.isArray(args.beneficiary_designations) ? args.beneficiary_designations : [],
          key_clauses: Array.isArray(args.key_clauses) ? args.key_clauses : [],
          notes: args.notes ?? null,
          source,
        }),
        errors,
      )),
    );
  }

  return { investorProfiles, legalFacts, errors };
}

// Account types this CRM's own account-type/asset-type free-text field
// uses (see HoldingTank.tsx's Select options) that correspond to a full
// deregistration-at-death tax event -- matches the prototype's own
// "RRSP/RRIF/LIRA at death" convention. TFSA/RESP are registered but
// aren't taxed the same way at death, so they're deliberately excluded.
const REGISTERED_TERMINAL_TAX_TYPES = new Set(["rrsp", "rrif", "lira"]);

interface RunAuditOptions {
  provinceCode?: string;
  currentEquityPct?: number;
  advisorTargetEquityPct?: number;
  keepFloor?: number;
  illiquidProtectedAssets?: string[];
}

async function runFullAudit(db: Db, householdId: string, userId: string, options: RunAuditOptions) {
  const { data: audit, error: insertErr } = await db
    .from("governance_audits")
    .insert({ household_id: householdId, created_by: userId, generation_status: "generating" })
    .select("id")
    .single();
  if (insertErr || !audit) throw new Error(`Failed to create audit row: ${insertErr?.message}`);
  const auditId = audit.id as string;

  try {
    const financials = await gatherHouseholdFinancials(db, householdId);
    const trackType = inferTrackType(financials.shareholders);

    // -- Phase 2: document extraction --
    let investorProfiles: InvestorProfile[] = [];
    let legalFacts: LegalDocFacts[] = [];
    let extractionErrors: string[] = [];
    const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));
    if (financials.vaultRootFolderId) {
      const extracted = await extractDocuments(db, sa, financials.vaultRootFolderId);
      investorProfiles = extracted.investorProfiles;
      legalFacts = extracted.legalFacts;
      extractionErrors = extracted.errors;
    } else {
      extractionErrors = ["This household's Vault is not yet provisioned -- no documents could be extracted."];
    }

    // -- Phase 3: calc --
    const provinceCode = options.provinceCode || "BC";
    const pillarTotals = computePillarTotals(financials);
    const pillarTotalsForNarrative: Record<string, number> = {};
    if (pillarTotals.vineyard > 0) pillarTotalsForNarrative["Vineyard"] = pillarTotals.vineyard;
    if (pillarTotals.keep > 0) pillarTotalsForNarrative["Keep"] = pillarTotals.keep;
    if (pillarTotals.armoury > 0) pillarTotalsForNarrative["Armoury"] = pillarTotals.armoury;
    if (pillarTotals.granary > 0) pillarTotalsForNarrative["Granary"] = pillarTotals.granary;
    if (pillarTotals.legacyVault > 0) pillarTotalsForNarrative["Legacy Vault"] = pillarTotals.legacyVault;

    const assumptions: string[] = [...pillarWarnings(pillarTotals)];

    // deno-lint-ignore no-explicit-any
    const allAccounts: any[] = [...financials.vineyardAccounts, ...financials.storehouses];
    const registeredTotal = allAccounts
      .filter((a) => REGISTERED_TERMINAL_TAX_TYPES.has(String(a.account_type || a.asset_type || "").trim().toLowerCase()))
      .reduce((sum, a) => sum + (Number(a.current_value) || 0), 0);
    const nonRegisteredGain = allAccounts
      .filter((a) => String(a.account_type || a.asset_type || "").trim().toLowerCase() === "non-registered")
      .reduce((sum, a) => {
        const current = Number(a.current_value) || 0;
        const book = Number(a.book_value) || 0;
        return sum + (book > 0 && current > book ? current - book : 0);
      }, 0);

    let registeredTerminalTax = 0;
    let capitalGainsTax = 0;
    try {
      combinedTopMarginalRate(provinceCode); // validates provinceCode before either estimate below
      if (registeredTotal > 0) registeredTerminalTax = estimateTerminalTaxOnRegistered(registeredTotal, provinceCode);
      if (nonRegisteredGain > 0) capitalGainsTax = estimateCapitalGainsTax(nonRegisteredGain, provinceCode);
      assumptions.push(
        `Tax figures computed from governance-audit-tax-config.ts as_of_year=${TAX_TABLES.asOfYear} for province=${provinceCode} -- verify this is current before client delivery.`,
      );
    } catch (e) {
      assumptions.push(
        `Terminal tax / capital gains tax were NOT computed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const liabilitiesTotal = financials.liabilities.reduce(
      // deno-lint-ignore no-explicit-any
      (sum: number, l: any) => sum + (Number(l.current_balance) || 0),
      0,
    );
    const sourceRows = estateAssetSourceRowsFromFinancials(financials);
    const { assets: estateAssets, warnings: estateWarnings } = estateAssetsFromAccounts(sourceRows);
    const estateResult = analyzeEstateLiquidity(
      estateAssets,
      liabilitiesTotal,
      registeredTerminalTax + capitalGainsTax,
      options.illiquidProtectedAssets ?? [],
    );
    assumptions.push(...estateWarnings, ...estateResult.notes);

    // -- Compliance: Sovereignty Charter ratification --
    // Fetched once, unconditionally (not just when an Investor Profile
    // exists), since this is a real compliance check on its own, not a
    // byproduct of target selection. Reused below for the target
    // selection's Charter tone summary too, so this is the only query.
    // Ratified-vs-not is a real, structured field this CRM already tracks
    // (draft_status/esign_status -- confirmed the exact "ratified" check
    // CharterRatificationTile.tsx/SovereigntyCharter.tsx already use, so
    // this can't silently drift from what those pages show). There's no
    // re-ratification/staleness concept modeled anywhere in this CRM
    // today (a ratified Charter never expires) -- confirmed with Rolf this
    // is the right bar for now; a re-ratification cadence would be a
    // separate, later policy decision, not invented here.
    let charterRow: { mission_of_capital: string | null; vision_20_year: string | null; draft_status: string | null; esign_status: string | null; ratified_at: string | null } | undefined;
    try {
      const { data: charters } = await db
        .from("sovereignty_charters")
        .select("mission_of_capital, vision_20_year, draft_status, esign_status, ratified_at")
        .in("contact_id", financials.members.map((m) => m.id))
        .limit(1);
      charterRow = charters?.[0];
    } catch {
      // no Charter row at all -- treated as not-ratified below
    }
    const hasRatifiedCharter = charterRow?.draft_status === "ratified" || charterRow?.esign_status === "ratified";

    // -- Compliance footnotes, printed on the document itself (not just
    // staff-only `assumptions`) -- per Rolf's request. Terms of Engagement
    // and regulatory disclosures have no structured tracking anywhere in
    // this CRM yet (confirmed: no table, no dedicated Vault folder, no
    // renewal cadence) -- Rolf's direction is a Correspondence/TOE and
    // Correspondence/Disclosures Vault subfolder structure, checked
    // autonomously by a future "Librarian Agent" once he provides the
    // required-document list (tracked on the roadmap). Until that exists,
    // this stays an honest manual-review reminder, not a fabricated check.
    const complianceNotes: string[] = [
      hasRatifiedCharter
        ? `Sovereignty Charter: ratified${charterRow?.ratified_at ? ` ${charterRow.ratified_at.slice(0, 10)}` : ""}.`
        : "Sovereignty Charter: NOT YET RATIFIED on file for this household -- confirm before this audit's governance recommendations are treated as Charter-aligned.",
      "Terms of Engagement and regulatory disclosures: confirm current signed copies are on file in the Vault " +
        "(Correspondence/TOE, Correspondence/Disclosures) before client delivery -- automated currency tracking not yet implemented.",
    ];

    const scoreableProfile = investorProfiles.find((p) => p.profile_category);
    let targetIncomeEquitySplit: { income_pct: number; equity_pct: number } | null = null;
    let capitalRow: ScorecardRow | undefined;
    if (scoreableProfile && typeof scoreableProfile.total_points === "number") {
      const charterTone = [charterRow?.mission_of_capital, charterRow?.vision_20_year].filter(Boolean).join(" ") || null;
      try {
        const target = selectTarget(
          { totalPoints: scoreableProfile.total_points, profileCategory: scoreableProfile.profile_category! },
          charterTone,
          { advisorTargetEquityPct: options.advisorTargetEquityPct },
        );
        targetIncomeEquitySplit = { income_pct: target.targetIncomePct, equity_pct: target.targetEquityPct };
        assumptions.push(...target.assumptions);
        if (typeof options.currentEquityPct === "number") {
          capitalRow = scoreCapitalInfrastructure({
            currentEquityPct: options.currentEquityPct,
            targetEquityPct: target.targetEquityPct,
            keepTotal: pillarTotals.keep,
            keepFloor: options.keepFloor ?? null,
          });
        } else {
          assumptions.push(
            "No current Income/Equity split was supplied for this run -- Capital Infrastructure & Asset Allocation could not be scored. " +
              "This CRM doesn't track fund-level asset-class detail per account; supply current_equity_pct to score this element.",
          );
        }
      } catch (e) {
        assumptions.push(`Target Income/Equity split could not be determined: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      assumptions.push(
        "No Investor Risk Profile was extracted for this household -- Capital Infrastructure & Asset Allocation could not be scored. " +
          "Upload an Investor Risk Profile to the Vault's Identity & Legal folder and re-run.",
      );
    }
    if (!capitalRow) capitalRow = manualReviewRow(CAPITAL_INFRASTRUCTURE);

    const estateRow = scoreEstateAlignment(estateResult);
    const matrimonialRow = manualReviewRow("Matrimonial Property Insulation");
    const environmentalRow = manualReviewRow("Environmental Noise & Behavioral Boundaries");
    const scorecard = [capitalRow, estateRow, matrimonialRow, environmentalRow];

    const currentIncomeEquitySplit =
      typeof options.currentEquityPct === "number"
        ? { income_pct: 100 - options.currentEquityPct, equity_pct: options.currentEquityPct }
        : null;

    const computed = {
      pillar_totals: pillarTotalsForNarrative,
      target_income_equity_split: targetIncomeEquitySplit,
      current_income_equity_split: currentIncomeEquitySplit,
      terminal_tax_estimate: { registered_terminal_tax: registeredTerminalTax, capital_gains_tax: capitalGainsTax },
      estate_liquidity_analysis: {
        total_estate_liquid_assets: estateResult.totalEstateLiquidAssets,
        total_beneficiary_bypass_assets: estateResult.totalBeneficiaryBypassAssets,
        total_liabilities_and_taxes: estateResult.totalLiabilitiesAndTaxes,
        surplus_or_deficit: estateResult.surplusOrDeficit,
      },
      assumptions,
    };

    // -- Phase 4: narrative --
    const { data: cfoProfile } = await db.from("profiles").select("full_name").eq("user_id", userId).maybeSingle();
    const doc = {
      client_name: financials.householdLabel,
      review_date: new Date().toISOString().slice(0, 10),
      reviewing_family_cfo: cfoProfile?.full_name || "Staff",
      track_type: trackType,
      executive_summary_bullets: [] as string[],
      pillar_analyses: Object.entries(pillarTotalsForNarrative).map(([pillar, current_total]) => ({
        pillar,
        current_total,
        narrative: "",
      })),
      element_deep_dives: scorecard.map((row) => ({
        element_name: row.elementName,
        charter_baseline: "See Charter mission/tone summary and pillar definitions.",
        current_score: row.currentScore,
        max_score: row.maxScore,
        audit_findings: [] as string[],
        required_corrective_actions: [] as string[],
      })),
      discussion_points: [] as { title: string; body: string }[],
    };

    const scorecardElements = scorecard.map((r) => r.elementName);
    let narrativeUngrounded: string[] = [];
    let narrativeError: string | null = null;
    try {
      const narrative = await generateAuditNarrative(sa, computed, scorecardElements);
      applyNarrative(doc, narrative);
      narrativeUngrounded = findUngroundedDollarFigures(narrative, computed);
    } catch (e) {
      narrativeError = e instanceof Error ? e.message : String(e);
    }

    const finalComputed = {
      ...doc,
      scorecard,
      computed,
      investor_profiles: investorProfiles,
      legal_facts: legalFacts,
      extraction_errors: extractionErrors,
      narrative_ungrounded_dollar_figures: narrativeUngrounded,
      compliance_notes: complianceNotes,
    };

    await db
      .from("governance_audits")
      .update({
        generation_status: "complete",
        generation_error: narrativeError,
        computed: finalComputed,
        generated_at: new Date().toISOString(),
      })
      .eq("id", auditId);

    return { auditId, ...finalComputed };
  } catch (e) {
    await db
      .from("governance_audits")
      .update({ generation_status: "error", generation_error: e instanceof Error ? e.message : String(e) })
      .eq("id", auditId);
    throw e;
  }
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const auth = await requireStaff(req);
  if (auth.error) return json({ error: auth.error }, 401);

  const body = await req.json().catch(() => ({}));
  const householdId = String(body?.household_id || "");
  if (!householdId) return json({ error: "household_id is required" }, 400);

  const options: RunAuditOptions = {
    provinceCode: typeof body?.province_code === "string" ? body.province_code : undefined,
    currentEquityPct: typeof body?.current_equity_pct === "number" ? body.current_equity_pct : undefined,
    advisorTargetEquityPct: typeof body?.advisor_target_equity_pct === "number" ? body.advisor_target_equity_pct : undefined,
    keepFloor: typeof body?.keep_floor === "number" ? body.keep_floor : undefined,
    illiquidProtectedAssets: Array.isArray(body?.illiquid_protected_assets) ? body.illiquid_protected_assets : undefined,
  };

  try {
    const result = await runFullAudit(admin(), householdId, auth.userId, options);
    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
