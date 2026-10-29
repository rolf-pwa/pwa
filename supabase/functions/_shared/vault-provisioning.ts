// vault-provisioning.ts
// Autonomous Drive folder-tree creation for a brand-new paid household —
// no external agent, no staff click. Builds:
//
//   [Family] Family Vault                       (once per family)
//     Family Docs                               <- families.vault_root_folder_id (category folders inside)
//     [LastName] Household Vault                (one per household; a later household joins the same family)
//       Household Docs                          <- households.vault_root_folder_id
//         00 Shoebox (Client Uploads) ... 99 From Collaborators  (from vault_folder_templates)
//       Personal Docs
//         Personal — [Name]                     <- contacts.personal_vault_folder_id (one per adult)
//       Advisor Files                           (staff only)
//         Insurance / Investment / Meeting Notes / Working Files
//
// One Shoebox per household (inside Household Docs); personal drawers and Family Docs have none.
//
// Requires CLIENT_VAULT_ROOT_FOLDER_ID (the Drive folder every "[LastName]
// Family" folder is created directly inside) and a connected Google account
// in `google_tokens` (see _shared/google-token.ts).

import { vaultContentsSummary, vaultHasContentsError } from "./vault-contents.ts";
import { buildVaultCreatedRow, buildPersonalDrawerRow, buildEntityVaultRow } from "./vault-audit-events.ts";
import { hasPersonalDrawerRole, FAMILY_VAULT_CATEGORIES } from "./vault-drawers.ts";
import { FAMILY_DOCS, HOUSEHOLD_DOCS, PERSONAL_DOCS, ENTITY_VAULTS, CORPORATE_DOCS, CORPORATE_ADVISOR_FILES, CORPORATE_CATEGORIES, withVaultSuffix } from "./vault-structure.ts";
import { getServiceGoogleAccessToken } from "./google-token.ts";

const CLIENT_ROOT_FOLDER_ID = Deno.env.get("CLIENT_VAULT_ROOT_FOLDER_ID");
const ADVISOR_SUBFOLDERS = ["Insurance", "Investment", "Meeting Notes", "Working Files"];
const ADULT_ROLE_PRIORITY: Record<string, number> = { head_of_family: 0, spouse: 1 };

async function driveCreateFolder(name: string, parentId: string, accessToken: string) {
  // A Drive call that never answers must not hang the whole request: give up after 20 seconds, and try a timed-out or rate-limited call once more.
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,parents", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) return r.json();
      last = await r.text();
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`drive_create_folder_failed (${name}): ${last}`);
}

/** Lists the direct, non-trashed children of a Drive folder. Mirrors vault-service's private helper of the same name. */
export async function driveListChildren(
  folderId: string,
  accessToken: string,
): Promise<{ id: string; name: string; mimeType: string }[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent("files(id,name,mimeType,size,modifiedTime,parents)");
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=200&orderBy=folder,name`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!r.ok) throw new Error(`drive_list_failed: ${await r.text()}`);
  return (await r.json()).files ?? [];
}

/** Downloads a Drive file's raw bytes. Callers should skip Google-native docs (Sheets/Docs/Slides) via mimeType before calling — those need the separate /export endpoint, not this one. */
export async function driveDownloadFile(fileId: string, accessToken: string): Promise<ArrayBuffer> {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error(`drive_download_failed: ${await r.text()}`);
  return r.arrayBuffer();
}

/**
 * Matches a household's standard Vault category folder (e.g. "05 Investment
 * Statements") among a Drive folder's already-fetched children, by
 * vault_folder_templates display_name. Exact-matches first, falling back to
 * a keyword match (derived from that same display_name, stripped of its
 * leading position number and any parenthetical) so a staff-renamed folder
 * still resolves. Pure/no I/O — callers fetch the children and template rows
 * themselves so they can batch those calls however suits them. Shared by
 * computeVaultReadiness and vault-statement-scan so the two never drift
 * apart on what "the Insurance folder" means.
 */
export function matchVaultCategoryFolder(
  children: { id: string; name: string; mimeType: string }[],
  displayName: string,
): { id: string; name: string } | null {
  const keywords = displayName
    .replace(/^\d+\s*/, "")
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2 && w !== "&");

  const folder = children.find((f) => {
    if (f.mimeType !== "application/vnd.google-apps.folder") return false;
    if (f.name.trim() === displayName.trim()) return true;
    const lower = f.name.toLowerCase();
    return keywords.some((k) => lower.includes(k.toLowerCase()));
  });
  return folder ? { id: folder.id, name: folder.name } : null;
}

export interface ProvisionResult {
  ok: boolean;
  vaultRootFolderId?: string;
  personalDrawers?: number;
  /** The Vault the household had before a rebuild; its Drive folder is left exactly as it was. */
  previousRoot?: string | null;
  error?: string;
}

const personalDrawerName = (c: { first_name: string | null; last_name: string | null }) =>
  `Personal — ${`${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Member"}`;

/**
 * Creates a personal drawer ("Personal — Name", inside Personal Docs) for every adult in the household who lacks one,
 * and records it. Needs the household's Household Vault folder (households.vault_folder_id, or the parent of its Vault
 * root). Safe to run repeatedly. Returns how many were created.
 */
// deno-lint-ignore no-explicit-any
export async function ensurePersonalDrawers(admin: any, householdId: string, accessToken: string, source = "automatic"): Promise<number> {
  const { data: hh } = await admin.from("households").select("id, family_id, vault_root_folder_id, vault_folder_id").eq("id", householdId).maybeSingle();
  if (!hh?.vault_root_folder_id) return 0;
  const { data: people } = await admin.from("contacts").select("id, first_name, last_name, family_role, is_minor, personal_vault_folder_id").eq("household_id", householdId);
  const needing = (people ?? []).filter((c: any) => !c.personal_vault_folder_id && hasPersonalDrawerRole(c.family_role, c.is_minor));
  if (needing.length === 0) return 0;

  let householdFolderId: string | null = hh.vault_folder_id ?? null;
  if (!householdFolderId) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${hh.vault_root_folder_id}?supportsAllDrives=true&fields=parents`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const parent: string | null = r.ok ? ((await r.json()).parents?.[0] ?? null) : null;
    if (!parent) return 0;
    const pr = await fetch(`https://www.googleapis.com/drive/v3/files/${parent}?supportsAllDrives=true&fields=name`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const pname: string | null = pr.ok ? (await pr.json()).name : null;
    // Only a folder plainly this household's own; never a shared client root.
    if (!pname || !/household|vault/i.test(pname)) return 0;
    householdFolderId = parent;
    await admin.from("households").update({ vault_folder_id: parent }).eq("id", householdId);
  }
  const kids = await driveListChildren(householdFolderId, accessToken);
  const personalDocs = kids.find((f) => f.mimeType === "application/vnd.google-apps.folder" && /^personal docs$/i.test((f.name ?? "").trim()))
    ?? await driveCreateFolder(PERSONAL_DOCS, householdFolderId, accessToken);
  let created = 0;
  for (const c of needing) {
    const folder = await driveCreateFolder(personalDrawerName(c), personalDocs.id, accessToken);
    await admin.from("contacts").update({ personal_vault_folder_id: folder.id }).eq("id", c.id);
    const { error } = await admin.from("vault_audit_log").insert(buildPersonalDrawerRow({ householdId, familyId: hh.family_id ?? null, contactId: c.id, folderId: folder.id, folderName: folder.name ?? null, source }));
    if (error) console.error("[vault-provisioning] could not log personal drawer:", error.message);
    created++;
  }
  return created;
}

/**
 * Builds a household's whole Drive structure and records it. Idempotent: for a household that already has a Vault it
 * only adds any missing personal drawers, unless `force` asks for a brand-new structure (the old folders stay in
 * Drive, unlinked).
 *
 *   {Family} Family Vault              (created once per family; later households join it)
 *     Family Docs                      (the family's shared documents; created once per family)
 *     {Household} Household Vault
 *       Household Docs                 (the Vault)
 *       Personal Docs > Personal — {Name}   (one private drawer per adult)
 *       Advisor Files                  (staff only)
 */
// deno-lint-ignore no-explicit-any
export async function provisionClientFolderTree(
  admin: any,
  householdId: string,
  source = "automatic",
  opts: { force?: boolean; /** The caller has been shown what the current Vault holds and wants it replaced anyway. */ acknowledgeContents?: boolean; /** Build the household a new structure inside its existing Family Vault, leaving the old Drive folders untouched and unlinked. */ rebuild?: boolean; requestedBy?: { id: string; email: string | null } | null } = {},
): Promise<ProvisionResult> {
  if (!CLIENT_ROOT_FOLDER_ID) {
    return { ok: false, error: "CLIENT_VAULT_ROOT_FOLDER_ID is not configured" };
  }

  const { data: household } = await admin
    .from("households")
    .select("id, label, family_id, vault_root_folder_id")
    .eq("id", householdId)
    .maybeSingle();
  if (!household) return { ok: false, error: "household_not_found" };

  // Already provisioned: success, plus any missing personal drawers. Never fails because Google is unreachable.
  if (household.vault_root_folder_id && !opts.force && !opts.rebuild) {
    try {
      const token = await getServiceGoogleAccessToken(admin);
      const personalDrawers = await ensurePersonalDrawers(admin, householdId, token, source);
      return { ok: true, vaultRootFolderId: household.vault_root_folder_id, personalDrawers };
    } catch (e) {
      return { ok: true, vaultRootFolderId: household.vault_root_folder_id, error: e instanceof Error ? e.message : String(e) };
    }
  }

  let accessToken: string;
  try {
    accessToken = await getServiceGoogleAccessToken(admin);
  } catch (e) {
    return { ok: false, error: `google_auth_failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  // A forced rebuild unlinks the current Vault: say what is in it first, so a Vault that is in use isn't replaced by mistake.
  if (opts.force && household.vault_root_folder_id && !opts.acknowledgeContents) {
    try {
      const held = vaultContentsSummary(await driveListChildren(household.vault_root_folder_id, accessToken));
      if (held.folders.length || held.files) return { ok: false, error: vaultHasContentsError(held) };
    } catch { /* couldn't look: the staff confirmation still applies */ }
  }

  const { data: family } = household.family_id
    ? await admin.from("families").select("id, name, vault_folder_id, vault_root_folder_id").eq("id", household.family_id).maybeSingle()
    : { data: null };
  const { data: contacts } = await admin
    .from("contacts")
    .select("first_name, last_name, family_role")
    .eq("household_id", householdId);

  const adults = (contacts ?? [])
    .filter((c: any) => c.family_role in ADULT_ROLE_PRIORITY)
    .sort((a: any, b: any) => ADULT_ROLE_PRIORITY[a.family_role] - ADULT_ROLE_PRIORITY[b.family_role]);

  const lastName =
    adults[0]?.last_name?.trim() ||
    (contacts ?? [])[0]?.last_name?.trim() ||
    household.label?.replace(/\s+Household$/i, "").trim() ||
    "Client";

  try {
    // 1. The family's tree: one Family Vault folder per family, with Family Docs inside. A later household joins it.
    let familyTopId: string | null = opts.force ? null : family?.vault_folder_id ?? null;
    let familyDocsCreated = false;
    if (!familyTopId) {
      const top = await driveCreateFolder(withVaultSuffix(/\bfamily$/i.test(family?.name?.trim() ?? "") ? family!.name!.trim() : `${family?.name?.trim() || lastName} Family`), CLIENT_ROOT_FOLDER_ID, accessToken);
      familyTopId = top.id;
    }
    if (family && (opts.force || !family.vault_root_folder_id)) {
      const docs = await driveCreateFolder(FAMILY_DOCS, familyTopId!, accessToken);
      for (const c of FAMILY_VAULT_CATEGORIES) await driveCreateFolder(c, docs.id, accessToken);
      await admin.from("families").update({ vault_root_folder_id: docs.id, vault_root_provisioned_at: new Date().toISOString() }).eq("id", family.id);
      familyDocsCreated = true;
    }
    if (family && family.vault_folder_id !== familyTopId) await admin.from("families").update({ vault_folder_id: familyTopId }).eq("id", family.id);

    // 2. The household's tree inside it.
    const householdFolder = await driveCreateFolder(withVaultSuffix(`${lastName} Household`), familyTopId!, accessToken);
    const vaultFolder = await driveCreateFolder(HOUSEHOLD_DOCS, householdFolder.id, accessToken);
    await driveCreateFolder(PERSONAL_DOCS, householdFolder.id, accessToken);

    const { data: templates } = await admin
      .from("vault_folder_templates")
      .select("display_name, position")
      .eq("is_active", true)
      .order("position");
    for (const t of templates ?? []) {
      await driveCreateFolder(t.display_name, vaultFolder.id, accessToken);
    }

    const advisorFolder = await driveCreateFolder("Advisor Files", householdFolder.id, accessToken);
    for (const sub of ADVISOR_SUBFOLDERS) {
      await driveCreateFolder(sub, advisorFolder.id, accessToken);
    }

    await admin.from("households").update({ vault_root_folder_id: vaultFolder.id, vault_folder_id: householdFolder.id }).eq("id", householdId);
    // A forced rebuild starts the personal drawers over too (the old ones stay in Drive, unlinked).
    if (opts.force || opts.rebuild) await admin.from("contacts").update({ personal_vault_folder_id: null }).eq("household_id", householdId);
    // The Shoebox is found or created under the new root the first time it is needed.
    await admin.from("households").update({ vault_shoebox_folder_id: null }).eq("id", householdId);

    // 3. A personal drawer for each adult already in the household.
    let personalDrawers = 0;
    try { personalDrawers = await ensurePersonalDrawers(admin, householdId, accessToken, source); }
    catch (e) { console.error("[vault-provisioning] personal drawers:", e instanceof Error ? e.message : String(e)); }

    // One audit entry for the Vault being created (not one per folder): the start of the household's audit file.
    // Logging must never undo or fail an enrolment that otherwise worked.
    try {
      const { error: auditErr } = await admin.from("vault_audit_log").insert(buildVaultCreatedRow({
        householdId, rootFolderId: vaultFolder.id, rootFolderName: vaultFolder.name ?? null, categoryFolders: (templates ?? []).length, source,
        familyId: family?.id ?? null, familyDocsCreated, personalDrawers, requestedBy: opts.requestedBy ?? null,
      }));
      if (auditErr) console.error("[vault-provisioning] could not log Vault creation:", auditErr.message);
    } catch (e) {
      console.error("[vault-provisioning] could not log Vault creation:", e instanceof Error ? e.message : String(e));
    }

    return { ok: true, vaultRootFolderId: vaultFolder.id, personalDrawers, previousRoot: household.vault_root_folder_id ?? null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Builds a corporation's vault inside its home household's Household Vault folder and records it. Idempotent.
 *
 *   {Household} Household Vault
 *     Entity Vaults                     (created once per household; households.entity_vaults_folder_id)
 *       {Corp} Vault                    <- corporations.vault_folder_id (navigation only)
 *         Corporate Docs                <- corporations.vault_root_folder_id (the access root; category folders inside)
 *         Corporate Advisor Files       (staff only)
 *
 * Access is explicit (entity_vault_access); nothing is granted by ownership or household role.
 */
// deno-lint-ignore no-explicit-any
export async function provisionEntityVault(
  admin: any,
  corporationId: string,
  source = "staff",
  opts: { requestedBy?: { id: string; email: string | null } | null } = {},
): Promise<{ ok: boolean; vaultRootFolderId?: string; alreadyExists?: boolean; error?: string }> {
  const { data: corp } = await admin
    .from("corporations")
    .select("id, name, vault_folder_id, vault_root_folder_id, home_household_id")
    .eq("id", corporationId)
    .maybeSingle();
  if (!corp) return { ok: false, error: "corporation_not_found" };
  if (corp.vault_root_folder_id) return { ok: true, vaultRootFolderId: corp.vault_root_folder_id, alreadyExists: true };
  if (!corp.home_household_id) return { ok: false, error: "no_home_household" };

  const { data: hh } = await admin
    .from("households")
    .select("id, vault_folder_id, entity_vaults_folder_id")
    .eq("id", corp.home_household_id)
    .maybeSingle();
  if (!hh?.vault_folder_id) return { ok: false, error: "household_no_vault" };

  try {
    const token = await getServiceGoogleAccessToken(admin);
    let entityVaultsId: string | null = hh.entity_vaults_folder_id ?? null;
    if (!entityVaultsId) {
      // Reuse an existing "Entity Vaults" folder rather than creating a second one (e.g. if the pointer was never saved).
      const kids = await driveListChildren(hh.vault_folder_id, token);
      entityVaultsId = kids.find((k) => k.mimeType === "application/vnd.google-apps.folder" && k.name === ENTITY_VAULTS)?.id ?? null;
      if (!entityVaultsId) entityVaultsId = (await driveCreateFolder(ENTITY_VAULTS, hh.vault_folder_id, token)).id;
      await admin.from("households").update({ entity_vaults_folder_id: entityVaultsId }).eq("id", hh.id);
    }
    const top = await driveCreateFolder(withVaultSuffix(String(corp.name).trim()), entityVaultsId!, token);
    const docs = await driveCreateFolder(CORPORATE_DOCS, top.id, token);
    for (const c of CORPORATE_CATEGORIES) await driveCreateFolder(c, docs.id, token);
    await driveCreateFolder(CORPORATE_ADVISOR_FILES, top.id, token);
    await admin.from("corporations").update({ vault_folder_id: top.id, vault_root_folder_id: docs.id, vault_provisioned_at: new Date().toISOString() }).eq("id", corp.id);

    try {
      const { error } = await admin.from("vault_audit_log").insert(buildEntityVaultRow({
        householdId: hh.id, corporationId: corp.id, corporationName: corp.name, folderId: docs.id, folderName: top.name ?? null, source, requestedBy: opts.requestedBy ?? null,
      }));
      if (error) console.error("[vault-provisioning] could not log entity vault:", error.message);
    } catch (e) {
      console.error("[vault-provisioning] could not log entity vault:", e instanceof Error ? e.message : String(e));
    }
    return { ok: true, vaultRootFolderId: docs.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
