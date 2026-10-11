// Turning raw Google Drive changes into audit events, for edits made directly in Drive (outside the app).
// Pure (no I/O) so it is unit-tested; the vault-drive-watch function does the fetching and writing.

export interface DriveSnapshot {
  name: string;
  parentIds: string[];
  trashed: boolean;
  md5: string | null;
  version: string | null;
  size: string | null;
  mimeType: string | null;
  isFolder: boolean;
  /** Sorted, comparable one-liners such as "user:writer:a@b.ca" or "anyone:reader". */
  permissions: string[];
}

export interface DriveEvent {
  action:
    | "drive_external_create"
    | "drive_external_modify"
    | "drive_external_rename"
    | "drive_external_move"
    | "drive_external_trash"
    | "drive_external_restore"
    | "drive_external_sharing_change"
    | "drive_external_removed";
  metadata: Record<string, unknown>;
}

export interface RawPermission { type?: string; role?: string; emailAddress?: string; domain?: string }

export function permissionsSummary(perms: RawPermission[] | undefined | null): string[] {
  return (perms ?? [])
    .map((p) => [p.type ?? "?", p.role ?? "?", p.emailAddress ?? p.domain ?? ""].filter((x, i) => i < 2 || x).join(":"))
    .sort();
}

const FOLDER = "application/vnd.google-apps.folder";
export const isFolderMime = (mime: string | null | undefined) => mime === FOLDER;

/** A file first seen with no earlier snapshot counts as new only if it was created moments before the change. */
const NEW_FILE_WINDOW_MS = 15 * 60_000;

export function deriveDriveEvents(
  prev: DriveSnapshot | null,
  next: DriveSnapshot,
  ctx: { changeTime: string; createdTime: string | null },
): DriveEvent[] {
  if (!prev) {
    const created = ctx.createdTime ? Date.parse(ctx.changeTime) - Date.parse(ctx.createdTime) : Infinity;
    if (created >= 0 && created <= NEW_FILE_WINDOW_MS) {
      return [{ action: "drive_external_create", metadata: { name: next.name, mime_type: next.mimeType, size: next.size, md5: next.md5, parent_ids: next.parentIds } }];
    }
    // We have no earlier picture of this file, so say so rather than guess what changed.
    return [{ action: next.trashed ? "drive_external_trash" : "drive_external_modify", metadata: { name: next.name, note: "first seen by the Drive watcher; earlier state unknown", md5: next.md5, version: next.version } }];
  }
  const out: DriveEvent[] = [];
  if (!prev.trashed && next.trashed) out.push({ action: "drive_external_trash", metadata: { name: next.name } });
  if (prev.trashed && !next.trashed) out.push({ action: "drive_external_restore", metadata: { name: next.name } });
  if (prev.name !== next.name) out.push({ action: "drive_external_rename", metadata: { old_name: prev.name, new_name: next.name } });
  const movedFrom = prev.parentIds.filter((p) => !next.parentIds.includes(p));
  const movedTo = next.parentIds.filter((p) => !prev.parentIds.includes(p));
  if (movedFrom.length || movedTo.length) out.push({ action: "drive_external_move", metadata: { from_folder_ids: movedFrom, to_folder_ids: movedTo } });
  const contentChanged = !next.isFolder && ((prev.md5 && next.md5 && prev.md5 !== next.md5) || (!prev.md5 && !next.md5 && prev.version !== next.version && prev.version !== null));
  if (contentChanged) out.push({ action: "drive_external_modify", metadata: { name: next.name, old_md5: prev.md5, new_md5: next.md5, old_size: prev.size, new_size: next.size } });
  const added = next.permissions.filter((p) => !prev.permissions.includes(p));
  const removed = prev.permissions.filter((p) => !next.permissions.includes(p));
  if (added.length || removed.length) out.push({ action: "drive_external_sharing_change", metadata: { name: next.name, added, removed, public_link: next.permissions.some((p) => p.startsWith("anyone")) } });
  return out;
}

/** Changes the app made itself are already in the log; a Drive change within this window of one of them is the same event. */
export const APP_CHANGE_WINDOW_MS = 180_000;

export function withinAppWindow(changeTime: string, appEventTimes: string[]): boolean {
  const t = Date.parse(changeTime);
  return appEventTimes.some((a) => Math.abs(Date.parse(a) - t) <= APP_CHANGE_WINDOW_MS);
}
