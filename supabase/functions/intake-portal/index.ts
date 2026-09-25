// Intake Portal — client-facing bridge for the Onboarding Agent.
//
// Two runtime modes:
//   INTAKE_AGENT_MODE=proxy  (default)  → forwards manifest/upload to the external agent.
//   INTAKE_AGENT_MODE=inhouse           → manifest, upload, and classification run inside this project.
//
// In in-house mode the external agent's share token NEVER reaches the browser.
// Clients authenticate with their existing portal token (x-portal-token); this
// function resolves their household and either proxies to the external agent or
// serves a manifest built from local tables (intake_classifications,
// intake_checklist_templates) and uploads files into the household's vault
// Shoebox for AI classification.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  generateVertexContent,
  parseServiceAccountKey,
} from "../_shared/vertex-ai.ts";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { driveListChildren, matchVaultCategoryFolder } from "../_shared/vault-provisioning.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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
      "authorization, x-client-info, apikey, content-type, x-portal-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MODE = Deno.env.get("INTAKE_AGENT_MODE") ?? "proxy";
const VERTEX_MODEL = "gemini-2.5-flash";
const CLASSIFY_CONFIDENCE_THRESHOLD = 0.6;

interface Resolved {
  householdId: string;
  contactId: string;
  shareToken: string | null;
  manifestUrl: string | null;
  uploadUrl: string | null;
  /** Legacy households, or households that haven't paid the Audit fee, are opted out. */
  onboardingEnabled: boolean;
  /** Why onboarding is hidden, when it is. */
  disabledReason: "legacy_client" | "audit_unpaid" | null;
  /** Staff enrolled an existing client (not a new wealth-event lead) — Step 3 asks
   *  about vision/values/purpose instead of a triggering wealth event. */
  legacyUpgrade: boolean;
}

async function resolveHousehold(req: Request): Promise<Resolved | null> {
  const portalToken = req.headers.get("x-portal-token");
  if (!portalToken) return null;
  const { data: tok } = await admin
    .from("portal_tokens")
    .select("contact_id, expires_at, revoked")
    .eq("token", portalToken)
    .maybeSingle();
  if (!tok || tok.revoked || new Date(tok.expires_at) <= new Date()) return null;

  const { data: contact } = await admin
    .from("contacts")
    .select("household_id")
    .eq("id", tok.contact_id)
    .maybeSingle();
  if (!contact?.household_id) return null;

  const { data: hh } = await admin
    .from("households")
    .select(
      "id, intake_share_token, intake_manifest_url, intake_upload_url, onboarding_enabled, legacy_intake_upgrade",
    )
    .eq("id", contact.household_id)
    .maybeSingle();
  if (!hh) return null;

  const flagOn = hh.onboarding_enabled !== false;

  // The Audit card only appears once the Audit fee is actually paid — or,
  // for an existing client staff enrolls without a new charge, once a
  // booking is marked "not_required" (see HouseholdDetail.tsx's "Enroll in
  // Guided Intake" action).
  let auditPaid = false;
  if (flagOn) {
    const { data: members } = await admin
      .from("contacts")
      .select("id")
      .eq("household_id", hh.id);
    const ids = (members ?? []).map((m: { id: string }) => m.id);
    if (ids.length) {
      const { data: paid } = await admin
        .from("service_bookings")
        .select("id")
        .in("contact_id", ids)
        .in("payment_status", ["paid", "not_required"])
        .limit(1);
      auditPaid = Boolean(paid?.length);
    }
  }

  return {
    householdId: hh.id,
    contactId: tok.contact_id,
    shareToken: hh.intake_share_token ?? null,
    manifestUrl: hh.intake_manifest_url ?? null,
    uploadUrl: hh.intake_upload_url ?? null,
    onboardingEnabled: flagOn && auditPaid,
    disabledReason: !flagOn ? "legacy_client" : auditPaid ? null : "audit_unpaid",
    legacyUpgrade: Boolean(hh.legacy_intake_upgrade),
  };
}


// ═════════════════════════════════════════════════════════════════════════════
//  PROXY MODE — existing external-agent passthrough
// ═════════════════════════════════════════════════════════════════════════════

function agentBase(): string | null {
  const raw = Deno.env.get("CRM_INTAKE_AGENT_URL");
  if (!raw) return null;
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/public\/crm\/intake$/i, "");
}

async function handleProxyManifest(
  req: Request,
  cors: Record<string, string>,
  resolved: Resolved,
): Promise<Response> {
  const base = agentBase();
  const tokenPath = resolved.shareToken ? encodeURIComponent(resolved.shareToken) : null;
  const manifestUrl =
    resolved.manifestUrl ?? (base && tokenPath ? `${base}/api/public/vault/${tokenPath}/manifest` : null);
  const uploadUrl =
    resolved.uploadUrl ?? (base && tokenPath ? `${base}/api/public/vault/${tokenPath}/upload` : null);

  const contentType = req.headers.get("content-type") ?? "";

  // ── Upload passthrough (multipart/form-data with a single `file` field) ──
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ error: "Missing file" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (file.size > 25 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "File exceeds 25MB" }), {
        status: 413,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!uploadUrl) {
      return new Response(JSON.stringify({ error: "Onboarding agent not configured" }), {
        status: 503,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const out = new FormData();
    out.append("file", file, file.name);
    const res = await fetch(uploadUrl, { method: "POST", body: out });

    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: "Unexpected response from onboarding agent" };
    }
    return new Response(JSON.stringify(body), {
      status: res.ok ? 200 : res.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // ── Manifest ──
  const payload = await req.json().catch(() => ({}));
  const action = (payload as { action?: string })?.action ?? "manifest";
  if (action !== "manifest") {
    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (!manifestUrl) {
    return new Response(JSON.stringify({ error: "Onboarding agent not configured" }), {
      status: 503,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const res = await fetch(manifestUrl, { headers: { Accept: "application/json" } });

  const text = await res.text();
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(text);
  } catch {
    console.error("[IntakePortal] non-JSON manifest:", text.slice(0, 300));
    return new Response(JSON.stringify({ error: "Unexpected response from onboarding agent" }), {
      status: 502,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (!res.ok) {
    return new Response(
      JSON.stringify({ enabled: false, reason: "agent_error", status: res.status }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  const {
    familyName,
    householdName,
    status,
    ready,
    completion,
    uploads,
    limits,
    items,
    knownItems,
    folders,
  } = manifest as Record<string, any>;

  const normalizeRequirement = (it: any): "required" | "optional" | null => {
    const raw = String(
      it?.requirement ?? it?.priority ?? it?.necessity ??
        (it?.required === true ? "required" : it?.required === false ? "optional" : it?.optional === true ? "optional" : ""),
    )
      .trim()
      .toLowerCase();
    if (["required", "mandatory", "must", "high"].includes(raw)) return "required";
    if (["optional", "nice_to_have", "nice-to-have", "recommended", "low"].includes(raw)) {
      return "optional";
    }
    return null;
  };

  const auditItems = Array.isArray((completion as any)?.audit?.items)
    ? (completion as any).audit.items
    : [];

  const checklist = auditItems.length
    ? auditItems.map((it: any) => ({
        name: it?.label ?? it?.key ?? "Document",
        category: it?.category ?? null,
        ownerInitials: null,
        subType: null,
        status: it?.satisfied ? "filed" : "waiting",
        receivedCount: typeof it?.matches === "number" ? it.matches : undefined,
        requirement: it?.critical ? "required" : "optional",
      }))
    : (Array.isArray(items) ? items : Array.isArray(knownItems) ? knownItems : [])
        .map((it: any) => ({
          name: it?.name ?? it?.label ?? "Document",
          category: it?.category ?? null,
          ownerInitials: it?.ownerInitials ?? null,
          subType: it?.subType ?? null,
          status: it?.status ?? (it?.received ? "received" : "waiting"),
          receivedCount: typeof it?.receivedCount === "number" ? it.receivedCount : undefined,
          requirement: normalizeRequirement(it),
        }))
        .filter((it: any) => it.requirement !== null);

  return new Response(
    JSON.stringify({
      enabled: true,
      familyName,
      householdName,
      status,
      ready,
      completion: completion ?? null,
      checklist,
      uploads: Array.isArray(uploads)
        ? uploads.map((u: any) => ({
            fileName: u?.fileName,
            folderName: u?.folderName,
            createdAt: u?.createdAt,
            classification: u?.classification
              ? {
                  status: u.classification.status,
                  category: u.classification.category,
                  typeTag: u.classification.typeTag,
                  identifier: u.classification.identifier,
                }
              : null,
          }))
        : [],
      limits: limits ?? null,
    }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  IN-HOUSE MODE — local manifest, upload, and Vertex AI classification
// ═════════════════════════════════════════════════════════════════════════════

async function getValidGoogleToken(): Promise<string | null> {
  const { data } = await admin
    .from("google_tokens")
    .select("access_token, token_expiry, refresh_token, user_id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.token_expiry) <= new Date(Date.now() + 60_000)) {
    const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
    const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: data.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tokens = await res.json();
    if (tokens.error) {
      console.error("[IntakePortal] token refresh failed", tokens);
      return null;
    }
    const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await admin
      .from("google_tokens")
      .update({ access_token: tokens.access_token, token_expiry: newExpiry })
      .eq("user_id", data.user_id);
    return tokens.access_token;
  }
  return data.access_token;
}

/** Refresh + return a usable access token for one staff google_tokens row. */
async function accessTokenForRow(row: any): Promise<string | null> {
  if (!row) return null;
  if (new Date(row.token_expiry) > new Date(Date.now() + 60_000)) return row.access_token;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
        client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const tokens = await res.json();
    if (tokens.error) return null;
    await admin
      .from("google_tokens")
      .update({
        access_token: tokens.access_token,
        token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      })
      .eq("user_id", row.user_id);
    return tokens.access_token;
  } catch {
    return null;
  }
}

/**
 * Look across every connected staff calendar for an upcoming event that has the
 * client's email on it — this is how we verify the Audit was actually booked
 * instead of trusting a manual "I booked it" click.
 */
async function findAuditEvent(email: string): Promise<
  { summary: string; start: string; htmlLink: string | null } | null
> {
  if (!email) return null;
  const { data: rows } = await admin
    .from("google_tokens")
    .select("access_token, token_expiry, refresh_token, user_id")
    .order("updated_at", { ascending: false });

  const timeMin = new Date(Date.now() - 2 * 3600_000).toISOString();
  const timeMax = new Date(Date.now() + 120 * 86400_000).toISOString();
  const target = email.toLowerCase();

  for (const row of rows ?? []) {
    const token = await accessTokenForRow(row);
    if (!token) continue;
    try {
      const res = await fetch(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?" +
          new URLSearchParams({
            timeMin,
            timeMax,
            maxResults: "50",
            singleEvents: "true",
            orderBy: "startTime",
            q: email,
          }),
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) continue;
      const data = await res.json();
      const match = (data.items || []).find(
        (ev: any) =>
          ev.status !== "cancelled" &&
          (ev.attendees?.some((a: any) => a.email?.toLowerCase() === target) ||
            ev.organizer?.email?.toLowerCase() === target ||
            ev.creator?.email?.toLowerCase() === target),
      );
      if (match) {
        return {
          summary: match.summary ?? "Sovereignty Survey",
          start: match.start?.dateTime ?? match.start?.date ?? new Date().toISOString(),
          htmlLink: match.htmlLink ?? null,
        };
      }
    } catch {
      // try the next calendar
    }
  }
  return null;
}



async function callVaultService(
  action: string,
  body: Record<string, unknown>,
  portalToken: string,
): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/vault-service`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-portal-token": portalToken,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const text = await res.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(json?.error || `vault-service ${action} failed (${res.status})`);
  }
  return json;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function classifyDocument(
  classificationId: string,
  fileName: string,
  driveFileId: string,
  mimeType: string,
  householdId: string,
) {
  try {
    const sa = await parseServiceAccountKey(Deno.env.get("GCP_SERVICE_ACCOUNT_KEY"));

    // Load active checklist templates to ground the model's category choice.
    const { data: templates } = await admin
      .from("intake_checklist_templates")
      .select("id, name, category, requirement")
      .eq("is_active", true)
      .order("sort_order");

    const categories = (templates ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      requirement: t.requirement,
    }));

    const categoryList = categories.length
      ? categories.map((c) => `- "${c.name}" (category: ${c.category ?? "other"})`).join("\n")
      : "- Statement / Tax / Identity / Legal / Insurance / Corporate / Other";

    const prompt = `You are a document classifier for a Canadian family-office intake vault.

File name: "${fileName}"
MIME type: ${mimeType}

Choose the single best matching document type from this checklist:
${categoryList}

Respond ONLY with a JSON object in this exact shape (no markdown, no commentary):
{
  "matchedName": "exact name from the checklist, or 'Other'",
  "category": "best category label",
  "confidence": 0.0 to 1.0,
  "reviewRequired": true or false
}

Set reviewRequired=true if the file name is vague, ambiguous, or the confidence is below 0.7.`;

    const result = await generateVertexContent(
      sa,
      VERTEX_MODEL,
      [{ role: "user", parts: [{ text: prompt }] }],
      { responseMimeType: "application/json" },
    );

    const textPart = result.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === "string");
    const rawText = textPart?.text ?? "";
    let parsed: any = {};
    try {
      // Strip markdown fences if the model added them.
      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = {};
    }

    const matchedTemplate = categories.find((c) =>
      String(parsed.matchedName || "").toLowerCase() === c.name.toLowerCase()
    );

    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const reviewRequired = !!parsed.reviewRequired || confidence < CLASSIFY_CONFIDENCE_THRESHOLD;
    const status = reviewRequired ? "needs_review" : "filed";

    await admin
      .from("intake_classifications")
      .update({
        predicted_category: parsed.category || parsed.matchedName || "Other",
        confidence,
        status,
        review_required: reviewRequired,
        matched_checklist_template_id: matchedTemplate?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", classificationId);

    console.log(`[IntakePortal] classified ${classificationId} as ${parsed.matchedName} (${confidence})`);
  } catch (e) {
    console.error(`[IntakePortal] classification failed for ${classificationId}:`, e);
    await admin
      .from("intake_classifications")
      .update({
        status: "needs_review",
        review_required: true,
        predicted_category: "Other",
        updated_at: new Date().toISOString(),
      })
      .eq("id", classificationId);
  }
}

async function handleInhouseUpload(
  req: Request,
  cors: Record<string, string>,
  resolved: Resolved,
): Promise<Response> {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ error: "Missing file" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (file.size > 25 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: "File exceeds 25MB" }), {
      status: 413,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const portalToken = req.headers.get("x-portal-token")!;

  // Ensure the household vault root exists before uploading.
  const { data: hh } = await admin
    .from("households")
    .select("vault_root_folder_id")
    .eq("id", resolved.householdId)
    .maybeSingle();
  if (!hh?.vault_root_folder_id) {
    return new Response(JSON.stringify({ error: "Vault not provisioned" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Get or create the Shoebox folder via vault-service.
  const shoebox = await callVaultService("ensureShoebox", {}, portalToken);
  const folderId = shoebox.folderId;
  if (!folderId) {
    return new Response(JSON.stringify({ error: "Could not prepare upload folder" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Upload the file to Drive through vault-service (reuses its firewall + audit).
  const base64 = arrayBufferToBase64(await file.arrayBuffer());
  const upload = await callVaultService(
    "uploadFile",
    {
      folderId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      base64,
      contactId: resolved.contactId,
    },
    portalToken,
  );

  if (!upload.fileId) {
    return new Response(JSON.stringify({ error: "Upload to vault failed" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Record the pending classification.
  const { data: classification } = await admin
    .from("intake_classifications")
    .insert({
      household_id: resolved.householdId,
      file_name: file.name,
      drive_file_id: upload.fileId,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      status: "pending",
    })
    .select("id")
    .single();

  // Classify asynchronously so the upload response returns immediately.
  // @ts-ignore EdgeRuntime is provided by Supabase Edge Functions runtime
  if (typeof EdgeRuntime !== "undefined") {
    EdgeRuntime.waitUntil(
      classifyDocument(
        classification!.id,
        file.name,
        upload.fileId,
        file.type || "application/octet-stream",
        resolved.householdId,
      ),
    );
  } else {
    // Local / test fallback — run in background without blocking response.
    classifyDocument(
      classification!.id,
      file.name,
      upload.fileId,
      file.type || "application/octet-stream",
      resolved.householdId,
    ).catch(console.error);
  }

  return new Response(
    JSON.stringify({
      success: true,
      fileId: upload.fileId,
      classificationId: classification!.id,
      status: "pending",
    }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
}

/**
 * Maps intake_checklist_templates.category values to the Vault folder template
 * slug that would already hold a matching document if it was filed directly
 * into the Vault (by staff, or by an existing client from before this
 * checklist pipeline existed) instead of uploaded through this wizard.
 */
const CHECKLIST_CATEGORY_TO_VAULT_SLUG: Record<string, string> = {
  "01_Identities": "identity-legal",
  "02_Financial": "investments",
  "05_Income_Tax": "tax",
  "06_Insurance": "insurance",
  "07_Estate_Planning": "estate",
  "10_Corporate_Entities": "business",
  "04_Asset_Specific": "real-estate",
};

/**
 * Best-effort supplement to the classification-based checklist: for each
 * checklist category, checks whether the household's real Vault folder
 * already has files in the matching category folder. Existing clients often
 * have documents staff filed directly into the Vault long before this wizard
 * existed, which intake_classifications has no rows for — without this check
 * every one of those items would show as missing despite already being on file.
 * Fails soft (returns an empty set) on any error — Vault access is a bonus
 * signal, never a hard requirement for the manifest to render.
 */
async function computeVaultSatisfiedCategories(
  vaultRootFolderId: string | null,
  neededSlugs: string[],
): Promise<Set<string>> {
  const satisfied = new Set<string>();
  if (!vaultRootFolderId || neededSlugs.length === 0) return satisfied;

  const { data: templates } = await admin
    .from("vault_folder_templates")
    .select("slug, display_name")
    .eq("is_active", true)
    .in("slug", neededSlugs);
  const categories = (templates ?? []) as { slug: string; display_name: string }[];
  if (categories.length === 0) return satisfied;

  try {
    const accessToken = await getServiceGoogleAccessToken(admin);
    const rootChildren = await driveListChildren(vaultRootFolderId, accessToken);
    for (const cat of categories) {
      const folder = matchVaultCategoryFolder(rootChildren, cat.display_name);
      if (!folder) continue;
      const contents = await driveListChildren(folder.id, accessToken);
      if (contents.length > 0) satisfied.add(cat.slug);
    }
  } catch {
    // Best-effort — classification-based status still applies.
  }
  return satisfied;
}

async function handleInhouseManifest(
  req: Request,
  cors: Record<string, string>,
  resolved: Resolved,
): Promise<Response> {
  const { data: household } = await admin
    .from("households")
    .select("id, label, family_id, vault_root_folder_id, onboarding_completed_at, families(name)")
    .eq("id", resolved.householdId)
    .maybeSingle();
  const familyName = (household as any)?.families?.name ?? "Family";
  const householdName = household?.label ?? "Household";

  const [{ data: templates }, { data: classifications }] = await Promise.all([
    admin
      .from("intake_checklist_templates")
      .select("id, name, category, requirement")
      .eq("is_active", true)
      .order("sort_order"),
    admin
      .from("intake_classifications")
      .select("*")
      .eq("household_id", resolved.householdId)
      .order("created_at", { ascending: false }),
  ]);

  const activeTemplates = (templates ?? []) as any[];
  const classRows = (classifications ?? []) as any[];

  // Match each classification to the best template by name similarity.
  const matchedByTemplate = new Map<string, any[]>();
  for (const cls of classRows) {
    const lowerFile = String(cls.file_name).toLowerCase();
    let best: any = null;
    let bestScore = 0;
    for (const t of activeTemplates) {
      const nameTokens = String(t.name).toLowerCase().split(/\s+/);
      let score = 0;
      for (const token of nameTokens) {
        if (token.length > 2 && lowerFile.includes(token)) score += 1;
      }
      if (String(cls.predicted_category).toLowerCase() === String(t.name).toLowerCase()) score += 5;
      if (cls.matched_checklist_template_id === t.id) score += 10;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) {
      const list = matchedByTemplate.get(best.id) ?? [];
      list.push(cls);
      matchedByTemplate.set(best.id, list);
    }
  }

  const neededVaultSlugs = [
    ...new Set(
      activeTemplates
        .map((t) => (t.category ? CHECKLIST_CATEGORY_TO_VAULT_SLUG[t.category] : null))
        .filter((slug): slug is string => Boolean(slug)),
    ),
  ];
  const vaultSatisfiedSlugs = await computeVaultSatisfiedCategories(
    (household as any)?.vault_root_folder_id ?? null,
    neededVaultSlugs,
  );

  const checklist = activeTemplates.map((t) => {
    const matches = matchedByTemplate.get(t.id) ?? [];
    const filed = matches.filter((c) => c.status === "filed").length;
    const pending = matches.filter((c) => c.status === "pending").length;
    const needsReview = matches.filter((c) => c.status === "needs_review").length;
    const vaultSlug = t.category ? CHECKLIST_CATEGORY_TO_VAULT_SLUG[t.category] : null;
    const foundInVault = Boolean(vaultSlug && vaultSatisfiedSlugs.has(vaultSlug));

    let status = "waiting";
    if (filed > 0 || foundInVault) status = "filed";
    else if (needsReview > 0) status = "needs_review";
    else if (pending > 0) status = "pending";

    return {
      name: t.name,
      category: t.category ?? null,
      ownerInitials: null,
      subType: null,
      status,
      receivedCount: matches.length,
      requirement: t.requirement === "required" ? "required" : "optional",
    };
  });

  const requiredItems = checklist.filter((i) => i.requirement === "required");
  const requiredSatisfied = requiredItems.filter((i) => i.status === "filed").length;
  const totalItems = checklist.length;
  const satisfiedTotal = checklist.filter((i) => i.status === "filed").length;
  const processingCount = classRows.filter((c) => c.status === "pending").length;
  const needsReviewCount = classRows.filter((c) => c.status === "needs_review").length;
  const uploadedFiles = classRows.length;

  const percent = totalItems > 0 ? Math.round((satisfiedTotal / totalItems) * 100) : 0;
  const criticalComplete = requiredItems.length > 0 && requiredSatisfied === requiredItems.length;
  const complete = criticalComplete && processingCount === 0 && needsReviewCount === 0;

  const uploads: any[] = classRows.map((c) => ({
    fileName: c.file_name,
    folderName: "00 Shoebox (Client Uploads)",
    createdAt: c.created_at,
    classification: {
      status: c.status,
      category: c.predicted_category ?? null,
      typeTag: c.mime_type ?? null,
      identifier: c.drive_file_id ?? null,
    },
  }));

  return new Response(
    JSON.stringify({
      enabled: true,
      familyName,
      householdName,
      onboardingCompletedAt: (household as any)?.onboarding_completed_at ?? null,
      status: complete ? "complete" : "in_progress",
      ready: true,
      completion: {
        status: complete ? "complete" : "in_progress",
        expectedItems: totalItems,
        uploadedFiles,
        percent,
        lastUploadAt: classRows[0]?.created_at ?? null,
        classification: {
          pending: processingCount,
          filed: classRows.filter((c) => c.status === "filed").length,
          needsReview: needsReviewCount,
          failed: 0,
        },
        audit: {
          criticalTotal: requiredItems.length,
          criticalSatisfied: requiredSatisfied,
          total: totalItems,
          satisfiedTotal,
          percent,
          criticalComplete,
          processing: processingCount,
          missingCritical: requiredItems
            .filter((i) => i.status !== "filed")
            .map((i) => i.name),
          missingRecommended: checklist
            .filter((i) => i.requirement !== "required" && i.status !== "filed")
            .map((i) => i.name),
        },
      },
      checklist,
      uploads,
      limits: { maxBytes: 25 * 1024 * 1024, allowedTypes: [] },
    }),
    { headers: { ...cors, "Content-Type": "application/json" } },
  );
}

// ═════════════════════════════════════════════════════════════════════════════
//  GUIDED ONBOARDING — steps 1-3 (step 4 is the document manifest above)
// ═════════════════════════════════════════════════════════════════════════════

const WEALTH_EVENTS = [
  "inheritance",
  "divorce",
  "retirement",
  "business_exit",
  "business_growth",
  "other_sudden_wealth",
] as const;

// The Household Context step (psychological/relational intake) only applies to
// personal sudden-wealth situations — it would feel out of place for a
// Corporate Exit or Growth-Stage Founder, so those two skip straight to
// Documents instead of landing on it.
const PERSONAL_WEALTH_EVENTS = ["inheritance", "divorce", "retirement", "other_sudden_wealth"] as const;

const MEMBER_ROLES: Record<string, string> = {
  spouse: "spouse",
  child: "beneficiary",
  dependant: "beneficiary",
  other: "beneficiary",
};

const str = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);

async function loadOnboarding(resolved: Resolved) {
  const [{ data: household }, { data: contact }, { data: members }, { data: booking }] =
    await Promise.all([
      admin
        .from("households")
        .select(
          "id, label, address, onboarding_step, onboarding_completed_at, audit_booked_at, profile_completed_at, wealth_event_type, wealth_event_notes, wealth_event_completed_at, vision_notes, values_notes, purpose_notes, intake_share_token, vault_root_folder_id, anchor_transfer_amount, anchor_transfer_amount_note, spousal_alignment_score, spousal_alignment_note, pressure_types, pressure_note, pending_capex_amount, pending_capex_date, pending_capex_description, legacy_advisor_friction_notes, household_context_completed_at, wealth_event_source, onboarding_intro_text",
        )
        .eq("id", resolved.householdId)
        .maybeSingle(),
      admin
        .from("contacts")
        .select("id, first_name, last_name, full_name, email, phone, address, family_role")
        .eq("id", resolved.contactId)
        .maybeSingle(),
      admin
        .from("contacts")
        .select("id, full_name, first_name, last_name, email, family_role, is_minor")
        .eq("household_id", resolved.householdId)
        .order("created_at", { ascending: true }),
      admin
        .from("service_bookings")
        .select("id, scheduling_url, starts_at, payment_status, paid_at, services(name)")
        .eq("contact_id", resolved.contactId)
        .in("payment_status", ["paid", "not_required"])
        .order("paid_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const vaultReady = !!(household?.intake_share_token || household?.vault_root_folder_id);

  return {
    ok: true,
    household: {
      id: household?.id,
      label: household?.label ?? "",
      address: household?.address ?? "",
      step: household?.onboarding_step ?? 1,
      auditBookedAt: household?.audit_booked_at ?? null,
      profileCompletedAt: household?.profile_completed_at ?? null,
      wealthEventType: household?.wealth_event_type ?? null,
      wealthEventNotes: household?.wealth_event_notes ?? "",
      wealthEventCompletedAt: household?.wealth_event_completed_at ?? null,
      visionNotes: household?.vision_notes ?? "",
      valuesNotes: household?.values_notes ?? "",
      purposeNotes: household?.purpose_notes ?? "",
      onboardingCompletedAt: household?.onboarding_completed_at ?? null,
      legacyUpgrade: resolved.legacyUpgrade,
      vaultReady,
      anchorTransferAmount: household?.anchor_transfer_amount ?? null,
      anchorTransferAmountNote: household?.anchor_transfer_amount_note ?? "",
      spousalAlignmentScore: household?.spousal_alignment_score ?? null,
      spousalAlignmentNote: household?.spousal_alignment_note ?? "",
      pressureTypes: household?.pressure_types ?? [],
      pressureNote: household?.pressure_note ?? "",
      pendingCapexAmount: household?.pending_capex_amount ?? null,
      pendingCapexDate: household?.pending_capex_date ?? null,
      pendingCapexDescription: household?.pending_capex_description ?? "",
      legacyAdvisorFrictionNotes: household?.legacy_advisor_friction_notes ?? "",
      householdContextCompletedAt: household?.household_context_completed_at ?? null,
      onboardingIntroText: household?.onboarding_intro_text ?? null,
      wealthEventFromDiagnostic: household?.wealth_event_source === "georgia_diagnostic",
    },
    contact: {
      id: contact?.id,
      firstName: contact?.first_name ?? "",
      lastName: contact?.last_name ?? "",
      fullName: contact?.full_name ?? "",
      email: contact?.email ?? "",
      phone: contact?.phone ?? "",
    },
    members: (members ?? [])
      .filter((m: any) => m.id !== resolved.contactId)
      .map((m: any) => ({
        id: m.id,
        fullName: m.full_name,
        email: m.email,
        role: m.family_role,
      })),
    booking: booking
      ? {
        id: booking.id,
        schedulingUrl: booking.scheduling_url,
        serviceName: (booking as any).services?.name ?? null,
      }
      : null,
    wealthEventOptions: WEALTH_EVENTS,
  };
}

/** Bump the stored step forward only (never backwards). */
async function advanceStep(householdId: string, step: number, patch: Record<string, unknown> = {}) {
  const { data: hh } = await admin
    .from("households")
    .select("onboarding_step")
    .eq("id", householdId)
    .maybeSingle();
  const current = hh?.onboarding_step ?? 1;
  const { error } = await admin
    .from("households")
    .update({ ...patch, onboarding_step: Math.max(current, step) })
    .eq("id", householdId);
  if (error) throw new Error(error.message);
}

async function handleOnboardingAction(
  action: string,
  payload: any,
  cors: Record<string, string>,
  resolved: Resolved,
): Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (action === "onboarding") {
    return json(await loadOnboarding(resolved));
  }

  if (action === "onboarding_audit_booked") {
    await advanceStep(resolved.householdId, 2, { audit_booked_at: new Date().toISOString() });
    return json(await loadOnboarding(resolved));
  }

  // Calendar-verified booking check — advances the client automatically once the
  // Audit session actually appears on a staff calendar.
  if (action === "onboarding_check_booking") {
    const state = await loadOnboarding(resolved);
    if (state.household.auditBookedAt) {
      return json({ ...state, auditEvent: null, verified: true });
    }
    const event = await findAuditEvent(state.contact.email);
    if (!event) return json({ ...state, auditEvent: null, verified: false });
    await advanceStep(resolved.householdId, 2, { audit_booked_at: event.start });
    return json({ ...(await loadOnboarding(resolved)), auditEvent: event, verified: true });
  }


  if (action === "onboarding_profile") {
    const householdName = str(payload?.householdName, 120);
    const address = str(payload?.address, 400);
    const phone = str(payload?.phone, 40);
    const primaryName = str(payload?.primaryName, 120);
    const email = str(payload?.email, 200).toLowerCase();
    const rawMembers = Array.isArray(payload?.members) ? payload.members.slice(0, 20) : [];

    if (!householdName) return json({ error: "Household name is required" }, 400);
    if (!address) return json({ error: "Address is required" }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "That email address doesn't look right" }, 400);
    }

    const { data: primary } = await admin
      .from("contacts")
      .select("id, family_id, created_by, email, full_name")
      .eq("id", resolved.contactId)
      .maybeSingle();
    if (!primary) return json({ error: "Contact not found" }, 404);

    // 1. Household record
    const { error: hhErr } = await admin
      .from("households")
      .update({ label: householdName, address })
      .eq("id", resolved.householdId);
    if (hhErr) return json({ error: hhErr.message }, 500);

    // 2. Head-of-family contact (their own name wins over any checkout guess)
    let namePatch: Record<string, unknown> = {};
    if (primaryName) {
      const parts = primaryName.split(/\s+/).filter(Boolean);
      namePatch = {
        full_name: primaryName,
        first_name: parts[0],
        last_name: parts.slice(1).join(" ") || parts[0],
      };
    }
    const { error: cErr } = await admin
      .from("contacts")
      .update({
        address,
        ...namePatch,
        ...(phone ? { phone } : {}),
        ...(email ? { email } : {}),
      })
      .eq("id", resolved.contactId);
    if (cErr) return json({ error: cErr.message }, 500);

    // 2b. Placeholder family names created at checkout get corrected too.
    if (primaryName && primary.family_id) {
      const { data: family } = await admin
        .from("families")
        .select("id, name")
        .eq("id", primary.family_id)
        .maybeSingle();
      const surname =
        primaryName.split(/\s+/).filter(Boolean).slice(1).join(" ") || primaryName;
      if (family && /^(client|new client)\b/i.test(String(family.name ?? ""))) {
        await admin.from("families").update({ name: `${surname} Family` }).eq("id", family.id);
      }
    }


    // 3. Household members → contacts (skip anything already on file by email/name)
    const { data: existing } = await admin
      .from("contacts")
      .select("id, full_name, email")
      .eq("household_id", resolved.householdId);
    const seenEmails = new Set(
      (existing ?? []).map((c: any) => String(c.email ?? "").toLowerCase()).filter(Boolean),
    );
    const seenNames = new Set(
      (existing ?? []).map((c: any) => String(c.full_name ?? "").trim().toLowerCase()).filter(Boolean),
    );

    let createdMembers = 0;
    for (const raw of rawMembers) {
      const fullName = str(raw?.fullName, 120);
      if (!fullName) continue;
      const memberEmail = str(raw?.email, 200).toLowerCase();
      const relationship = str(raw?.relationship, 30).toLowerCase();
      if (memberEmail && seenEmails.has(memberEmail)) continue;
      if (seenNames.has(fullName.toLowerCase())) continue;

      const parts = fullName.split(/\s+/);
      const first = parts[0];
      const last = parts.slice(1).join(" ") || parts[0];
      const { error: insErr } = await admin.from("contacts").insert({
        full_name: fullName,
        first_name: first,
        last_name: last,
        email: memberEmail || null,
        address,
        family_id: primary.family_id,
        household_id: resolved.householdId,
        family_role: MEMBER_ROLES[relationship] ?? "beneficiary",
        is_minor: relationship === "child" || relationship === "dependant"
          ? !!raw?.isMinor
          : false,
        created_by: primary.created_by,
      });
      if (insErr) {
        console.error("[IntakePortal] member insert failed:", insErr.message);
        continue;
      }
      createdMembers += 1;
      if (memberEmail) seenEmails.add(memberEmail);
      seenNames.add(fullName.toLowerCase());
    }

    // Legacy upgrades run Household info first (Step 1) and unlock Vision &
    // values (Step 2) next; new clients run Book Audit first, so completing
    // Household info here (their Step 2) unlocks Wealth event (Step 3).
    await advanceStep(resolved.householdId, resolved.legacyUpgrade ? 2 : 3, {
      profile_completed_at: new Date().toISOString(),
    });
    const state = await loadOnboarding(resolved);
    return json({ ...state, createdMembers });
  }

  if (action === "onboarding_wealth_event") {
    // Legacy upgrades never had a triggering wealth event — they use the
    // dedicated onboarding_vision_values action (Step 2) instead.
    if (resolved.legacyUpgrade) {
      return json({ error: "This household uses the vision & values step instead" }, 400);
    }

    const notes = str(payload?.notes, 4000);
    const type = str(payload?.wealthEventType, 40).toLowerCase();
    if (!WEALTH_EVENTS.includes(type as (typeof WEALTH_EVENTS)[number])) {
      return json({ error: "Please choose a wealth event" }, 400);
    }
    // Personal events (inheritance/divorce/retirement/other sudden wealth) land
    // on the new Household Context step next; corporate events (business exit,
    // growth-stage founder) skip it entirely and go straight to Documents.
    const isPersonalEvent = PERSONAL_WEALTH_EVENTS.includes(type as (typeof PERSONAL_WEALTH_EVENTS)[number]);
    // A wealth event pre-filled from the Georgia diagnostic stays marked as
    // such only while the client keeps it; changing it makes it theirs.
    const { data: prior } = await admin
      .from("households")
      .select("wealth_event_type, wealth_event_source")
      .eq("id", resolved.householdId)
      .maybeSingle();
    const keepsDiagnosticEvent =
      prior?.wealth_event_source === "georgia_diagnostic" && prior?.wealth_event_type === type;
    await advanceStep(resolved.householdId, isPersonalEvent ? 4 : 5, {
      wealth_event_source: keepsDiagnosticEvent ? "georgia_diagnostic" : null,
      // The personalized intro describes the diagnostic's event -- once the
      // client changes it, it would be stale, so fall back to the generic text.
      ...(prior?.wealth_event_source === "georgia_diagnostic" && !keepsDiagnosticEvent
        ? { onboarding_intro_text: null }
        : {}),
      wealth_event_type: type,
      wealth_event_notes: notes || null,
      wealth_event_completed_at: new Date().toISOString(),
    });
    return json(await loadOnboarding(resolved));
  }

  // New-lead Step 4 (personal sudden-wealth events only — see
  // PERSONAL_WEALTH_EVENTS) — the psychological/relational intake layer.
  // Every field is optional; this step never blocks progress.
  if (action === "onboarding_household_context") {
    if (resolved.legacyUpgrade) {
      return json({ error: "Not applicable for this household" }, 400);
    }
    const { data: hhCheck } = await admin
      .from("households")
      .select("wealth_event_type")
      .eq("id", resolved.householdId)
      .maybeSingle();
    const eventType = hhCheck?.wealth_event_type;
    if (!PERSONAL_WEALTH_EVENTS.includes(eventType as (typeof PERSONAL_WEALTH_EVENTS)[number])) {
      return json({ error: "Not applicable for this household's wealth event" }, 400);
    }
    const anchorTransferAmount = payload?.anchorTransferAmount;
    const spousalAlignmentScore = payload?.spousalAlignmentScore;
    const pendingCapexAmount = payload?.pendingCapexAmount;
    const pendingCapexDate = str(payload?.pendingCapexDate, 10);
    const pressureTypes = Array.isArray(payload?.pressureTypes)
      ? payload.pressureTypes.map((t: unknown) => str(t, 40)).filter(Boolean).slice(0, 20)
      : [];

    await advanceStep(resolved.householdId, 5, {
      anchor_transfer_amount:
        typeof anchorTransferAmount === "number" && anchorTransferAmount >= 0 ? anchorTransferAmount : null,
      anchor_transfer_amount_note: str(payload?.anchorTransferAmountNote, 1000) || null,
      spousal_alignment_score:
        typeof spousalAlignmentScore === "number" && spousalAlignmentScore >= 1 && spousalAlignmentScore <= 5
          ? spousalAlignmentScore
          : null,
      spousal_alignment_note: str(payload?.spousalAlignmentNote, 1000) || null,
      pressure_types: pressureTypes,
      pressure_note: str(payload?.pressureNote, 1000) || null,
      pending_capex_amount:
        typeof pendingCapexAmount === "number" && pendingCapexAmount >= 0 ? pendingCapexAmount : null,
      pending_capex_date: pendingCapexDate || null,
      pending_capex_description: str(payload?.pendingCapexDescription, 1000) || null,
      legacy_advisor_friction_notes: str(payload?.legacyAdvisorFrictionNotes, 2000) || null,
      household_context_completed_at: new Date().toISOString(),
    });
    return json(await loadOnboarding(resolved));
  }

  // Legacy upgrades' Step 2 — vision, values, and purpose for their capital,
  // captured as 3 separate fields so each can be read/quoted independently
  // elsewhere (Sovereignty Charter, Stabilization Survey) rather than one blob.
  if (action === "onboarding_vision_values") {
    if (!resolved.legacyUpgrade) {
      return json({ error: "This household uses the wealth event step instead" }, 400);
    }
    const vision = str(payload?.vision, 2000);
    const values = str(payload?.values, 2000);
    const purpose = str(payload?.purpose, 2000);
    if (!vision && !values && !purpose) {
      return json({ error: "Please share at least one of your vision, values, or purpose" }, 400);
    }
    await advanceStep(resolved.householdId, 3, {
      vision_notes: vision || null,
      values_notes: values || null,
      purpose_notes: purpose || null,
      wealth_event_completed_at: new Date().toISOString(),
    });
    return json(await loadOnboarding(resolved));
  }

  if (action === "onboarding_documents_complete") {
    // Legacy upgrades still have a Step 4 (Book Meeting) after documents —
    // advance without finishing (Documents is legacy step 3, unchanged).
    // New clients finish here — Documents is their step 5 now that Household
    // Context (personal wealth events only) sits between Wealth Event and it.
    await advanceStep(
      resolved.householdId,
      resolved.legacyUpgrade ? 4 : 5,
      resolved.legacyUpgrade ? {} : { onboarding_completed_at: new Date().toISOString() },
    );
    return json(await loadOnboarding(resolved));
  }

  // Legacy upgrades' Step 4 — client confirms they've booked their session via
  // the external Google Calendar link. No calendar-verification like the
  // audit-booking flow has; this is the last step, so it finishes onboarding.
  if (action === "onboarding_meeting_booked") {
    if (!resolved.legacyUpgrade) {
      return json({ error: "Not applicable for this household" }, 400);
    }
    await advanceStep(resolved.householdId, 4, { onboarding_completed_at: new Date().toISOString() });
    return json(await loadOnboarding(resolved));
  }

  return json({ error: "Unknown action" }, 400);
}

const ONBOARDING_ACTIONS = new Set([
  "onboarding",
  "onboarding_audit_booked",
  "onboarding_check_booking",
  "onboarding_profile",
  "onboarding_wealth_event",
  "onboarding_household_context",
  "onboarding_vision_values",
  "onboarding_documents_complete",
  "onboarding_meeting_booked",
]);

// ═════════════════════════════════════════════════════════════════════════════
//  ENTRYPOINT
// ═════════════════════════════════════════════════════════════════════════════

serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const resolved = await resolveHousehold(req);
    if (!resolved) return json({ error: "Unauthorized" }, 401);

    const contentType = req.headers.get("content-type") ?? "";
    const isUpload = contentType.includes("multipart/form-data");

    // Legacy clients, and anyone who hasn't paid the Audit fee, don't see the
    // guided onboarding or its checklist at all.
    if (!resolved.onboardingEnabled) {
      const reason = resolved.disabledReason ?? "legacy_client";
      if (isUpload) return json({ error: "Onboarding is not enabled for this household" }, 403);
      const body = await req.json().catch(() => ({}));
      const act = String(body?.action ?? "manifest");
      if (ONBOARDING_ACTIONS.has(act)) {
        return json({ ok: false, disabled: true, reason });
      }
      return json({ enabled: false, reason });
    }


    // Onboarding actions are mode-independent: they live entirely in the CRM.
    let payload: any = {};
    if (!isUpload) {
      payload = await req.json().catch(() => ({}));
      const action = String(payload?.action ?? "manifest");
      if (ONBOARDING_ACTIONS.has(action)) {
        return await handleOnboardingAction(action, payload, cors, resolved);
      }
      if (action !== "manifest") return json({ error: "Unknown action" }, 400);
    }

    // If the household is still linked to an external agent, keep using the
    // proxy even when the global mode is in-house. Staff can clear the
    // intake_share_token/intake_manifest_url to switch a household over.
    const householdLinkedExternally = !!(
      resolved.shareToken || resolved.manifestUrl || resolved.uploadUrl
    );
    const effectiveMode = MODE === "inhouse" && !householdLinkedExternally ? "inhouse" : "proxy";

    if (effectiveMode === "proxy") {
      if (!householdLinkedExternally) {
        return json({ enabled: false, reason: "not_linked" });
      }
      return await handleProxyManifest(req, cors, resolved);
    }

    // In-house mode
    if (isUpload) return await handleInhouseUpload(req, cors, resolved);
    return await handleInhouseManifest(req, cors, resolved);
  } catch (e) {
    console.error("[IntakePortal] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});

