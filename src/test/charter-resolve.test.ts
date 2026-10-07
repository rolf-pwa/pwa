import { describe, expect, it } from "vitest";
import { decideCharter } from "../../supabase/functions/_shared/charter-decide";

const base = { vaultCharter: null, hasHouseholdCharter: false, householdComplete: false, hasContactCharterRow: false, hasCharterUrl: false, contactCharterRatified: false };

describe("decideCharter", () => {
  it("a Charter in the Vault wins, and a draft-named file is not ratified", () => {
    expect(decideCharter({ ...base, vaultCharter: { ratified: true }, hasHouseholdCharter: true })).toEqual({ source: "vault", ratified: true });
    expect(decideCharter({ ...base, vaultCharter: { ratified: false } })).toEqual({ source: "vault", ratified: false });
  });
  it("then the household v2 Charter, ratified only when complete", () => {
    expect(decideCharter({ ...base, hasHouseholdCharter: true, householdComplete: true })).toEqual({ source: "household", ratified: true });
    expect(decideCharter({ ...base, hasHouseholdCharter: true })).toEqual({ source: "household", ratified: false });
  });
  it("then an earlier-format Charter: a linked document or a ratified row counts as ratified", () => {
    expect(decideCharter({ ...base, hasCharterUrl: true })).toEqual({ source: "contact", ratified: true });
    expect(decideCharter({ ...base, hasContactCharterRow: true, contactCharterRatified: true })).toEqual({ source: "contact", ratified: true });
    expect(decideCharter({ ...base, hasContactCharterRow: true })).toEqual({ source: "contact", ratified: false });
  });
  it("no Charter anywhere", () => {
    expect(decideCharter(base)).toEqual({ source: null, ratified: false });
  });
});
