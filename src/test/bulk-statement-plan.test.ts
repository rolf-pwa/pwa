import { describe, expect, it } from "vitest";
import { planBulkStatement, normalizeContract, type AccountHit } from "../../supabase/functions/_shared/bulk-statement-plan";

const hit = (o: Partial<AccountHit> = {}): AccountHit => ({
  household_id: "h1", household_label: "Aamir", vault_root_folder_id: "root", contact_id: "c1", first_name: "Widaad", last_name: "Aamir", ...o,
});
const base = { contract: "1820293483", statementDate: "2026-06-30", hits: [hit()], existingNames: [] as string[], alreadyFiled: false };

describe("planBulkStatement", () => {
  it("names a matched statement from the contact and last 4 of the contract", () => {
    const p = planBulkStatement(base);
    expect(p.status).toBe("ready");
    expect(p.fileName).toBe("26-06-30_Aamir_W-InvestmentStatement_3483.pdf");
  });
  it("is unmatched when no account has the number", () => expect(planBulkStatement({ ...base, hits: [] }).status).toBe("unmatched"));
  it("is ambiguous when the number sits in two households", () => {
    expect(planBulkStatement({ ...base, hits: [hit(), hit({ household_id: "h2" })] }).status).toBe("ambiguous");
  });
  it("treats the same household appearing twice as one match", () => {
    expect(planBulkStatement({ ...base, hits: [hit({ contact_id: null }), hit()] }).hit?.contact_id).toBe("c1");
  });
  it("skips statements already imported or already in the Vault under that name", () => {
    expect(planBulkStatement({ ...base, alreadyFiled: true }).status).toBe("already_filed");
    expect(planBulkStatement({ ...base, existingNames: ["26-06-30_AAMIR_W-InvestmentStatement_3483.PDF"] }).status).toBe("already_filed");
  });
  it("refuses a household with no Vault and bad input", () => {
    expect(planBulkStatement({ ...base, hits: [hit({ vault_root_folder_id: null })] }).status).toBe("no_vault");
    expect(planBulkStatement({ ...base, statementDate: "June 30" }).status).toBe("bad_input");
    expect(planBulkStatement({ ...base, contract: "12" }).status).toBe("bad_input");
  });
  it("normalizes contract numbers", () => expect(normalizeContract(" 1820-293 483 ")).toBe("1820293483"));
});
