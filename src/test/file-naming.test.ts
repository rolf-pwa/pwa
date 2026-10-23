import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOC_FILE_NAME, conventionFile, conventionName, shortDate } from "../../supabase/functions/_shared/file-naming";

const rolf = { first_name: "Rolf", last_name: "Issler" }, lisa = { first_name: "Lisa", last_name: "Issler" };

describe("the file naming convention: yy-mm-dd_lastname_init_docname", () => {
  it("names the signed disclosure and the reason-why letter as asked", () => {
    expect(conventionFile("2026-10-23", [rolf, lisa], DOC_FILE_NAME.disclosure_privacy)).toBe("26-10-23_Issler_RL_Advisor Disclosure.pdf");
    expect(conventionFile("2026-10-23", [rolf], DOC_FILE_NAME.reason_why)).toBe("26-10-23_Issler_R_Reason Why.pdf");
  });
  it("uses the date as yy-mm-dd and the initials of every signer in order", () => {
    expect(shortDate("2026-01-05")).toBe("26-01-05");
    expect(conventionName("2027-03-09", [lisa, rolf], "Fact Find")).toBe("27-03-09_Issler_LR_Fact Find");
  });
  it("joins different last names with a hyphen", () => {
    expect(conventionName("2026-10-23", [{ first_name: "Thomas", last_name: "Wolfe" }, { first_name: "Sarah", last_name: "Smith" }], "Advisor Disclosure")).toBe("26-10-23_Wolfe-Smith_TS_Advisor Disclosure");
  });
  it("falls back to the full name, and never produces an empty or unsafe name", () => {
    expect(conventionName("2026-10-23", [{ full_name: "Colleen Van Dyk" }], "Needs Analysis")).toBe("26-10-23_Dyk_C_Needs Analysis");
    expect(conventionName("2026-10-23", [], "Needs Analysis")).toBe("26-10-23_Client_X_Needs Analysis");
    expect(conventionName("2026-10-23", [{ first_name: "A", last_name: "B/C" }], "Alternatives Considered Term/Life")).toBe("26-10-23_B-C_A_Alternatives Considered Term-Life");
  });
  it("has a plain name for every kind of document", () => {
    for (const k of ["disclosure_privacy", "reason_why", "fact_find", "replacement_declaration", "replacement_explanation", "needs_analysis", "alternatives"]) expect(DOC_FILE_NAME[k], k).toBeTruthy();
  });
  it("is what the signed documents, needs analyses and comparisons are saved under", () => {
    expect(readFileSync("supabase/functions/_shared/insurance-doc-service.ts", "utf8")).toContain('"Signed Documents", conventionFile(ymd(), ordered, DOC_FILE_NAME[d.kind] ?? d.title)');
    expect(readFileSync("supabase/functions/_shared/insurance-doc-service.ts", "utf8")).toContain("DOC_FILE_NAME.needs_analysis");
    expect(readFileSync("supabase/functions/_shared/quote-service.ts", "utf8")).toContain("conventionFile(ymd(), [c ?? {}]");
    expect(readFileSync("supabase/functions/_shared/insurance-doc-service.ts", "utf8")).not.toContain("(signed ${ymd()})");
  });
});
