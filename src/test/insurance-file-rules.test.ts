import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CHECKLIST, checklistFor, fileStatus, indexHtml, parseDriveId } from "../../supabase/functions/_shared/insurance-file-rules";

describe("what an insurance file must contain", () => {
  it("asks more of a sale or replacement than of an in-force review", () => {
    expect(checklistFor("new_sale").length).toBeGreaterThan(checklistFor("in_force_review").length);
    expect(checklistFor("new_sale").map((c) => c.kind)).toEqual(expect.arrayContaining(["advisor_disclosure", "needs_analysis", "alternatives", "recommendation", "application", "meeting_records"]));
  });
  it("needs the replacement disclosure only for a replacement", () => {
    expect(checklistFor("replacement").map((c) => c.kind)).toContain("replacement_disclosure");
    expect(checklistFor("new_sale").map((c) => c.kind)).not.toContain("replacement_disclosure");
  });
  it("keeps optional items out of the required list", () => {
    const req = new Set(checklistFor("replacement").map((c) => c.kind));
    expect(req.has("underwriting_notes")).toBe(false);
    expect(CHECKLIST.find((c) => c.kind === "other")?.requiredFor).toEqual([]);
  });
});

describe("is the file complete?", () => {
  it("counts an item done when evidence is attached or it is marked not applicable", () => {
    const need = checklistFor("new_sale");
    const items = need.slice(0, 3).map((c, i) => ({ kind: c.kind, status: i === 0 ? ("not_applicable" as const) : ("provided" as const) }));
    const st = fileStatus("new_sale", items);
    expect(st.done).toBe(3);
    expect(st.complete).toBe(false);
    expect(st.missing).toHaveLength(need.length - 3);
    expect(fileStatus("new_sale", need.map((c) => ({ kind: c.kind, status: "provided" as const }))).complete).toBe(true);
  });
});

describe("Drive links", () => {
  it("finds the file id in a link or a bare id, and nothing else", () => {
    expect(parseDriveId("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012/edit")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz012");
    expect(parseDriveId("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012/view?usp=sharing")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz012");
    expect(parseDriveId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz012");
    expect(parseDriveId("1AbCdEfGhIjKlMnOpQrStUvWxYz012")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz012");
    expect(parseDriveId("not a link")).toBeNull();
    expect(parseDriveId("")).toBeNull();
  });
});

describe("the index document", () => {
  const base = { title: "Colleen, term 20", kindLabel: "New sale", household: "Jerczynski", client: "Colleen Jerczynski", policy: "Canada Life, term 20", openedYmd: "2026-10-01", createdYmd: "2026-10-22", createdBy: "rolf@prosperwise.ca", complete: false };
  it("lists every item with its status, evidence, date and who added it, and flags what is missing", () => {
    const html = indexHtml({ ...base, rows: [
      { label: "Needs analysis", required: true, status: "provided", evidence: "Needs analysis.pdf", url: "https://drive.google.com/x", addedYmd: "2026-10-05", addedBy: "rolf@prosperwise.ca", note: null },
      { label: "Replacement disclosure", required: false, status: "not_applicable", evidence: "Marked not applicable", url: null, addedYmd: "2026-10-05", addedBy: "rolf@prosperwise.ca", note: "No policy replaced" },
      { label: "Signed application", required: true, status: "missing", evidence: "", url: null, addedYmd: null, addedBy: null, note: null },
    ] });
    expect(html).toContain("Needs analysis.pdf");
    expect(html).toContain("Provided");
    expect(html).toContain("<b>Missing</b>");
    expect(html).toContain("No policy replaced");
    expect(html).toContain("Some required items are missing");
  });
  it("escapes what is put in it", () => {
    const html = indexHtml({ ...base, title: "<script>x</script>", rows: [] });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("the plumbing", () => {
  const svc = readFileSync("supabase/functions/_shared/insurance-file-service.ts", "utf8");
  it("only copies and creates in Drive: nothing is moved or deleted", () => {
    expect(svc).not.toMatch(/method: "DELETE"|trashed: true|\/trash/); // only the database row of an attachment can be removed, never a Drive file
    expect(svc).toContain("/copy?supportsAllDrives=true");
  });
  it("is reachable from the app, and checked each morning", () => {
    const admin = readFileSync("supabase/functions/review-agent-admin/index.ts", "utf8");
    for (const a of ["insFiles", "insFileCreate", "insFileAttach", "insFileRemoveItem", "insFilePackage"]) expect(admin).toContain(`"${a}"`);
    expect(readFileSync("supabase/functions/daily-briefing-generate/index.ts", "utf8")).toContain('trackJob(db, "insurance_file_check"');
  });
});

describe("the database change", () => {
  it("is in the repository, with both tables, their grants and the daily job", () => {
    const sql = readFileSync("supabase/migrations/20261214120000_insurance_files.sql", "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.insurance_files");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.insurance_file_items");
    expect(sql).toContain("GRANT ALL ON public.insurance_files, public.insurance_file_items TO service_role");
    expect(sql).toContain("insurance_file_check");
  });
});
