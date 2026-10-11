import { describe, it, expect } from "vitest";
import { csvCell, toCsv, describeDetails, groupOf, actionLabel, type AuditRow } from "@/modules/crm/lib/vaultAudit";

const row = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: "i", seq: 1, created_at: "2026-10-09T20:44:01.467Z", household_id: "h", contact_id: null, actor_type: "staff", actor_id: "u", actor_label: "staff",
  actor_email: "rolf@prosperwise.ca", action: "rename", drive_id: "d1", drive_name: "new.pdf", ip: "1.1.1.1", user_agent: "UA", metadata: { old_name: "old.pdf", new_name: "new.pdf" },
  prev_hash: null, row_hash: "abc", ...over,
});

describe("vault audit helpers", () => {
  it("quotes cells and defuses spreadsheet formulas", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1 555")).toBe("'+1 555");
    expect(csvCell(null)).toBe("");
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });
  it("describes changes in plain language", () => {
    expect(describeDetails(row())).toBe("“old.pdf” → “new.pdf”");
    expect(describeDetails(row({ action: "firewall_block", metadata: { reason: "shoebox_only", op: "delete" } }))).toBe("Refused: shoebox_only (delete)");
    expect(describeDetails(row({ action: "upload", metadata: { size_bytes: 2048, mime_type: "application/pdf", sha256: "a".repeat(64) } }))).toBe("2.0 KB · application/pdf · sha256 aaaaaaaaaaaa…");
  });
  it("describes edits made in Google Drive", () => {
    expect(describeDetails(row({ action: "drive_external_rename", metadata: { old_name: "a.pdf", new_name: "b.pdf" } }))).toBe("“a.pdf” → “b.pdf”");
    expect(describeDetails(row({ action: "drive_external_sharing_change", metadata: { added: ["anyone:reader"], removed: [], public_link: true } }))).toBe("PUBLIC LINK ON · added anyone:reader");
    expect(groupOf("drive_external_trash")).toBe("changes");
    expect(groupOf("drive_external_sharing_change")).toBe("sharing");
    expect(actionLabel("drive_external_modify")).toBe("Edited in Google Drive");
  });
  it("groups known actions and leaves unknown ones as other", () => {
    expect(groupOf("download")).toBe("reads");
    expect(groupOf("firewall_block")).toBe("blocked");
    expect(groupOf("something_new")).toBe("other");
    expect(actionLabel("something_new")).toBe("something new");
  });
  it("exports a header, one line per row, and the hashes", () => {
    const csv = toCsv([row(), row({ seq: 2, row_hash: "def", prev_hash: "abc", household_id: null })], {
      household: (id) => (id ? "Peters" : ""), actor: (r) => r.actor_email ?? "", contact: () => "",
    });
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("row_hash");
    expect(lines[1]).toContain("2026-10-09T20:44:01.467Z,Peters,staff,rolf@prosperwise.ca,rename");
    expect(lines[2].endsWith(",abc,def")).toBe(true);
  });
});

import { buildVaultCreatedRow } from "../../supabase/functions/_shared/vault-audit-events";
describe("vault created entry", () => {
  it("is one system entry for the household with the root folder and source", () => {
    const row = buildVaultCreatedRow({ householdId: "h1", rootFolderId: "r1", rootFolderName: "1. ProsperWise Vault — Peters", categoryFolders: 9, source: "paid_booking" });
    expect(row).toMatchObject({ household_id: "h1", actor_type: "system", action: "provision", drive_id: "r1", drive_name: "1. ProsperWise Vault — Peters" });
    expect(row.metadata).toEqual({ household_id: "h1", auto: true, source: "paid_booking", category_folders: 9 });
  });
});
