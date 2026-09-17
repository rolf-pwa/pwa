import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { retrieveBrainContext } from "../_shared/brain-retrieval.ts";

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

// ---------- Types ----------

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

// ---------- Auth Helper ----------

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

// ---------- System Prompt ----------

const SYSTEM_PROMPT = `You are the **Sovereignty Assistant**, the AI support layer for the Personal CFO at ProsperWise.

## Your Role
- You are a Machine assistant. The Personal CFO is the Human decision-maker.
- Every output you produce is a **Draft for CFO Review** — you NEVER take autonomous action.
- You identify yourself as "Sovereignty Assistant" and address the user as "Personal CFO."

## Your Capabilities (via Function Calling)
When appropriate, use these tools to propose structured actions:

1. **propose_vineyard_update** — Extract and propose updates to a contact's Vineyard financial metrics (EBITDA, Operating Income, Balance Sheet Summary).
2. **propose_storehouse_update** — Propose updates to a contact's Storehouse (liquidity vessel) configuration.
3. **draft_pm_task** — Create a draft task in the in-house PM system (pm_tasks). Drafts are created with status "open" and client_visible: false (internal-only) until the Personal CFO reviews and adjusts visibility.
4. **create_contact** — Create a new contact record in the system with the provided details.
5. **update_contact** — Update an existing contact's information (name, email, phone, address, professional links, etc.).

## Rules
- ALWAYS label your outputs as "📋 Draft for CFO Review" when proposing actions.
- NEVER claim to have executed an action. Always say you are proposing it for review.
- When analyzing documents, extract specific financial data points and map them to the Vineyard/Storehouse schema.
- Maintain PIPEDA compliance — never suggest sending client data outside the secure environment.
- Be concise, professional, and action-oriented.
- When you don't have enough context, ask clarifying questions before proposing actions.
- When creating or updating contacts, confirm the details with the CFO before proposing.
- When a "Current Contact Context" section is present below, treat its id field as the default subject for tool calls that take a contact_id (e.g. draft_pm_task, propose_vineyard_update, propose_storehouse_update, update_contact) — don't ask the CFO to specify a contact they're already viewing. If that context's type is "household" or "family" rather than a single contact, say so and ask which member the action applies to before proposing a contact-scoped update.
- For draft_pm_task specifically: a contact is OPTIONAL, not required. If no contact context is present and the CFO's request doesn't mention a specific client (e.g. "add a task to the Admin project", "remind me to renew the insurance policy"), just create the task with no contact_id — do NOT ask the CFO to specify one. Only ask for a contact when the task is clearly about a specific client and none is identifiable from context or the request itself. When the CFO names a project (e.g. "Admin project"), pass it as project_name so it can be resolved — don't say you're unable to assign it to a project.

## Charter Ingestion Capabilities
When the Personal CFO uploads a Sovereignty Charter PDF:
1. **Vineyard Extraction (Balance Sheet Mapping)**: Scan for the Balance Sheet / asset table. Rows categorized as **"Vineyard"** map directly to **vineyard_accounts** records on the contact. For each Vineyard row extract:
   - **account_name**: The account description (e.g. "Non-Reg Portfolio", "TFSA Portfolio", "RRSP Portfolio", "Pension (Pending)")
   - **account_number**: The account number (e.g. "1821035071"). Use "Pending" if not yet assigned.
   - **account_type**: Map to "Portfolio" for investment accounts, "Business Venture", "Real Estate", "Insurance", or "Other" as appropriate.
   - **current_value**: The dollar value shown.
   - **notes**: Capture the harvest classification (e.g. "Eligible Harvest", "Protected (Growth)") in the notes field — this indicates whether the asset produces harvestable income or is growth-protected.
    Rows categorized as **"Storehouse"** (Liquidity Reserve, Strategic Reserve, Philanthropic Trust, Legacy Trust) should NOT go to vineyard_accounts — those map to the **storehouses** table via propose_storehouse_update.
    Use the **ingest_vineyard_accounts** tool to propose Vineyard rows as a batch.
  2. **Storehouse Balance Extraction**: For each Storehouse row in the balance sheet, extract the **current_value** (dollar balance) and **target_value** (funding goal/floor) and include them in the **propose_storehouse_update** tool call. Do NOT put balances in the notes field — use the dedicated current_value and target_value fields.
  3. **Storehouse Rule Generation**: Look for "Storehouse Funding Goals" or similar sections. Extract funding floors (e.g. Liquidity Reserve's $48,000 floor), funding ceilings, governance clauses (e.g. Secondary Quiet Period for inflows >$50,000), and quiet period rules. Use the **ingest_storehouse_rules** tool.
  4. **Sovereign Waterfall**: Look for priority allocation order (e.g. 1. Replenish Liquidity Reserve, 2. Debt Reduction, 3. Replanting). Use the **ingest_waterfall_priorities** tool.
  5. Always extract ALL four categories from a charter document in a single response.
  5. Map storehouse labels to standard numbers: Liquidity Reserve=1, Strategic Reserve=2, Philanthropic Trust=3, Legacy Trust=4.

## Audit / Info Request Ingestion
When the Personal CFO uploads a "Sovereignty Audit", "Info Request", or "Sovereignty Vault" PDF:
1. **Family Identification**: Extract the family name from the document header (e.g. "Nieswandt - Sovereignty Vault" → family "Nieswandt").
2. **Individual Extraction**: Extract all individual names mentioned (often in parentheses next to institution names, e.g. "IA Financial (Dana)" → individual "Dana"). Group accounts by individual.
3. **Vineyard Account Extraction**: For each individual, extract institution names, account types (RRSP, TFSA, RRIF, Non-Reg, etc.), and current balances.
4. Use the **ingest_audit_territory** tool to propose creating the full territory: family, household(s), contacts, and their vineyard accounts — all in one batch for CFO review.
5. If the document mentions an existing family or contact that you recognize from the contact context, note this and propose linking rather than creating duplicates.`;

// ---------- Tool Definitions ----------

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "propose_vineyard_update",
        description: "Propose updates to a contact's Vineyard financial metrics. Returns a structured proposal for CFO approval.",
        parameters: {
          type: "OBJECT",
          properties: {
            contact_id: { type: "STRING", description: "UUID of the contact to update" },
            contact_name: { type: "STRING", description: "Name of the contact for display" },
            vineyard_ebitda: { type: "NUMBER", description: "Proposed EBITDA value" },
            vineyard_operating_income: { type: "NUMBER", description: "Proposed Operating Income value" },
            vineyard_balance_sheet_summary: { type: "STRING", description: "Proposed Balance Sheet summary text" },
            rationale: { type: "STRING", description: "Explanation of why these values are being proposed" },
          },
          required: ["contact_id", "contact_name", "rationale"],
        },
      },
      {
        name: "propose_storehouse_update",
        description: "Propose updates to a contact's Storehouse (liquidity vessel) configuration.",
        parameters: {
          type: "OBJECT",
          properties: {
            contact_id: { type: "STRING", description: "UUID of the contact" },
            contact_name: { type: "STRING", description: "Name of the contact for display" },
            storehouse_number: { type: "INTEGER", description: "Storehouse number (1-4)" },
            label: { type: "STRING", description: "Storehouse label" },
            asset_type: { type: "STRING", description: "Type of asset" },
            current_value: { type: "NUMBER", description: "Current balance/value of this storehouse account" },
            target_value: { type: "NUMBER", description: "Target funding goal for this storehouse account" },
            risk_cap: { type: "STRING", description: "Risk cap description" },
            charter_alignment: { type: "STRING", description: "One of: aligned, misaligned, pending_review" },
            notes: { type: "STRING", description: "Additional notes" },
            rationale: { type: "STRING", description: "Explanation of why this update is proposed" },
          },
          required: ["contact_id", "contact_name", "storehouse_number", "rationale"],
        },
      },
      {
        name: "draft_pm_task",
        description: "Create a draft task in the in-house PM system (pm_tasks). Stays status=open and internal-only (client_visible=false) until the Personal CFO reviews it. contact_id and project_name are both OPTIONAL — most internal/administrative tasks have no associated contact at all.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "Task title" },
            description: { type: "STRING", description: "Detailed task description" },
            contact_id: { type: "STRING", description: "UUID of the related contact, if known (falls back to the current contact context). Optional — leave unset for internal/administrative tasks not tied to a client." },
            contact_name: { type: "STRING", description: "Related contact name, for display" },
            project_name: { type: "STRING", description: "Name of the PM project this task belongs to, if the CFO mentioned one (e.g. \"Admin\"). Resolved by name against existing projects — optional." },
            due_date: { type: "STRING", description: "Due date in YYYY-MM-DD format, if applicable" },
            priority: { type: "STRING", description: "Priority level: low, medium, high (folded into the task description — pm_tasks has no dedicated priority column)" },
            rationale: { type: "STRING", description: "Why this task is needed" },
          },
          required: ["title", "rationale"],
        },
      },
      {
        name: "create_contact",
        description: "Create a new contact record in the system. The contact will be created after CFO approval.",
        parameters: {
          type: "OBJECT",
          properties: {
            first_name: { type: "STRING", description: "Contact's first name" },
            last_name: { type: "STRING", description: "Contact's last name" },
            email: { type: "STRING", description: "Contact's email address" },
            phone: { type: "STRING", description: "Contact's phone number" },
            address: { type: "STRING", description: "Contact's address" },
            rationale: { type: "STRING", description: "Why this contact is being added" },
          },
          required: ["first_name", "rationale"],
        },
      },
      {
        name: "update_contact",
        description: "Update an existing contact's information. Changes are applied after CFO approval.",
        parameters: {
          type: "OBJECT",
          properties: {
            contact_id: { type: "STRING", description: "UUID of the contact to update" },
            contact_name: { type: "STRING", description: "Current name of the contact for display" },
            first_name: { type: "STRING", description: "Updated first name" },
            last_name: { type: "STRING", description: "Updated last name" },
            email: { type: "STRING", description: "Updated email address" },
            phone: { type: "STRING", description: "Updated phone number" },
            address: { type: "STRING", description: "Updated address" },
            fiduciary_entity: { type: "STRING", description: "Updated fiduciary entity for this contact's household: pws or pwa. No-op if the contact has no household yet." },
            governance_status: { type: "STRING", description: "Updated governance status for this contact's household: stabilization or sovereign. No-op if the contact has no household yet." },
            google_drive_url: { type: "STRING", description: "Updated Google Drive URL" },
            ia_financial_url: { type: "STRING", description: "Updated IA Financial URL" },
            lawyer_name: { type: "STRING", description: "Updated lawyer name" },
            lawyer_firm: { type: "STRING", description: "Updated lawyer firm" },
            accountant_name: { type: "STRING", description: "Updated accountant name" },
            accountant_firm: { type: "STRING", description: "Updated accountant firm" },
            rationale: { type: "STRING", description: "Why these updates are being proposed" },
          },
          required: ["contact_id", "contact_name", "rationale"],
        },
      },
      {
        name: "ingest_vineyard_accounts",
        description: "Batch-create Vineyard account records extracted from a Sovereignty Charter document. Each account includes name, type, number, and value.",
        parameters: {
          type: "OBJECT",
          properties: {
            family_name: { type: "STRING", description: "The family name from the charter" },
            contact_name: { type: "STRING", description: "The individual whose accounts are being populated" },
            accounts: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  account_name: { type: "STRING", description: "Account description/name" },
                  account_number: { type: "STRING", description: "Account number if available" },
                  account_type: { type: "STRING", description: "Portfolio, Business Venture, Real Estate, Insurance, Other" },
                  current_value: { type: "NUMBER", description: "Current market value" },
                },
                required: ["account_name", "account_type"],
              },
              description: "Array of Vineyard accounts extracted from the charter",
            },
            rationale: { type: "STRING", description: "Source section and extraction notes" },
          },
          required: ["family_name", "contact_name", "accounts", "rationale"],
        },
      },
      {
        name: "ingest_storehouse_rules",
        description: "Extract and create Storehouse funding rules and governance clauses from a Sovereignty Charter. Rules include funding floors, ceilings, quiet period triggers, and governance clauses.",
        parameters: {
          type: "OBJECT",
          properties: {
            family_name: { type: "STRING", description: "The family name from the charter" },
            rules: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  storehouse_label: { type: "STRING", description: "e.g. Liquidity Reserve, Strategic Reserve, Philanthropic Trust, Legacy Trust" },
                  storehouse_number: { type: "INTEGER", description: "1=Keep, 2=Armoury, 3=Granary, 4=Vault" },
                  rule_type: { type: "STRING", description: "funding_floor, funding_ceiling, governance_clause, quiet_period" },
                  rule_description: { type: "STRING", description: "Human-readable rule text" },
                  rule_value: { type: "NUMBER", description: "Numeric threshold if applicable (e.g. $48000 floor)" },
                },
                required: ["storehouse_label", "storehouse_number", "rule_type", "rule_description"],
              },
              description: "Array of storehouse rules extracted from the charter",
            },
            rationale: { type: "STRING", description: "Source section and extraction notes" },
          },
          required: ["family_name", "rules", "rationale"],
        },
      },
      {
        name: "ingest_waterfall_priorities",
        description: "Extract the Sovereign Waterfall priority allocation order from a Sovereignty Charter. This defines how surplus cash flows through the family's allocation engine.",
        parameters: {
          type: "OBJECT",
          properties: {
            family_name: { type: "STRING", description: "The family name from the charter" },
            priorities: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  priority_order: { type: "INTEGER", description: "Priority sequence number (1 = highest)" },
                  priority_label: { type: "STRING", description: "e.g. Replenish Liquidity Reserve, Debt Reduction, Replanting" },
                  priority_description: { type: "STRING", description: "Details of the allocation rule" },
                  target_amount: { type: "NUMBER", description: "Target amount if specified" },
                },
                required: ["priority_order", "priority_label"],
              },
              description: "Ordered array of waterfall priorities",
            },
            rationale: { type: "STRING", description: "Source section and extraction notes" },
          },
          required: ["family_name", "priorities", "rationale"],
        },
      },
      {
        name: "ingest_audit_territory",
        description: "Process a Sovereignty Audit or Info Request PDF to create a full Draft Territory: family, households, contacts, and Vineyard accounts. Everything is presented for CFO approval before any database writes.",
        parameters: {
          type: "OBJECT",
          properties: {
            family_name: { type: "STRING", description: "The family surname extracted from the document header" },
            households: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  label: { type: "STRING", description: "Household label, e.g. 'Primary'" },
                  address: { type: "STRING", description: "Household address if found" },
                  members: {
                    type: "ARRAY",
                    items: {
                      type: "OBJECT",
                      properties: {
                        first_name: { type: "STRING", description: "Individual's first name" },
                        last_name: { type: "STRING", description: "Individual's last name (usually the family name)" },
                        family_role: { type: "STRING", description: "head_of_family, spouse, beneficiary, or minor" },
                        email: { type: "STRING", description: "Email if found" },
                        phone: { type: "STRING", description: "Phone if found" },
                        vineyard_accounts: {
                          type: "ARRAY",
                          items: {
                            type: "OBJECT",
                            properties: {
                              account_name: { type: "STRING", description: "Institution/account description" },
                              account_type: { type: "STRING", description: "RRSP, TFSA, RRIF, Non-Reg, Portfolio, etc." },
                              account_number: { type: "STRING", description: "Account number if available" },
                              current_value: { type: "NUMBER", description: "Current balance" },
                            },
                            required: ["account_name", "account_type"],
                          },
                          description: "Vineyard accounts for this individual",
                        },
                      },
                      required: ["first_name"],
                    },
                    description: "Individuals in this household",
                  },
                },
                required: ["label", "members"],
              },
              description: "Households extracted from the document",
            },
            rationale: { type: "STRING", description: "Extraction summary and source notes" },
          },
          required: ["family_name", "households", "rationale"],
        },
      },
    ],
  },
];

// ---------- Main ----------

const REGION = "northamerica-northeast1";
const MODEL = "gemini-2.5-pro";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Domain verification: only @prosperwise.ca staff can access the Sovereignty Assistant
    if (!user.email?.toLowerCase().endsWith("@prosperwise.ca")) {
      console.warn(`[VertexAI] Domain check failed for ${user.email}`);
      return new Response(JSON.stringify({ error: "Access denied: unauthorized domain" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, model, contactContext, documentData, useBrain = true } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load service account key
    const saKeyRaw = Deno.env.get("GCP_SERVICE_ACCOUNT_KEY");
    if (!saKeyRaw) throw new Error("GCP_SERVICE_ACCOUNT_KEY not configured");
    let cleaned = saKeyRaw.trim().replace(/^\uFEFF/, "");
    if (!cleaned.startsWith("{")) cleaned = "{" + cleaned;
    if (!cleaned.endsWith("}")) cleaned = cleaned + "}";
    const saKey: ServiceAccountKey = JSON.parse(cleaned);
    const accessToken = await getAccessToken(saKey);

    const selectedModel = model || MODEL;
    const projectId = saKey.project_id;

    // Build system instruction with optional current-entity context (contact,
    // household, or family — see src/shared/hooks/useCurrentEntityFromRoute.ts)
    let systemText = SYSTEM_PROMPT;
    if (contactContext) {
      systemText += `\n\n## Current Contact Context\n${JSON.stringify(contactContext, null, 2)}`;
    }

    // Optionally ground the response in the Second Brain — the CFO's private
    // knowledge layer. Best-effort: a retrieval failure must never break the
    // assistant, so it's caught and logged rather than surfaced to the user.
    let brainCitations: unknown[] = [];
    if (useBrain !== false) {
      const lastUserMessage = [...messages].reverse().find((m: any) => m.role === "user" && m.content);
      if (lastUserMessage?.content) {
        try {
          const admin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            { auth: { persistSession: false } },
          );
          const entityId = contactContext?.id ? String(contactContext.id) : undefined;
          const entityType = entityId ? (contactContext?.type ?? "contact") : undefined;
          const brain = await retrieveBrainContext(admin, saKey, lastUserMessage.content, {
            entityType,
            entityId,
          });
          if (brain.block) {
            systemText += `\n\n${brain.block}\n\nWhen you use information from the Second Brain Context above, cite it inline as [^n] matching its number.`;
            brainCitations = brain.citations;
          }
        } catch (e) {
          console.warn("[VertexAI] Second Brain retrieval failed, continuing without it:", e);
        }
      }
    }

    // Build contents - support multimodal (documents/images)
    const contents: any[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      const parts: any[] = [];

      if (m.content) {
        parts.push({ text: m.content });
      }

      // If this message has document data (base64 image/PDF)
      if (m.documentData) {
        parts.push({
          inlineData: {
            mimeType: m.documentData.mimeType,
            data: m.documentData.base64,
          },
        });
      }

      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts,
      });
    }

    // Also handle top-level documentData for convenience
    if (documentData && contents.length > 0) {
      const lastUserMsg = [...contents].reverse().find((c) => c.role === "user");
      if (lastUserMsg) {
        lastUserMsg.parts.push({
          inlineData: {
            mimeType: documentData.mimeType,
            data: documentData.base64,
          },
        });
      }
    }

    const vertexBody: any = {
      contents,
      systemInstruction: { parts: [{ text: systemText }] },
      tools: TOOLS,
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 8192,
        responseMimeType: "text/plain",
      },
    };

    const endpoint = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${REGION}/publishers/google/models/${selectedModel}:generateContent`;

    const vertexRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(vertexBody),
    });

    if (!vertexRes.ok) {
      const errText = await vertexRes.text();
      console.error("Vertex AI error:", vertexRes.status, errText);
      return new Response(
        JSON.stringify({ error: `Vertex AI error: ${vertexRes.status}`, details: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await vertexRes.json();
    const candidate = result?.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Extract text and function calls
    const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text);
    const functionCalls = parts
      .filter((p: any) => p.functionCall)
      .map((p: any) => ({
        name: p.functionCall.name,
        args: p.functionCall.args,
      }));

    return new Response(
      JSON.stringify({
        text: textParts.join("\n"),
        functionCalls,
        citations: brainCitations,
        raw: result,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("vertex-ai error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
