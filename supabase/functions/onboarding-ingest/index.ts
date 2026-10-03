import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GEMINI_FLASH_MODEL, withThinking } from "../_shared/vertex-ai.ts";

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

const REGION = "northamerica-northeast1";
const MODEL = GEMINI_FLASH_MODEL;

interface ServiceAccountKey {
  type: string;
  project_id: string;
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

    const { filePaths, familyName } = await req.json();
    if (!filePaths || !filePaths.length) throw new Error("No files provided");

    // Download and convert all files to base64
    const fileContents: Array<{ path: string; base64: string }> = [];
    for (const fp of filePaths) {
      const { data: fileData, error: dlErr } = await adminClient.storage
        .from("statement-uploads")
        .download(fp);
      if (dlErr || !fileData) throw new Error("Failed to download: " + fp);
      const ab = await fileData.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const b64 = btoa(binary);
      fileContents.push({ path: fp, base64: b64 });
    }

    // Vertex AI call — pinned to Montreal
    const gcpKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!gcpKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    const sa: ServiceAccountKey = JSON.parse(gcpKeyRaw);
    const accessToken = await getAccessToken(sa);

    const vertexUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${sa.project_id}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

    console.log(`[onboarding-ingest] Calling Vertex AI in ${REGION} with ${fileContents.length} file(s)`);

    const userText = `Parse these ${fileContents.length} financial statement(s) for a new client onboarding. Extract ALL individuals mentioned, their contact information, and every investment account.

Return a JSON object with this exact structure:
{
  "family_name": "Suggested family name based on primary account holder",
  "individuals": [
    {
      "full_name": "Full legal name",
      "first_name": "First name",
      "last_name": "Last name or null",
      "email": "Email if found or null",
      "phone": "Phone if found or null",
      "address": "Full mailing address or null",
      "is_primary": true/false,
      "relationship_hint": "e.g. spouse, child, joint holder, or null"
    }
  ],
  "accounts": [
    {
      "account_name": "Institution - Account Type",
      "account_number": "string or null",
      "account_type": "Portfolio|RRSP|TFSA|RESP|LIRA|LIF|Corporate|Trust|Other",
      "account_owner_name": "Full name of owner",
      "custodian": "Financial institution name",
      "book_value": number or null,
      "current_value": number or null,
      "notes": "Classification notes",
      "source_file_index": 0
    }
  ],
  "summary": "Brief summary"
}

Guidelines:
- Extract EVERY individual mentioned (account holders, beneficiaries, spouses, joint holders)
- Do NOT include dealer firms or financial institutions as individuals
- Only include actual human persons
- Return ONLY valid JSON, no markdown fences`;

    const contentParts: any[] = [{ text: userText }];
    for (const fc of fileContents) {
      contentParts.push({ inlineData: { mimeType: "application/pdf", data: fc.base64 } });
    }

    const aiResponse = await fetch(vertexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: contentParts }],
        generationConfig: withThinking(MODEL, { temperature: 0.1, maxOutputTokens: 16000 }, "minimal"),
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error(`[onboarding-ingest] Vertex AI error ${aiResponse.status}:`, errText);
      throw new Error("AI parsing failed: " + errText);
    }

    const aiResult = await aiResponse.json();
    const rawContent = aiResult.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // Trailing-comma strip handles the common "model emitted valid-but-strict-invalid JSON"
    // case; the catch block below still handles genuinely truncated JSON separately.
    const jsonStr = rawContent
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim()
      .replace(/,(\s*[}\]])/g, "$1");

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Repair truncated JSON
      let repaired = jsonStr;
      const openBraces = (repaired.match(/{/g) || []).length - (repaired.match(/}/g) || []).length;
      const openBrackets = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
      repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*[^,}\]]*$/, "");
      for (let i = 0; i < openBrackets; i++) repaired += "]";
      for (let i = 0; i < openBraces; i++) repaired += "}";
      try {
        parsed = JSON.parse(repaired);
        console.log("Repaired truncated JSON successfully");
      } catch {
        throw new Error("Failed to parse AI response: " + jsonStr.slice(0, 300));
      }
    }

    const finalFamilyName = familyName || parsed.family_name || "New Family";

    // Create Family
    const { data: family, error: famErr } = await adminClient
      .from("families").insert({ name: finalFamilyName, created_by: user.id }).select("id").single();
    if (famErr) throw new Error("Failed to create family: " + famErr.message);

    // Create Household
    const { data: household, error: hhErr } = await adminClient
      .from("households").insert({ family_id: family.id, label: "Primary" }).select("id").single();
    if (hhErr) throw new Error("Failed to create household: " + hhErr.message);

    // Create Contacts
    const contactMap: Record<string, string> = {};
    const createdContacts: any[] = [];

    for (const individual of parsed.individuals || []) {
      const { data: contact, error: cErr } = await adminClient.from("contacts").insert({
        full_name: individual.full_name || `${individual.first_name} ${individual.last_name || ""}`.trim(),
        first_name: individual.first_name || individual.full_name?.split(" ")[0] || "",
        last_name: individual.last_name || individual.full_name?.split(" ").slice(1).join(" ") || null,
        email: individual.email || null,
        phone: individual.phone || null,
        address: individual.address || null,
        family_id: family.id,
        household_id: household.id,
        family_role: individual.is_primary ? "head_of_family" : "beneficiary",
        created_by: user.id,
      }).select("id, full_name").single();

      if (!cErr && contact) {
        contactMap[individual.full_name?.toLowerCase() || ""] = contact.id;
        contactMap[(individual.account_owner_name || individual.full_name || "").toLowerCase()] = contact.id;
        createdContacts.push(contact);
      }
    }

    if (createdContacts.length === 0) {
      const { data: placeholder, error: phErr } = await adminClient.from("contacts").insert({
        full_name: finalFamilyName,
        first_name: finalFamilyName.split(" ")[0],
        last_name: finalFamilyName.split(" ").slice(1).join(" ") || null,
        family_id: family.id, household_id: household.id,
        family_role: "head_of_family", created_by: user.id,
      }).select("id, full_name").single();
      if (!phErr && placeholder) {
        createdContacts.push(placeholder);
        contactMap["default"] = placeholder.id;
      }
    }

    // Create Holding Tank entries
    const insertedAccounts: any[] = [];
    const primaryContactId = createdContacts[0]?.id;

    for (const account of parsed.accounts || []) {
      const ownerKey = (account.account_owner_name || "").toLowerCase();
      let contactId = contactMap[ownerKey];
      if (!contactId) {
        for (const [key, id] of Object.entries(contactMap)) {
          if (key !== "default" && (ownerKey.includes(key) || key.includes(ownerKey))) {
            contactId = id; break;
          }
        }
      }
      contactId = contactId || contactMap["default"] || primaryContactId;

      const { data: htItem, error: htErr } = await adminClient.from("holding_tank").insert({
        contact_id: contactId, household_id: household.id,
        account_name: account.account_name, account_number: account.account_number,
        account_type: account.account_type || "Portfolio", account_owner: account.account_owner_name,
        custodian: account.custodian, book_value: account.book_value,
        current_value: account.current_value, notes: account.notes,
        source_file: filePaths[account.source_file_index ?? 0] || filePaths[0], status: "holding",
      }).select("id").single();

      if (!htErr && htItem) insertedAccounts.push(htItem);
    }

    await adminClient.from("review_queue").insert({
      action_type: "onboarding_ingestion",
      action_description: `Onboarded ${finalFamilyName}: ${createdContacts.length} contact(s), ${insertedAccounts.length} account(s) staged`,
      family_id: family.id, created_by: user.id,
      proposed_data: {
        family_id: family.id, household_id: household.id,
        contact_ids: createdContacts.map((c: any) => c.id),
        holding_tank_ids: insertedAccounts.map((a: any) => a.id),
        summary: parsed.summary,
      },
      logic_trace: `AI parsed ${filePaths.length} statement(s). ${parsed.individuals?.length || 0} individuals, ${parsed.accounts?.length || 0} accounts. Family: ${finalFamilyName}.`,
      status: "pending",
    });

    return new Response(
      JSON.stringify({
        success: true,
        family: { id: family.id, name: finalFamilyName },
        household: { id: household.id },
        contacts: createdContacts,
        accountsExtracted: parsed.accounts?.length || 0,
        accountsInserted: insertedAccounts.length,
        summary: parsed.summary,
        parsedData: parsed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("onboarding-ingest error:", err);
    const corsHeaders = getCorsHeaders(req);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
