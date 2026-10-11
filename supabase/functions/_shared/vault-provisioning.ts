// vault-provisioning.ts
// Autonomous Drive folder-tree creation for a brand-new paid household —
// no external agent, no staff click. Builds:
//
//   [LastName] Family
//     [LastName] Household
//       1. ProsperWise Vault — [LastName] (First & First)   <- vault_root_folder_id
//         00 Shoebox (Client Uploads) ... 99 From Collaborators  (from vault_folder_templates)
//       Advisor Files
//         Insurance / Investment / Meeting Notes / Working Files
//
// Requires CLIENT_VAULT_ROOT_FOLDER_ID (the Drive folder every "[LastName]
// Family" folder is created directly inside) and a connected Google account
// in `google_tokens` (see _shared/google-token.ts).

import { buildVaultCreatedRow } from "./vault-audit-events.ts";
import { getServiceGoogleAccessToken } from "./google-token.ts";

const CLIENT_ROOT_FOLDER_ID = Deno.env.get("CLIENT_VAULT_ROOT_FOLDER_ID");
const ADVISOR_SUBFOLDERS = ["Insurance", "Investment", "Meeting Notes", "Working Files"];
const ADULT_ROLE_PRIORITY: Record<string, number> = { head_of_family: 0, spouse: 1 };

async function driveCreateFolder(name: string, parentId: string, accessToken: string) {
  const r = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,parents", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  if (!r.ok) throw new Error(`drive_create_folder_failed (${name}): ${await r.text()}`);
  return r.json();
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
  error?: string;
}

/**
 * Builds the full Family/Household/Vault/Advisor-Files tree for a household
 * that doesn't have one yet, and stamps households.vault_root_folder_id.
 * Idempotent: no-ops (ok: true) if the household is already provisioned.
 */
// deno-lint-ignore no-explicit-any
export async function provisionClientFolderTree(admin: any, householdId: string, source = "automatic"): Promise<ProvisionResult> {
  if (!CLIENT_ROOT_FOLDER_ID) {
    return { ok: false, error: "CLIENT_VAULT_ROOT_FOLDER_ID is not configured" };
  }

  const { data: household } = await admin
    .from("households")
    .select("id, label, vault_root_folder_id")
    .eq("id", householdId)
    .maybeSingle();
  if (!household) return { ok: false, error: "household_not_found" };
  if (household.vault_root_folder_id) {
    return { ok: true, vaultRootFolderId: household.vault_root_folder_id };
  }

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

  const firstNames = adults.map((c: any) => c.first_name?.trim()).filter(Boolean);
  const peopleLabel = firstNames.length ? firstNames.join(" & ") : lastName;

  let accessToken: string;
  try {
    accessToken = await getServiceGoogleAccessToken(admin);
  } catch (e) {
    return { ok: false, error: `google_auth_failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  try {
    const familyFolder = await driveCreateFolder(`${lastName} Family`, CLIENT_ROOT_FOLDER_ID, accessToken);
    const householdFolder = await driveCreateFolder(`${lastName} Household`, familyFolder.id, accessToken);

    const vaultFolder = await driveCreateFolder(
      `1. ProsperWise Vault — ${lastName} (${peopleLabel})`,
      householdFolder.id,
      accessToken,
    );

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

    await admin.from("households").update({ vault_root_folder_id: vaultFolder.id }).eq("id", householdId);

    // One audit entry for the Vault being created (not one per folder): the start of the household's audit file.
    // Logging must never undo or fail an enrolment that otherwise worked.
    try {
      const { error: auditErr } = await admin.from("vault_audit_log").insert(buildVaultCreatedRow({
        householdId, rootFolderId: vaultFolder.id, rootFolderName: vaultFolder.name ?? null, categoryFolders: (templates ?? []).length, source,
      }));
      if (auditErr) console.error("[vault-provisioning] could not log Vault creation:", auditErr.message);
    } catch (e) {
      console.error("[vault-provisioning] could not log Vault creation:", e instanceof Error ? e.message : String(e));
    }

    return { ok: true, vaultRootFolderId: vaultFolder.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
