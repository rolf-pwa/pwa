// vault-statement-scan
// Staff-triggered, household-scoped: scans the "Investment Statements" and
// "Insurance" Vault folders, AI-extracts figures from every file in each,
// and writes them directly onto matched vineyard_accounts/storehouses/
// insurance_policies rows — same "extract, match, write" shape as
// ingest-statement (which does this for a single pre-uploaded contact
// statement), just widened to a whole household's Vault folders and to a
// second document category (insurance policies) that nothing parses today.
//
// No automatic trigger — staff clicks "Scan Vault for Updates" on the
// household page. Building real Drive push-notification automation is a
// separate, bigger piece of infra, deliberately out of scope for this pass.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { driveListChildren, driveDownloadFile, matchVaultCategoryFolder } from "../_shared/vault-provisioning.ts";
import { GEMINI_EXTRACT_MODEL, withThinking, fetchWithVertexRetry } from "../_shared/vertex-ai.ts";

// Keep in sync with src/shared/lib/custodians.ts (a Deno edge function can't
// import a frontend module directly). Normalizes AI-extracted custodian text
// before it's stored — found real production rows where the exact same
// custodian came back as "iA Financial Group", "IA Financial", "IAG
// Financial Group", etc. across different statement PDFs.
function normalizeCustodian(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes("ia financial") || lower.includes("iag financial")) return "iA Financial Group";
  if (lower.includes("justwealth") || lower.includes("just wealth")) return "JustWealth";
  // A statement's custodian text is never purely digits — the AI extraction
  // occasionally grabs a policy/account number instead of the issuer name.
  // Store nothing rather than a garbage value in that case.
  if (/^[a-z]?\d{6,}$/i.test(value)) return null;
  return value;
}

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
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  };
}

// ---------- Vertex AI auth (same self-contained pattern as ingest-statement) ----------

const REGION = "northamerica-northeast1";
const MODEL = GEMINI_EXTRACT_MODEL;

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

async function getVertexAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };
  const enc = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${enc(header)}.${enc(payload)}`;
  const pemBody = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", binaryKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signatureBuffer = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${unsigned}.${signature}`;
  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  return data.access_token;
}

function normalizeToken(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Matches an extracted name (often a legal name with a middle initial —
 * "ADRIAN E SCILLATO" — that won't exact-match a plain "Adrian Scillato"
 * contact record) by checking whether both the first and last name appear
 * anywhere in the extracted string, instead of requiring an exact match.
 */
function findMemberByLooseName(
  members: { id: string; first_name: string; last_name: string }[],
  name: string | null | undefined,
) {
  const normalized = normalizeToken(name);
  if (!normalized) return null;
  return members.find((m) => {
    const first = normalizeToken(m.first_name);
    const last = normalizeToken(m.last_name);
    return Boolean(first) && Boolean(last) && normalized.includes(first) && normalized.includes(last);
  }) ?? null;
}

// Chunked, unlike ingest-statement's spread-based btoa(String.fromCharCode(...bytes)) —
// insurance policy contracts run larger than typical statements and can exceed the
// JS engine's max call-stack argument count if spread all at once.
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_NATIVE_MIME = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
]);
const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_FILES = 100;

/**
 * Walks a Vault category folder's full subtree, not just its direct children —
 * staff commonly organize into subfolders (e.g. "Insurance/Life Insurance/Statements"),
 * and a flat listing would silently miss everything nested under them.
 */
async function collectFilesRecursive(
  folderId: string,
  accessToken: string,
  depth = 0,
): Promise<{ id: string; name: string; mimeType: string }[]> {
  if (depth >= MAX_SCAN_DEPTH) return [];
  const children = await driveListChildren(folderId, accessToken);
  const files: { id: string; name: string; mimeType: string }[] = [];
  for (const child of children) {
    if (files.length >= MAX_SCAN_FILES) break;
    if (child.mimeType === FOLDER_MIME) {
      files.push(...(await collectFilesRecursive(child.id, accessToken, depth + 1)));
    } else if (!GOOGLE_NATIVE_MIME.has(child.mimeType)) {
      files.push(child);
    }
  }
  return files.slice(0, MAX_SCAN_FILES);
}

async function callVertex(accessToken: string, projectId: string, systemPrompt: string, instruction: string, base64: string, mimeType: string) {
  const vertexUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;
  const res = await fetchWithVertexRetry(vertexUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: systemPrompt + "\n\n" + instruction }, { inlineData: { mimeType, data: base64 } }],
        },
      ],
      generationConfig: withThinking(MODEL, { temperature: 0.1, maxOutputTokens: 8000 }, "minimal"),
    }),
  });
  if (!res.ok) throw new Error(`AI parsing failed: ${await res.text()}`);
  const result = await res.json();
  const raw = result.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const finishReason = result.candidates?.[0]?.finishReason;
  // Models routinely emit a trailing comma before a closing } or ] despite instructions
  // not to — strict JSON.parse rejects that, so strip it before parsing.
  const jsonStr = raw
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim()
    .replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(jsonStr);
  } catch {
    const truncated = finishReason === "MAX_TOKENS" ? " (response was truncated — hit the output token limit)" : "";
    throw new Error(`Failed to parse AI response as JSON${truncated}: ${jsonStr.slice(0, 300)}`);
  }
}

const INVESTMENT_SYSTEM_PROMPT = `You are a financial statement parser for a Canadian family office. Extract investment/brokerage account data from the uploaded document.
Return a JSON object with this exact structure:
{
  "statement_date": "YYYY-MM-DD or null",
  "accounts": [
    {
      "account_name": "Institution - Account Type (e.g. iA Financial - RRSP)",
      "account_number": "string or null",
      "account_type": "Portfolio|RRSP|TFSA|RESP|LIRA|LIF|Corporate|Trust|Other",
      "account_owner": "Full name of the account holder or null",
      "custodian": "Name of the financial institution",
      "book_value": number or null,
      "current_harvest": number or null,
      "current_value": number or null,
      "notes": "Any classification notes"
    }
  ],
  "summary": "Brief one-line summary of total holdings",
  "missing_fields": ["list of fields that could not be confidently extracted"]
}
Guidelines:
- "book_value" is the beginning-of-year value, cost basis, or original investment amount
- "current_harvest" is the year-to-date gain/loss if shown, otherwise current_value minus book_value
- "current_value" is the most recent market value shown
- Use null for any values you cannot confidently extract
- Return ONLY the JSON, no markdown`;

const INSURANCE_SYSTEM_PROMPT = `You are an insurance policy document parser for a Canadian family office. Extract policy data from the uploaded document (a policy schedule, illustration, or annual statement).
Return a JSON object with this exact structure:
{
  "policies": [
    {
      "carrier": "Name of the insurance company",
      "policy_number": "string or null",
      "policy_type": "term|whole_life|universal_life|critical_illness|disability|long_term_care|other",
      "insured_name": "Full name of the insured person, or the corporation name if this is a corporate-owned policy",
      "coverage_amount": number or null,
      "cash_value": number or null,
      "premium_amount": number or null,
      "premium_frequency": "annual|semi-annual|monthly|single or null",
      "issue_date": "YYYY-MM-DD or null",
      "renewal_date": "YYYY-MM-DD or null"
    }
  ],
  "summary": "Brief one-line summary",
  "missing_fields": ["list of fields that could not be confidently extracted"]
}
Guidelines:
- "coverage_amount" is the face amount / death benefit / sum insured
- "cash_value" is the policy's current cash surrender value, if shown (often absent on term policies — use null)
- For life insurance, pick the most specific policy_type the document supports: "term" if it names a level term period (10/20/T100), "whole_life" or "universal_life" if the document says so explicitly, otherwise "whole_life" as the more common default for a permanent policy — never invent a type the document doesn't support
- IMPORTANT — joint/multi-life policies: a single policy number can cover more than one insured life (e.g. "Insured No. 01" and "Insured No. 02" on a joint spousal term policy), each with their own coverage amount and premium. When you see this, emit ONE entry per insured life, each with that same policy_number/carrier but that person's own individual insured_name and coverage_amount/premium_amount — never combine multiple people into a single insured_name like "Adrian and Luciana" or use the policy owner's joint name as insured_name
- "insured_name" must always be exactly one person's full name (or one corporation's name) — never a policyowner field that lists multiple people
- "premium_amount" and "premium_frequency" must describe the same period: if the document states an amount per payment period (for example 276.00 per month), report that amount with that frequency; if it only gives an annual total, report the annual total with "annual". Never pair an annual total with "monthly" or the reverse
- Use null for any values you cannot confidently extract
- Return ONLY the JSON, no markdown`;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing auth header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) throw new Error("Unauthorized");
    if (!user.email?.toLowerCase().endsWith("@prosperwise.ca")) {
      return new Response(JSON.stringify({ error: "Access denied: unauthorized domain" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const { householdId } = await req.json();
    if (!householdId) throw new Error("Missing householdId");

    const { data: household } = await admin
      .from("households")
      .select("id, label, vault_root_folder_id")
      .eq("id", householdId)
      .maybeSingle();
    if (!household) throw new Error("Household not found");
    if (!household.vault_root_folder_id) {
      return new Response(JSON.stringify({ error: "This household's Vault isn't provisioned yet." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: contacts } = await admin
      .from("contacts")
      .select("id, first_name, last_name, family_role")
      .eq("household_id", householdId);
    const members = contacts ?? [];
    const memberIds = members.map((c: any) => c.id);
    const roleRank = (r: string | null | undefined) => {
      const v = (r || "").toLowerCase();
      if (v === "hof" || v === "head_of_family" || v.includes("head of family")) return 0;
      if (v === "hoh" || v === "head_of_household" || v.includes("head of household")) return 1;
      return 2;
    };
    const headOfHousehold = [...members].sort((a: any, b: any) => roleRank(a.family_role) - roleRank(b.family_role))[0];

    const { data: shareholders } = memberIds.length
      ? await admin.from("shareholders").select("corporation_id").in("contact_id", memberIds).eq("is_active", true)
      : { data: [] };
    const corpIds = [...new Set((shareholders ?? []).map((s: any) => s.corporation_id))];
    const { data: corporations } = corpIds.length
      ? await admin.from("corporations").select("id, name").in("id", corpIds)
      : { data: [] };

    // ---------- Google auth + locate the two Vault category folders ----------

    const driveAccessToken = await getServiceGoogleAccessToken(admin);
    const rootChildren = await driveListChildren(household.vault_root_folder_id, driveAccessToken);

    const { data: templates } = await admin
      .from("vault_folder_templates")
      .select("display_name, slug")
      .eq("is_active", true)
      .in("slug", ["investments", "insurance"]);
    const investmentsTemplate = (templates ?? []).find((t: any) => t.slug === "investments");
    const insuranceTemplate = (templates ?? []).find((t: any) => t.slug === "insurance");

    const investmentsFolder = investmentsTemplate ? matchVaultCategoryFolder(rootChildren, investmentsTemplate.display_name) : null;
    const insuranceFolder = insuranceTemplate ? matchVaultCategoryFolder(rootChildren, insuranceTemplate.display_name) : null;

    // ---------- Vertex AI auth ----------

    const gcpKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!gcpKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    const sa: ServiceAccountKey = JSON.parse(gcpKeyRaw);
    const vertexAccessToken = await getVertexAccessToken(sa);

    const filesToParse = async (folder: { id: string; name: string } | null) => {
      if (!folder) return [];
      return collectFilesRecursive(folder.id, driveAccessToken);
    };

    // ---------- Investment Statements ----------

    const { data: existingVineyard } = memberIds.length
      ? await admin.from("vineyard_accounts").select("id, contact_id, account_name, account_number").in("contact_id", memberIds)
      : { data: [] };
    const { data: existingStorehouses } = memberIds.length
      ? await admin.from("storehouses").select("id, contact_id, label, asset_type").in("contact_id", memberIds)
      : { data: [] };
    // A household's real accounts often sit here, not yet formally "moved" into
    // vineyard_accounts/storehouses — must be a matchable target too, or every
    // re-scan treats the same statement as brand new and duplicates it.
    const { data: existingHoldingTank } = memberIds.length
      ? await admin.from("holding_tank").select("id, contact_id, account_name, account_number").in("contact_id", memberIds).neq("status", "moved")
      : { data: [] };

    const vineyardByNumber = new Map(
      (existingVineyard ?? []).filter((a: any) => a.account_number).map((a: any) => [normalizeToken(a.account_number), a]),
    );
    const vineyardByName = new Map((existingVineyard ?? []).map((a: any) => [normalizeToken(a.account_name), a]));
    const storehouseByName = new Map(
      (existingStorehouses ?? []).flatMap((s: any) =>
        [s.label, s.asset_type].filter(Boolean).map((v: string) => [normalizeToken(v), s] as const),
      ),
    );
    const holdingTankByNumber = new Map(
      (existingHoldingTank ?? []).filter((h: any) => h.account_number).map((h: any) => [normalizeToken(h.account_number), h]),
    );
    const holdingTankByName = new Map((existingHoldingTank ?? []).map((h: any) => [normalizeToken(h.account_name), h]));

    let investmentAccountsExtracted = 0;
    let investmentAccountsMatched = 0;
    let investmentHoldingTankUpdated = 0;
    const investmentUnmatched: string[] = [];
    const investmentFilesParsed: string[] = [];
    const investmentErrors: string[] = [];

    for (const file of await filesToParse(investmentsFolder)) {
      try {
        const bytes = await driveDownloadFile(file.id, driveAccessToken);
        const base64 = bytesToBase64(new Uint8Array(bytes));
        const parsed = await callVertex(
          vertexAccessToken,
          sa.project_id,
          INVESTMENT_SYSTEM_PROMPT,
          `Parse this financial statement for the ${household.label} household. Extract all investment accounts.`,
          base64,
          file.mimeType,
        );
        investmentFilesParsed.push(file.name);

        for (const account of parsed.accounts || []) {
          investmentAccountsExtracted += 1;
          const normalizedNumber = normalizeToken(account.account_number);
          const normalizedName = normalizeToken(account.account_name);
          const matched = (normalizedNumber && vineyardByNumber.get(normalizedNumber)) || vineyardByName.get(normalizedName) || storehouseByName.get(normalizedName);

          const currentValue = account.current_value ?? 0;
          const bookValue = account.book_value ?? 0;

          if (matched) {
            const isVineyard = "account_name" in matched;
            await admin
              .from(isVineyard ? "vineyard_accounts" : "storehouses")
              .update({ book_value: bookValue, current_value: currentValue })
              .eq("id", (matched as any).id);
            investmentAccountsMatched += 1;
            continue;
          }

          // Not yet moved into Vineyard/Storehouses — check Holding Tank before
          // creating a new row, or every re-scan of the same statement duplicates it.
          const matchedHoldingTank =
            (normalizedNumber && holdingTankByNumber.get(normalizedNumber)) || holdingTankByName.get(normalizedName);
          if (matchedHoldingTank) {
            await admin
              .from("holding_tank")
              .update({ book_value: account.book_value, current_value: account.current_value })
              .eq("id", (matchedHoldingTank as any).id);
            investmentHoldingTankUpdated += 1;
            continue;
          }

          investmentUnmatched.push(account.account_name);
          const owner = findMemberByLooseName(members, account.account_owner) || headOfHousehold;
          const { data: newHoldingTankRow } = await admin
            .from("holding_tank")
            .insert({
              contact_id: owner?.id,
              household_id: householdId,
              account_name: account.account_name,
              account_number: account.account_number,
              account_type: account.account_type || "Portfolio",
              account_owner: account.account_owner,
              custodian: normalizeCustodian(account.custodian),
              book_value: account.book_value,
              current_value: account.current_value,
              notes: account.notes,
              source_file: `vault:${file.id}:${file.name}`,
              status: "holding",
            })
            .select("id, account_name, account_number")
            .single();
          // Register it so a second account extracted from the SAME statement (or a
          // later file in this same run) matches it too, instead of also duplicating.
          if (newHoldingTankRow) {
            if (newHoldingTankRow.account_number) holdingTankByNumber.set(normalizeToken(newHoldingTankRow.account_number), newHoldingTankRow);
            holdingTankByName.set(normalizeToken(newHoldingTankRow.account_name), newHoldingTankRow);
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[vault-statement-scan] investment file "${file.name}" failed:`, message);
        investmentErrors.push(`${file.name}: ${message}`);
      }
    }

    // ---------- Insurance ----------

    const { data: existingPolicies } = await admin
      .from("insurance_policies")
      .select("id, contact_id, corporation_id, carrier, policy_number, insured_name")
      .or(`contact_id.in.(${memberIds.length ? memberIds.join(",") : "00000000-0000-0000-0000-000000000000"})${corpIds.length ? `,corporation_id.in.(${corpIds.join(",")})` : ""}`);

    // Keyed on policy_number + insured_name together, not policy_number alone — a
    // joint policy (e.g. a spousal term policy) can list two different insured
    // lives under the SAME policy number, each needing its own row.
    const policyByNumberAndInsured = new Map(
      (existingPolicies ?? [])
        .filter((p: any) => p.policy_number)
        .map((p: any) => [normalizeToken(`${p.policy_number}${p.insured_name}`), p]),
    );
    const policyByCarrierInsured = new Map(
      (existingPolicies ?? []).map((p: any) => [normalizeToken(`${p.carrier}${p.insured_name}`), p]),
    );
    const corpByName = new Map((corporations ?? []).map((c: any) => [normalizeToken(c.name), c]));

    let insurancePoliciesExtracted = 0;
    let insurancePoliciesMatched = 0;
    let insurancePoliciesCreated = 0;
    const insuranceFilesParsed: string[] = [];
    const insuranceErrors: string[] = [];

    for (const file of await filesToParse(insuranceFolder)) {
      try {
        const bytes = await driveDownloadFile(file.id, driveAccessToken);
        const base64 = bytesToBase64(new Uint8Array(bytes));
        const parsed = await callVertex(
          vertexAccessToken,
          sa.project_id,
          INSURANCE_SYSTEM_PROMPT,
          `Parse this insurance document for the ${household.label} household. Extract all policies shown.`,
          base64,
          file.mimeType,
        );
        insuranceFilesParsed.push(file.name);

        for (const policy of parsed.policies || []) {
          insurancePoliciesExtracted += 1;
          const normalizedNumberInsured = normalizeToken(`${policy.policy_number}${policy.insured_name}`);
          const normalizedCarrierInsured = normalizeToken(`${policy.carrier}${policy.insured_name}`);
          const matched =
            (policy.policy_number && policyByNumberAndInsured.get(normalizedNumberInsured)) ||
            policyByCarrierInsured.get(normalizedCarrierInsured);

          const update: Record<string, unknown> = {};
          if (typeof policy.coverage_amount === "number") update.coverage_amount = policy.coverage_amount;
          if (typeof policy.cash_value === "number") update.cash_value = policy.cash_value;
          if (typeof policy.premium_amount === "number") update.premium_amount = policy.premium_amount;
          if (policy.premium_frequency) update.premium_frequency = policy.premium_frequency;
          if (policy.issue_date) update.issue_date = policy.issue_date;
          if (policy.renewal_date) update.renewal_date = policy.renewal_date;

          if (matched) {
            if (Object.keys(update).length > 0) {
              await admin.from("insurance_policies").update(update).eq("id", (matched as any).id);
            }
            insurancePoliciesMatched += 1;
            continue;
          }

          const matchedMember = findMemberByLooseName(members, policy.insured_name);
          const matchedCorp = !matchedMember ? corpByName.get(normalizeToken(policy.insured_name)) : null;
          const { data: newPolicyRow } = await admin
            .from("insurance_policies")
            .insert({
              contact_id: matchedCorp ? null : (matchedMember?.id ?? headOfHousehold?.id ?? null),
              corporation_id: matchedCorp ? (matchedCorp as any).id : null,
              carrier: policy.carrier,
              policy_number: policy.policy_number,
              policy_type: policy.policy_type || "other",
              insured_name: policy.insured_name,
              coverage_amount: policy.coverage_amount ?? 0,
              cash_value: policy.cash_value ?? 0,
              premium_amount: policy.premium_amount ?? null,
              premium_frequency: policy.premium_frequency ?? null,
              issue_date: policy.issue_date ?? null,
              renewal_date: policy.renewal_date ?? null,
              notes: `Created from Vault scan of "${file.name}".`,
              vault_folder_id: insuranceFolder?.id ?? null,
            })
            .select("id, carrier, policy_number, insured_name")
            .single();
          // Register it so a second entry for the SAME joint policy (or a later
          // file in this run) matches it instead of also duplicating.
          if (newPolicyRow) {
            if (newPolicyRow.policy_number) {
              policyByNumberAndInsured.set(normalizeToken(`${newPolicyRow.policy_number}${newPolicyRow.insured_name}`), newPolicyRow);
            }
            policyByCarrierInsured.set(normalizeToken(`${newPolicyRow.carrier}${newPolicyRow.insured_name}`), newPolicyRow);
          }
          insurancePoliciesCreated += 1;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[vault-statement-scan] insurance file "${file.name}" failed:`, message);
        insuranceErrors.push(`${file.name}: ${message}`);
      }
    }

    // ---------- Accountability log ----------

    await admin.from("review_queue").insert({
      action_type: "vault_statement_scan",
      action_description: `Scanned Vault for ${household.label}: ${investmentFilesParsed.length} investment file(s), ${insuranceFilesParsed.length} insurance file(s).`,
      contact_id: headOfHousehold?.id ?? null,
      created_by: user.id,
      proposed_data: {
        investment_files: investmentFilesParsed,
        investment_accounts_matched: investmentAccountsMatched,
        investment_holding_tank_updated: investmentHoldingTankUpdated,
        investment_accounts_unmatched: investmentUnmatched,
        insurance_files: insuranceFilesParsed,
        insurance_policies_matched: insurancePoliciesMatched,
        insurance_policies_created: insurancePoliciesCreated,
        errors: [...investmentErrors, ...insuranceErrors],
      },
      logic_trace: `Vault-scan triggered by ${user.email}. Investment folder ${investmentsFolder ? "found" : "not found"}, insurance folder ${insuranceFolder ? "found" : "not found"}.`,
      status: "approved",
    });

    return new Response(
      JSON.stringify({
        success: true,
        investmentsFolderFound: Boolean(investmentsFolder),
        insuranceFolderFound: Boolean(insuranceFolder),
        investmentFilesParsed: investmentFilesParsed.length,
        investmentAccountsExtracted,
        investmentAccountsMatched,
        investmentHoldingTankUpdated,
        investmentAccountsUnmatched: investmentUnmatched.length,
        insuranceFilesParsed: insuranceFilesParsed.length,
        insurancePoliciesExtracted,
        insurancePoliciesMatched,
        insurancePoliciesCreated,
        errors: [...investmentErrors, ...insuranceErrors],
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("vault-statement-scan error:", err);
    const corsHeaders = getCorsHeaders(req);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
