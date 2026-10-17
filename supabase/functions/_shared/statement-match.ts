// statement-match.ts: which account on file a statement line belongs to. Pure (no I/O), shared by the contact-page upload.
// Same rules as the Vault scan's plan (vault-apply.ts): match by account number first; fall back to the name only when the
// account on file has no number of its own (two contracts can share a name); never add a second copy of an account that has
// already been moved into a Vineyard or Storehouse; and never read an insurance contract as an investment account.
import { looksLikeInsurancePolicy, normalizeToken } from "./vault-apply.ts";

export interface StatementLine { account_name?: string | null; account_number?: string | null; account_type?: string | null }
export interface MatchContext {
  vineyard: { id: string; account_name: string; account_number: string | null }[];
  storehouses: { id: string; label: string | null; asset_type: string | null }[];
  tank: { id: string; account_name?: string | null; account_number: string | null }[];
  /** Account numbers of Holding Tank rows already moved into a Vineyard or Storehouse. */
  movedNumbers: string[];
}
export type StatementMatch =
  | { kind: "vineyard"; row: MatchContext["vineyard"][number] }
  | { kind: "storehouse"; row: MatchContext["storehouses"][number] }
  | { kind: "tank"; row: MatchContext["tank"][number] }
  | { kind: "skip"; reason: string }
  | { kind: "new" };

export function matchStatementAccount(a: StatementLine, ctx: MatchContext): StatementMatch {
  const num = normalizeToken(a.account_number);
  const name = normalizeToken(a.account_name);
  const sameOrUnnumbered = <T extends { account_number: string | null }>(row: T | undefined) =>
    row && (!num || !normalizeToken(row.account_number) || normalizeToken(row.account_number) === num) ? row : undefined;

  const vNum = num ? ctx.vineyard.find((r) => normalizeToken(r.account_number) === num) : undefined;
  const vineyard = vNum ?? sameOrUnnumbered(ctx.vineyard.find((r) => normalizeToken(r.account_name) === name));
  if (vineyard) return { kind: "vineyard", row: vineyard };
  const storehouse = ctx.storehouses.find((s) => [s.label, s.asset_type].filter(Boolean).some((v) => normalizeToken(v) === name));
  if (storehouse) return { kind: "storehouse", row: storehouse };
  const tNum = num ? ctx.tank.find((r) => normalizeToken(r.account_number) === num) : undefined;
  const tank = tNum ?? sameOrUnnumbered(ctx.tank.find((r) => normalizeToken(r.account_name) === name));
  if (tank) return { kind: "tank", row: tank };
  if (looksLikeInsurancePolicy(a)) return { kind: "skip", reason: "This is an insurance policy, not an investment account. Add it from the insurance documents." };
  if (num && ctx.movedNumbers.map(normalizeToken).includes(num)) return { kind: "skip", reason: "This account has already been moved into a Vineyard or Storehouse. Update it there; adding it again would duplicate it." };
  return { kind: "new" };
}
