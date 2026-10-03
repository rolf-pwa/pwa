import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_GOVERNANCE_MODEL, withThinking, fetchWithVertexRetry } from "../_shared/vertex-ai.ts";

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

// ---------- Vertex AI Auth ----------

const REGION = "northamerica-northeast1"; // Montreal — PIPEDA compliance
const MODEL = GEMINI_GOVERNANCE_MODEL;

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  };

  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const unsigned = `${enc(header)}.${enc(payload)}`;

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsigned)
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = `${unsigned}.${signature}`;

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  return data.access_token;
}

const SYSTEM_PROMPT = `You are the Household Cashflow Analyst for ProsperWise. Your objective is to extract the 'True Burn Rate' from raw financial data.

## Phase 1: Ingestion & Mapping
Utilize the following header mapping to identify columns from Canadian bank CSV exports:
- RBC: "Transaction Date" → date, "Description 1" → description, "CAD$" → amount
- TD: "Date" → date, "Description" → description, "Amount" → amount (may have separate Debit/Credit columns; merge them)
- Scotiabank: "Date" → date, "Description" → description, "Amount" → amount
- BMO: "Posting Date" → date, "Description" → description, "Amount" → amount
- CIBC: "Date" → date, "Description" → description, "Debit"/"Credit" → amount (use -Debit or +Credit)
- American Express: "Date" → date, "Description" → description, "Amount" → amount (payments are negative, spend is positive — invert)
Standardize all dates to ISO-8601 and all amounts to a single Inflow(+)/Outflow(-) convention.

## Phase 2: Normalization (The Transfer Firewall)
Identify and neutralize 'Internal Transfers.' If an outflow from one account matches an inflow to another account within a 3-day window for the same amount, mark both as INTERNAL_TRANSFER and exclude from Burn Rate calculation.

## Phase 3: Categorization
CRITICAL RULE: Every single positive/inflow transaction MUST be categorized into one of the INCOME categories below. Do NOT leave any inflow uncategorized or lump them into expense categories. If the source CSV already has category labels, USE them to inform your classification.

EXPENSE categories (outflows, negative amounts): Housing, Utilities, Groceries, Transport, Lifestyle, Debt Service, Other.
INCOME categories (inflows, positive amounts): Employment, Investment Income, Government Benefits, Business Income, Rental Income, Other Income.

Keyword hints (non-exhaustive — use your judgment for any transaction not matching these):
- Housing: Mortgage, Rent, Property Tax, BC Hydro, Fortis, Strata
- Lifestyle: Netflix, Spotify, Restaurant, LCBO, Uber, Amazon, Entertainment
- Groceries: SafeWay, Save-On, Whole Foods, Loblaws, Costco, Superstore
- Transport: Chevron, Shell, ICBC, Parking, Transit, Gas Station
- Utilities: Hydro, Gas, Internet, Phone, Shaw, Telus, Rogers
- Debt Service: Loan, Interest, Credit Card Payment (when not internal transfer)
- Employment: Payroll, Salary, Direct Deposit, Pay, Wages, Employer
- Investment Income: Dividends, Interest Earned, Capital Gains, Distribution, Yield, Fund, ETF, DRIP, T3, T5, ROC
- Government Benefits: CRA, GST Credit, Child Benefit, CCB, OAS, CPP, EI, CERB, CWB, GIS
- Business Income: Invoice, Consulting, Revenue, Client Payment, Professional Fee
- Rental Income: Rent Received, Tenant, Rental
- Other Income: Refund, Rebate, Insurance Claim, Gift, Reimbursement, Settlement

IMPORTANT: If the CSV contains a "Category" column or similar label that identifies a transaction as investment income, dividends, interest, etc., you MUST respect that categorization. Do not override source categories with generic labels.

Identify 'The Outliers': Flag any single transaction exceeding 20% of the monthly average outflow.

## Phase 4: Sovereign Analysis
- The Liquidity Wall: Calculate how many months of 'Fixed Burn' (Housing + Utilities + Debt Service) are covered by current liquid assets (provided separately).
- The Anxiety Anchor: Match spending patterns against the client's stated Anxiety Anchor if provided.

## Output Format
Return ONLY valid JSON with this exact structure:
{
  "period_start": "YYYY-MM-DD",
  "period_end": "YYYY-MM-DD",
  "burn_rate": {
    "monthly_average": number,
    "fixed_baseline": number,
    "variable_leakage": number
  },
  "liquidity_status": {
    "wall_months": number,
    "status": "Red" | "Yellow" | "Green",
    "liquid_assets": number,
    "gap_to_sovereignty": number
  },
  "category_breakdown": {
    "Housing": number (annual total, negative for outflows),
    "Utilities": number,
    "Groceries": number,
    "Transport": number,
    "Lifestyle": number,
    "Debt Service": number,
    "Other": number,
    "Employment": number (annual total, positive for inflows),
    "Investment Income": number,
    "Government Benefits": number,
    "Business Income": number,
    "Rental Income": number,
    "Other Income": number
  },
  "total_inflows": number (sum of all positive/income transactions for the period),
  "total_outflows": number (sum of all negative/expense transactions for the period, as a negative number),
  "net_cashflow": number (total_inflows + total_outflows; positive = surplus, negative = deficit),
  "outliers": [
    { "date": "YYYY-MM-DD", "description": "string", "amount": number, "category": "string", "flag_reason": "string" }
  ],
  "internal_transfers_neutralized": number,
  "proposed_tasks": [
    { "title": "string", "phase": "C" | "D" | "E", "description": "string" }
  ],
  "logic_trace": "string",
  "executive_summary": "string",
  "anxiety_anchor_findings": "string or null"
}

Green = 6+ months coverage, Yellow = 3-6 months, Red = <3 months.
IMPORTANT: All category_breakdown values must be ANNUAL TOTALS for the full period, NOT monthly averages. Use negative numbers for outflow categories and positive numbers for income. Include total_inflows, total_outflows, and net_cashflow as top-level fields.
CRITICAL: You MUST categorize ALL inflows into the correct income category. If a transaction is clearly investment income (dividends, interest, distributions, capital gains), it MUST appear under "Investment Income", NOT under "Employment" or "Other Income". Review EVERY positive transaction and assign the most accurate income category. Zero values are acceptable for unused categories but do NOT omit any category key.
Do NOT include markdown fences. Return ONLY the JSON object.`;

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
    // Domain verification: only @prosperwise.ca staff can run cashflow analysis
    if (!user.email?.toLowerCase().endsWith("@prosperwise.ca")) {
      return new Response(JSON.stringify({ error: "Access denied: unauthorized domain" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { householdId, filePaths, householdName, liquidAssets, anxietyAnchor } = await req.json();
    if (!householdId || !filePaths?.length) throw new Error("Missing householdId or filePaths");

    // Download and concatenate all CSV files
    const csvContents: string[] = [];
    for (const fp of filePaths) {
      const { data: fileData, error: dlErr } = await adminClient.storage
        .from("cashflow-uploads")
        .download(fp);
      if (dlErr || !fileData) throw new Error("Failed to download file: " + fp + " " + dlErr?.message);
      const text = await fileData.text();
      csvContents.push(`--- FILE: ${fp} ---\n${text}`);
    }

    const allCsvData = csvContents.join("\n\n");

    // Build the user prompt
    let userPrompt = `Analyze the following CSV transaction data for the "${householdName || "Unknown"}" household.\n\n`;
    if (liquidAssets !== undefined && liquidAssets !== null) {
      userPrompt += `Current Liquid Assets (Cash, HISA, Short-term GICs): $${Number(liquidAssets).toLocaleString()}\n`;
    }
    if (anxietyAnchor) {
      userPrompt += `Client's Anxiety Anchor: "${anxietyAnchor}"\n`;
    }
    userPrompt += `\nRAW CSV DATA:\n${allCsvData}`;

    // Authenticate with GCP service account for Vertex AI
    const gcpKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!gcpKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    const sa: ServiceAccountKey = JSON.parse(gcpKeyRaw);
    const accessToken = await getAccessToken(sa);

    // Call Vertex AI directly — pinned to Montreal (northamerica-northeast1)
    const vertexUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

    console.log(`[cashflow-analyst] Calling Vertex AI in ${REGION} with model ${MODEL}`);

    const aiResponse = await fetchWithVertexRetry(vertexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: SYSTEM_PROMPT + "\n\n" + userPrompt }] },
        ],
        generationConfig: withThinking(MODEL, { temperature: 0.1, maxOutputTokens: 16000, responseMimeType: "application/json" }, "medium"),
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error(`[cashflow-analyst] Vertex AI error ${aiResponse.status}:`, errText);
      throw new Error("AI analysis failed: " + errText);
    }

    const aiResult = await aiResponse.json();
    // 3.x models can return thought parts ahead of the answer; join only the answer parts.
    // deno-lint-ignore no-explicit-any
    const rawContent = ((aiResult.candidates?.[0]?.content?.parts || []) as any[])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("") || "";

    // Clean markdown fences, and strip trailing commas before a closing } or ] —
    // models routinely emit them despite instructions not to, and strict JSON.parse rejects them.
    let jsonStr = rawContent
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const firstBrace = jsonStr.indexOf("{");
    const lastBrace = jsonStr.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    jsonStr = jsonStr.replace(/,(\s*[}\]])/g, "$1");
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error("Failed to parse AI response as JSON: " + jsonStr.slice(0, 300));
    }

    // Save the analysis to the database
    const { data: analysis, error: insertErr } = await adminClient
      .from("cashflow_analyses")
      .insert({
        household_id: householdId,
        created_by: user.id,
        status: "complete",
        period_start: parsed.period_start || null,
        period_end: parsed.period_end || null,
        burn_rate: parsed.burn_rate || {},
        liquidity_status: parsed.liquidity_status || {},
        category_breakdown: parsed.category_breakdown || {},
        outliers: parsed.outliers || [],
        proposed_tasks: parsed.proposed_tasks || [],
        logic_trace: parsed.logic_trace || null,
        raw_report: rawContent,
        file_paths: filePaths,
      })
      .select("id")
      .single();

    if (insertErr) throw new Error("Failed to save analysis: " + insertErr.message);

    return new Response(
      JSON.stringify({
        success: true,
        analysisId: analysis?.id,
        result: parsed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("cashflow-analyst error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
