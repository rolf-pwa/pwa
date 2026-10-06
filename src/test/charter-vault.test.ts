import { describe, expect, it } from "vitest";
import { findCharterSubfolder, looksUnratified, pickCharterFile, type DriveItem } from "../../supabase/functions/_shared/charter-vault-pick";

const f = (name: string, modifiedTime = "2026-01-01T00:00:00Z", mimeType = "application/pdf"): DriveItem => ({ id: name, name, mimeType, modifiedTime });
const folder = (name: string): DriveItem => ({ id: name, name, mimeType: "application/vnd.google-apps.folder" });

describe("charter selection", () => {
  it("prefers the Charter subfolder, newest final file", () => {
    const pick = pickCharterFile([folder("Charter"), f("letter.pdf")], [f("Charter 2025.pdf", "2025-03-01T00:00:00Z"), f("Charter 2026.pdf", "2026-03-01T00:00:00Z")]);
    expect(pick).toMatchObject({ name: "Charter 2026.pdf", ratified: true, viaSubfolder: true });
  });
  it("skips drafts when a final exists, but falls back to a draft marked not ratified", () => {
    expect(pickCharterFile([], [f("Charter DRAFT.pdf", "2026-05-01T00:00:00Z"), f("Charter signed.pdf", "2026-01-01T00:00:00Z")])?.name).toBe("Charter signed.pdf");
    expect(pickCharterFile([], [f("Charter draft.pdf")])).toMatchObject({ ratified: false });
  });
  it("falls back to a top-level file with 'charter' in its name", () => {
    expect(pickCharterFile([f("Smith Sovereignty Charter - signed.pdf"), f("Cover letter.pdf")], null)).toMatchObject({ name: "Smith Sovereignty Charter - signed.pdf", viaSubfolder: false, ratified: true });
  });
  it("returns null when there is no charter", () => {
    expect(pickCharterFile([f("Cover letter.pdf"), folder("Letters")], null)).toBeNull();
    expect(pickCharterFile([folder("Charter")], [])).toBeNull();
  });
  it("finds the subfolder, exact name first", () => {
    expect(findCharterSubfolder([folder("Old charter stuff"), folder("Charter")])?.name).toBe("Charter");
    expect(findCharterSubfolder([folder("Letters")])).toBeNull();
  });
  it("flags unratified names", () => {
    expect(looksUnratified("Charter - DRAFT v2.pdf")).toBe(true);
    expect(looksUnratified("Charter signed.pdf")).toBe(false);
  });
});
