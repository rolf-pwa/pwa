import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_EXTRACT_MODEL, withThinking, fetchWithVertexRetry } from "../_shared/vertex-ai.ts";

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

// ---------- Vertex AI Auth ----------

const REGION = "northamerica-northeast1";
const MODEL = GEMINI_EXTRACT_MODEL;

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

function normalizeAccountToken(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getSnapshotDate(input?: string | null) {
  if (!input) return new Date().toISOString().slice(0, 10);
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString().slice(0, 10) : parsed.toISOString().slice(0, 10);
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
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${enc(header)}.${enc(payload)}`;
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned)
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
    // Domain check
    if (!user.email?.toLowerCase().endsWith("@prosperwise.ca")) {
      return new Response(JSON.stringify({ error: "Access denied: unauthorized domain" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { contactId, householdId, filePath, contactName } = await req.json();
    if (!contactId || !filePath) throw new Error("Missing contactId or filePath");

    // Download the file from storage
    const { data: fileData, error: dlErr } = await adminClient.storage
      .from("statement-uploads")
      .download(filePath);
    if (dlErr || !fileData) throw new Error("Failed to download file: " + dlErr?.message);

    // Convert to base64 for AI processing
    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = (() => {
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    })();

    // Vertex AI call — pinned to Montreal
    const gcpKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!gcpKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    const sa: ServiceAccountKey = JSON.parse(gcpKeyRaw);
    const accessToken = await getAccessToken(sa);

    const vertexUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

    console.log(`[ingest-statement] Calling Vertex AI in ${REGION}`);

    const systemContent = `You are a financial statement parser for a Canadian family office. Extract investment/brokerage account data from the uploaded document.
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
- "statement_date" should be the statement end date or valuation date shown on the document
- "book_value" is the beginning-of-year value, cost basis, or original investment amount
- "current_harvest" is the year-to-date gain/loss, growth, or harvest amount if shown; otherwise calculate it from current value minus BOY when possible
- "current_value" is the most recent market value shown
- Extract the account owner name from the statement header/title
- Identify the custodian/institution from the statement branding
- Use null for any values you cannot confidently extract
- Return ONLY the JSON, no markdown`;

    const aiResponse = await fetchWithVertexRetry(vertexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: systemContent + `\n\nParse this financial statement for ${contactName || "the client"}. Extract all investment accounts.` },
              { inlineData: { mimeType: "application/pdf", data: base64 } },
            ],
          },
        ],
        generationConfig: withThinking(MODEL, { temperature: 0.1, maxOutputTokens: 4000 }, "minimal"),
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error("AI parsing failed: " + errText);
    }

    const aiResult = await aiResponse.json();
    const rawContent = aiResult.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Clean any markdown fences, and strip trailing commas before a closing } or ] —
    // models routinely emit them despite instructions not to, and strict JSON.parse rejects them.
    const jsonStr = rawContent
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim()
      .replace(/,(\s*[}\]])/g, "$1");
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error("Failed to parse AI response as JSON: " + jsonStr.slice(0, 200));
    }

    const snapshotDate = getSnapshotDate(parsed.statement_date);
    const { data: existingVineyard } = await adminClient
      .from("vineyard_accounts")
      .select("id, account_name, account_number, book_value, current_value")
      .eq("contact_id", contactId);
    const { data: existingStorehouses } = await adminClient
      .from("storehouses")
      .select("id, label, asset_type, book_value, current_value")
      .eq("contact_id", contactId);

    const vineyardByNumber = new Map((existingVineyard || [])
      .filter((item) => item.account_number)
      .map((item) => [normalizeAccountToken(item.account_number), item]));
    const vineyardByName = new Map((existingVineyard || []).map((item) => [normalizeAccountToken(item.account_name), item]));
    const storehouseByName = new Map((existingStorehouses || []).flatMap((item) => {
      const tokens = [item.label, item.asset_type].filter(Boolean).map((value) => normalizeAccountToken(value));
      return tokens.map((token) => [token, item] as const);
    }));

    let snapshotUpdates = 0;
    const unmatchedAccounts = [];

    // Insert extracted accounts into the Holding Tank and/or tracking snapshots
    const insertedAccounts = [];
    for (const account of parsed.accounts || []) {
      const normalizedNumber = normalizeAccountToken(account.account_number);
      const normalizedName = normalizeAccountToken(account.account_name);
      const matchedVineyard = (normalizedNumber && vineyardByNumber.get(normalizedNumber)) || vineyardByName.get(normalizedName);
      const matchedStorehouse = storehouseByName.get(normalizedName);
      const matchedAccount = matchedVineyard || matchedStorehouse;
      const boyValue = account.book_value ?? 0;
      const currentValue = account.current_value ?? 0;
      const currentHarvest = account.current_harvest ?? (currentValue - boyValue);

      if (matchedAccount) {
        const isVineyard = "account_name" in matchedAccount;
        const idColumn = isVineyard ? "vineyard_account_id" : "storehouse_id";
        const sourceTable = isVineyard ? "vineyard_accounts" : "storehouses";

        const { data: existingSnapshot } = await adminClient
          .from("account_harvest_snapshots")
          .select("id")
          .eq(idColumn, matchedAccount.id)
          .eq("snapshot_date", snapshotDate)
          .maybeSingle();

        const snapshotPayload = {
          contact_id: contactId,
          snapshot_date: snapshotDate,
          boy_value: boyValue,
          ytd_value: currentValue,
          current_harvest: currentHarvest,
          current_value: currentValue,
          notes: account.notes || null,
          vineyard_account_id: isVineyard ? matchedAccount.id : null,
          storehouse_id: isVineyard ? null : matchedAccount.id,
        };

        const snapshotQuery = existingSnapshot?.id
          ? adminClient.from("account_harvest_snapshots").update(snapshotPayload).eq("id", existingSnapshot.id)
          : adminClient.from("account_harvest_snapshots").insert(snapshotPayload);

        const { error: snapshotErr } = await snapshotQuery;
        if (!snapshotErr) {
          snapshotUpdates += 1;
          await adminClient
            .from(sourceTable)
            .update({ book_value: boyValue, current_value: currentValue })
            .eq("id", matchedAccount.id);
          continue;
        }
      }

      unmatchedAccounts.push(account.account_name);
      const { data: htItem, error: htErr } = await adminClient
        .from("holding_tank")
        .insert({
          contact_id: contactId,
          household_id: householdId || null,
          account_name: account.account_name,
          account_number: account.account_number,
          account_type: account.account_type || "Portfolio",
          account_owner: account.account_owner,
          custodian: account.custodian,
          book_value: account.book_value,
          current_value: account.current_value,
          notes: account.notes,
          source_file: filePath,
          status: "holding",
        })
        .select("id")
        .single();
      if (!htErr && htItem) insertedAccounts.push(htItem);
    }

    // Create a review queue item
    await adminClient.from("review_queue").insert({
      action_type: "statement_ingestion",
      action_description: `Parsed ${insertedAccounts.length} account(s) from statement into Holding Tank${parsed.summary ? `: ${parsed.summary}` : ""}`,
      contact_id: contactId,
      created_by: user.id,
      proposed_data: {
        holding_tank_ids: insertedAccounts.map((a: any) => a.id),
        harvest_snapshot_updates: snapshotUpdates,
        unmatched_accounts: unmatchedAccounts,
        summary: parsed.summary,
        missing_fields: parsed.missing_fields || [],
      },
      logic_trace: `AI extracted ${parsed.accounts?.length || 0} accounts from uploaded statement. Harvest snapshots updated: ${snapshotUpdates}. Holding tank inserts: ${insertedAccounts.length}. File: ${filePath}. Missing fields: ${(parsed.missing_fields || []).join(", ") || "none"}`,
      status: "pending",
    });

    return new Response(
      JSON.stringify({
        success: true,
        accountsExtracted: parsed.accounts?.length || 0,
        accountsInserted: insertedAccounts.length,
        harvestSnapshotsUpdated: snapshotUpdates,
        unmatchedAccounts,
        missingFields: parsed.missing_fields || [],
        summary: parsed.summary,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("ingest-statement error:", err);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
