import { describe, it, expect } from "vitest";
import { matchStatementAccount, type MatchContext } from "../../supabase/functions/_shared/statement-match";

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({ vineyard: [], storehouses: [], tank: [], movedNumbers: [], ...over });
const line = (over: any = {}) => ({ account_name: "iA Financial - TFSA", account_number: "111", account_type: "TFSA", ...over });

describe("which account a contact-page statement belongs to", () => {
  it("matches by account number first", () => {
    const m = matchStatementAccount(line(), ctx({ vineyard: [{ id: "v1", account_name: "Something else", account_number: "111" }] }));
    expect(m).toMatchObject({ kind: "vineyard" });
  });
  it("does not treat a different contract with the same name as the same account", () => {
    expect(matchStatementAccount(line(), ctx({ vineyard: [{ id: "v1", account_name: "iA Financial - TFSA", account_number: "222" }] })).kind).toBe("new");
    expect(matchStatementAccount(line(), ctx({ vineyard: [{ id: "v1", account_name: "iA Financial - TFSA", account_number: null }] })).kind).toBe("vineyard");
  });
  it("updates a Holding Tank account instead of adding another", () => {
    expect(matchStatementAccount(line(), ctx({ tank: [{ id: "t1", account_name: "x", account_number: "111" }] }))).toMatchObject({ kind: "tank" });
  });
  it("matches a Storehouse by its label", () => {
    expect(matchStatementAccount(line({ account_name: "iA Financial - RESP", account_number: "5742" }), ctx({ storehouses: [{ id: "s1", label: "iA Financial - RESP", asset_type: "RESP" }] })).kind).toBe("storehouse");
  });
  it("skips an account already moved into a Vineyard or Storehouse rather than adding it again", () => {
    const m = matchStatementAccount(line({ account_name: "iA Financial - RESP", account_number: "1819025742" }), ctx({ movedNumbers: ["1819025742"] }));
    expect(m).toMatchObject({ kind: "skip", reason: expect.stringMatching(/already been moved/) });
  });
  it("skips an insurance contract read as an investment account", () => {
    expect(matchStatementAccount(line({ account_name: "iA Financial - Whole Life Insurance (iA PAR Wealth)", account_number: "9132375604", account_type: "Other" }), ctx())).toMatchObject({ kind: "skip", reason: expect.stringMatching(/insurance policy/) });
  });
  it("adds a genuinely new account", () => {
    expect(matchStatementAccount(line(), ctx()).kind).toBe("new");
  });
});
