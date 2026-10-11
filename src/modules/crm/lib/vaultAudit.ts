// Pure helpers for the Vault audit page: action grouping, plain-language details and CSV export.

export interface AuditRow {
  id: string;
  seq: number;
  created_at: string;
  household_id: string | null;
  contact_id: string | null;
  actor_type: string;
  actor_id: string | null;
  actor_label: string | null;
  actor_email: string | null;
  action: string;
  drive_id: string | null;
  drive_name: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  prev_hash: string | null;
  row_hash: string;
}

export type ActionGroup = "reads" | "changes" | "sharing" | "blocked" | "system";

export const ACTION_GROUPS: Record<ActionGroup, { label: string; hint: string; actions: string[] }> = {
  reads: { label: "Viewing", hint: "Folder listings, previews, downloads", actions: ["list", "preview", "download"] },
  changes: {
    label: "Changes", hint: "Uploads, renames, deletes, filing, visibility",
    actions: ["upload", "rename", "delete", "create_folder", "make_visible", "hide", "shoebox_file_filed", "shoebox_auto_filed", "shoebox_auto_file_undone", "bulk_statement_filed", "bulk_statements_revealed", "provision", "reprovision", "set_root"],
  },
  sharing: {
    label: "Sharing & access", hint: "Links, invitations, grants, roles",
    actions: ["share_link_created", "share_link_revoked", "share_link_redeemed", "share_link_email_sent", "share_link_email_failed", "invite_collaborator", "revoke_collaborator", "vault_invite_email_sent", "vault_invite_email_failed", "vault_collaborator_otp_sent", "vault_collaborator_otp_failed", "add_grant", "update_grant", "reissue_guest_token", "share_with_professional", "set_contact_role", "set_contact_grant", "revoke_contact_grant"],
  },
  blocked: { label: "Blocked", hint: "Attempts the Vault refused", actions: ["firewall_block"] },
  system: { label: "System", hint: "Scans and reads of this log", actions: ["shoebox_scan", "audit_log_csv_export", "audit_log_integrity_check"] },
};

export const ALL_KNOWN_ACTIONS = Object.values(ACTION_GROUPS).flatMap((g) => g.actions);

export function groupOf(action: string): ActionGroup | "other" {
  for (const [key, g] of Object.entries(ACTION_GROUPS)) if (g.actions.includes(action)) return key as ActionGroup;
  return "other";
}

const LABELS: Record<string, string> = {
  list: "Viewed folder", preview: "Previewed file", download: "Downloaded file", upload: "Uploaded file", rename: "Renamed",
  delete: "Moved to trash", create_folder: "Created folder", make_visible: "Made visible to client", hide: "Hidden from client",
  shoebox_file_filed: "Filed from Shoebox", shoebox_auto_filed: "Auto-filed from Shoebox", shoebox_auto_file_undone: "Undid auto-filing",
  bulk_statement_filed: "Filed statement (bulk)", bulk_statements_revealed: "Revealed bulk statements", provision: "Created Vault", reprovision: "Re-created Vault", set_root: "Set Vault root",
  share_link_created: "Created share link", share_link_revoked: "Revoked share link", share_link_redeemed: "Opened share link", share_link_email_sent: "Emailed share link", share_link_email_failed: "Share-link email failed",
  invite_collaborator: "Invited collaborator", revoke_collaborator: "Revoked collaborator", vault_invite_email_sent: "Emailed Vault invitation", vault_invite_email_failed: "Vault invitation email failed",
  vault_collaborator_otp_sent: "Sent unlock code", vault_collaborator_otp_failed: "Unlock code email failed", add_grant: "Granted access", update_grant: "Changed access", reissue_guest_token: "Re-issued guest access",
  share_with_professional: "Shared with professional", set_contact_role: "Set client role", set_contact_grant: "Granted client access", revoke_contact_grant: "Revoked client access",
  firewall_block: "Blocked by Vault", shoebox_scan: "Scanned Shoebox", audit_log_csv_export: "Exported audit log", audit_log_integrity_check: "Checked audit log integrity",
};
export const actionLabel = (action: string) => LABELS[action] ?? action.replace(/_/g, " ");

const size = (n: unknown) => {
  const b = Number(n);
  if (!Number.isFinite(b)) return "";
  return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`;
};

/** One line saying what happened, from the row's details. Full details stay in the expanded view and the export. */
export function describeDetails(row: Pick<AuditRow, "action" | "metadata">): string {
  const m = (row.metadata ?? {}) as Record<string, unknown>;
  const s = (k: string) => (m[k] == null ? "" : String(m[k]));
  switch (row.action) {
    case "rename": return s("old_name") || s("new_name") ? `“${s("old_name") || "?"}” → “${s("new_name")}”` : "";
    case "delete": return m.trashed ? "Moved to Drive trash (recoverable)" : "";
    case "upload": return [size(m.size_bytes), s("mime_type"), s("sha256") ? `sha256 ${s("sha256").slice(0, 12)}…` : ""].filter(Boolean).join(" · ");
    case "firewall_block": return `Refused: ${s("reason") || "no reason recorded"}${s("op") ? ` (${s("op")})` : ""}`;
    case "share_link_created": return [s("link_type"), s("permission")].filter(Boolean).join(", ");
    case "add_grant": case "set_contact_grant": return [s("scope_type"), s("permission")].filter(Boolean).join(", ");
    case "invite_collaborator": return s("email");
    case "list": return m.count != null ? `${s("count")} items` : "";
    case "audit_log_csv_export": return `${s("row_count")} rows`;
    case "audit_log_integrity_check": return "";
    default: {
      const keys = Object.keys(m).filter((k) => k !== "household_id").slice(0, 3);
      return keys.map((k) => `${k}: ${typeof m[k] === "object" ? JSON.stringify(m[k]) : String(m[k])}`).join(" · ");
    }
  }
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** Quote a cell, and defuse spreadsheet formulas (a cell starting with = + - @ is read as a formula by Excel). */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface CsvLookups {
  household: (id: string | null) => string;
  actor: (row: AuditRow) => string;
  contact: (id: string | null) => string;
}

export const CSV_HEADERS = ["seq", "time_utc", "household", "actor_type", "actor", "action", "what_happened", "file_name", "drive_id", "contact", "ip", "user_agent", "details_json", "prev_hash", "row_hash"];

/** Includes seq, prev_hash and row_hash so the export can be checked against the live chain. */
export function toCsv(rows: AuditRow[], lk: CsvLookups): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push([
      r.seq, new Date(r.created_at).toISOString(), lk.household(r.household_id), r.actor_type, lk.actor(r), r.action, describeDetails(r),
      r.drive_name, r.drive_id, lk.contact(r.contact_id), r.ip, r.user_agent, JSON.stringify(r.metadata ?? {}), r.prev_hash, r.row_hash,
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
