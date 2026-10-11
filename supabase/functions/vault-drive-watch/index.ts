// vault-drive-watch — records edits made directly in Google Drive (outside the app) to files inside a
// household's Vault, so the Vault audit log also covers changes the app never saw.
//
// Called every 10 minutes by a pg_cron job with a shared secret. It reads Drive's change feed for the
// connected Workspace account, keeps only changes inside a household's Vault folder tree, compares each file
// with the snapshot it last saw, and writes an audit entry per real change (create, modify, rename, move,
// trash, restore, sharing change, removed). Changes the app made itself are already in the log and are
// skipped (matched by drive_id and time). Nothing here changes anything in Drive: it only reads.
//
// Honest limits: it sees changes from the moment the watch started; it polls (up to ~10 minutes of delay);
// and it only sees what the connected account can see.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceGoogleAccessToken } from "../_shared/google-token.ts";
import { deriveDriveEvents, permissionsSummary, withinAppWindow, isFolderMime, APP_CHANGE_WINDOW_MS, type DriveSnapshot } from "../_shared/drive-watch.ts";
import { logSystemHealth } from "../_shared/system-health.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("VAULT_DRIVE_WATCH_CRON_SECRET");
const DRIVE = "https://www.googleapis.com/drive/v3";
const MAX_PAGES = 30;
const TIME_BUDGET_MS = 100_000;
const PROVISION_WINDOW_MS = 10 * 60_000;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const FILE_FIELDS = "id,name,mimeType,parents,trashed,createdTime,modifiedTime,md5Checksum,size,version,lastModifyingUser(displayName,emailAddress),permissions(type,role,emailAddress,domain)";

async function drive(path: string, token: string): Promise<any> {
  const res = await fetch(`${DRIVE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-vault-watch-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const started = Date.now();
  const stats = { pages: 0, changesSeen: 0, inVault: 0, logged: 0, skippedAppMade: 0, started: false };
  try {
    const token = await getServiceGoogleAccessToken(db);

    const { data: watch } = await db.from("vault_drive_watch").select("*").eq("id", 1).maybeSingle();
    if (!watch?.page_token) {
      const start = await drive("/changes/startPageToken?supportsAllDrives=true", token);
      await db.from("vault_drive_watch").upsert({ id: 1, page_token: start.startPageToken, baseline_at: new Date().toISOString(), last_run_at: new Date().toISOString(), last_error: null });
      stats.started = true;
      return json({ ok: true, ...stats });
    }

    // Vault roots → household, and what we already know about folders.
    const { data: hh } = await db.from("households").select("id, vault_root_folder_id").not("vault_root_folder_id", "is", null);
    const rootToHousehold = new Map<string, string>((hh ?? []).map((h: any) => [h.vault_root_folder_id, h.id]));
    const { data: mapRows } = await db.from("vault_drive_folder_map").select("folder_id, household_id");
    const folderMap = new Map<string, string | null>((mapRows ?? []).map((r: any) => [r.folder_id, r.household_id]));

    // Which household does a folder belong to? Walk up to a Vault root, remembering every folder on the way.
    const householdOfFolder = async (folderId: string): Promise<string | null> => {
      const trail: string[] = [];
      let cur: string | undefined = folderId;
      let result: string | null = null;
      for (let depth = 0; cur && depth < 15; depth++) {
        if (rootToHousehold.has(cur)) { result = rootToHousehold.get(cur)!; break; }
        if (folderMap.has(cur)) { result = folderMap.get(cur)!; break; }
        trail.push(cur);
        try {
          const f = await drive(`/files/${cur}?supportsAllDrives=true&fields=parents`, token);
          cur = f.parents?.[0];
        } catch { cur = undefined; }
      }
      const rows = trail.map((id) => ({ folder_id: id, household_id: result, checked_at: new Date().toISOString() }));
      for (const r of rows) folderMap.set(r.folder_id, result);
      if (rows.length) await db.from("vault_drive_folder_map").upsert(rows);
      return result;
    };
    const householdOf = async (parents: string[]): Promise<string | null> => {
      for (const p of parents) { const h = await householdOfFolder(p); if (h) return h; }
      return null;
    };

    let pageToken: string = watch.page_token;
    for (let page = 0; page < MAX_PAGES && Date.now() - started < TIME_BUDGET_MS; page++) {
      const list = await drive(
        `/changes?pageToken=${encodeURIComponent(pageToken)}&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true&includeRemoved=true&fields=nextPageToken,newStartPageToken,changes(time,removed,fileId,file(${FILE_FIELDS}))`,
        token,
      );
      stats.pages++;
      for (const ch of list.changes ?? []) {
        stats.changesSeen++;
        const fileId: string | undefined = ch.fileId ?? ch.file?.id;
        if (!fileId) continue;
        const { data: prevRow } = await db.from("vault_drive_state").select("*").eq("drive_id", fileId).maybeSingle();

        if (ch.removed || !ch.file) {
          if (prevRow) {
            await record(prevRow.household_id, fileId, prevRow.name, null, "drive_external_removed", { name: prevRow.name, note: "removed from Drive, or no longer visible to the connected account" }, ch.time, stats);
            await db.from("vault_drive_state").delete().eq("drive_id", fileId);
          }
          continue;
        }
        const f = ch.file;
        const parentIds: string[] = f.parents ?? [];
        // A folder that itself moved may now belong elsewhere: forget what we cached about it.
        if (isFolderMime(f.mimeType) && folderMap.has(fileId)) { folderMap.delete(fileId); await db.from("vault_drive_folder_map").delete().eq("folder_id", fileId); }
        const household = (await householdOf(parentIds)) ?? prevRow?.household_id ?? null;
        if (!household) continue;
        stats.inVault++;

        const next: DriveSnapshot = {
          name: f.name ?? "", parentIds, trashed: !!f.trashed, md5: f.md5Checksum ?? null, version: f.version ?? null, size: f.size ?? null,
          mimeType: f.mimeType ?? null, isFolder: isFolderMime(f.mimeType), permissions: permissionsSummary(f.permissions),
        };
        const prev: DriveSnapshot | null = prevRow ? {
          name: prevRow.name, parentIds: prevRow.parent_ids ?? [], trashed: !!prevRow.trashed, md5: prevRow.md5, version: prevRow.version, size: prevRow.size,
          mimeType: prevRow.mime_type, isFolder: !!prevRow.is_folder, permissions: prevRow.permissions ?? [],
        } : null;
        const events = deriveDriveEvents(prev, next, { changeTime: ch.time, createdTime: f.createdTime ?? null });

        if (events.length) {
          // Changes the app made itself are already logged: same file, within a few minutes.
          const from = new Date(Date.parse(ch.time) - APP_CHANGE_WINDOW_MS).toISOString();
          const to = new Date(Date.parse(ch.time) + APP_CHANGE_WINDOW_MS).toISOString();
          const { data: appRows } = await db.from("vault_audit_log").select("created_at").eq("drive_id", fileId).neq("actor_type", "drive_external").gte("created_at", from).lte("created_at", to).limit(10);
          const appMade = withinAppWindow(ch.time, (appRows ?? []).map((r: any) => r.created_at));
          // Folders created while the app provisions a Vault are not individually logged by it.
          let provisioning = false;
          if (!appMade && next.isFolder && events.some((e) => e.action === "drive_external_create")) {
            const pf = new Date(Date.parse(ch.time) - PROVISION_WINDOW_MS).toISOString();
            const pt = new Date(Date.parse(ch.time) + PROVISION_WINDOW_MS).toISOString();
            const { data: prov } = await db.from("vault_audit_log").select("id").eq("household_id", household).in("action", ["provision", "reprovision", "set_root", "create_folder"]).gte("created_at", pf).lte("created_at", pt).limit(1);
            provisioning = (prov?.length ?? 0) > 0;
          }
          if (appMade || provisioning) stats.skippedAppMade += events.length;
          else for (const e of events) await record(household, fileId, next.name, f.lastModifyingUser, e.action, e.metadata, ch.time, stats);
        }
        await db.from("vault_drive_state").upsert({
          drive_id: fileId, household_id: household, name: next.name, parent_ids: next.parentIds, trashed: next.trashed, md5: next.md5, version: next.version,
          size: next.size, mime_type: next.mimeType, is_folder: next.isFolder, permissions: next.permissions, seen_at: new Date().toISOString(),
        });
      }
      pageToken = list.nextPageToken ?? list.newStartPageToken ?? pageToken;
      await db.from("vault_drive_watch").update({ page_token: pageToken, last_run_at: new Date().toISOString(), last_error: null }).eq("id", 1);
      if (!list.nextPageToken) break;
    }
    return json({ ok: true, ...stats, ms: Date.now() - started });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[vault-drive-watch]", message);
    await db.from("vault_drive_watch").update({ last_error: message.slice(0, 500), last_run_at: new Date().toISOString() }).eq("id", 1);
    await logSystemHealth(db as any, { function_name: "vault-drive-watch", severity: "ERROR", error_code: "DRIVE_WATCH_FAILED", error_message: message.slice(0, 900) });
    return json({ ok: false, error: message, ...stats }, 500);
  }
});

async function record(household: string | null, driveId: string, name: string | null, user: { displayName?: string; emailAddress?: string } | null, action: string, metadata: Record<string, unknown>, changeTime: string, stats: { logged: number }) {
  const { error } = await db.from("vault_audit_log").insert({
    household_id: household, actor_type: "drive_external", actor_id: null,
    actor_label: user?.displayName ? `drive:${user.displayName}` : "drive:unknown", actor_email: user?.emailAddress ?? null,
    action, drive_id: driveId, drive_name: name, ip: null, user_agent: null,
    metadata: { ...metadata, drive_change_time: changeTime, via: "Google Drive (outside the app)" },
  });
  if (error) {
    console.error("[vault-drive-watch] audit insert failed:", error.message);
    await logSystemHealth(db as any, { function_name: "vault-drive-watch", severity: "ERROR", error_code: "VAULT_AUDIT_WRITE_FAILED", household_id: household, error_message: `drive watch audit write failed for "${action}": ${error.message}`.slice(0, 900) });
    return;
  }
  stats.logged++;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
