// Vault Service — proxies Google Drive through Supabase with a strict
// per-contact ancestry firewall. Drive is invisible to clients and to
// invited collaborators (lawyers, accountants, etc.).
//
// Actor types:
//   - 'staff'        — authenticated Supabase user (CRM)
//   - 'client'       — portal session (Bearer = portal token from portal_tokens)
//   - 'collaborator' — guest session (Bearer = vault_guest_tokens.token + verified unlock_code)
//   - 'professional' — Pro Portal session (x-pro-session = pro_portal_tokens, see
//                      _shared/pro-portal-auth.ts). Grants come from this professional's
//                      own vault_collaborators rows (one per household they're linked to),
//                      never from a magic link — access follows directly from the grant.
//
// Every byte that leaves this function passes the firewall check:
//   ensureAccess(actor, fileOrFolderId)
// which verifies the file's ancestor chain contains the actor's allowed root(s).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkOutboundPii } from "../_shared/pii-shield.ts";
import { validateProSession } from "../_shared/pro-portal-auth.ts";

const APP_BASE_URL = "https://app.prosperwise.ca";

// ── Gmail relay (client-facing email) — Wix was fully decommissioned; this
// used to call sendVaultEmailViaWix, which silently no-op'd once the Wix
// secrets were removed, while still reporting success to the caller. ──
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

async function sendVaultEmail(payload: {
  email: string;
  full_name?: string;
  subject: string;
  message: string;
  event_type: string;
}): Promise<{ sent: boolean; reason?: string }> {
  // PII Shield — never let financial/health content leave Canadian infra
  const pii = checkOutboundPii(`${payload.subject}\n${payload.message}`);
  if (pii.blocked) {
    console.warn("[VaultEmail] PII Shield blocked send:", pii.reason);
    return { sent: false, reason: "pii_blocked" };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-admin-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "x-internal-secret": Deno.env.get("INTERNAL_FUNCTION_SECRET") ?? "",
      },
      body: JSON.stringify({
        to: payload.email,
        subject: payload.subject,
        text: payload.message,
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[VaultEmail] Gmail relay failed ${res.status}: ${text}`);
      return { sent: false, reason: "gmail_error" };
    }
    return { sent: true };
  } catch (e) {
    console.error("[VaultEmail] Gmail relay error:", e);
    return { sent: false, reason: "gmail_error" };
  }
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

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
      "authorization, x-client-info, apikey, content-type, x-vault-guest-token, x-vault-unlock-code, x-vault-share-token, x-portal-token, x-pro-session, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ───── Google token (firm Workspace ghost user) ─────
async function getValidGoogleToken(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("google_tokens")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.token_expiry) <= new Date(Date.now() + 60_000)) {
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
      console.error("[Vault] token refresh failed", tokens);
      return null;
    }
    const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    await supabaseAdmin
      .from("google_tokens")
      .update({ access_token: tokens.access_token, token_expiry: newExpiry })
      .eq("user_id", data.user_id);
    return tokens.access_token;
  }
  return data.access_token;
}

const GOOGLE_NATIVE = new Set([
  "application/vnd.google-apps.document",
  "application/vnd.google-apps.spreadsheet",
  "application/vnd.google-apps.presentation",
]);
function googleExportMime(mime: string) {
  if (mime === "application/vnd.google-apps.spreadsheet")
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/pdf";
}

// ───── Actor resolution ─────
type Actor =
  | { kind: "staff"; userId: string }
  | { kind: "client"; contactId: string; householdId: string | null; vaultRootId: string; shoeboxOnly: boolean }
  | {
      kind: "collaborator";
      collaboratorId: string;
      contactId: string;
      grants: Array<{ scope_type: string; drive_id: string; permission: string }>;
    }
  | {
      kind: "share_link";
      linkId: string;
      householdId: string;
      scopeDriveId: string;
      permission: "view" | "view_upload" | "view_upload_download";
    }
  | {
      kind: "professional";
      professionalId: string;
      collaboratorIds: string[];
      grants: Array<{ scope_type: string; drive_id: string; permission: string; household_id: string }>;
    };

// Returns true if the request carries either a valid staff JWT or a valid
// portal client token. Used to bypass guest unlock-code prompts when the
// recipient is already authenticated inside the app.
async function isAuthenticatedPrincipal(req: Request): Promise<boolean> {
  const portalToken = req.headers.get("x-portal-token");
  if (portalToken) {
    const { data: tok } = await supabaseAdmin
      .from("portal_tokens")
      .select("expires_at, revoked")
      .eq("token", portalToken)
      .maybeSingle();
    if (tok && !tok.revoked && new Date(tok.expires_at) > new Date()) return true;
  }
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    try {
      const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await userClient.auth.getUser();
      if (data?.user) return true;
    } catch { /* ignore */ }
  }
  return false;
}

async function resolveActor(req: Request): Promise<Actor | null> {
  // 1. Collaborator guest token (highest specificity — checked first)
  const guestToken = req.headers.get("x-vault-guest-token");
  const unlockCode = req.headers.get("x-vault-unlock-code");
  if (guestToken) {
    const { data: tokenRow } = await supabaseAdmin
      .from("vault_guest_tokens")
      .select("*, vault_collaborators(id, contact_id, revoked_at)")
      .eq("token", guestToken)
      .maybeSingle();
    if (!tokenRow || tokenRow.revoked) return null;
    if (new Date(tokenRow.expires_at) <= new Date()) return null;
    if (tokenRow.vault_collaborators?.revoked_at) return null;
    // Require unlock code on first use; afterwards bound to user_agent
    const ua = req.headers.get("User-Agent") ?? "";
    if (!tokenRow.unlock_verified_at) {
      if (!unlockCode || unlockCode !== tokenRow.unlock_code) return null;
      await supabaseAdmin
        .from("vault_guest_tokens")
        .update({ unlock_verified_at: new Date().toISOString(), bound_user_agent: ua })
        .eq("id", tokenRow.id);
    } else if (tokenRow.bound_user_agent && tokenRow.bound_user_agent !== ua) {
      return null;
    }
    const { data: grants } = await supabaseAdmin
      .from("vault_collaborator_grants")
      .select("scope_type, drive_id, permission, expires_at, revoked_at")
      .eq("collaborator_id", tokenRow.vault_collaborators.id);
    const active = (grants ?? []).filter(
      (g) => !g.revoked_at && new Date(g.expires_at) > new Date(),
    );
    return {
      kind: "collaborator",
      collaboratorId: tokenRow.vault_collaborators.id,
      contactId: tokenRow.vault_collaborators.contact_id,
      grants: active,
    };
  }

  // 2. Share-link guest token (vault_share_links)
  const shareToken = req.headers.get("x-vault-share-token");
  if (shareToken) {
    const { data: link } = await supabaseAdmin
      .from("vault_share_links")
      .select("*")
      .eq("token", shareToken)
      .maybeSingle();
    if (!link || link.revoked_at) return null;
    if (link.expires_at && new Date(link.expires_at) <= new Date()) return null;
    if (typeof link.max_uses === "number" && link.use_count >= link.max_uses) return null;
    const ua = req.headers.get("User-Agent") ?? "";
    if (link.link_type === "guest") {
      const provided = req.headers.get("x-vault-unlock-code");
      const bypass = await isAuthenticatedPrincipal(req);
      if (link.unlock_code && !bypass) {
        if (!provided || provided !== link.unlock_code) return null;
      }
      if (link.bound_user_agent && link.bound_user_agent !== ua) return null;
      if (!link.bound_user_agent) {
        await supabaseAdmin
          .from("vault_share_links")
          .update({ bound_user_agent: ua, last_accessed_at: new Date().toISOString() })
          .eq("id", link.id);
      }
    }
    return {
      kind: "share_link",
      linkId: link.id,
      householdId: link.household_id,
      scopeDriveId: link.drive_id,
      permission: link.permission,
    };
  }

  // 3. Portal client session (x-portal-token = portal_tokens.token)
  const portalToken = req.headers.get("x-portal-token");
  if (portalToken) {
    const { data: tok } = await supabaseAdmin
      .from("portal_tokens")
      .select("contact_id, expires_at, revoked")
      .eq("token", portalToken)
      .maybeSingle();
    if (!tok || tok.revoked || new Date(tok.expires_at) <= new Date()) return null;
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("household_id, vault_root_folder_id, vault_shoebox_only, households(vault_root_folder_id)")
      .eq("id", tok.contact_id)
      .maybeSingle();
    const vaultRootId = (contact as any)?.households?.vault_root_folder_id ?? contact?.vault_root_folder_id;
    if (!vaultRootId) return null;
    return { kind: "client", contactId: tok.contact_id, householdId: contact?.household_id ?? null, vaultRootId, shoeboxOnly: !!(contact as any)?.vault_shoebox_only };
  }

  // 4. Pro Portal session (x-pro-session = pro_portal_tokens, validated the
  // same way pro-portal-workspace/pro-portal-engagements already do). A
  // professional can hold one vault_collaborators row per household they're
  // linked to — aggregate active grants across all of them.
  const proSessionToken = req.headers.get("x-pro-session");
  if (proSessionToken) {
    const session = await validateProSession(supabaseAdmin, proSessionToken);
    if (!session) return null;
    const { data: collabRows } = await supabaseAdmin
      .from("vault_collaborators")
      .select("id, household_id")
      .eq("professional_id", session.professional_id)
      .is("revoked_at", null);
    const collaboratorIds = (collabRows ?? []).map((c: any) => c.id);
    if (!collaboratorIds.length) {
      return { kind: "professional", professionalId: session.professional_id, collaboratorIds: [], grants: [] };
    }
    const { data: grants } = await supabaseAdmin
      .from("vault_collaborator_grants")
      .select("scope_type, drive_id, permission, expires_at, revoked_at, collaborator_id")
      .in("collaborator_id", collaboratorIds);
    const hhByCollab = new Map((collabRows ?? []).map((c: any) => [c.id, c.household_id]));
    const active = (grants ?? [])
      .filter((g: any) => !g.revoked_at && new Date(g.expires_at) > new Date())
      .map((g: any) => ({ ...g, household_id: hhByCollab.get(g.collaborator_id) }));
    return { kind: "professional", professionalId: session.professional_id, collaboratorIds, grants: active };
  }

  // 5. Staff JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data } = await userClient.auth.getUser();
    if (data?.user) return { kind: "staff", userId: data.user.id };
  }
  return null;
}

// ───── Firewall: confirm a Drive id is reachable from the actor's allowed roots ─────
async function getAncestors(driveId: string, accessToken: string): Promise<string[]> {
  // Try cache first
  const { data: cached } = await supabaseAdmin
    .from("vault_files")
    .select("ancestor_folder_ids, parent_folder_id")
    .eq("drive_id", driveId)
    .maybeSingle();
  if (cached?.ancestor_folder_ids?.length) return cached.ancestor_folder_ids;

  // Walk Drive (cap depth = 12)
  const chain: string[] = [];
  let current = driveId;
  for (let i = 0; i < 12; i++) {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${current}?fields=id,parents`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!r.ok) break;
    const j = await r.json();
    const parent = j.parents?.[0];
    if (!parent) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

// Effective client capability: 'view' | 'upload' | 'manage'
const ROLE_CAP: Record<string, "view" | "upload" | "manage"> = {
  viewer: "view",
  contributor: "upload",
  manager: "manage",
};
function rank(c: "view" | "upload" | "manage") {
  return c === "view" ? 0 : c === "upload" ? 1 : 2;
}

async function effectiveClientPermission(
  contactId: string,
  chain: string[],
): Promise<"view" | "upload" | "manage"> {
  // Baseline role
  const { data: roleRow } = await supabaseAdmin
    .from("vault_contact_roles")
    .select("role")
    .eq("contact_id", contactId)
    .maybeSingle();
  let cap: "view" | "upload" | "manage" = ROLE_CAP[roleRow?.role ?? "viewer"] ?? "view";
  // Most specific (file > nearer folder > root) grant in chain
  const { data: grants } = await supabaseAdmin
    .from("vault_contact_grants")
    .select("scope_type, drive_id, permission, expires_at, revoked_at")
    .eq("contact_id", contactId)
    .in("drive_id", chain.length ? chain : ["__none__"]);
  const active = (grants ?? []).filter(
    (g) => !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > new Date()),
  );
  // Walk chain from most specific (driveId itself = chain[0]) outward
  for (const id of chain) {
    const match = active.find((g) => g.drive_id === id);
    if (match) {
      const grantCap = (match.permission as "view" | "upload" | "manage");
      if (rank(grantCap) > rank(cap)) cap = grantCap;
      break;
    }
  }
  return cap;
}

// Resolve (and cache) the Shoebox child folder for a household. Returns null
// if the household has no vault root or the Shoebox folder cannot be located.
async function getShoeboxFolderId(
  householdId: string | null,
  vaultRootId: string,
  accessToken: string,
): Promise<string | null> {
  if (!householdId) return null;
  const { data: hh } = await supabaseAdmin
    .from("households")
    .select("vault_shoebox_folder_id")
    .eq("id", householdId)
    .maybeSingle();
  if (hh?.vault_shoebox_folder_id) return hh.vault_shoebox_folder_id;

  // Resolve display name from active templates (position=0 = Shoebox)
  const { data: tmpl } = await supabaseAdmin
    .from("vault_folder_templates")
    .select("display_name")
    .eq("slug", "shoebox")
    .maybeSingle();
  const shoeboxName = tmpl?.display_name ?? "00 Shoebox (Client Uploads)";

  try {
    const children = await driveListChildren(vaultRootId, accessToken);
    let match = (children ?? []).find(
      (f: any) =>
        f.mimeType === "application/vnd.google-apps.folder" &&
        (f.name === shoeboxName || /shoebox/i.test(f.name)),
    );
    // Externally-provisioned vaults (AI Onboarding Agent) don't create a Shoebox —
    // create it under the household root so client uploads always have a target.
    if (!match) {
      match = await driveCreateFolder(shoeboxName, vaultRootId, accessToken);
    }
    if (!match?.id) return null;
    await supabaseAdmin
      .from("households")
      .update({ vault_shoebox_folder_id: match.id })
      .eq("id", householdId);
    return match.id;
  } catch {
    return null;
  }

}

type Need = false | "upload" | "rename" | "delete" | "create_folder";

async function ensureAccess(
  actor: Actor,
  driveId: string,
  accessToken: string,
  need: Need = false,
): Promise<{ ok: boolean; reason?: string; cap?: string }> {
  if (actor.kind === "staff") return { ok: true, cap: "manage" };

  const ancestors = await getAncestors(driveId, accessToken);
  const chain = [driveId, ...ancestors];

  if (actor.kind === "client") {
    if (!chain.includes(actor.vaultRootId)) return { ok: false, reason: "outside_vault_root" };

    // Shoebox-only firewall: client may only see/touch items inside the Shoebox subtree
    if (actor.shoeboxOnly) {
      const shoeboxId = await getShoeboxFolderId(actor.householdId, actor.vaultRootId, accessToken);
      // If shoebox can't be resolved, deny everything except the root listing itself
      if (!shoeboxId) {
        if (driveId !== actor.vaultRootId) return { ok: false, reason: "shoebox_only" };
      } else if (driveId !== actor.vaultRootId && !chain.includes(shoeboxId)) {
        return { ok: false, reason: "shoebox_only" };
      }
    }

    const cap = await effectiveClientPermission(actor.contactId, chain);

    // For files, check client_visible unless explicit grant covers
    if (!need) {
      const { data: row } = await supabaseAdmin
        .from("vault_files")
        .select("client_visible, is_folder")
        .eq("drive_id", driveId)
        .maybeSingle();
      if (row && row.is_folder === false && row.client_visible === false) {
        // Allow if any explicit grant exists in chain
        const { data: gr } = await supabaseAdmin
          .from("vault_contact_grants")
          .select("id")
          .eq("contact_id", actor.contactId)
          .in("drive_id", chain.length ? chain : ["__none__"])
          .is("revoked_at", null)
          .limit(1);
        if (!gr || gr.length === 0) return { ok: false, reason: "not_client_visible" };
      }
      return { ok: true, cap };
    }

    if (need === "upload") {
      if (rank(cap) >= 1) return { ok: true, cap };
      // Every portal client may always drop files into their household Shoebox —
      // it exists for exactly that purpose (staff triage the contents later).
      const shoeboxId = await getShoeboxFolderId(actor.householdId, actor.vaultRootId, accessToken);
      if (shoeboxId && chain.includes(shoeboxId)) return { ok: true, cap: "upload" };
      return { ok: false, reason: "client_no_upload" };
    }

    if (need === "create_folder") {
      if (cap === "manage") return { ok: true, cap };
      return { ok: false, reason: "client_no_create_folder" };
    }
    if (need === "rename" || need === "delete") {
      if (cap === "manage") return { ok: true, cap };
      const { data: f } = await supabaseAdmin
        .from("vault_files")
        .select("uploaded_by_contact_id")
        .eq("drive_id", driveId)
        .maybeSingle();
      const ownUpload = f?.uploaded_by_contact_id === actor.contactId;
      if (cap === "upload" && ownUpload) return { ok: true, cap };
      // Clients may also clean up their own Shoebox drops even without a role.
      if (ownUpload) {
        const shoeboxId = await getShoeboxFolderId(actor.householdId, actor.vaultRootId, accessToken);
        if (shoeboxId && chain.includes(shoeboxId)) return { ok: true, cap: "upload" };
      }
      return { ok: false, reason: "client_can_modify_own_only" };
    }

    return { ok: false, reason: "unknown_need" };
  }

  if (actor.kind === "collaborator") {
    for (const g of actor.grants) {
      if (need && need !== "upload") continue; // collaborators: view + upload only
      if (need === "upload" && g.permission !== "upload") continue;
      if (chain.includes(g.drive_id)) return { ok: true };
    }
    return { ok: false, reason: "no_matching_grant" };
  }

  if (actor.kind === "professional") {
    for (const g of actor.grants) {
      if (need && need !== "upload") continue; // same as collaborator: view + upload only
      if (need === "upload" && g.permission !== "upload") continue;
      if (chain.includes(g.drive_id)) return { ok: true };
    }
    return { ok: false, reason: "no_matching_grant" };
  }

  if (actor.kind === "share_link") {
    if (!chain.includes(actor.scopeDriveId)) return { ok: false, reason: "outside_share_scope" };
    if (!need) return { ok: true };
    if (need === "upload") {
      if (actor.permission === "view_upload" || actor.permission === "view_upload_download")
        return { ok: true };
      return { ok: false, reason: "share_link_no_upload" };
    }
    return { ok: false, reason: "share_link_no_modify" };
  }
  return { ok: false, reason: "unknown_actor" };
}

async function audit(
  actor: Actor | null,
  action: string,
  contactId: string | null,
  driveId: string | null,
  driveName: string | null,
  req: Request,
  metadata: Record<string, unknown> = {},
) {
  await supabaseAdmin.from("vault_audit_log").insert({
    contact_id: contactId,
    actor_type: actor?.kind ?? "anonymous",
    actor_id:
      actor?.kind === "staff"
        ? actor.userId
        : actor?.kind === "collaborator"
          ? actor.collaboratorId
          : actor?.kind === "share_link"
            ? actor.linkId
            : actor?.kind === "professional"
              ? actor.professionalId
              : null,
    actor_label:
      actor?.kind === "client"
        ? `client:${actor.contactId}`
        : actor?.kind === "share_link"
          ? `share_link:${actor.linkId}`
          : actor?.kind === "professional"
            ? `professional:${actor.professionalId}`
            : actor?.kind ?? "anonymous",
    action,
    drive_id: driveId,
    drive_name: driveName,
    ip: req.headers.get("x-forwarded-for"),
    user_agent: req.headers.get("user-agent"),
    metadata,
  });
}

// Defense in depth for shareWithProfessional: never trust a client-supplied
// (professionalId, householdId) pairing -- confirm an active engagement
// actually resolves to this household, whether scoped directly to the
// household, to a contact within it, or to its family.
async function professionalIsEngagedWithHousehold(professionalId: string, householdId: string): Promise<boolean> {
  const ACTIVE_STATUSES = ["invited", "active", "completed"];
  const { data: household } = await supabaseAdmin
    .from("households")
    .select("family_id")
    .eq("id", householdId)
    .maybeSingle();
  const { data: contacts } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("household_id", householdId);
  const contactIds = (contacts ?? []).map((c: any) => c.id);

  const { data: engagements } = await supabaseAdmin
    .from("professional_engagements")
    .select("scope_type, scope_id, status")
    .eq("professional_id", professionalId)
    .in("status", ACTIVE_STATUSES);

  return (engagements ?? []).some((e: any) => {
    if (e.scope_type === "household") return e.scope_id === householdId;
    if (e.scope_type === "contact") return contactIds.includes(e.scope_id);
    if (e.scope_type === "family") return household?.family_id != null && e.scope_id === household.family_id;
    return false;
  });
}

// ───── Drive helpers ─────
async function driveCreateFolder(name: string, parentId: string, accessToken: string) {
  const r = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,parents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  if (!r.ok) throw new Error(`drive_create_folder_failed: ${await r.text()}`);
  return r.json();
}

async function driveListChildren(folderId: string, accessToken: string) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent("files(id,name,mimeType,size,modifiedTime,parents)");
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=200&orderBy=folder,name`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!r.ok) throw new Error(`drive_list_failed: ${await r.text()}`);
  return (await r.json()).files ?? [];
}

function genUnlockCode() {
  // Cryptographically secure 6-digit code with rejection sampling to avoid modulo bias.
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    const n = buf[0];
    if (n < 4_294_000_000) return String(100000 + (n % 900000));
  }
}

// ─────────────────────────────────────────────────────────
serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const url = new URL(req.url);
  let action = url.searchParams.get("action") ?? "";
  let body: any = {};
  if (req.method === "POST") {
    try {
      body = await req.json();
      action = body.action ?? action;
    } catch {
      /* empty */
    }
  }

  // Anonymous endpoint: collaborator forgot their unlock code and wants a
  // fresh one emailed to the address on file (vault_guest_tokens fallback).
  if (action === "requestGuestOtp") {
    const { token } = body;
    if (!token)
      return new Response(JSON.stringify({ error: "token required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const { data: tokenRow } = await supabaseAdmin
      .from("vault_guest_tokens")
      .select("id, revoked, expires_at, vault_collaborators(id, email, full_name, revoked_at)")
      .eq("token", token)
      .maybeSingle();
    if (!tokenRow || tokenRow.revoked || (tokenRow as any).vault_collaborators?.revoked_at) {
      // Don't leak whether token exists
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    const collab = (tokenRow as any).vault_collaborators;
    if (!collab?.email) {
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    const newCode = genUnlockCode();
    await supabaseAdmin
      .from("vault_guest_tokens")
      .update({
        unlock_code: newCode,
        unlock_verified_at: null,
        bound_user_agent: null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .eq("id", tokenRow.id);
    const subject = "Your ProsperWise document vault code";
    const message =
      `Hello${collab.full_name ? ` ${collab.full_name}` : ""},\n\n` +
      `Here is a new one-time unlock code for your secure document vault:\n\n` +
      `    ${newCode}\n\n` +
      `Enter it on the unlock page to access the documents shared with you. ` +
      `This code replaces any previous code and is valid for 24 hours.\n\n` +
      `If you didn't request this code, you can safely ignore this email — no one can access the vault without it.\n\n` +
      `— ProsperWise`;
    const otpEmailResult = await sendVaultEmail({
      email: collab.email, full_name: collab.full_name, subject, message, event_type: "vault_collaborator_otp",
    });
    await audit(null, otpEmailResult.sent ? "vault_collaborator_otp_sent" : "vault_collaborator_otp_failed", null, null, null, req, { collaborator_id: collab.id, email: collab.email, reason: otpEmailResult.reason });
    return new Response(
      JSON.stringify({ ok: true, email_hint: maskEmail(collab.email), email_sent: otpEmailResult.sent }),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  }

  // Anonymous endpoint: resolveShareLink runs before any actor exists,
  // because the caller is trying to redeem a token to *become* a share_link actor.
  if (action === "resolveShareLink") {
    const { token, unlock_code } = body;
    if (!token)
      return new Response(JSON.stringify({ error: "token required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const { data: link } = await supabaseAdmin.from("vault_share_links").select("*").eq("token", token).maybeSingle();
    if (!link || link.revoked_at)
      return new Response(JSON.stringify({ error: "invalid_or_revoked" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    if (link.expires_at && new Date(link.expires_at) <= new Date())
      return new Response(JSON.stringify({ error: "expired" }), { status: 410, headers: { ...cors, "Content-Type": "application/json" } });
    if (typeof link.max_uses === "number" && link.use_count >= link.max_uses)
      return new Response(JSON.stringify({ error: "use_limit_reached" }), { status: 410, headers: { ...cors, "Content-Type": "application/json" } });
    const bypass = await isAuthenticatedPrincipal(req);
    const needsCode = link.link_type === "guest" && !!link.unlock_code && !bypass;
    if (needsCode && unlock_code !== link.unlock_code)
      return new Response(JSON.stringify({ needs_unlock_code: true }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    const accessTokenForMeta = await getValidGoogleToken();
    let meta: any = {};
    if (accessTokenForMeta) {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${link.drive_id}?fields=id,name,mimeType`, { headers: { Authorization: `Bearer ${accessTokenForMeta}` } });
      meta = r.ok ? await r.json() : {};
    }
    // Resolve client (family) name for branding header
    let clientName: string | null = null;
    const { data: hh } = await supabaseAdmin
      .from("households")
      .select("label, families(name)")
      .eq("id", link.household_id)
      .maybeSingle();
    if (hh) clientName = (hh as any).families?.name ?? hh.label ?? null;
    await audit(null, "share_link_redeemed", null, link.drive_id, meta.name ?? null, req, { link_id: link.id });
    return new Response(JSON.stringify({
      ok: true,
      scope: { drive_id: link.drive_id, name: meta.name ?? null, mime_type: meta.mimeType ?? null, scope_type: link.scope_type },
      permission: link.permission,
      link_type: link.link_type,
      client_name: clientName,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  const actor = await resolveActor(req);
  if (!actor) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const accessToken = await getValidGoogleToken();
  if (!accessToken) {
    return new Response(JSON.stringify({ error: "no_google_token" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    // ─── GET ROOT (client portal entry-point) ───
    if (action === "getRoot") {
      if (actor.kind !== "client")
        return new Response(JSON.stringify({ error: "client_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files/${actor.vaultRootId}?fields=id,name`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!r.ok) {
        return new Response(JSON.stringify({ error: "drive_meta_error" }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
      }
      const j = await r.json();
      return new Response(JSON.stringify({ rootFolderId: j.id, rootName: j.name }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── PROVISION VAULT (staff only) ───
    if (action === "provisionVault") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { householdId, contactId, parentFolderId, force } = body;
      if (!parentFolderId || (!householdId && !contactId))
        return new Response(JSON.stringify({ error: "householdId (or contactId) and parentFolderId required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

      // Resolve household
      let hhId = householdId as string | undefined;
      if (!hhId && contactId) {
        const { data: c } = await supabaseAdmin.from("contacts").select("household_id").eq("id", contactId).maybeSingle();
        hhId = c?.household_id ?? undefined;
      }
      if (!hhId)
        return new Response(JSON.stringify({ error: "contact_has_no_household" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

      const { data: hh } = await supabaseAdmin
        .from("households")
        .select("id, label, vault_root_folder_id, family_id, families(name)")
        .eq("id", hhId)
        .maybeSingle();
      if (!hh) return new Response(JSON.stringify({ error: "household_not_found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
      if (hh.vault_root_folder_id && !force) {
        return new Response(JSON.stringify({ ok: true, folderId: hh.vault_root_folder_id, alreadyExists: true }), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      const familyName = (hh as any).families?.name ?? hh.label ?? "Household";
      const folderLabel = `ProsperWise Vault — ${familyName}${hh.label && hh.label !== "Primary" ? ` (${hh.label})` : ""}`;
      const root = await driveCreateFolder(folderLabel, parentFolderId, accessToken);

      const { data: tmpls } = await supabaseAdmin
        .from("vault_folder_templates")
        .select("display_name, position")
        .eq("is_active", true)
        .order("position");
      for (const t of tmpls ?? []) {
        await driveCreateFolder(t.display_name, root.id, accessToken);
      }

      const previousRoot = hh.vault_root_folder_id ?? null;
      await supabaseAdmin.from("households").update({ vault_root_folder_id: root.id }).eq("id", hhId);
      await audit(actor, force && previousRoot ? "reprovision" : "provision", contactId ?? null, root.id, root.name, req, { household_id: hhId, previous_root: previousRoot });

      return new Response(JSON.stringify({ ok: true, folderId: root.id, householdId: hhId, previousRoot }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── SET VAULT ROOT (staff only) ───
    // Point a household at an existing Drive folder. Useful when a vault was
    // mis-provisioned or the team wants to reuse an existing folder structure.
    if (action === "setVaultRoot") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { householdId, folderId } = body;
      if (!householdId || !folderId)
        return new Response(JSON.stringify({ error: "householdId and folderId required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      // Validate the folder exists and is a folder
      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType,trashed&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!r.ok) {
        return new Response(JSON.stringify({ error: "folder_not_accessible", detail: await r.text() }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      }
      const meta = await r.json();
      if (meta.mimeType !== "application/vnd.google-apps.folder" || meta.trashed) {
        return new Response(JSON.stringify({ error: "not_a_folder" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      }
      const { data: hh } = await supabaseAdmin.from("households").select("vault_root_folder_id").eq("id", householdId).maybeSingle();
      const previousRoot = hh?.vault_root_folder_id ?? null;
      await supabaseAdmin.from("households").update({ vault_root_folder_id: folderId }).eq("id", householdId);
      await audit(actor, "set_root", null, folderId, meta.name, req, { household_id: householdId, previous_root: previousRoot });
      return new Response(JSON.stringify({ ok: true, folderId, name: meta.name, previousRoot }), { headers: { ...cors, "Content-Type": "application/json" } });
    }


    // ─── ENSURE SHOEBOX (client or staff) ───
    // Finds-or-creates the "00 Shoebox (Client Uploads)" folder under the
    // household's vault root. Used by the portal uploader and by staff
    // backfill of already-provisioned vaults.
    if (action === "ensureShoebox") {
      let rootFolderId: string | null = null;
      if (actor.kind === "client") {
        rootFolderId = actor.vaultRootId;
      } else if (actor.kind === "staff") {
        const { householdId } = body;
        if (!householdId) {
          return new Response(JSON.stringify({ error: "householdId required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const { data: hh } = await supabaseAdmin
          .from("households")
          .select("vault_root_folder_id")
          .eq("id", householdId)
          .maybeSingle();
        rootFolderId = hh?.vault_root_folder_id ?? null;
      } else {
        return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      }
      if (!rootFolderId) {
        return new Response(JSON.stringify({ error: "vault_not_provisioned" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      }
      const SHOEBOX_NAME = "00 Shoebox (Client Uploads)";
      const children = await driveListChildren(rootFolderId, accessToken);
      let shoebox = children.find(
        (c: any) =>
          c.mimeType === "application/vnd.google-apps.folder" &&
          (c.name === SHOEBOX_NAME || c.name?.toLowerCase().includes("shoebox")),
      );
      if (!shoebox) {
        shoebox = await driveCreateFolder(SHOEBOX_NAME, rootFolderId, accessToken);
      }
      const hhIdForCache = actor.kind === "client" ? actor.householdId : body.householdId;
      if (hhIdForCache && shoebox?.id) {
        await supabaseAdmin
          .from("households")
          .update({ vault_shoebox_folder_id: shoebox.id })
          .eq("id", hhIdForCache);
      }
      return new Response(
        JSON.stringify({ folderId: shoebox.id, name: shoebox.name }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );

    }

    // ─── COLLABORATOR: list own grant roots (post-unlock) ───
    if (action === "myGrants") {
      if (actor.kind !== "collaborator")
        return new Response(JSON.stringify({ error: "collaborator_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const ids = actor.grants.map((g) => g.drive_id);
      const roots: { id: string; name: string }[] = [];
      for (const id of ids) {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (r.ok) {
          const j = await r.json();
          roots.push({ id: j.id, name: j.name });
        }
      }
      // Resolve collaborator + client (family) name for branding header
      const { data: collab } = await supabaseAdmin
        .from("vault_collaborators")
        .select("full_name, household_id")
        .eq("id", actor.collaboratorId)
        .maybeSingle();
      let clientName: string | null = null;
      if (collab?.household_id) {
        const { data: hh } = await supabaseAdmin
          .from("households")
          .select("label, families(name)")
          .eq("id", collab.household_id)
          .maybeSingle();
        if (hh) clientName = (hh as any).families?.name ?? hh.label ?? null;
      }
      return new Response(JSON.stringify({
        roots,
        collaborator_name: collab?.full_name ?? null,
        client_name: clientName,
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── PROFESSIONAL: list own grants across every household they're linked to ───
    if (action === "listMyProfessionalGrants") {
      if (actor.kind !== "professional")
        return new Response(JSON.stringify({ error: "professional_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const grants = body.householdId
        ? actor.grants.filter((g) => g.household_id === body.householdId)
        : actor.grants;
      const enriched = await Promise.all(grants.map(async (g) => {
        try {
          const r = await fetch(`https://www.googleapis.com/drive/v3/files/${g.drive_id}?fields=id,name,mimeType`, { headers: { Authorization: `Bearer ${accessToken}` } });
          const j = r.ok ? await r.json() : null;
          return { ...g, drive_name: j?.name ?? g.drive_id, mime_type: j?.mimeType ?? null };
        } catch { return { ...g, drive_name: g.drive_id, mime_type: null }; }
      }));
      return new Response(JSON.stringify({ grants: enriched }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── LIST FOLDER ───
    if (action === "listFolder") {
      const folderId = body.folderId ?? url.searchParams.get("folderId");
      if (!folderId)
        return new Response(JSON.stringify({ error: "folderId required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

      const access = await ensureAccess(actor, folderId, accessToken);
      if (!access.ok) {
        await audit(actor, "firewall_block", null, folderId, null, req, { reason: access.reason });
        return new Response(JSON.stringify({ error: "forbidden", reason: access.reason }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      }

      const files = await driveListChildren(folderId, accessToken);
      let folders = files.filter((f: any) => f.mimeType === "application/vnd.google-apps.folder");
      let docs = files.filter((f: any) => f.mimeType !== "application/vnd.google-apps.folder");

      // Client view: files are visible by default; only hide when explicitly toggled off
      if (actor.kind === "client") {
        const ids = docs.map((d: any) => d.id);
        const { data: visRows } = await supabaseAdmin
          .from("vault_files")
          .select("drive_id, client_visible")
          .in("drive_id", ids.length ? ids : ["__none__"]);
        const visMap = new Map((visRows ?? []).map((r) => [r.drive_id, r.client_visible]));
        docs = docs.filter((d: any) => visMap.get(d.id) !== false);

        // Shoebox-only firewall: hide every folder except the Shoebox subtree,
        // and hide every file that lives outside the Shoebox.
        if (actor.shoeboxOnly) {
          const shoeboxId = await getShoeboxFolderId(actor.householdId, actor.vaultRootId, accessToken);
          if (!shoeboxId) {
            folders = [];
            docs = [];
          } else if (folderId === actor.vaultRootId) {
            folders = folders.filter((f: any) => f.id === shoeboxId);
            docs = []; // no loose files at the root for shoebox-only clients
          }
          // For folderId === shoeboxId or any descendant, ensureAccess already
          // gated the request, so no extra filtering is needed here.
        }
      }

      // Collaborator / professional view: only files/folders inside one of their grants
      if (actor.kind === "collaborator" || actor.kind === "professional") {
        const grantIds = new Set(actor.grants.map((g) => g.drive_id));
        const filterByGrant = async (item: any) => {
          if (grantIds.has(item.id)) return true;
          const anc = await getAncestors(item.id, accessToken);
          return [item.id, ...anc].some((id) => grantIds.has(id));
        };
        folders = (await Promise.all(folders.map(async (f: any) => ((await filterByGrant(f)) ? f : null)))).filter(Boolean);
        docs = (await Promise.all(docs.map(async (f: any) => ((await filterByGrant(f)) ? f : null)))).filter(Boolean);
      }

      // Share-link view: only files/folders inside the link's scope
      if (actor.kind === "share_link") {
        const scope = actor.scopeDriveId;
        const filterByScope = async (item: any) => {
          if (item.id === scope) return true;
          const anc = await getAncestors(item.id, accessToken);
          return [item.id, ...anc].includes(scope);
        };
        folders = (await Promise.all(folders.map(async (f: any) => ((await filterByScope(f)) ? f : null)))).filter(Boolean);
        docs = (await Promise.all(docs.map(async (f: any) => ((await filterByScope(f)) ? f : null)))).filter(Boolean);
      }

      await audit(actor, "list", null, folderId, null, req, { count: folders.length + docs.length });

      return new Response(
        JSON.stringify({
          folders: folders.map((f: any) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime })),
          files: docs.map((f: any) => ({
            id: f.id,
            name: f.name,
            mimeType: f.mimeType,
            size: f.size ? Number(f.size) : null,
            modifiedTime: f.modifiedTime,
          })),
        }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    // ─── STREAM FILE ───
    if (action === "streamFile") {
      const fileId = body.fileId ?? url.searchParams.get("fileId");
      const disposition = url.searchParams.get("disposition") ?? "inline";
      if (!fileId)
        return new Response(JSON.stringify({ error: "fileId required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

      const access = await ensureAccess(actor, fileId, accessToken);
      if (!access.ok) {
        await audit(actor, "firewall_block", null, fileId, null, req, { reason: access.reason });
        return new Response(JSON.stringify({ error: "forbidden", reason: access.reason }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      }
      // Share-link disposition rules: 'view' permits inline preview only (no attachment download)
      if (actor.kind === "share_link" && disposition === "attachment" && actor.permission === "view") {
        return new Response(JSON.stringify({ error: "forbidden", reason: "share_link_no_download" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      }

      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const meta = await metaRes.json();
      if (!metaRes.ok)
        return new Response(JSON.stringify({ error: "drive_meta_error", detail: meta }), { status: metaRes.status, headers: { ...cors, "Content-Type": "application/json" } });

      let downloadUrl: string;
      let outMime = meta.mimeType;
      let outName = meta.name;
      if (GOOGLE_NATIVE.has(meta.mimeType)) {
        outMime = googleExportMime(meta.mimeType);
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(outMime)}`;
        if (outMime === "application/pdf" && !outName.toLowerCase().endsWith(".pdf")) outName += ".pdf";
      } else {
        downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
      }
      const dlRes = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!dlRes.ok) {
        const text = await dlRes.text();
        return new Response(JSON.stringify({ error: "drive_download_error", detail: text }), { status: dlRes.status, headers: { ...cors, "Content-Type": "application/json" } });
      }

      await audit(actor, disposition === "attachment" ? "download" : "preview", null, fileId, outName, req);

      const headers: Record<string, string> = {
        ...cors,
        "Content-Type": outMime || "application/octet-stream",
        "Content-Disposition": (() => {
          const raw = (outName ?? "file").replace(/"/g, "");
          const ascii = raw.replace(/[^\x20-\x7E]/g, "_");
          return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
        })(),
        "Cache-Control": "private, no-store",
      };
      const len = dlRes.headers.get("Content-Length");
      if (len) headers["Content-Length"] = len;
      return new Response(dlRes.body, { status: 200, headers });
    }

    // ─── SET CLIENT VISIBILITY (staff only) ───
    if (action === "setVisibility") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { fileId, householdId, contactId, clientVisible } = body;
      const ancestors = await getAncestors(fileId, accessToken);
      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,parents`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const meta = await metaRes.json();
      await supabaseAdmin
        .from("vault_files")
        .upsert({
          drive_id: fileId,
          household_id: householdId ?? null,
          contact_id: contactId ?? null,
          parent_folder_id: meta.parents?.[0] ?? null,
          ancestor_folder_ids: ancestors,
          name: meta.name,
          mime_type: meta.mimeType,
          is_folder: meta.mimeType === "application/vnd.google-apps.folder",
          size_bytes: meta.size ? Number(meta.size) : null,
          modified_at: meta.modifiedTime,
          client_visible: !!clientVisible,
          staff_reviewed: true,
        });
      await audit(actor, clientVisible ? "make_visible" : "hide", contactId ?? null, fileId, meta.name, req, { household_id: householdId });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── COLLABORATOR INVITE (staff only) ───
    if (action === "inviteCollaborator") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { householdId, contactId, email, fullName, role, grants } = body;
      // Resolve household: prefer explicit, fall back to contact's household
      let hhId = householdId as string | undefined;
      let cId = contactId as string | undefined;
      if (!hhId && cId) {
        const { data: c } = await supabaseAdmin.from("contacts").select("household_id").eq("id", cId).maybeSingle();
        hhId = c?.household_id ?? undefined;
      }
      if (!hhId)
        return new Response(JSON.stringify({ error: "household_required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

      const { data: collab, error: cErr } = await supabaseAdmin
        .from("vault_collaborators")
        .upsert(
          { household_id: hhId, contact_id: cId ?? null, email, full_name: fullName, role, invited_by: actor.userId, revoked_at: null },
          { onConflict: "household_id,email" },
        )
        .select()
        .single();
      if (cErr) throw cErr;
      for (const g of grants ?? []) {
        await supabaseAdmin.from("vault_collaborator_grants").insert({
          collaborator_id: collab.id,
          scope_type: g.scope_type,
          drive_id: g.drive_id,
          permission: g.permission ?? "view",
          expires_at: g.expires_at ?? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          granted_by: actor.userId,
        });
      }
      const code = genUnlockCode();
      const { data: tok } = await supabaseAdmin
        .from("vault_guest_tokens")
        .insert({ collaborator_id: collab.id, unlock_code: code })
        .select()
        .single();
      await audit(actor, "invite_collaborator", cId ?? null, null, null, req, { collaborator_id: collab.id, email, household_id: hhId });

      // Auto-send invite email with link only (unlock code sent separately/manually)
      if (email && tok?.token) {
        const url = `${APP_BASE_URL}/vault/guest/${tok.token}`;
        const subject = "You've been invited to a secure document vault";
        const message =
          `Hello${fullName ? ` ${fullName}` : ""},\n\n` +
          `You've been granted secure access to a ProsperWise client vault.\n\n` +
          `Open the vault: ${url}\n\n` +
          `For your security, you'll be asked for a one-time unlock code on the landing page. ` +
          `That code is being sent to you separately.\n\n` +
          `Access can be revoked at any time. If you weren't expecting this invitation, please disregard this email.\n\n` +
          `— ProsperWise`;
        const inviteEmailResult = await sendVaultEmail({
          email, full_name: fullName, subject, message, event_type: "vault_collaborator_invite",
        });
        await audit(actor, inviteEmailResult.sent ? "vault_invite_email_sent" : "vault_invite_email_failed", cId ?? null, null, null, req, { collaborator_id: collab.id, email, reason: inviteEmailResult.reason });
      }

      return new Response(JSON.stringify({ ok: true, collaborator: collab, magicToken: tok?.token, unlockCode: code }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── REVOKE COLLABORATOR (staff only) ───
    if (action === "revokeCollaborator") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { collaboratorId } = body;
      await supabaseAdmin.from("vault_collaborators").update({ revoked_at: new Date().toISOString() }).eq("id", collaboratorId);
      await supabaseAdmin.from("vault_guest_tokens").update({ revoked: true }).eq("collaborator_id", collaboratorId);
      await audit(actor, "revoke_collaborator", null, null, null, req, { collaborator_id: collaboratorId });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── UPLOAD (staff, collaborator-with-upload, or client → shoebox only) ───
    if (action === "uploadFile") {
      const { folderId, fileName, mimeType, base64, contactId } = body;

      const access = await ensureAccess(actor, folderId, accessToken, "upload");
      if (!access.ok) {
        await audit(actor, "firewall_block", contactId ?? null, folderId, fileName, req, { reason: access.reason });
        return new Response(JSON.stringify({ error: "forbidden", reason: access.reason }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      }

      const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const boundary = "----vault" + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({ name: fileName, parents: [folderId], mimeType });
      const pre = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
      const post = `\r\n--${boundary}--`;
      const preBytes = new TextEncoder().encode(pre);
      const postBytes = new TextEncoder().encode(post);
      const bodyBytes = new Uint8Array(preBytes.length + binary.length + postBytes.length);
      bodyBytes.set(preBytes, 0);
      bodyBytes.set(binary, preBytes.length);
      bodyBytes.set(postBytes, preBytes.length + binary.length);
      const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
        body: bodyBytes,
      });
      if (!r.ok) throw new Error(`upload_failed: ${await r.text()}`);
      const created = await r.json();
      const uploaderContactId =
        contactId ??
        (actor.kind === "client" ? actor.contactId : actor.kind === "collaborator" ? actor.contactId : null);
      const ancestorChain = [folderId, ...(await getAncestors(folderId, accessToken))];
      await supabaseAdmin.from("vault_files").insert({
        drive_id: created.id,
        contact_id: uploaderContactId,
        household_id:
          actor.kind === "client" ? actor.householdId :
          actor.kind === "share_link" ? actor.householdId : null,
        parent_folder_id: folderId,
        ancestor_folder_ids: ancestorChain,
        name: fileName,
        mime_type: mimeType,
        is_folder: false,
        client_visible: true,
        uploaded_by_collaborator_id: actor.kind === "collaborator" ? actor.collaboratorId : null,
        uploaded_by_contact_id: actor.kind === "client" ? actor.contactId : null,
        staff_reviewed: actor.kind === "staff",
      });
      // Bump share-link use count
      if (actor.kind === "share_link") {
        const { data: cur } = await supabaseAdmin
          .from("vault_share_links")
          .select("use_count")
          .eq("id", actor.linkId)
          .maybeSingle();
        await supabaseAdmin
          .from("vault_share_links")
          .update({ use_count: (cur?.use_count ?? 0) + 1, last_accessed_at: new Date().toISOString() })
          .eq("id", actor.linkId);
      }
      await audit(actor, "upload", uploaderContactId ?? null, created.id, fileName, req, { uploader: actor.kind });

      // Notify staff whenever a client drops a file into their own Shoebox
      // (not every vault upload -- staff already know when they upload
      // something themselves; this is specifically "a client just left
      // something for us to review").
      if (actor.kind === "client") {
        try {
          const shoeboxId = await getShoeboxFolderId(actor.householdId, actor.vaultRootId, accessToken);
          if (shoeboxId && ancestorChain.includes(shoeboxId)) {
            const { data: contact } = await supabaseAdmin
              .from("contacts")
              .select("full_name, first_name, last_name")
              .eq("id", actor.contactId)
              .maybeSingle();
            const name =
              contact?.full_name || `${contact?.first_name || ""} ${contact?.last_name || ""}`.trim() || "A client";
            await supabaseAdmin.from("staff_notifications").insert({
              source_type: "vault_upload",
              title: `${name} uploaded a file to their Shoebox`,
              body: fileName,
              contact_id: actor.contactId,
              link: actor.householdId ? `/households/${actor.householdId}` : `/contacts/${actor.contactId}`,
            });
          }
        } catch (e) {
          console.error("vault-service: failed to send shoebox upload notification:", e);
        }
      }

      return new Response(JSON.stringify({ ok: true, fileId: created.id }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── LIST GRANTS for a collaborator (staff only) ───
    if (action === "listGrants") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { collaboratorId } = body;
      const { data: grants } = await supabaseAdmin
        .from("vault_collaborator_grants")
        .select("id, scope_type, drive_id, permission, expires_at, revoked_at, created_at")
        .eq("collaborator_id", collaboratorId)
        .order("created_at", { ascending: false });
      // Resolve display names from Drive (best-effort)
      const enriched = await Promise.all((grants ?? []).map(async (g) => {
        try {
          const r = await fetch(`https://www.googleapis.com/drive/v3/files/${g.drive_id}?fields=id,name`, { headers: { Authorization: `Bearer ${accessToken}` } });
          const j = r.ok ? await r.json() : null;
          return { ...g, drive_name: j?.name ?? g.drive_id };
        } catch { return { ...g, drive_name: g.drive_id }; }
      }));
      return new Response(JSON.stringify({ grants: enriched }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── ADD GRANT to existing collaborator (staff only) ───
    if (action === "addGrant") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { collaboratorId, scope_type, drive_id, permission, expires_at } = body;
      if (!collaboratorId || !scope_type || !drive_id)
        return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      const { data: g, error } = await supabaseAdmin.from("vault_collaborator_grants").insert({
        collaborator_id: collaboratorId,
        scope_type,
        drive_id,
        permission: permission ?? "view",
        expires_at: expires_at ?? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        granted_by: actor.userId,
      }).select().single();
      if (error) throw error;
      await audit(actor, "add_grant", null, drive_id, null, req, { collaborator_id: collaboratorId, scope_type, permission });
      return new Response(JSON.stringify({ ok: true, grant: g }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── REVOKE / UPDATE single grant (staff only) ───
    if (action === "updateGrant") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { grantId, revoke, expires_at, permission } = body;
      const patch: Record<string, unknown> = {};
      if (revoke === true) patch.revoked_at = new Date().toISOString();
      if (revoke === false) patch.revoked_at = null;
      if (expires_at !== undefined) patch.expires_at = expires_at; // null = no expiry
      if (permission) patch.permission = permission;
      await supabaseAdmin.from("vault_collaborator_grants").update(patch).eq("id", grantId);
      await audit(actor, "update_grant", null, null, null, req, { grantId, patch });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── REISSUE guest token for an existing collaborator (staff only) ───
    if (action === "reissueGuestToken") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { collaboratorId } = body;
      // Revoke previous tokens
      await supabaseAdmin.from("vault_guest_tokens").update({ revoked: true }).eq("collaborator_id", collaboratorId);
      const code = genUnlockCode();
      const { data: tok } = await supabaseAdmin.from("vault_guest_tokens").insert({ collaborator_id: collaboratorId, unlock_code: code }).select().single();
      await audit(actor, "reissue_guest_token", null, null, null, req, { collaborator_id: collaboratorId });
      return new Response(JSON.stringify({ ok: true, magicToken: tok?.token, unlockCode: code }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── SHARE a folder/file with a linked professional (staff only) ───
    // No magic link is ever issued here -- the professional already has a
    // Pro Portal session; access follows directly from the grant. Finds or
    // creates this professional's vault_collaborators row for the household
    // (at most one, keyed on household_id+professional_id) and adds a grant
    // to it, in one round trip.
    if (action === "shareWithProfessional") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { householdId, professionalId, scope_type, drive_id, permission, expires_at } = body;
      if (!householdId || !professionalId || !scope_type || !drive_id)
        return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

      const engaged = await professionalIsEngagedWithHousehold(professionalId, householdId);
      if (!engaged)
        return new Response(JSON.stringify({ error: "not_engaged", reason: "professional has no active engagement with this household" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });

      const { data: pro } = await supabaseAdmin
        .from("professionals")
        .select("email, full_name, professional_type")
        .eq("id", professionalId)
        .maybeSingle();
      if (!pro)
        return new Response(JSON.stringify({ error: "professional_not_found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

      const { data: collab, error: cErr } = await supabaseAdmin
        .from("vault_collaborators")
        .upsert(
          { household_id: householdId, professional_id: professionalId, email: pro.email, full_name: pro.full_name, role: pro.professional_type, invited_by: actor.userId, revoked_at: null },
          { onConflict: "household_id,professional_id" },
        )
        .select()
        .single();
      if (cErr) throw cErr;

      const { data: g, error: gErr } = await supabaseAdmin.from("vault_collaborator_grants").insert({
        collaborator_id: collab.id,
        scope_type,
        drive_id,
        permission: permission ?? "view",
        expires_at: expires_at ?? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        granted_by: actor.userId,
      }).select().single();
      if (gErr) throw gErr;

      await audit(actor, "share_with_professional", null, drive_id, null, req, { professional_id: professionalId, household_id: householdId, scope_type, permission });
      return new Response(JSON.stringify({ ok: true, collaborator: collab, grant: g }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ═════════════════════════════════════════════════════════
    //  CLIENT PERMISSIONS  (staff manages, client/share consume)
    // ═════════════════════════════════════════════════════════

    // ─── Get effective permission for a folder/file (any actor) ───
    if (action === "getEffectivePermission") {
      const { driveId } = body;
      if (!driveId)
        return new Response(JSON.stringify({ error: "driveId required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      if (actor.kind === "staff")
        return new Response(JSON.stringify({ cap: "manage" }), { headers: { ...cors, "Content-Type": "application/json" } });
      if (actor.kind === "client") {
        const ancestors = await getAncestors(driveId, accessToken);
        const chain = [driveId, ...ancestors];
        if (!chain.includes(actor.vaultRootId))
          return new Response(JSON.stringify({ cap: "none" }), { headers: { ...cors, "Content-Type": "application/json" } });
        let cap = await effectiveClientPermission(actor.contactId, chain);
        // Mirror ensureAccess's upload-need Shoebox fallback (line ~500) --
        // every client can always upload into their household Shoebox, even
        // with no vault_contact_roles row yet, so the button must reflect
        // that instead of reporting "view" for a brand-new/unassigned client.
        if (rank(cap) < 1) {
          const shoeboxId = await getShoeboxFolderId(actor.householdId, actor.vaultRootId, accessToken);
          if (shoeboxId && chain.includes(shoeboxId)) cap = "upload";
        }
        return new Response(JSON.stringify({ cap }), { headers: { ...cors, "Content-Type": "application/json" } });
      }
      if (actor.kind === "share_link") {
        const cap =
          actor.permission === "view_upload_download" ? "manage" :
          actor.permission === "view_upload" ? "upload" : "view";
        return new Response(JSON.stringify({ cap, share_permission: actor.permission }), { headers: { ...cors, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ cap: "view" }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── Set per-contact baseline role (staff) ───
    if (action === "setContactRole") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { contactId, householdId, role } = body;
      if (!contactId || !householdId || !role)
        return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      await supabaseAdmin
        .from("vault_contact_roles")
        .upsert({ contact_id: contactId, household_id: householdId, role, granted_by: actor.userId }, { onConflict: "contact_id" });
      await audit(actor, "set_contact_role", contactId, null, null, req, { role, household_id: householdId });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── Set per-folder/file grant for a portal contact (staff) ───
    if (action === "setContactGrant") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { contactId, householdId, scope_type, drive_id, permission, expires_at } = body;
      if (!contactId || !householdId || !scope_type || !drive_id || !permission)
        return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      const { data: g } = await supabaseAdmin.from("vault_contact_grants").insert({
        contact_id: contactId,
        household_id: householdId,
        scope_type,
        drive_id,
        permission,
        expires_at: expires_at ?? null,
        granted_by: actor.userId,
      }).select().single();
      await audit(actor, "set_contact_grant", contactId, drive_id, null, req, { permission, scope_type });
      return new Response(JSON.stringify({ ok: true, grant: g }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── Revoke a contact grant (staff) ───
    if (action === "revokeContactGrant") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { grantId } = body;
      await supabaseAdmin.from("vault_contact_grants").update({ revoked_at: new Date().toISOString() }).eq("id", grantId);
      await audit(actor, "revoke_contact_grant", null, null, null, req, { grantId });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ─── List all permissions for a household (staff UI) ───
    if (action === "listContactPermissions") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { householdId } = body;
      const { data: roles } = await supabaseAdmin
        .from("vault_contact_roles").select("*").eq("household_id", householdId);
      const { data: grants } = await supabaseAdmin
        .from("vault_contact_grants").select("*").eq("household_id", householdId).is("revoked_at", null);
      return new Response(JSON.stringify({ roles: roles ?? [], grants: grants ?? [] }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ═════════════════════════════════════════════════════════
    //  RENAME / DELETE / CREATE FOLDER
    // ═════════════════════════════════════════════════════════

    if (action === "renameItem") {
      const { driveId, newName } = body;
      if (!driveId || !newName)
        return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      const access = await ensureAccess(actor, driveId, accessToken, "rename");
      if (!access.ok) {
        await audit(actor, "firewall_block", null, driveId, newName, req, { reason: access.reason, op: "rename" });
        return new Response(JSON.stringify({ error: "forbidden", reason: access.reason }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      }
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      if (!r.ok) throw new Error(`rename_failed: ${await r.text()}`);
      await supabaseAdmin.from("vault_files").update({ name: newName }).eq("drive_id", driveId);
      await audit(actor, "rename", null, driveId, newName, req);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "deleteItem") {
      const { driveId } = body;
      if (!driveId)
        return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      const access = await ensureAccess(actor, driveId, accessToken, "delete");
      if (!access.ok) {
        await audit(actor, "firewall_block", null, driveId, null, req, { reason: access.reason, op: "delete" });
        return new Response(JSON.stringify({ error: "forbidden", reason: access.reason }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      }
      // Trash (recoverable) instead of hard delete
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      });
      if (!r.ok) throw new Error(`delete_failed: ${await r.text()}`);
      await audit(actor, "delete", null, driveId, null, req);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "createFolder") {
      const { parentFolderId, name } = body;
      if (!parentFolderId || !name)
        return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      const access = await ensureAccess(actor, parentFolderId, accessToken, "create_folder");
      if (!access.ok) {
        await audit(actor, "firewall_block", null, parentFolderId, name, req, { reason: access.reason, op: "create_folder" });
        return new Response(JSON.stringify({ error: "forbidden", reason: access.reason }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      }
      const created = await driveCreateFolder(name, parentFolderId, accessToken);
      await audit(actor, "create_folder", null, created.id, name, req);
      return new Response(JSON.stringify({ ok: true, folderId: created.id, name: created.name }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ═════════════════════════════════════════════════════════
    //  VAULT-ONLY SHARE LINKS
    // ═════════════════════════════════════════════════════════

    if (action === "createShareLink") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { householdId, scope_type, drive_id, permission, link_type, expires_at, max_uses, generate_unlock_code, notify_email, recipient_name, name } = body;
      if (!householdId || !scope_type || !drive_id || !permission || !link_type)
        return new Response(JSON.stringify({ error: "missing_fields" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      // Verify scope is inside the household root
      const { data: hh } = await supabaseAdmin.from("households").select("vault_root_folder_id").eq("id", householdId).maybeSingle();
      if (!hh?.vault_root_folder_id)
        return new Response(JSON.stringify({ error: "household_no_vault" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      const ancestors = await getAncestors(drive_id, accessToken);
      const chain = [drive_id, ...ancestors];
      if (!chain.includes(hh.vault_root_folder_id))
        return new Response(JSON.stringify({ error: "scope_outside_household" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      const code = link_type === "guest" && generate_unlock_code ? genUnlockCode() : null;
      const { data: link, error } = await supabaseAdmin.from("vault_share_links").insert({
        link_type,
        household_id: householdId,
        scope_type,
        drive_id,
        permission,
        unlock_code: code,
        expires_at: expires_at ?? null,
        max_uses: max_uses ?? null,
        created_by: actor.userId,
        name: name ?? null,
      }).select().single();
      if (error) throw error;
      await audit(actor, "share_link_created", null, drive_id, null, req, { link_type, permission });

      // Optional: auto-send the share URL by email (link only — unlock code sent separately/manually).
      // Awaited (not fire-and-forget) so the response can honestly report
      // whether it actually sent, rather than the caller assuming success.
      let emailResult: { sent: boolean; reason?: string } | null = null;
      if (notify_email) {
        const path = link_type === "guest" ? `/vault/share/${link.token}` : `/portal/vault?share=${link.token}`;
        const url = `${APP_BASE_URL}${path}`;
        const subject = "A secure document has been shared with you";
        const message =
          `Hello${recipient_name ? ` ${recipient_name}` : ""},\n\n` +
          `A secure document has been shared with you from ProsperWise.\n\n` +
          `Open it here: ${url}\n\n` +
          (code
            ? `For your security, you'll be asked for a one-time unlock code on the landing page. That code is being sent to you separately.\n\n`
            : `You'll be asked to verify your identity on the landing page.\n\n`) +
          `Access can be revoked at any time. If you weren't expecting this, please disregard.\n\n` +
          `— ProsperWise`;
        emailResult = await sendVaultEmail({
          email: notify_email, full_name: recipient_name, subject, message, event_type: "vault_share_link",
        });
        await audit(actor, emailResult.sent ? "share_link_email_sent" : "share_link_email_failed", null, drive_id, null, req, { link_id: link.id, email: notify_email, reason: emailResult.reason });
      }

      return new Response(
        JSON.stringify({ ok: true, link, email_sent: emailResult?.sent ?? null, email_reason: emailResult?.reason ?? null }),
        { headers: { ...cors, "Content-Type": "application/json" } },
      );
    }

    if (action === "listShareLinks") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { householdId, driveId } = body;
      let q = supabaseAdmin.from("vault_share_links").select("*").order("created_at", { ascending: false });
      if (householdId) q = q.eq("household_id", householdId);
      if (driveId) q = q.eq("drive_id", driveId);
      const { data } = await q;
      return new Response(JSON.stringify({ links: data ?? [] }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "revokeShareLink") {
      if (actor.kind !== "staff")
        return new Response(JSON.stringify({ error: "staff_only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
      const { linkId } = body;
      await supabaseAdmin.from("vault_share_links").update({ revoked_at: new Date().toISOString() }).eq("id", linkId);
      await audit(actor, "share_link_revoked", null, null, null, req, { linkId });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown_action", action }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[Vault] error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
