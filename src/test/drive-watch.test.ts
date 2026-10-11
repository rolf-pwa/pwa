import { describe, it, expect } from "vitest";
import { deriveDriveEvents, permissionsSummary, withinAppWindow, type DriveSnapshot } from "../../supabase/functions/_shared/drive-watch";

const snap = (o: Partial<DriveSnapshot> = {}): DriveSnapshot => ({
  name: "a.pdf", parentIds: ["p1"], trashed: false, md5: "m1", version: "3", size: "10", mimeType: "application/pdf", isFolder: false, permissions: ["user:owner:x@prosperwise.ca"], ...o,
});
const ctx = { changeTime: "2026-10-11T12:00:00Z", createdTime: "2026-01-01T00:00:00Z" };

describe("deriveDriveEvents", () => {
  it("reports nothing when nothing we track changed", () => {
    expect(deriveDriveEvents(snap(), snap({ version: "4" }), ctx)).toEqual([]);
  });
  it("sees a rename, a move, a trash and a content change together", () => {
    const e = deriveDriveEvents(snap(), snap({ name: "b.pdf", parentIds: ["p2"], trashed: true, md5: "m2" }), ctx).map((x) => x.action);
    expect(e).toEqual(["drive_external_trash", "drive_external_rename", "drive_external_move", "drive_external_modify"]);
  });
  it("records old and new names", () => {
    const [e] = deriveDriveEvents(snap(), snap({ name: "renamed.pdf" }), ctx);
    expect(e).toMatchObject({ action: "drive_external_rename", metadata: { old_name: "a.pdf", new_name: "renamed.pdf" } });
  });
  it("sees restore from trash", () => {
    expect(deriveDriveEvents(snap({ trashed: true }), snap(), ctx)[0].action).toBe("drive_external_restore");
  });
  it("flags sharing changes, and a public link in particular", () => {
    const [e] = deriveDriveEvents(snap(), snap({ permissions: ["anyone:reader", "user:owner:x@prosperwise.ca"] }), ctx);
    expect(e).toMatchObject({ action: "drive_external_sharing_change", metadata: { added: ["anyone:reader"], removed: [], public_link: true } });
  });
  it("treats a file created moments ago as new, and an old unseen file as a change of unknown state", () => {
    expect(deriveDriveEvents(null, snap(), { changeTime: "2026-10-11T12:00:00Z", createdTime: "2026-10-11T11:55:00Z" })[0].action).toBe("drive_external_create");
    const [e] = deriveDriveEvents(null, snap(), ctx);
    expect(e.action).toBe("drive_external_modify");
    expect(e.metadata.note).toMatch(/earlier state unknown/);
  });
  it("uses version when Google-native files have no checksum", () => {
    const e = deriveDriveEvents(snap({ md5: null, version: "5" }), snap({ md5: null, version: "6" }), ctx);
    expect(e.map((x) => x.action)).toEqual(["drive_external_modify"]);
  });
});

describe("helpers", () => {
  it("summarises permissions in a stable order", () => {
    expect(permissionsSummary([{ type: "user", role: "writer", emailAddress: "b@x.ca" }, { type: "anyone", role: "reader" }])).toEqual(["anyone:reader", "user:writer:b@x.ca"]);
  });
  it("matches Drive changes to the app's own audit entries within three minutes", () => {
    expect(withinAppWindow("2026-10-11T12:00:00Z", ["2026-10-11T12:02:00Z"])).toBe(true);
    expect(withinAppWindow("2026-10-11T12:00:00Z", ["2026-10-11T12:04:00Z"])).toBe(false);
  });
});
